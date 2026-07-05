"""
Standalone AI dress-matcher service.

Runs the SigLIP model + FAISS index in their own OS process, on their own
port, separate from main.py's API server. Heavy CPU-bound inference here
(add_product/search) competes for this process's GIL only — it can no
longer starve the dashboard/catalog/admin endpoints served by main.py,
which was the root cause of the API freezing during bulk Drive ingests.

main.py's /api/v1/matcher/* routes proxy to this service over HTTP.
"""
from io import BytesIO
from typing import List

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool
from PIL import Image

from services.matcher_service import matcher

app = FastAPI(title="CDH Matcher Service")


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": matcher.is_loaded}


@app.post("/verify")
async def verify_dress(files: List[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    pil_images = []
    for file in files[:4]:
        content = await file.read()
        pil_images.append(Image.open(BytesIO(content)))

    similarity, matched_name, all_scores = await run_in_threadpool(matcher.search, pil_images)
    is_match = bool(similarity > 0.80)

    return {
        "similarity": float(similarity),
        "match": is_match,
        "matched_product": matched_name if is_match else "Unknown Imposter",
        "threshold": 0.80
    }


@app.post("/add")
async def add_dress_reference(
    product_name: str = Form(...),
    files: List[UploadFile] = File(...)
):
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    pil_images = []
    for file in files:
        content = await file.read()
        pil_images.append(Image.open(BytesIO(content)))

    count = await run_in_threadpool(matcher.add_product, pil_images, product_name)

    return {
        "status": "success",
        "message": f"Successfully stored {len(pil_images)} reference images ({count} vectors) for '{product_name}'."
    }


@app.get("/stats")
async def get_matcher_stats():
    return matcher.get_stats()


@app.get("/products")
async def get_matcher_products():
    return {"products": matcher.get_products()}


@app.delete("/products/{product_name}")
async def delete_matcher_product(product_name: str):
    success = matcher.delete_product(product_name)
    if not success:
        raise HTTPException(status_code=404, detail=f"Product '{product_name}' not found in matcher database")
    return {"status": "success", "message": f"Successfully deleted product '{product_name}' from matcher index."}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
