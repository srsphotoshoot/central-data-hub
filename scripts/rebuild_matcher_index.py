"""
One-off recovery script: rebuilds the matcher's FAISS index from scratch by
walking the same Google Drive catalog structure as import_catalog_from_drive.py,
downloading each product/color's AI reference images, and feeding them straight
into services.matcher_service.matcher.add_product() (in-process, no HTTP hop).

Resumable: skips any product_name already present in the index (checked via
matcher.get_products()), so it can be safely re-run after an interruption.

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
        fields="files(id, name, mimeType)"
    ).execute())
    files = r.get('files', [])
    return [f for f in files
            if f.get('mimeType', '').startswith('image/')
            or os.path.splitext(f['name'])[1].lower() in IMAGE_EXTS]


def is_ai_folder(name):
    n = name.upper()
    return n == "AI" or n.endswith("-AI") or n.endswith(" AI") or "-AI-" in n


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


def collect_style_variants(service, style):
    """Returns {color: [file_id, ...]} for one style folder, same logic as
    import_catalog_from_drive.py's two supported Drive layouts."""
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

    for color_sf in subfolders:
        if is_ai_folder(color_sf['name']):
            continue
        color_name = color_sf['name'].upper()
        try:
            color_subs = list_folders(service, color_sf['id'])
            nested_ai = next((c for c in color_subs if is_ai_folder(c['name'])), None)
            if nested_ai:
                for f in list_images(service, nested_ai['id']):
                    variants_map.setdefault(color_name, []).append(f['id'])
        except Exception as e:
            logger.warning(f"  Structure-B listing failed for {style['name']}/{color_sf['name']}: {e}")

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

            pil_images = []
            for fid in file_ids:
                try:
                    pil_images.append(download_image(service, fid))
                except Exception as e:
                    logger.warning(f"  Failed to download image {fid} for {product_name}: {e}")

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
                    f"elapsed: {elapsed/60:.1f}m"
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
