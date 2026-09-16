"""The experiment that actually answers "will a photo from any angle match?".

An earlier cut removed the AI render from the tested colourways and indexed only the real
angles. That lost 12pp, but the design was wrong: it deleted the one view that resembled
the query, so it measured "can a back view stand in for a front view" (no) rather than
"does having more views help" (the real question). The giveaway was the control -- with
the query's own angle present in the index, accuracy was 98.9%.

Production would never drop the render, so: index the AI render plus three real angles,
hold the fourth out, and query with it. Repeat for all four. Against the baseline of
indexing the render alone, which is production today.

faiss + numpy only, no torch.

Usage:  ./venv/bin/python scripts/leave_one_angle_out.py
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

AE = np.load(os.path.join(EV, "angle_emb.npy"))
meta = json.load(open(os.path.join(EV, "angle_emb_meta.json")))
a_owner = np.array(meta["owners"]); a_angle = np.array(meta["angles"])

# position 0 of each photo's 6-augmentation group is the un-augmented embedding -- the
# same thing /verify computes for a query image.
starts = np.arange(0, len(AE), 6)
q_owner = a_owner[starts]; q_angle = a_angle[starts]

lcE = lc_owner = None
lcp = os.path.join(EV, "lc_emb.npy")
if os.path.exists(lcp):
    lcE = np.load(lcp)
    lcm = json.load(open(os.path.join(EV, "lc_emb_meta.json")))
    lc_owner = np.array(lcm["owners"])
    print(f"close-ups available: {lcE.shape[0]} vectors, {len(set(lc_owner))} colourways\n")

TEST = sorted(set(a_owner))
testset = set(TEST)
keep = np.array([o not in testset for o in owner])          # distractors: untouched renders
ai_rows = np.array([o in testset for o in owner])           # tested colourways' AI renders
design = lambda n: "-".join(n.split("-")[:2])

def run(vecs, owners, Q, gts):
    uniq, inv = np.unique(owners, return_inverse=True); P = len(uniq)
    S = Q @ vecs.T
    full = des = 0
    for r in range(S.shape[0]):
        best = np.full(P, -1e9, dtype=np.float32)
        np.maximum.at(best, inv, S[r])
        pick = uniq[int(np.argmax(best))]
        full += pick == gts[r]; des += design(pick) == design(gts[r])
    return full, des, len(gts)

ANG = ["f", "b", "l", "r"]
print("=== LEAVE-ONE-ANGLE-OUT ===")
print("  query is a real photo from an angle that is NOT in the index.\n")
print(f"  {'held-out angle':<16}{'AI render only (today)':<26}{'AI + other 3 angles':<26}{'+ close-ups'}")
tot = defaultdict(lambda: [0, 0, 0])
for held in ANG:
    qsel = q_angle == held
    Q = AE[starts][qsel]; gts = list(q_owner[qsel])

    b_full, b_des, n = run(X, owner, Q, gts)                       # baseline: renders only
    keep_ang = (a_angle != held)
    V = np.vstack([X, AE[keep_ang]]); O = np.concatenate([owner, a_owner[keep_ang]])
    a_full, a_des, _ = run(V, O, Q, gts)
    cell3 = ""
    if lcE is not None:
        V2 = np.vstack([V, lcE]); O2 = np.concatenate([O, lc_owner])
        c_full, c_des, _ = run(V2, O2, Q, gts)
        cell3 = f"{c_full:3d}/{n} ({100*c_full/n:5.1f}%)"
        tot["lc"][0] += c_full; tot["lc"][1] += c_des; tot["lc"][2] += n
    tot["base"][0] += b_full; tot["base"][1] += b_des; tot["base"][2] += n
    tot["ang"][0] += a_full; tot["ang"][1] += a_des; tot["ang"][2] += n
    print(f"  {held:<16}{b_full:3d}/{n} ({100*b_full/n:5.1f}%)          "
          f"{a_full:3d}/{n} ({100*a_full/n:5.1f}%)          {cell3}")

print()
for k, lab in (("base", "AI render only (today)"), ("ang", "AI + other 3 angles"), ("lc", "+ close-ups")):
    if tot[k][2]:
        f, d, n = tot[k]
        print(f"  {lab:<26} full {f:3d}/{n} ({100*f/n:5.1f}%)   design {d:3d}/{n} ({100*d/n:5.1f}%)")
