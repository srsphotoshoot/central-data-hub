"""
Drive Watcher — Auto-Sync Daemon (Strict & End-to-End)
======================================================
Monitors Google Drive for both Flat photos and AI model photos.
Maintains a strict sync_state.json so it never loses track of what's been ingested.
"""

import os, io, time, re, logging, sys, requests, json
from PIL import Image
from dotenv import load_dotenv

cdh_path = "/Users/romitaggarwal/Desktop/AI/central data hub"
if cdh_path not in sys.path:
    sys.path.append(cdh_path)

from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google.oauth2 import service_account

load_dotenv(os.path.join(cdh_path, ".env"))

# ── Config ────────────────────────────────────────────────────────────────────
PARENT_FOLDER_ID = os.getenv("DRIVE_CATALOG_FOLDER_ID", "1qD743hkc_GWWw8bxdqhgzgeW6shquYHo")
API_BASE         = "http://localhost:8000/api/v1/matcher"
SCAN_INTERVAL    = int(os.getenv("DRIVE_SCAN_INTERVAL_SEC", "900"))  # 15 min default
TOKEN_FILE       = os.path.join(cdh_path, "token.json")
SERVICE_ACCOUNT  = os.path.join(cdh_path, "service_account.json")
IMAGE_EXTS       = {'.jpg', '.jpeg', '.png', '.webp', '.tiff', '.bmp'}

SYNC_STATE_FILE  = os.path.join(cdh_path, "data", "matcher", "sync_state.json")

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S',
    level=logging.INFO
)
logger = logging.getLogger("drive-watcher")

# ── Sync State Management ─────────────────────────────────────────────────────
def load_sync_state():
    if os.path.exists(SYNC_STATE_FILE):
        try:
            with open(SYNC_STATE_FILE, 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading sync state: {e}")
    return {}

def save_sync_state(state):
    try:
        # Ensure dir exists
        os.makedirs(os.path.dirname(SYNC_STATE_FILE), exist_ok=True)
        with open(SYNC_STATE_FILE, 'w') as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving sync state: {e}")

# ── Auth ──────────────────────────────────────────────────────────────────────
def get_drive_service():
    scopes = ['https://www.googleapis.com/auth/drive']
    if os.path.exists(SERVICE_ACCOUNT):
        try:
            creds = service_account.Credentials.from_service_account_file(SERVICE_ACCOUNT, scopes=scopes)
            return build('drive', 'v3', credentials=creds)
        except Exception as e:
            logger.error(f"Service account error: {e}")

    if os.path.exists(TOKEN_FILE):
        try:
            creds = Credentials.from_authorized_user_file(TOKEN_FILE, scopes)
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
                with open(TOKEN_FILE, 'w') as f:
                    f.write(creds.to_json())
            return build('drive', 'v3', credentials=creds)
        except Exception as e:
            logger.error(f"OAuth token error: {e}")

    logger.error("No valid Drive credentials found!")
    return None

# ── Drive Helpers ─────────────────────────────────────────────────────────────
def list_folders(service, parent_id):
    try:
        q = f"'{parent_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        r = service.files().list(q=q, fields="files(id, name)", pageSize=1000).execute()
        return r.get('files', [])
    except Exception as e:
        logger.error(f"list_folders error: {e}")
        return []

def list_files(service, parent_id):
    try:
        q = f"'{parent_id}' in parents and trashed = false"
        r = service.files().list(q=q, fields="files(id, name, mimeType)", pageSize=200).execute()
        return r.get('files', [])
    except Exception as e:
        logger.error(f"list_files error: {e}")
        return []

def download_file(service, file_id):
    for attempt in range(3):
        try:
            request  = service.files().get_media(fileId=file_id)
            buf      = io.BytesIO()
            dl       = MediaIoBaseDownload(buf, request, chunksize=4*1024*1024)
            done     = False
            while not done:
                _, done = dl.next_chunk()
            buf.seek(0)
            return buf
        except Exception as e:
            wait = 5 * (2 ** attempt)
            logger.warning(f"Download retry {attempt+1}/3 for {file_id}: {e}. Waiting {wait}s...")
            time.sleep(wait)
    raise RuntimeError(f"Download failed for file_id={file_id}")

# ── CDH API ───────────────────────────────────────────────────────────────────
def ingest_product(product_name, files_payload):
    for attempt in range(3):
        try:
            r = requests.post(
                f"{API_BASE}/add",
                data={'product_name': product_name},
                files=files_payload,
                timeout=180
            )
            return r.status_code == 200
        except Exception as e:
            wait = 5 * (2 ** attempt)
            logger.warning(f"Ingest retry {attempt+1}/3 for {product_name}: {e}. Waiting {wait}s...")
            time.sleep(wait)
            # Rewind BytesIO objects
            for _, (_, fio, _) in files_payload:
                try:
                    fio.seek(0)
                except:
                    pass
    return False

# ── Core Scan Logic ───────────────────────────────────────────────────────────
def scan_and_ingest_new(service):
    logger.info("=" * 55)
    logger.info("Scanning Google Drive catalog for strict end-to-end sync...")

    sync_state = load_sync_state()
    style_folders = list_folders(service, PARENT_FOLDER_ID)
    logger.info(f"Found {len(style_folders)} style folders on Drive")

    newly_ingested_flats = 0
    newly_ingested_ais   = 0

    for style in style_folders:
        style_code   = re.sub(r'-[mM]$', '', style['name']).upper()
        color_folders = list_folders(service, style['id'])

        # First pass: find AI folders mapping
        ai_folders_map = {}
        for folder in color_folders:
            n = folder['name'].upper()
            if n in ('AI', 'LC') or n.endswith('-AI') or n.endswith(' AI') or "-AI-" in n:
                # We store the folder reference to process later
                ai_folders_map[folder['id']] = folder

        # Second pass: Process actual color folders
        for color in color_folders:
            if color['id'] in ai_folders_map:
                continue # Skip processing AI folders as primary products

            product_name = f"SRS-{style_code}-{color['name'].upper()}"
            
            # Initialize state if not exists
            if product_name not in sync_state:
                sync_state[product_name] = {"flat_synced": False, "ai_synced": False, "last_updated": 0}
            
            p_state = sync_state[product_name]
            
            # --- PHASE 1: Sync Flat Photos ---
            if not p_state["flat_synced"]:
                color_files = list_files(service, color['id'])
                found = {}
                for f in color_files:
                    m = re.match(r'^([fblr])(\..+)?$', f['name'].lower())
                    if m:
                        found[m.group(1)] = f

                if len(found) == 0:
                    logger.warning(f"  ⚠ NEW {product_name}: missing ALL flats — skipping flats for now")
                else:
                    missing = [t for t in ['f','b','l','r'] if t not in found]
                    if missing:
                        logger.info(f"  ⚠ NEW {product_name}: missing {missing} flats — syncing available ones")
                    
                    logger.info(f"  🆕 Processing Flats for: {product_name}")
                    files_payload, open_ios = [], []
                    success = True

                    for ftype in found.keys():
                        try:
                            buf = download_file(service, found[ftype]['id'])
                            open_ios.append(buf)
                            files_payload.append(('files', (f'{ftype}.jpg', buf, 'image/jpeg')))
                        except Exception as e:
                            logger.error(f"    Download error ({ftype}): {e}")
                            success = False
                            break

                    if success and ingest_product(product_name, files_payload):
                        logger.info(f"    ✅ Flats Ingested: {product_name}")
                        p_state["flat_synced"] = True
                        p_state["last_updated"] = int(time.time())
                        save_sync_state(sync_state)
                        newly_ingested_flats += 1
                    else:
                        logger.error(f"    ❌ Flats Ingest FAILED: {product_name}")

                    for buf in open_ios:
                        buf.close()

            # --- PHASE 2: Sync AI Photos ---
            # We only sync AI photos if flats are synced (or we could sync independently, but usually we want flats as base)
            if p_state["flat_synced"] and not p_state["ai_synced"]:
                # Look for matching AI photos. We'll search in all AI subfolders within this style.
                ai_files_for_product = []
                for ai_folder in ai_folders_map.values():
                    ai_files = list_files(service, ai_folder['id'])
                    for f in ai_files:
                        # Match filename (e.g. "rama green.jpg") with color name
                        fname = f['name']
                        root, ext = os.path.splitext(fname)
                        if root.upper() == color['name'].upper():
                            if f.get('mimeType','').startswith('image/') or fname.lower().endswith(tuple(IMAGE_EXTS)):
                                ai_files_for_product.append((f, ext))

                if ai_files_for_product:
                    logger.info(f"  🆕 Processing AI Photos for: {product_name} ({len(ai_files_for_product)} found)")
                    files_payload, open_ios = [], []
                    success = True

                    for f, ext in ai_files_for_product:
                        try:
                            buf = download_file(service, f['id'])
                            open_ios.append(buf)
                            # Append 'ai_' prefix to avoid any filename collision, though API handles it
                            save_name = f"ai_{f['name']}" if ext else f"ai_{f['name']}.jpg"
                            files_payload.append(('files', (save_name, buf, 'image/jpeg')))
                        except Exception as e:
                            logger.error(f"    Download error (AI photo): {e}")
                            success = False
                            break
                    
                    if success and ingest_product(product_name, files_payload):
                        logger.info(f"    ✅ AI Photos Ingested: {product_name}")
                        p_state["ai_synced"] = True
                        p_state["last_updated"] = int(time.time())
                        save_sync_state(sync_state)
                        newly_ingested_ais += 1
                    else:
                        logger.error(f"    ❌ AI Photos Ingest FAILED: {product_name}")
                    
                    for buf in open_ios:
                        buf.close()
                else:
                    # No AI photos found, we don't mark as true so it keeps looking in future runs
                    pass

    logger.info(f"✅ Sync complete: {newly_ingested_flats} flat batches, {newly_ingested_ais} AI batches ingested.")
    return newly_ingested_flats + newly_ingested_ais

# ── Main Loop ─────────────────────────────────────────────────────────────────
def main():
    logger.info("╔══════════════════════════════════════════════════════╗")
    logger.info("║   CDH Drive Auto-Sync Daemon Starting...             ║")
    logger.info(f"║   Catalog Folder: {PARENT_FOLDER_ID[:20]}...           ║")
    logger.info(f"║   Scan Interval : {SCAN_INTERVAL}s ({SCAN_INTERVAL//60} min)                   ║")
    logger.info("╚══════════════════════════════════════════════════════╝")

    # Load initial state to verify it exists
    load_sync_state()

    service = None

    while True:
        try:
            if service is None:
                logger.info("Authenticating with Google Drive...")
                service = get_drive_service()
                if not service:
                    logger.error("Auth failed. Retrying in 60s...")
                    time.sleep(60)
                    continue
                logger.info("Google Drive authenticated ✅")

            scan_and_ingest_new(service)

        except Exception as e:
            logger.error(f"Scan loop error: {e}")
            service = None

        logger.info(f"Next scan in {SCAN_INTERVAL // 60} minutes...")
        time.sleep(SCAN_INTERVAL)


if __name__ == "__main__":
    main()
