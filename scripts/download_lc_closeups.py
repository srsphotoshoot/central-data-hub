"""Download the lc/ close-ups and assign each one to a colourway by EXIF shot time.

Drive's lc/ folder holds up/down close-ups for every colourway of a design, but the
filenames collide (several files are all literally "up.JPG") and carry no colour, so the
folder layout alone cannot say which close-up belongs to which colour.

EXIF does. Verified on SRS-8693 and SRS-8894: the shoot runs colour by colour, and each
colour's close-ups are taken within about a minute of that colour's f/b/l/r set --

    SRS-8693   lc 17:55:33 -> silver   (17:56:46)
               lc 18:06:02 -> lavendar (18:06:49)
               lc 18:26:26 -> off white(18:27:19)

so each close-up is assigned to whichever colour folder has the nearest photo in time.
Anything further away than --max-gap minutes from every colour is left unassigned rather
than guessed, since a wrong assignment is label noise in the index.

Usage:  ./venv/bin/python scripts/download_lc_closeups.py [--max-gap 5]
"""
import os, io, re, sys, json, argparse, difflib
from datetime import datetime
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EV = os.environ.get("EVAL_DIR", os.path.join(ROOT, "data", "matcher_eval"))
OUT = os.path.join(EV, "angles"); os.makedirs(OUT, exist_ok=True)
PARENT = '1qD743hkc_GWWw8bxdqhgzgeW6shquYHo'
IMGX = {'.jpg', '.jpeg', '.png', '.webp'}

ap = argparse.ArgumentParser(); ap.add_argument("--max-gap", type=float, default=5.0)
args = ap.parse_args()

creds = Credentials.from_authorized_user_file(os.path.join(ROOT, "token.json"),
                                              ['https://www.googleapis.com/auth/drive'])
if creds.expired and creds.refresh_token: creds.refresh(Request())
svc = build('drive', 'v3', credentials=creds)

def folders(p):
    return svc.files().list(q=f"'{p}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
                            fields="files(id,name)", pageSize=200).execute().get('files', [])
def images(p):
    fs = svc.files().list(q=f"'{p}' in parents and trashed=false",
                          fields="files(id,name,mimeType,imageMediaMetadata(time))",
                          pageSize=200).execute().get('files', [])
    return [f for f in fs if f.get('mimeType', '').startswith('image/')
            or os.path.splitext(f['name'])[1].lower() in IMGX]
def shot(f):
    t = (f.get('imageMediaMetadata') or {}).get('time')
    try: return datetime.strptime(t, "%Y:%m:%d %H:%M:%S") if t else None
    except Exception: return None

man = json.load(open(os.path.join(EV, "manifest.json")))
want = {}
for m in man: want.setdefault(m["design"], set()).add("-".join(m["gt"].split("-")[2:]))

styles = []; tok = None
while True:
    r = svc.files().list(q=f"'{PARENT}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
                         fields="nextPageToken,files(id,name)", pageToken=tok, pageSize=200).execute()
    styles += r.get('files', []); tok = r.get('nextPageToken')
    if not tok: break
by_code = {}
for s in styles: by_code.setdefault(re.sub(r'-[mM]$', '', s['name']).upper(), s)
norm = lambda x: re.sub(r'\s+', ' ', x.strip().upper())

out, unassigned = [], 0
for di, (design, cols) in enumerate(sorted(want.items()), 1):
    st = by_code.get(design)
    if not st: continue
    subs = folders(st['id'])
    lc = next((s for s in subs if norm(s['name']) == "LC"), None)
    if not lc: continue
    times = {}                       # colour -> [datetime, ...] from its f/b/l/r
    for sf in subs:
        nm = norm(sf['name'])
        if nm in ("AI", "LC") or nm.endswith("-AI") or nm.endswith(" AI"): continue
        m = difflib.get_close_matches(nm, list(cols), n=1, cutoff=0.7)
        if not m: continue
        ts = [shot(i) for i in images(sf['id'])]
        ts = [t for t in ts if t]
        if ts: times[m[0]] = ts
    if not times: continue
    for f in images(lc['id']):
        t = shot(f)
        if not t: unassigned += 1; continue
        colour, gap = min(((c, min(abs((t - x).total_seconds()) for x in ts))
                           for c, ts in times.items()), key=lambda z: z[1])
        if gap > args.max_gap * 60: unassigned += 1; continue
        gt = f"SRS-{design}-{colour}"
        tag = os.path.splitext(f['name'])[0].lower() or "lc"
        dst = os.path.join(OUT, f"{gt.replace('/', '_')}__lc{tag}_{f['id'][:6]}.jpg")
        if os.path.exists(dst):
            out.append({"file": dst, "gt": gt, "angle": "lc"}); continue
        try:
            req = svc.files().get_media(fileId=f['id']); buf = io.BytesIO()
            dl = MediaIoBaseDownload(buf, req); done = False
            while not done: _, done = dl.next_chunk()
            buf.seek(0)
            im = ImageOps.exif_transpose(Image.open(buf)).convert("RGB")
            im.thumbnail((1024, 1024), Image.LANCZOS); im.save(dst, quality=92)
            out.append({"file": dst, "gt": gt, "angle": "lc"})
        except Exception as e:
            print(f"  fail {gt}: {e}", file=sys.stderr)
    print(f"  [{di}/{len(want)}] {design}: {len(out)} close-ups so far", file=sys.stderr, flush=True)

path = os.path.join(EV, "lc.json")
json.dump(out, open(path, "w"), indent=1)
print(f"\nDONE: {len(out)} close-ups across {len(set(o['gt'] for o in out))} colourways, "
      f"{unassigned} left unassigned (gap > {args.max_gap} min)", file=sys.stderr)
