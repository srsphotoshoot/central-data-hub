"""
Standalone AI dress-matcher service.

Runs the SigLIP model + FAISS index in their own OS process, on their own
port, separate from main.py's API server. Heavy CPU-bound inference here
(add_product/search) competes for this process's GIL only — it can no
longer starve the dashboard/catalog/admin endpoints served by main.py,
which was the root cause of the API freezing during bulk Drive ingests.

main.py's /api/v1/matcher/* routes proxy to this service over HTTP.
"""
import os
from io import BytesIO
from typing import List

import uvicorn
from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from PIL import Image

from services import hf_sync
from services.matcher_service import (
    INDEX_FILE, MAP_FILE, THUMB_DIR,
    KEYPOINT_RERANK_CLOSE_CALL_RATIO, MIN_INLIERS_FOR_KEYPOINT_VERIFIED,
    matcher,
)

app = FastAPI(title="CDH Matcher Service")

# Wide-open CORS so a browser-based test page (or the Sutra web app) can call this API
# directly — access is still gated by the X-API-Key check below, this only controls
# which browser origins are allowed to read the response.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Optional shared-secret auth. No-op locally (PM2, no MATCHER_API_KEY set) — this only
# matters once the service is reachable over the public internet (e.g. Cloud Run), where
# /add and /products/{name} DELETE would otherwise be wide open to anyone with the URL.
MATCHER_API_KEY = os.environ.get("MATCHER_API_KEY")


async def require_api_key(x_api_key: str = Header(default=None)):
    if MATCHER_API_KEY and x_api_key != MATCHER_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")


@app.on_event("shutdown")
async def flush_hf_on_shutdown():
    """Narrows the mark_dirty()/background-thread trade-off above: on a
    graceful stop (Cloud Run sends SIGTERM before actually killing the
    container, e.g. a redeploy or a controlled scale-down) this guarantees
    the last batch of adds/deletes reaches HF instead of waiting for the
    next scheduled flush that may never come. Does nothing on a hard kill
    (OOM, `docker kill`) — no hook fires in that case, same as before this
    existed; only bounds the window, doesn't close it."""
    if hf_sync.ENABLED:
        await run_in_threadpool(hf_sync.push, INDEX_FILE, MAP_FILE)
        await run_in_threadpool(hf_sync.push_thumbnails, THUMB_DIR)


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": matcher.is_loaded}


@app.post("/verify", dependencies=[Depends(require_api_key)])
async def verify_dress(files: List[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    pil_images = []
    for file in files[:4]:
        content = await file.read()
        pil_images.append(Image.open(BytesIO(content)))

    similarity, matched_name, all_scores = await run_in_threadpool(matcher.search, pil_images)
    is_match = bool(similarity > 0.80)

    # Confidence based on the MARGIN to the runner-up, not the raw similarity score.
    # Diagnosed 2026-09-10 against real logged mismatches (learning_log.jsonl) and a
    # 40-query random sample of the full catalog: raw similarity does NOT separate
    # correct from incorrect picks (wrong picks reached 0.9528 while some correct
    # picks scored as low as 0.9363 -- entirely overlapping ranges). The margin
    # between the top pick and the runner-up is a much better signal (~2.5x larger
    # on average for correct picks: ~0.030 vs ~0.012 for wrong ones), though still
    # not perfect on its own -- treat "low" as "worth a second look", not "wrong".
    # Reuses KEYPOINT_RERANK_CLOSE_CALL_RATIO so "low confidence" here means exactly
    # the same thing as "close call" did when deciding whether to keypoint re-rank.
    runner_up_name, runner_up_score = None, -1.0
    for name, score in all_scores.items():
        if name != matched_name and score > runner_up_score:
            runner_up_name, runner_up_score = name, score
    margin = float(similarity - runner_up_score) if runner_up_name is not None else None
    is_close_call = (runner_up_name is not None and similarity > 0
                      and runner_up_score / similarity >= KEYPOINT_RERANK_CLOSE_CALL_RATIO)

    # Absolute keypoint sanity check on the top pick itself (distinct from the
    # relative re-rank already applied inside matcher.search() for close calls).
    # Diagnosed 2026-09-10: margin/confidence above only measures "how contested was
    # this decision among catalog candidates" -- it says nothing about whether the
    # query is actually IN the catalog at all. An out-of-catalog garment that lands
    # at, say, 0.89 similarity with no other candidate close behind it would get
    # "confidence": "high" from margin alone despite being a real mismatch. Only
    # runs when is_match, since there's nothing useful to sanity-check otherwise.
    keypoint_inliers = None
    if is_match:
        keypoint_inliers = await run_in_threadpool(matcher.verify_with_keypoints, pil_images, matched_name)
    keypoint_verified = (keypoint_inliers >= MIN_INLIERS_FOR_KEYPOINT_VERIFIED) if keypoint_inliers is not None else None

    # Confidence is driven by the KEYPOINT check first and the margin only as a fallback.
    # Measured 2026-09-16 on n=91 real held-out photos over the 34 most confusable designs
    # (see MIN_INLIERS_FOR_KEYPOINT_VERIFIED for the full method). Precision of a "high":
    #     keypoint (>=12 inliers) : 47/47  = 100%
    #     margin only             : 15/16  =  94%
    #     margin AND keypoint@30  :  8/9   =  89%   <- what this used to do
    # The old rule ANDed the two, so a genuine match that happened to be a close call was
    # downgraded even when the keypoints confirmed it outright. Keypoints win when they
    # have an answer; margin is consulted only when they don't (no thumbnail for this
    # product yet, or ORB threw).
    if keypoint_verified is True:
        confidence = "high"
    elif keypoint_verified is False:
        confidence = "low"
    else:  # None -- couldn't check; fall back to the margin signal
        confidence = "low" if is_close_call else "high"

    return {
        "similarity": float(similarity),
        "match": is_match,
        "matched_product": matched_name if is_match else "Unknown Imposter",
        "threshold": 0.80,
        "confidence": confidence,
        "margin": margin,
        "runner_up_product": runner_up_name,
        "runner_up_similarity": float(runner_up_score) if runner_up_name is not None else None,
        "keypoint_verified": keypoint_verified,
        "keypoint_inliers": keypoint_inliers,
    }


@app.post("/add", dependencies=[Depends(require_api_key)])
async def add_dress_reference(
    background_tasks: BackgroundTasks,
    product_name: str = Form(...),
    files: List[UploadFile] = File(...)
):
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    pil_images = []
    for file in files:
        content = await file.read()
        pil_images.append(Image.open(BytesIO(content)))

    # add_product() now only does the (fast, few-ms) local FAISS+labels save —
    # see matcher_service.py's save_db_local()/save_db() split, 5 Sep 2026.
    # The HF Dataset push used to run inline here and was the entire reason
    # this request took ~60s end-to-end (confirmed live against a real Drive
    # ingest) even though the actual embedding work is fast. mark_dirty()
    # just flags the change (instant) — a background thread in hf_sync.py
    # actually pushes at most once every HF_PUSH_INTERVAL_SECONDS, coalescing
    # any burst of adds into one HF commit instead of one-per-request (a fast
    # burst hit HF's 128-commits/hour cap live, 5 Sep 2026, back when this
    # was still push() per request) — same pattern for the DELETE handler
    # below.
    #
    # Trade-off, accepted deliberately: if this Cloud Run instance is killed
    # (scale-to-zero, crash, redeploy) in the narrow window between the last
    # unflushed add and the next scheduled push (bounded by
    # HF_PUSH_INTERVAL_SECONDS, plus the shutdown-flush below narrows it
    # further for a graceful stop), that add is only on this instance's
    # ephemeral local disk and is lost on the next cold start (which pulls
    # from HF). Acceptable here — a lost /add just means Drive's own
    # sync_state.json won't have marked it done either (it's set based on
    # THIS response), so drive_watcher.py will simply retry it on a later
    # scan; nothing upstream treats this response as the last word.
    count = await run_in_threadpool(matcher.add_product, pil_images, product_name)
    background_tasks.add_task(hf_sync.mark_dirty, INDEX_FILE, MAP_FILE, THUMB_DIR)

    return {
        "status": "success",
        "message": f"Successfully stored {len(pil_images)} reference images ({count} vectors) for '{product_name}'."
    }


@app.get("/stats", dependencies=[Depends(require_api_key)])
async def get_matcher_stats():
    return matcher.get_stats()


@app.get("/products", dependencies=[Depends(require_api_key)])
async def get_matcher_products():
    return {"products": matcher.get_products()}


@app.delete("/products/{product_name}", dependencies=[Depends(require_api_key)])
async def delete_matcher_product(product_name: str, background_tasks: BackgroundTasks):
    success = matcher.delete_product(product_name)
    if not success:
        raise HTTPException(status_code=404, detail=f"Product '{product_name}' not found in matcher database")
    # Same async-push pattern as /add above.
    background_tasks.add_task(hf_sync.mark_dirty, INDEX_FILE, MAP_FILE, THUMB_DIR)
    return {"status": "success", "message": f"Successfully deleted product '{product_name}' from matcher index."}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
