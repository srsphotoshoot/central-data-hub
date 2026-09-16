# Matcher — what to do next (written 15 Sep 2026)

Based on live testing against the deployed Cloud Run matcher
(`cdh-image-matcher-84407657314.asia-south1.run.app`) plus a full read of
`matcher_server.py`, `services/matcher_service.py` and
`scripts/rebuild_matcher_index.py`. Ordered by leverage — #1 and #2 are both
cheap and don't need a model change.

---

## What was actually measured (15 Sep)

11 `/verify` calls with real images (9 in one batch, 2 more on a second cold
instance ~1h later). Results:

- 10 of 11 matched (`match: true`), 1 correctly fell below threshold
  ("Unknown Imposter", similarity 0.768).
- **Every single matched call was a genuine close call** — runner-up/top ratio
  ≥ 0.97 on all of them, so `confidence: "low"` was *correct*, not a stuck
  field. (An earlier note claiming the confidence field looked unwired was
  wrong — the arithmetic checks out against `matcher_server.py`'s own rule.)
- **In every close call the runner-up was a colourway of the same or a
  near-identical design**: RED vs RANI, PURPLE(8680) vs PURPLE(8679),
  ONION(5909) vs ONION(6014), PISTA vs GOLD, PEACH vs PINK. Margins as low as
  **0.0003**.
- **`keypoint_verified` and `keypoint_inliers` came back `null` on all 11
  calls**, including a second call minutes into a warm instance. The keypoint
  layer is not producing results in production.

Separately: Sutra's Go client (`sutra-v2-api/internal/connectors/matcher`) was
silently dropping `margin`/`runner_up_*` from every response — now fixed there
(uncommitted), so the returns desk can finally see "this was a coin flip".

---

## 1. Find out why the keypoint layer is dead in prod

It's built, measured and wired (`verify_with_keypoints` is called from
`/verify` whenever `is_match`; `_keypoint_rerank` runs inside `search()` for
cross-design close calls) — and by your own 2026-09-10 measurement the re-rank
took 84.5% → 85.7% on n=84. Right now prod gets neither that nor the
out-of-catalog sanity check, and nothing surfaces the failure: both paths
degrade silently to `None` by design.

`verify_with_keypoints` returns `None` only if the thumbnail is missing or ORB
throws. Locally `data/matcher/thumbnails/` has **1047** files, so the thumbnails
exist *here*. Checks, in order:

- `GET /stats` on the live service vs. local — same `total_images_indexed`?
- Is `thumbnails.tar.gz` actually in the HF dataset repo? `pull_thumbnails()`
  is a silent no-op if it isn't (it only logs).
- Does the deployed revision predate 10 Sep? `deploy/matcher/` matches the root
  copies byte-for-byte right now, so a stale *deployed image* is the most likely
  culprit — check the revision's build date in Cloud Run.
- Cloud Run logs for `Keypoint re-rank skipped: missing thumbnail` or
  `Keypoint sanity check failed`.

Fix is probably just a redeploy and/or a `push_thumbnails()`. Worth adding a
one-line counter/log so "keypoints unavailable" isn't invisible next time.

## 2. Index the real photographs, not just the AI renders

`rebuild_matcher_index.py` ingests **only the `ai/` folder** of each style
(Structure A: `<style>/ai/<colour>.png`, Structure B:
`<style>/<colour>/ai/...`). So each design+colour is represented in FAISS by
essentially **one synthetic render**, augmented 6× (mirror/brightness/rotate).

Meanwhile Drive already holds real photography that never reaches the index:

```
Master Catalogue Folder / Mannequin and Model Image Folders /
    <design_no>-m /
        pink/   f.JPG  b.JPG  l.JPG  r.JPG     ← real shoot, 4 angles
        gold/   f.JPG  b.JPG  l.JPG  r.JPG
        lc/     up.JPG down.JPG (×2)           ← two-piece sets
        ai/     pink.png  gold.png             ← the only thing indexed today
```

(40+ `-m` folders, new ones added daily — several created 12–15 Sep. Freshly
shot ones are still a flat 10–12 frame `DSC0*.JPG` burst before someone sorts
them into colour subfolders.)

This matters directly for the failure in the measurements above. The pipeline
deliberately crops **inward** (20%/15%) to destroy silhouette and focus on
embroidery — but embroidery is exactly what's *identical* between two colourways
of one design. So the model is asked to separate colourways using the one signal
the crop preserves least, from a single synthetic image per class. Giving it 4
real angles per colourway instead of 1 render is the cheapest available change
and needs no model work: extend the ingest to walk the colour subfolders too,
rebuild, re-measure on the same n=84 set.

Watch for: real photos and AI renders in one index may need different handling
(a model shoot has a person in it; `_preprocess_image`'s rembg + inward crop
should mostly handle that, but verify on a few before a full rebuild).

## 3. The genuinely unsolved gap: same-design colourway ties

Already established in the code, don't re-tread:
- ORB re-rank is **deliberately restricted to cross-design** ties — grayscale
  ORB can't tell two colourways of the same embroidery apart, and was measured
  actively harmful there (3 of the first 8 regressions).
- A zero-shot colour classifier as re-ranker was tried and measured **badly
  harmful** (63.1% vs 84.5%).
- EXPERIMENT #4 (full-crop embedding concatenated alongside the fabric-crop one)
  made things **worse** — fashionSigLIP's whole-garment embedding tracks overall
  "ethnic wedding-wear aesthetic" more than structural cut.

So: every *post-hoc* tie-break tried so far has failed on this specific case.
What has **never** been tried is changing the embedding itself — everything to
date is frozen pretrained fashionSigLIP + classical CV around it.

## 4. Fine-tuning (untried, and the data is already labelled)

The Drive tree above is a labelled dataset for free: folder path gives
design_no + colour, filename gives angle. That makes supervised metric learning
straightforward, and — importantly — lets you mine the exact hard negatives that
are failing: **same design, different colourway**, which is a pair the folder
structure hands over directly.

Practical shape: keep fashionSigLIP as the backbone, freeze it, train a small
projection head with a margin loss (ArcFace or triplet) over (design, colour)
identities, hard-negative-mined on same-design pairs. A single T4/L4 is enough.
Escalate to unfreezing the last blocks only if the head alone underdelivers.

**On adding DINOv2 as a second branch** (asked about separately): worth testing,
but note EXPERIMENT #4 is a warning, not an unrelated result — adding a second
embedding diluted rather than sharpened. DINOv2 is a different bet (self-
supervised, strong at fine texture correspondence — arguably a learned version
of what ORB is doing by hand) and would run on the *same* fabric crop rather
than adding a whole-garment view, so it isn't a repeat of #4. But given #4's
outcome: measure DINOv2 **solo** on the n=84 set first, then late-fuse with a
tuned weight. Never blind-concatenate.

## 5. Keep the evaluation honest

Reuse the existing n=84 held-out set over the 30 most mutually-confusable
designs as the regression baseline for every change above — and report
**design accuracy and colour accuracy separately**, since a single blended
number is exactly what hides this failure mode. `data/matcher/learning_log.jsonl`
(15 entries) and `scripts/test_experimental_matcher.py` are the starting points.

Also worth building: a small eval slice of **real customer/floor photos**, not
catalogue shots. Everything measured so far is studio-vs-studio;
`MIN_INLIERS_FOR_KEYPOINT_VERIFIED = 30` is explicitly flagged in the code as
never validated against real customer photos.

---

# RESULTS — 16 Sep 2026

Prod was redeployed (rev 00009) after finding the keypoint layer had been dead
since 10 Sep: `deploy/matcher/` is a manual copy and still held the pre-19:43
`snapshot_download` version of `pull_thumbnails()`, so thumbnails never reached
the container. Confirmed by grep — the deployed build context had **zero**
occurrences of `THUMBNAILS_ARCHIVE_NAME`. `thumbnails.tar.gz` (49MB) has since
been pushed to the HF dataset repo.

## First real-photo measurement (n=91)

Method, and it differs from everything before it: 91 held-out **real front-angle
photographs** taken from Drive's per-colour subfolders (`<design>-m/<colour>/f.JPG`)
across the 34 most mutually-confusable designs. These photos are **not in the
index** — only the `ai/` renders are. Ground truth from the folder path.
Confusability was computed offline from the FAISS index itself
(max cos-sim between every pair of products), not guessed.

    full (design+colour)   75/91   82.4%
    design                 79/91   86.8%
    colour | design right  75/79   94.9%

Adversarial slice, so a floor rather than a catalogue-wide average.

## #5 was right that a blended number hides the failure — but it hides the OPPOSITE one

    colour wrong (design right):   4
    design wrong              :   12

**Design confusion outnumbers colour confusion 3 to 1.** Sections #3 and #4 above
are built on the premise that same-design colourway ties are the core unsolved
gap. On real photographs that premise does not hold — colour is 94.9% correct.
Retarget the fine-tuning objective accordingly before investing in it.

## MIN_INLIERS_FOR_KEYPOINT_VERIFIED was wrong by ~2.5x (fixed)

    wrong matches    3..11 inliers   (never once above 11, n=15)
    correct matches  2..186 inliers, median 19.5

The original 30 came from synthetic augmentation, where genuine matches scored
~570+. At 30 the check rejected all 15 wrong matches but also 47 of 72 correct
ones, so `confidence` was "low" on 82 of 91 calls. Now 12: still rejects 15/15
wrong, keeps 47/72 correct, and all 47 were genuinely correct.

Precision of a "high confidence" verdict:

    keypoint (>=12)          47/47   100%
    margin only              15/16    94%
    margin AND keypoint@30    8/9     89%   <- what shipped before

Confidence now consults keypoints first, margin only as fallback.

## The ORB re-rank is net zero on real photos (#1's +1.2pp does not reproduce)

7 of 91 queries had their embedding answer overridden by `_keypoint_rerank`:
1 improved, 1 regressed, 5 were wrong either way. The 84.5% -> 85.7% measured on
10 Sep was render-vs-render. Left enabled, but it is not currently earning its
latency.

## Brightness augmentation: hypothesis TESTED and REJECTED

Proposed that `get_augmented_embeddings`' Brightness(1.25)/Brightness(0.75),
combined with per-product `max()` scoring, was manufacturing the PISTA/GOLD and
PEACH/PINK confusions. Tested offline by masking vector positions (each product
is a consecutive 6-vector block: 0=original 1=mirror 2=bright+ 3=bright- 4=rot+
5=rot-), so no re-embedding was needed:

    ALL 6 (current)            full 82.4%   design 86.8%
    drop both brightness       full 79.1%   design 84.6%    -3 / -2
    drop bright+1.25 only      full 79.1%   design 84.6%    -3 / -2
    drop bright-0.75 only      full 82.4%   design 86.8%     0 /  0
    drop rotations             full 79.1%   design 82.4%    -3 / -4
    drop mirror                full 81.3%   design 86.8%    -1 /  0
    original + mirror only     full 74.7%   design 79.1%    -7 / -7
    original only              full 76.9%   design 80.2%    -5 / -6

**Every augmentation helps; removing any of them costs accuracy.** The hypothesis
was wrong — do not retry it.

Note what this implies for #2: if six *synthetic* variants of a single render are
worth +5.5pp over the render alone, four *real* photographed angles per colourway
should be worth more. #2 is now the best-evidenced remaining lever.
