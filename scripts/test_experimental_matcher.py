"""
Isolated before/after test for the search()-logic experiments in
services/matcher_service_experimental.py (mtime caching, dynamic k, and the
two-stage design->colorway selection).

Uses its own isolated data dir (matcher_service_experimental's DATA_DIR) —
never touches the real production index or the ongoing full re-ingest.

Method: for each style/color group with >=2 reference photos, hold out the
LAST photo as a query and index the rest. Then run search() on every held-out
query and compare two picks computed from the exact same product_final scores
(so embeddings/search are identical between old and new — only the final
selection step differs):
  - old_pick = argmax(product_final)                          (original behavior)
  - new_pick = two-stage design-then-colorway pick (experimental, returned by search())

Usage:
    ./venv/bin/python scripts/test_experimental_matcher.py [--styles N]
"""
import os
import io
import re
import sys
import time
import argparse
import logging

from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from googleapiclient.errors import HttpError
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from PIL import Image

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

from services.matcher_service_experimental import matcher  # noqa: E402

logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(message)s")
logger = logging.getLogger("test-experimental")
logger.setLevel(logging.INFO)

SCOPES = ['https://www.googleapis.com/auth/drive']
PARENT_FOLDER_ID = '1qD743hkc_GWWw8bxdqhgzgeW6shquYHo'
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff'}
RETRYABLE = (429, 500, 503)
TOKEN_FILE = os.path.join(REPO_ROOT, "token.json")


def authenticate():
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
                time.sleep(2 ** attempt)
            else:
                raise
        except Exception:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
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
    subfolders = list_folders(service, style['id'])
    variants_map = {}
    ai_folder = next((sf for sf in subfolders if is_ai_folder(sf['name'])), None)
    if ai_folder:
        for f in list_images(service, ai_folder['id']):
            color = color_from_filename(f['name'])
            variants_map.setdefault(color, []).append(f['id'])
    for color_sf in subfolders:
        if is_ai_folder(color_sf['name']):
            continue
        color_name = color_sf['name'].upper()
        color_subs = list_folders(service, color_sf['id'])
        nested_ai = next((c for c in color_subs if is_ai_folder(c['name'])), None)
        if nested_ai:
            for f in list_images(service, nested_ai['id']):
                variants_map.setdefault(color_name, []).append(f['id'])
    return variants_map


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-queries", type=int, default=20,
                         help="Keep scanning style folders until this many held-out queries are collected")
    parser.add_argument("--max-styles", type=int, default=150,
                         help="Safety cap on how many style folders to scan while searching for multi-photo colorways")
    args = parser.parse_args()

    matcher.load_model()
    matcher.load_db()

    service = authenticate()

    held_out = []  # (query_image, ground_truth_product_name)
    indexed_products = 0
    si = 0
    page_token = None
    styles_buffer = []

    print(f"Scanning style folders (up to {args.max_styles}) until {args.target_queries} held-out queries are found...")
    while si < args.max_styles and len(held_out) < args.target_queries:
        if not styles_buffer:
            resp = api_call(lambda: service.files().list(
                q=f"'{PARENT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
                fields="nextPageToken, files(id, name)",
                pageToken=page_token
            ).execute())
            styles_buffer = resp.get('files', [])
            page_token = resp.get('nextPageToken')
            if not styles_buffer:
                break
        style = styles_buffer.pop(0)
        si += 1
        style_code = re.sub(r'-[mM]$', '', style['name']).upper()
        try:
            variants_map = collect_style_variants(service, style)
        except Exception as e:
            print(f"  [{si}] skip {style['name']}: {e}")
            continue

        for color, file_ids in variants_map.items():
            product_name = f"SRS-{style_code}-{color}"
            images = []
            for fid in file_ids:
                try:
                    images.append(download_image(service, fid))
                except Exception:
                    pass
            if not images:
                continue

            if len(images) >= 2:
                query_img = images[-1]
                to_index = images[:-1]
                held_out.append((query_img, product_name))
            else:
                to_index = images

            matcher.add_product(to_index, product_name)
            indexed_products += 1

        print(f"  [{si}] {style['name']}: {len(variants_map)} colorways indexed so far (total products: {indexed_products}, held-out queries: {len(held_out)})")

    print(f"\nIndex built: {indexed_products} product/color entries, {len(held_out)} held-out queries.\n")
    print("Running held-out queries...\n")

    old_correct = 0
    new_correct = 0
    disagreements = []

    for query_img, ground_truth in held_out:
        best_score, new_pick, product_final = matcher.search([query_img])
        if not product_final:
            continue
        old_pick = max(product_final, key=product_final.get)

        old_ok = (old_pick == ground_truth)
        new_ok = (new_pick == ground_truth)
        old_correct += int(old_ok)
        new_correct += int(new_ok)

        if old_pick != new_pick:
            disagreements.append((ground_truth, old_pick, new_pick, old_ok, new_ok))

    n = len(held_out)
    print("=" * 70)
    print(f"RESULTS  (n={n} held-out queries)")
    print(f"  OLD (flat argmax)         : {old_correct}/{n}  ({100*old_correct/n:.1f}%)" if n else "  n=0")
    print(f"  NEW (design->colorway)    : {new_correct}/{n}  ({100*new_correct/n:.1f}%)" if n else "")
    print("=" * 70)

    if disagreements:
        print(f"\n{len(disagreements)} cases where old and new picked differently:")
        for gt, old_p, new_p, old_ok, new_ok in disagreements:
            marker_old = "correct" if old_ok else "WRONG"
            marker_new = "correct" if new_ok else "WRONG"
            print(f"  truth={gt}  |  old={old_p} ({marker_old})  |  new={new_p} ({marker_new})")


if __name__ == '__main__':
    main()
