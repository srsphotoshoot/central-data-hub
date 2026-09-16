"""
Rebuilds the matcher's FAISS index from scratch by walking the Google Drive catalog and
feeding every reference photo of each product/colour into add_product() in-process.

As of 2026-09-16 this ingests ALL of a colourway's photos, not just the AI render:
the render, the four real photographed angles (f/b/l/r) from the colour folder, and the
lc/ close-ups. See collect_style_variants for how each source is found and why. The
render alone left the index unable to recognise a garment from its sides -- 37.4% on a
left-side query against 82.4% on a front one; all four angles together took the average
from 56.9% to 83.0%.

Resumable: skips any product_name already present in the index (checked via
matcher.get_products()), so it can be safely re-run after an interruption.

Build somewhere else first. A full re-ingest is several hours and replaces what the
matcher serves, so point it at a scratch directory, evaluate that index with
scripts/leave_one_angle_out.py, and only then swap it in:

    MATCHER_DATA_DIR=$PWD/data/matcher_v2 ./venv/bin/python scripts/rebuild_matcher_index.py

Usage:
    ./venv/bin/python scripts/rebuild_matcher_index.py [--limit N]
"""
import os
import io
import re
import sys
import time
import argparse
import logging
import difflib
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import requests
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from googleapiclient.errors import HttpError
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from PIL import Image

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

from services.matcher_service import matcher  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("rebuild-index")

SCOPES = ['https://www.googleapis.com/auth/drive']
PARENT_FOLDER_ID = '1qD743hkc_GWWw8bxdqhgzgeW6shquYHo'
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff'}
RETRYABLE = (429, 500, 503)
TOKEN_FILE = os.path.join(REPO_ROOT, "token.json")


def authenticate():
    if not os.path.exists(TOKEN_FILE):
        logger.error(f"{TOKEN_FILE} not found! Run services/authenticate_drive.py first.")
        sys.exit(1)
    creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return build('drive', 'v3', credentials=creds)


def api_call(fn, retries=5):
    for attempt in range(retries):
        try:
            return fn()
        except HttpError as e:
            if e.resp.status in RETRYABLE and attempt < retries - 1:
                wait = 2 ** attempt
                logger.warning(f"Drive HTTP {e.resp.status}, retry {attempt+1}/{retries-1} in {wait}s...")
                time.sleep(wait)
            else:
                raise
        except Exception as e:
            if attempt < retries - 1:
                wait = 2 ** attempt
                logger.warning(f"Network error ({type(e).__name__}), retry {attempt+1}/{retries-1} in {wait}s...")
                time.sleep(wait)
            else:
                raise


def list_folders(service, parent_id):
    r = api_call(lambda: service.files().list(
        q=f"'{parent_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields="files(id, name)"
    ).execute())
    return r.get('files', [])


def list_images(service, parent_id):
    r = api_call(lambda: service.files().list(
        q=f"'{parent_id}' in parents and trashed=false",
        fields="files(id, name, mimeType, imageMediaMetadata(time))"
    ).execute())
    files = r.get('files', [])
    return [f for f in files
            if f.get('mimeType', '').startswith('image/')
            or os.path.splitext(f['name'])[1].lower() in IMAGE_EXTS]


def is_ai_folder(name):
    n = name.upper()
    return n == "AI" or n.endswith("-AI") or n.endswith(" AI") or "-AI-" in n


LC_FOLDER_NAMES = {"LC"}
# How far apart a close-up and a colour's own photos may be shot and still be treated as
# the same colourway. The shoot runs colour by colour with roughly ten minutes per colour,
# so five is comfortably inside one colour's block without reaching the next.
LC_MAX_GAP_MINUTES = 5


def shot_time(f):
    """EXIF capture time, or None. Used to attach lc/ close-ups to a colourway."""
    t = (f.get('imageMediaMetadata') or {}).get('time')
    if not t:
        return None
    try:
        return datetime.strptime(t, "%Y:%m:%d %H:%M:%S")
    except Exception:
        return None


def is_lc_folder(name):
    return name.strip().upper() in LC_FOLDER_NAMES


def color_from_filename(filename):
    root, ext = os.path.splitext(filename)
    return (root if ext.lower() in IMAGE_EXTS else filename).upper()


def download_image(service, file_id):
    request = service.files().get_media(fileId=file_id)
    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = api_call(lambda: downloader.next_chunk())
    buf.seek(0)
    return Image.open(buf).convert("RGB")


# googleapiclient's service object wraps a single httplib2.Http, which is not thread-safe,
# so each worker thread builds and keeps its own.
_local = threading.local()


def thread_service():
    if not hasattr(_local, "svc"):
        _local.svc = authenticate()
    return _local.svc


DOWNLOAD_WORKERS = int(os.environ.get("REBUILD_DOWNLOAD_WORKERS", "8"))


def download_images(file_ids):
    """Fetch one colourway's photos in parallel, preserving order.

    Serially this dominated the whole run: a full catalogue pass is roughly 9,000 photos
    (518 style folders, ~2.5 colourways each, ~7 photos per colourway once the four real
    angles and the close-ups are included) and downloads alone ran near 18 hours at about
    8 photos a minute. Embedding is the floor at ~2.5s per photo, so there is no point
    driving this further than a handful of workers."""
    out = [None] * len(file_ids)

    def fetch(i_fid):
        i, fid = i_fid
        try:
            return i, download_image(thread_service(), fid)
        except Exception as e:
            logger.warning(f"  Failed to download image {fid}: {e}")
            return i, None

    with ThreadPoolExecutor(max_workers=min(DOWNLOAD_WORKERS, max(1, len(file_ids)))) as ex:
        for i, img in ex.map(fetch, list(enumerate(file_ids))):
            out[i] = img
    return [im for im in out if im is not None]


def collect_style_variants(service, style):
    """Returns {color: [file_id, ...]} for one style folder, merging three sources.

    Until 2026-09-16 only the first of these was ingested, so every colourway was
    represented by a single synthetic render. Measured effect of that: a front-view query
    matched 82.4% of the time but a left-side view only 37.4%, because no photograph of
    the garment's sides was ever in the index. Adding the real angles took the average
    across all four viewpoints from 56.9% to 83.0% (see TODAY.md, "THE ANGLE FINDING").

      ai/          the synthetic render. Structure A: <style>/ai/<colour>.png,
                   Structure B: <style>/<colour>/ai/... . Kept -- it is the view that
                   matches a front-facing query best, and angles are additive, not
                   interchangeable.
      <colour>/    the real photographed angles, f/b/l/r.JPG, sitting directly in each
                   colour folder.
      lc/          close-ups. Their filenames are all just "up.JPG"/"down.JPG" with no
                   colour in them, so each is attached to whichever colour has the
                   nearest photo by EXIF shot time (see shot_time / LC_MAX_GAP_MINUTES).
                   Anything outside that window is skipped rather than guessed, since a
                   wrong attachment is label noise in the index.
    """
    subfolders = list_folders(service, style['id'])
    variants_map = {}

    ai_folder = next((sf for sf in subfolders if is_ai_folder(sf['name'])), None)
    if ai_folder:
        try:
            for f in list_images(service, ai_folder['id']):
                color = color_from_filename(f['name'])
                variants_map.setdefault(color, []).append(f['id'])
        except Exception as e:
            logger.warning(f"  Structure-A listing failed for {style['name']}: {e}")

    # Colour keys from ai/ come from the FILE name, colour keys from the subfolders come
    # from the FOLDER name, and the two disagree often enough to matter: SRS-8693 has an
    # "off white" folder whose render is named "offf white.png", and a "lavendar" folder
    # against a "lavender" render. Taken literally that splits one colourway into two
    # products and the real photos never join their own render. So a folder name is
    # snapped to an existing ai/-derived key when it is clearly the same colour, and the
    # ai/ spelling wins -- it is what is already indexed and what /verify already returns.
    ai_colors = list(variants_map)

    def canonical_color(folder_name):
        name = folder_name.strip().upper()
        if name in variants_map:
            return name
        close = difflib.get_close_matches(name, ai_colors, n=1, cutoff=0.7)
        if close and close[0] != name:
            logger.info(f"  {style['name']}: folder '{folder_name}' -> '{close[0]}' (matched to ai/ spelling)")
        return close[0] if close else name

    colour_times = {}
    for color_sf in subfolders:
        if is_ai_folder(color_sf['name']) or is_lc_folder(color_sf['name']):
            continue
        color_name = canonical_color(color_sf['name'])
        try:
            direct = list_images(service, color_sf['id'])
            for f in direct:
                variants_map.setdefault(color_name, []).append(f['id'])
            times = [t for t in (shot_time(f) for f in direct) if t]
            if times:
                colour_times[color_name] = times

            color_subs = list_folders(service, color_sf['id'])
            nested_ai = next((c for c in color_subs if is_ai_folder(c['name'])), None)
            if nested_ai:
                for f in list_images(service, nested_ai['id']):
                    variants_map.setdefault(color_name, []).append(f['id'])
        except Exception as e:
            logger.warning(f"  Structure-B listing failed for {style['name']}/{color_sf['name']}: {e}")

    lc_folder = next((sf for sf in subfolders if is_lc_folder(sf['name'])), None)
    if lc_folder and colour_times:
        skipped = 0
        try:
            for f in list_images(service, lc_folder['id']):
                t = shot_time(f)
                if not t:
                    skipped += 1
                    continue
                colour, gap = min(
                    ((c, min(abs((t - x).total_seconds()) for x in ts))
                     for c, ts in colour_times.items()),
                    key=lambda z: z[1])
                if gap > LC_MAX_GAP_MINUTES * 60:
                    skipped += 1
                    continue
                variants_map.setdefault(colour, []).append(f['id'])
            if skipped:
                logger.info(f"  {style['name']}: {skipped} close-up(s) unassigned (no EXIF, or >{LC_MAX_GAP_MINUTES}min from any colour)")
        except Exception as e:
            logger.warning(f"  lc/ listing failed for {style['name']}: {e}")

    return variants_map


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Only process first N styles (for a test run)")
    args = parser.parse_args()

    logger.info("Loading SigLIP model...")
    matcher.load_model()
    matcher.load_db()
    already_done = {p["name"] for p in matcher.get_products()}
    logger.info(f"{len(already_done)} product/color entries already indexed — will be skipped.")

    service = authenticate()

    styles = []
    page_token = None
    while True:
        resp = api_call(lambda: service.files().list(
            q=f"'{PARENT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
            fields="nextPageToken, files(id, name)",
            pageToken=page_token
        ).execute())
        styles.extend(resp.get('files', []))
        page_token = resp.get('nextPageToken')
        if not page_token:
            break

    if args.limit:
        styles = styles[:args.limit]

    logger.info(f"Found {len(styles)} style folders. Starting ingest...")

    total_products_done = 0
    total_images_embedded = 0
    t0 = time.time()

    for si, style in enumerate(styles, 1):
        style_code = re.sub(r'-[mM]$', '', style['name']).upper()

        try:
            variants_map = collect_style_variants(service, style)
        except Exception as e:
            logger.error(f"[{si}/{len(styles)}] Skipping style {style['name']} — {e}")
            continue

        if not variants_map:
            continue

        for color, file_ids in variants_map.items():
            product_name = f"SRS-{style_code}-{color}"
            if product_name in already_done:
                continue

            pil_images = download_images(file_ids)

            if not pil_images:
                continue

            try:
                # add_product() only does a local save now (5 Sep 2026 —
                # HF push moved out so the matcher_server.py HTTP path isn't
                # blocked on it per-request, see matcher_service.py's
                # save_db_local()/save_db() split). This script has no HTTP
                # response to send early, so it explicitly flushes to HF
                # itself every 50 products as a crash-safety checkpoint,
                # rather than relying on a push after every single one like
                # before (which is also what made every /add call ~60s).
                n = matcher.add_product(pil_images, product_name)
                total_products_done += 1
                total_images_embedded += n
                elapsed = time.time() - t0
                logger.info(
                    f"[{si}/{len(styles)}] {product_name}: +{n} embeddings "
                    f"({len(pil_images)} imgs) | total products so far: {total_products_done} | "
                    f"imgs: {total_images_embedded} | elapsed: {elapsed/60:.1f}m"
                )
                if total_products_done % 50 == 0:
                    logger.info("  Checkpoint: pushing to HF Dataset (no-op if HF_TOKEN unset)...")
                    matcher.save_db()  # local save (already done) + HF push
            except Exception as e:
                logger.error(f"  add_product failed for {product_name}: {e}")

    logger.info("Final flush: pushing to HF Dataset (no-op if HF_TOKEN unset)...")
    matcher.save_db()

    logger.info(
        f"DONE. Products ingested this run: {total_products_done}, "
        f"embeddings added: {total_images_embedded}, "
        f"total time: {(time.time()-t0)/60:.1f} min"
    )
    stats = matcher.get_stats()
    logger.info(f"Final index stats: {stats}")


if __name__ == '__main__':
    main()
