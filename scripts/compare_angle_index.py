"""Stage 2 of the 4-angle experiment: does indexing the four REAL photographed angles
beat indexing the single AI render?

faiss + numpy only, no torch (stage 1 explains why they must not share a process).

Setup. The catalogue today holds exactly one AI render per product/colourway, stored as a
consecutive 6-vector block (0=original 1=mirror 2=bright+ 3=bright- 4=rot+ 5=rot-). For
the colourways in the eval set we swap that render out for the real angle photos and keep
every other product's render untouched, so the ~977 distractors stay exactly as they are
in production and only the tested colourways change.

Configs:
  C  index = AI render only                 query = real f photo      (today's production)
  A  index = f + b + l + r real angles      query = AI render         (the target design)
  B  index = b + l + r real angles          query = real f photo      (real-to-real, held out)

A's query costs nothing extra: position 0 of a product's block already IS the embedding of
its preprocessed AI render, identical to what /verify would compute for that image.

Usage:  ./venv/bin/python scripts/compare_angle_index.py
"""
import os, sys, json
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
import numpy as np, faiss
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EV = os.environ.get("EVAL_DIR", os.path.join(ROOT, "data", "matcher_eval"))

labels = {int(k): v for k, v in json.load(open(os.path.join(ROOT, "data/matcher/dress_labels.json"))).items()}
index = faiss.read_index(os.path.join(ROOT, "data/matcher/dress_db.index"))
N = index.ntotal
X = index.reconstruct_n(0, N).astype(np.float32); X /= (np.linalg.norm(X, axis=1, keepdims=True) + 1e-8)
owner = np.array([labels[i] for i in range(N)])

blocks = defaultdict(list)
for i in sorted(labels): blocks[labels[i]].append(i)

AE = np.load(os.path.join(EV, "angle_emb.npy"))
meta = json.load(open(os.path.join(EV, "angle_meta.json")))
a_owner = np.array(meta["owners"]); a_angle = np.array(meta["angles"])

man = json.load(open(os.path.join(EV, "manifest.json")))
TEST = [m["gt"] for m in man if m["gt"] in set(a_owner)]
Qf_all = np.load(os.path.join(EV, "qemb.npy")); Qf_gt = json.load(open(os.path.join(EV, "qgt.json")))
fidx = {g: i for i, g in enumerate(Qf_gt)}
TEST = [t for t in TEST if t in fidx]
print(f"test colourways with both real angles and an f query: {len(TEST)}")

Qf = np.vstack([Qf_all[fidx[t]] for t in TEST])
Qai = np.vstack([X[blocks[t][0]] for t in TEST])       # position 0 == preprocessed AI render
design = lambda n: "-".join(n.split("-")[:2])

def evaluate(vecs, owners, Q, gts, name):
    uniq, inv = np.unique(owners, return_inverse=True); P = len(uniq)
    S = Q @ vecs.T
    full = des = 0
    for r in range(S.shape[0]):
        best = np.full(P, -1e9, dtype=np.float32)
        np.maximum.at(best, inv, S[r])
        pick = uniq[int(np.argmax(best))]
        full += pick == gts[r]; des += design(pick) == design(gts[r])
    n = len(gts)
    print(f"  {name:<46} full {full:3d}/{n} ({100*full/n:5.1f}%)   design {des:3d}/{n} ({100*des/n:5.1f}%)")
    return full, des

testset = set(TEST)
keep = np.array([o not in testset for o in owner])       # every non-tested product's AI render
def with_angles(which):
    sel = np.isin(a_angle, which)
    V = np.vstack([X[keep], AE[sel]])
    O = np.concatenate([owner[keep], a_owner[sel]])
    return V, O

print(f"\n=== 4-ANGLE EXPERIMENT (n={len(TEST)} colourways, {int(keep.sum())} distractor vectors kept) ===\n")
print("  C = production today")
evaluate(X, owner, Qf, TEST, "C  index: AI render      query: real f photo")
print("\n  A = the target design (index the real angles, AI becomes a query)")
Va, Oa = with_angles(["f", "b", "l", "r"])
evaluate(Va, Oa, Qai, TEST, "A  index: f+b+l+r        query: AI render")
print("\n  B = real-to-real, one angle held out (closest to production traffic)")
Vb, Ob = with_angles(["b", "l", "r"])
evaluate(Vb, Ob, Qf, TEST, "B  index: b+l+r          query: real f photo")
print("\n  extra reference points")
Vc, Oc = with_angles(["f"])
evaluate(Vc, Oc, Qai, TEST, "   index: f only         query: AI render")
Vd, Od = with_angles(["f", "b", "l", "r"])
evaluate(Vd, Od, Qf, TEST, "   index: f+b+l+r        query: real f photo (f IS indexed)")
