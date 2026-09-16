"""Stage 1 of the 4-angle experiment: embed the b/l/r reference photos exactly the way
add_product() would -- preprocess once, then 6 augmentations per photo.

torch is imported first and the FAISS index is never read here: importing faiss and then
instantiating the torch model in one process segfaults on macOS (exit 139, OpenMP clash).
Stage 2 (compare_angle_index.py) does the faiss/numpy half.

Usage:  ./venv/bin/python scripts/embed_angle_photos.py
"""
import os, sys
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"; os.environ["OMP_NUM_THREADS"] = "1"
import torch, open_clip  # noqa: F401  -- torch BEFORE anything that pulls faiss
torch.set_num_threads(1)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import json, time
import numpy as np
from PIL import Image
from services.matcher_service import matcher

EV = os.environ.get("EVAL_DIR", os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "matcher_eval"))

matcher.load_model()                       # no load_db() -> no faiss index read
SRC = sys.argv[1] if len(sys.argv) > 1 else "angles"   # "angles" (f/b/l/r) or "lc"
OUTNAME = "angle_emb" if SRC == "angles" else "lc_emb"

if SRC == "lc":
    ang = json.load(open(os.path.join(EV, "lc.json")))
else:
    ang = json.load(open(os.path.join(EV, "angles.json")))

# The f (front) photos were already downloaded as the eval queries and live in
# manifest.json, not angles.json -- fold them in so all four angles get embedded
# together. Config B in stage 2 then simply excludes angle "f" from the index.
if SRC == "angles":
    have = {(a["gt"], a["angle"]) for a in ang}
    for m in json.load(open(os.path.join(EV, "manifest.json"))):
        if (m["gt"], "f") not in have and os.path.exists(m["file"]):
            ang.append({"file": m["file"], "gt": m["gt"], "angle": "f"})

from collections import Counter
print(f"embedding {len(ang)} photos x 6 augmentations  "
      f"(per angle: {dict(Counter(a['angle'] for a in ang))})", file=sys.stderr, flush=True)

vecs, owners, angles = [], [], []
t0 = time.time()
for k, a in enumerate(ang, 1):
    try:
        pi = matcher._preprocess_image(Image.open(a["file"]).convert("RGB"))
        for e in matcher.get_augmented_embeddings(pi):     # same 6 as add_product()
            vecs.append(e.reshape(-1)); owners.append(a["gt"]); angles.append(a["angle"])
    except Exception as ex:
        print(f"  skip {a['gt']} {a['angle']}: {ex}", file=sys.stderr)
    if k % 20 == 0:
        print(f"  {k}/{len(ang)} ({time.time()-t0:.0f}s)", file=sys.stderr, flush=True)

V = np.vstack(vecs).astype(np.float32); V /= (np.linalg.norm(V, axis=1, keepdims=True) + 1e-8)
np.save(os.path.join(EV, OUTNAME + ".npy"), V)
json.dump({"owners": owners, "angles": angles}, open(os.path.join(EV, OUTNAME + "_meta.json"), "w"))
print(f"saved {V.shape} ({len(set(owners))} colourways)", file=sys.stderr)
