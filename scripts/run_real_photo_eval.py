"""Run the real-photo eval set against a matcher /verify endpoint and report
design accuracy and colour accuracy SEPARATELY (a single blended number hides
which of the two is actually failing).

Build the set first with scripts/build_real_photo_evalset.py.

Usage:
    KEY=<matcher api key> ./venv/bin/python scripts/run_real_photo_eval.py
    KEY=... MATCHER_URL=http://localhost:8001/verify ./venv/bin/python scripts/run_real_photo_eval.py

Artifacts live in data/matcher_eval/ (override with EVAL_DIR).
"""
import os, json, time, requests

SP = os.environ.get("EVAL_DIR", os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "matcher_eval"))
URL = os.environ.get("MATCHER_URL",
                     "https://cdh-image-matcher-84407657314.asia-south1.run.app/verify")
KEY = os.environ["KEY"]

man = json.load(open(os.path.join(SP, "manifest.json")))
design = lambda n: "-".join(n.split("-")[:2])
colour = lambda n: "-".join(n.split("-")[2:])

rows = []
for i, m in enumerate(man, 1):
    t0 = time.time()
    try:
        with open(m["file"], "rb") as fh:
            r = requests.post(URL, headers={"X-API-Key": KEY},
                              files={"files": (os.path.basename(m["file"]), fh, "image/jpeg")},
                              timeout=300).json()
    except Exception as e:
        print(f"[{i}/{len(man)}] {m['gt']}: REQUEST FAILED {e}")
        continue
    gt, got = m["gt"], r.get("matched_product", "")
    row = dict(gt=gt, got=got, full=(got == gt),
               design=(design(got) == design(gt)),
               colour=(design(got) == design(gt) and colour(got) == colour(gt)),
               sim=r.get("similarity"), ru=r.get("runner_up_product"),
               rus=r.get("runner_up_similarity"), margin=r.get("margin"),
               conf=r.get("confidence"), kv=r.get("keypoint_verified"),
               ki=r.get("keypoint_inliers"), match=r.get("match"),
               secs=round(time.time() - t0, 1))
    rows.append(row)
    mark = "OK " if row["full"] else ("~D " if row["design"] else "XX ")
    print(f"[{i:3d}/{len(man)}] {mark} {gt:<24} -> {got:<24} "
          f"sim={row['sim']:.4f} kp={row['ki']} ({row['secs']}s)")

json.dump(rows, open(os.path.join(SP, "results.json"), "w"), indent=1)

n = len(rows)
if n:
    full = sum(r["full"] for r in rows)
    des = sum(r["design"] for r in rows)
    print("\n" + "=" * 60)
    print(f"  FULL   (design+colour)  : {full:3d}/{n}  ({100*full/n:.1f}%)")
    print(f"  DESIGN                  : {des:3d}/{n}  ({100*des/n:.1f}%)")
    if des:
        print(f"  COLOUR | design correct : {full:3d}/{des}  ({100*full/des:.1f}%)")
    print(f"  colour wrong (design ok): {des-full}")
    print(f"  design wrong            : {n-des}")
