"""Widen the test set: top-N confusable designs -> real (non-ai/) front photos from Drive."""
import os, io, re, sys, json, difflib
sys.path.insert(0,".")
import numpy as np, faiss
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.http import MediaIoBaseDownload
from PIL import Image, ImageOps

SP=os.environ.get("EVAL_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "matcher_eval"))
os.makedirs(SP, exist_ok=True)
OUT=os.path.join(SP,"photos"); os.makedirs(OUT, exist_ok=True)
D="data/matcher"

# ---- 1. confusability from the index ----
index=faiss.read_index(os.path.join(D,"dress_db.index"))
labels={int(k):v for k,v in json.load(open(os.path.join(D,"dress_labels.json"))).items()}
n=index.ntotal
X=index.reconstruct_n(0,n).astype(np.float32); X/= (np.linalg.norm(X,axis=1,keepdims=True)+1e-8)
names=sorted(set(labels.values())); ni={nm:i for i,nm in enumerate(names)}
owner=np.array([ni[labels[i]] for i in range(n)],dtype=np.int32); P=len(names)
best=np.full((P,P),-1.0,dtype=np.float32)
for s in range(0,n,512):
    e=min(s+512,n); S=X[s:e]@X.T
    for r in range(e-s): np.maximum.at(best[owner[s+r]], owner, S[r])
np.fill_diagonal(best,-1.0); best=np.maximum(best,best.T)
iu=np.triu_indices(P,k=1)
pairs=sorted(zip(best[iu],iu[0],iu[1]), key=lambda t:-t[0])[:600]
def dz(nm):
    p=nm.split("-"); return p[1] if len(p)>=2 else nm
want=[]
for sim,a,b in pairs:
    for x in (names[a],names[b]):
        d=dz(x)
        if d not in want: want.append(d)
TARGETS=want[:60]
print(f"targeting {len(TARGETS)} most-confusable design codes", file=sys.stderr)
idx_by_design={}
for nm in names: idx_by_design.setdefault(dz(nm),[]).append(nm)

# ---- 2. Drive ----
creds=Credentials.from_authorized_user_file("token.json",['https://www.googleapis.com/auth/drive'])
if creds.expired and creds.refresh_token: creds.refresh(Request())
svc=build('drive','v3',credentials=creds)
PARENT='1qD743hkc_GWWw8bxdqhgzgeW6shquYHo'
IMGX={'.jpg','.jpeg','.png','.webp'}
def folders(p): return svc.files().list(q=f"'{p}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",fields="files(id,name)",pageSize=200).execute().get('files',[])
def images(p):
    fs=svc.files().list(q=f"'{p}' in parents and trashed=false",fields="files(id,name,mimeType)",pageSize=200).execute().get('files',[])
    return [f for f in fs if f.get('mimeType','').startswith('image/') or os.path.splitext(f['name'])[1].lower() in IMGX]
styles=[];tok=None
while True:
    r=svc.files().list(q=f"'{PARENT}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",fields="nextPageToken,files(id,name)",pageToken=tok,pageSize=200).execute()
    styles+=r.get('files',[]);tok=r.get('nextPageToken')
    if not tok: break
def code(nm): return re.sub(r'-[mM]$','',nm).upper()
by_code={}
for s in styles: by_code.setdefault(code(s['name']),s)

def norm(s): return re.sub(r'\s+',' ',s.strip().upper())
man=[]
for d in TARGETS:
    st=by_code.get(d)
    if not st: continue
    cand=idx_by_design.get(d,[])
    if not cand: continue
    cand_cols={ "-".join(c.split("-")[2:]): c for c in cand }
    try: subs=folders(st['id'])
    except Exception as ex: print(f"  {d}: listing failed {ex}",file=sys.stderr); continue
    for sf in subs:
        nm=norm(sf['name'])
        if nm in ("AI","LC") or nm.endswith("-AI") or nm.endswith(" AI"): continue
        m=difflib.get_close_matches(nm, list(cand_cols), n=1, cutoff=0.7)
        if not m: continue
        gt=cand_cols[m[0]]
        if any(x["gt"]==gt for x in man): continue
        try: imgs=images(sf['id'])
        except Exception: continue
        f=next((i for i in imgs if os.path.splitext(i['name'])[0].lower()=="f"), None)
        if not f: continue
        try:
            req=svc.files().get_media(fileId=f['id']); buf=io.BytesIO()
            dl=MediaIoBaseDownload(buf,req); done=False
            while not done: _,done=dl.next_chunk()
            buf.seek(0)
            im=ImageOps.exif_transpose(Image.open(buf)).convert("RGB"); im.thumbnail((1024,1024),Image.LANCZOS)
            p=os.path.join(OUT, gt.replace("/","_")+".jpg"); im.save(p,quality=92)
            man.append({"file":p,"gt":gt,"design":d})
            print(f"  [{len(man):3d}] {gt}", file=sys.stderr)
        except Exception as ex:
            print(f"  dl fail {gt}: {ex}", file=sys.stderr)
    if len(man)>=90: break
json.dump(man, open(os.path.join(SP,"manifest.json"),"w"), indent=1)
print(f"\nTOTAL: {len(man)} real query photos across {len(set(m['design'] for m in man))} designs", file=sys.stderr)
