import os
import sys
import time
import logging
import io

# Setup path for imports
cdh_path = "/Users/romitaggarwal/Desktop/AI/central data hub"
if cdh_path not in sys.path:
    sys.path.append(cdh_path)

from sqlalchemy.orm import Session
from database import SessionLocal, CatalogProduct
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from google.oauth2.credentials import Credentials

logging.basicConfig(
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S',
    level=logging.INFO
)
logger = logging.getLogger("ai-image-downloader")

LOCAL_IMAGE_DIR = os.path.join(cdh_path, "data", "ai_images")
os.makedirs(LOCAL_IMAGE_DIR, exist_ok=True)

TOKEN_FILE = os.path.join(cdh_path, "token.json")
SYNC_INTERVAL = 3600  # 1 hour

def get_drive_service():
    if os.path.exists(TOKEN_FILE):
        try:
            SCOPES = ['https://www.googleapis.com/auth/drive']
            creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
            return build('drive', 'v3', credentials=creds)
        except Exception as e:
            logger.error(f"Failed to auth Drive: {e}")
    return None

def download_file(service, file_id, local_path):
    for attempt in range(3):
        try:
            request = service.files().get_media(fileId=file_id)
            buf = io.BytesIO()
            dl = MediaIoBaseDownload(buf, request, chunksize=4*1024*1024)
            done = False
            while not done:
                _, done = dl.next_chunk()
            buf.seek(0)
            
            with open(local_path, 'wb') as f:
                f.write(buf.read())
            return True
        except Exception as e:
            wait = 5 * (2 ** attempt)
            logger.warning(f"Download retry {attempt+1}/3 for {file_id}: {e}. Waiting {wait}s...")
            time.sleep(wait)
    return False

def sync_images():
    logger.info("Starting AI Image Sync Check...")
    service = get_drive_service()
    if not service:
        logger.error("Drive service not available. Skipping sync.")
        return

    db = SessionLocal()
    try:
        products = db.query(CatalogProduct).all()
        missing_images = []
        
        # Identify all required image IDs
        for p in products:
            if not p.variants:
                continue
            for v in p.variants:
                images = v.get("images", [])
                for img_id in images:
                    local_path = os.path.join(LOCAL_IMAGE_DIR, f"{img_id}.jpg")
                    if not os.path.exists(local_path):
                        missing_images.append(img_id)
                        
        if not missing_images:
            logger.info("All catalog AI images are already downloaded locally.")
            return

        logger.info(f"Found {len(missing_images)} missing AI images. Starting download...")
        
        downloaded_count = 0
        for img_id in missing_images:
            local_path = os.path.join(LOCAL_IMAGE_DIR, f"{img_id}.jpg")
            if download_file(service, img_id, local_path):
                downloaded_count += 1
                if downloaded_count % 10 == 0:
                    logger.info(f"Progress: Downloaded {downloaded_count}/{len(missing_images)} images...")
                    
        logger.info(f"Sync complete. Downloaded {downloaded_count}/{len(missing_images)} missing images.")
    except Exception as e:
        logger.error(f"Error during sync: {e}")
    finally:
        db.close()

def main():
    logger.info("╔══════════════════════════════════════════════════════╗")
    logger.info("║   AI Image Auto-Downloader Starting...               ║")
    logger.info(f"║   Sync Interval : {SYNC_INTERVAL}s ({SYNC_INTERVAL//60} min)                   ║")
    logger.info("╚══════════════════════════════════════════════════════╝")

    while True:
        try:
            sync_images()
        except Exception as e:
            logger.error(f"Loop error: {e}")

        logger.info(f"Next sync in {SYNC_INTERVAL // 60} minutes...")
        time.sleep(SYNC_INTERVAL)

if __name__ == "__main__":
    main()
