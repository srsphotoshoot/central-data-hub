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

## Verified on prod after the fix (rev 00010, same 91 photos)

                          BEFORE (t=30)        AFTER (t=12)
    confidence=high       9 cases,  88.9%     48 cases,  97.9%
    confidence=low       82 cases,  81.7%     43 cases,  65.1%
    keypoint_verified    True=25 False=62     True=47 False=40
    accuracy (full)           75/91               75/91
    match decisions changed:  0

Accuracy is unchanged by design — the threshold only governs what gets reported,
not what gets picked. What changed is that the signal became usable:

- **53% of calls are now "high" at 97.9% precision** (was 10% of calls), so the
  returns desk can act on roughly half of them without a second look.
- **15 of the 16 actual errors land in "low"** — 94% of errors caught by the flag.

Before the fix, "low" covered 90% of all calls and was right 81.7% of the time,
which is barely different from the 82.4% base rate — i.e. the field carried
almost no information.

## What is actually left for accuracy

Accuracy on this slice is 82.4% and none of today's work moved it. The levers,
in order of evidence:

1. **#2, index the real photographs.** Now the best-evidenced option: the
   ablation shows six synthetic variants of one render are worth +5.5pp over the
   render alone, so four real angles per colourway should beat that. Note the
   index still holds ~1 image per product (6432 vectors / 1068 products = 6.02).
2. **Target DESIGN discrimination, not colourway.** 12 of 16 errors are design
   errors. #3/#4 above are aimed at the smaller half of the problem.
3. Prod's `search()` still uses a flat `k=500`. At ~5x the vectors that is 1.6%
   of the index and recall will drop. EXPERIMENT #3 in
   matcher_service_experimental.py already has dynamic k — port it WITH #2.

Also still true: the local index (6432 vectors / 1068 products) lags prod
(8118 / 1129), and thumbnails.tar.gz covers 1047 of prod's 1129 products, so
~82 products return null keypoints until a fresh push.

---

# THE ANGLE FINDING — 16 Sep 2026

The catalogue indexes exactly one AI render per colourway. Nobody had ever tested
what happens when the query is shot from a different side, because every previous
eval used front or catalogue views. It turns out that is where the system fails.

Leave-one-angle-out, n=91 colourways x 4 angles = 364 queries. Index holds the AI
render plus three real angles; the fourth angle is held out and used as the query.
The other 977 products keep their renders untouched as distractors.

    held-out angle   AI render only (today)   AI + other 3 angles
    f (front)         75/91   82.4%            81/91   89.0%     +6.6
    b (back)          51/91   56.0%            74/91   81.3%    +25.3
    l (left)          34/91   37.4%            71/91   78.0%    +40.6
    r (right)         47/91   51.6%            76/91   83.5%    +31.9

    OVERALL          207/364  56.9%           302/364  83.0%    +26.1
    design           225/364  61.8%           313/364  86.0%    +24.2

**Production today is 82.4% on a front photo and 37.4% on a left-side photo.**
The headline 82.4% figure everyone has been quoting is the best case, not the
average. Real traffic is not all front views.

## A wrong turn worth recording, so it is not repeated

The first cut of this experiment removed the AI render from the tested colourways
and indexed only the real angles:

    C  index AI render    query real f photo   82.4%
    A  index f+b+l+r      query AI render      70.3%   (-12)
    B  index b+l+r        query real f photo   69.2%   (-13)

Read naively that says "real angles are worse". It does not. Deleting the render
removed the only view resembling the query, so it measured "can a back view stand
in for a front view" (no) rather than "does having more views help" (yes, a lot).
The control gave it away: with the query's own angle present, accuracy was 98.9%.

Different angles of one garment are NOT interchangeable -- they are additive.
Keep every view and add to it; never swap one view for another.

## What this means for the rebuild

- Extend `rebuild_matcher_index.py` to walk the colour subfolders (`f/b/l/r.JPG`)
  in addition to `ai/`. Keep the render.
- Index goes from 1129 x 1 image to 1129 x 5 (render + 4 angles): 8,118 -> ~34,000
  vectors at 6x augmentation. ~100MB, fine for IndexFlatIP in 8Gi.
- `k=500` MUST become dynamic first. At 34,000 vectors a flat 500 scans 1.5% of the
  index (it is 6% today) and recall will fall -- which would look like "real photos
  made it worse" and wrongly discredit this result. EXPERIMENT #3 in
  matcher_service_experimental.py already has `max(500, unique_products * 10)`.
- Full re-ingest is ~4,500 Drive downloads, roughly 8 hours at the observed rate.
  One-off, best run overnight.

## Close-ups (lc/): tested, no benefit — skip them

Drive's `lc/` close-ups were colour-assigned by EXIF shot time (see
`scripts/download_lc_closeups.py`; the assignment is sound — every assigned
colourway got exactly 2, up and down, across 73 of 91).

    AI + other 3 angles    302/364  83.0%   design 313/364  86.0%
    + close-ups            300/364  82.4%   design 313/364  86.0%

Two cases worse, design accuracy identical. `_preprocess_image` already crops
20%/15% inward, so a close-up ends up as an extreme zoom that no longer resembles
a full-garment query. Not worth doubling the ingest. Keep the script — it works,
and the EXIF trick is reusable if close-ups are ever wanted for something else.

## Re-ingest speed: where the time actually goes (16 Sep, measured)

The rebuild runs at ~26s per colourway. Profiled, that splits as:

    _preprocess_image (rembg + crop)      0.51s per photo
    get_augmented_embeddings (6 passes)   0.25s per photo
    -> real work, 7 photos                 5.3s
    everything else                       ~20s   <- downloading

So it is bandwidth-bound, not CPU-bound. The originals are DSLR frames around
16MB; seven of them is ~110MB per colourway. Parallel workers do not help because
the limit is total throughput, not concurrency. Two hypotheses were checked and
both were wrong: MPS is already in use (Apple M3), and per-thread `authenticate()`
costs only 0.16s, not the seconds assumed.

`_preprocess_image` downscales to 1024px on the long edge as its first step, so
nearly all of those bytes are fetched only to be discarded. Drive will serve its
own rendition via `thumbnailLink`. Measured on 3 real catalogue photos, cosine of
the resulting embedding against the full-resolution download:

    full   16.13MB  2.89s  1.00000
    s1024   0.17MB  0.78s  0.98007
    s1600   0.39MB  0.75s  0.99345
    s2048   0.60MB  1.48s  0.99730
    s4096   1.85MB  2.22s  0.99504

s2048 is 27x smaller and effectively indistinguishable; it would take the rebuild
from ~26s to ~7s per colourway, i.e. roughly 5.5 hours down to 1.5.

**Not applied.** Switching mid-run would leave the first ~494 colourways built from
full-resolution files and the rest from renditions -- a systematic 0.27% offset
across half the catalogue, against typical winning margins of 0.02-0.03. The run
was left on full-resolution downloads for a uniform index. Worth using for the
NEXT full rebuild, where every product goes through the same path.
