import os
import io
import re
import sys
import json
import time
import requests
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from googleapiclient.errors import HttpError
from google.oauth2.credentials import Credentials

sys.path.append("/Users/romitaggarwal/Desktop/AI/central data hub")
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

from database import SessionLocal, CatalogProduct

SCOPES = ['https://www.googleapis.com/auth/drive']
PARENT_FOLDER_ID = '1qD743hkc_GWWw8bxdqhgzgeW6shquYHo'
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff'}

RETRYABLE = (429, 500, 503)

def authenticate():
    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)
        return build('drive', 'v3', credentials=creds)
    print("token.json not found! Please run bulk_drive_ingest.py first to authenticate.")
    sys.exit(1)

def api_call(fn, retries=5):
    for attempt in range(retries):
        try:
            return fn()
        except HttpError as e:
            if e.resp.status in RETRYABLE and attempt < retries - 1:
                wait = 2 ** attempt
                print(f"  Drive HTTP {e.resp.status}, retry {attempt+1}/{retries-1} in {wait}s...")
                time.sleep(wait)
            else:
                raise
        except Exception as e:
            if attempt < retries - 1:
                wait = 2 ** attempt
                print(f"  Network error ({type(e).__name__}), retry {attempt+1}/{retries-1} in {wait}s...")
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

def main():
    print("=" * 60)
    print("Importing Catalog Hierarchy with AI Images from Drive")
    print("=" * 60)

    service = authenticate()
    db = SessionLocal()

    # Paginate through all style folders
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

    print(f"Found {len(styles)} style folders.\n")

    for style in styles:
        style_code = re.sub(r'-[mM]$', '', style['name']).upper()
        product_code = f"SRS-{style_code}"
        
        try:
            subfolders = list_folders(service, style['id'])
        except Exception as e:
            print(f"  Skipping style {style['name']} — folder listing failed: {e}")
            continue

        variants_map = {} # color -> list of image ids

        # Structure A: Style/ai/ -> color images are inside
        ai_folder = next((sf for sf in subfolders if is_ai_folder(sf['name'])), None)
        if ai_folder:
            try:
                img_files = list_images(service, ai_folder['id'])
                for f in img_files:
                    color = color_from_filename(f['name'])
                    if color not in variants_map:
                        variants_map[color] = []
                    variants_map[color].append(f['id'])
            except Exception as e:
                pass

        # Structure B: Style/Color/AI/
        for color_sf in subfolders:
            if is_ai_folder(color_sf['name']):
                continue
            color_name = color_sf['name'].upper()
            try:
                color_subs = list_folders(service, color_sf['id'])
                nested_ai = next((c for c in color_subs if is_ai_folder(c['name'])), None)
                if nested_ai:
                    img_files = list_images(service, nested_ai['id'])
                    for f in img_files:
                        if color_name not in variants_map:
                            variants_map[color_name] = []
                        variants_map[color_name].append(f['id'])
            except Exception as e:
                pass

        if not variants_map:
            continue
            
        # Format variants JSON
        variants_json = []
        for color, img_ids in variants_map.items():
            variants_json.append({
                "color": color,
                "images": img_ids
            })

        # Save to DB
        product = db.query(CatalogProduct).filter(CatalogProduct.name == product_code).first()
        if product:
            product.variants = variants_json
            print(f"  [UPDATED] {product_code} with {len(variants_json)} variants")
        else:
            product = CatalogProduct(
                name=product_code,
                description=style['name'],
                variants=variants_json,
                price=0.0,
                crm_tags=[]
            )
            db.add(product)
            print(f"  [NEW] {product_code} with {len(variants_json)} variants")
            
        db.commit()

    db.close()
    print("\nImport Complete.")

if __name__ == '__main__':
    main()
