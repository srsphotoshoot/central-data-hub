import os
import json
import base64
import threading
import torch
import open_clip
import faiss
import cv2
import numpy as np
from PIL import Image, ImageEnhance, ImageOps
import torch.nn.functional as F
import logging
from io import BytesIO

try:
    from services import hf_sync
except ImportError:
    import hf_sync  # when this module is imported with services/ itself on sys.path

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cdh-matcher")

# Paths and Constants
DIMENSION = 768 # Full Image only (Pose Invariant)
# Loaded straight from the Hugging Face Hub (auto-downloads + caches locally) instead of a
# fixed local path — the old local HF cache path was found broken (dangling symlink) during
# the 2026-09-05 recovery, and this also makes the service portable to any host (e.g. a
# Hugging Face Space) with zero local-path assumptions.
MODEL_NAME = "hf-hub:Marqo/marqo-fashionSigLIP"
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "matcher")
INDEX_FILE = os.path.join(DATA_DIR, "dress_db.index")
MAP_FILE = os.path.join(DATA_DIR, "dress_labels.json")
# One representative reference photo per product, kept ONLY so the keypoint re-ranker
# (see _keypoint_rerank) has something to compare against for a close-call tie —
# the matcher itself never needed original images, only embeddings, until this.
# Synced to/from the HF dataset repo alongside the index+labels (see hf_sync.py) since
# Cloud Run has no durable local disk across restarts.
THUMB_DIR = os.path.join(DATA_DIR, "thumbnails")

# Ensure data directories exist
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(THUMB_DIR, exist_ok=True)

# Runner-up must score at least this fraction of the top pick's score to count as a
# "close call" worth a keypoint re-rank. Validated 2026-09-10 on the 30 most mutually-
# confusable designs in the real catalog (held-out real photos, n=84): pure embedding
# argmax got 84.5% (71/84); adding this cross-design-only keypoint re-rank raised it to
# 85.7% (72/84). Do NOT also re-rank same-base-design ties (see _keypoint_rerank) —
# ORB runs on a grayscale conversion, so two colorways of the identical embroidery/
# weave pattern look the same to it and it only adds noise there (confirmed: 3 of the
# first 8 regressions before this guard were exactly that).
KEYPOINT_RERANK_CLOSE_CALL_RATIO = 0.97

# Minimum ORB inlier count (see _best_orb_score) for the top pick to count as
# "keypoint-verified" — an absolute sanity check on a SINGLE candidate, distinct from
# _keypoint_rerank's relative comparison between two close candidates. Added
# 2026-09-10 to catch the case a margin-based confidence can't: an out-of-catalog
# garment that happens to land close to one catalog item on embedding similarity
# alone (e.g. 0.89, with no other candidate close enough to look like a "close call")
# would otherwise be reported as a confident match. Threshold picked from the same
# 2026-09-10 measurements used to validate _keypoint_rerank: wrong/different-design
# pairs topped out at ~12 inliers even under brightness/rotation variation, while
# genuine matches (same augmentations) never dropped below ~570 — 30 sits with wide
# margin on both sides of that gap, favoring NOT falsely flagging a real match over
# catching every possible false one. Unvalidated against real customer photos (only
# synthetic augmentation + real catalog photos so far) — a starting point, not a
# tuned number; revisit if real usage shows it firing on genuine matches.
MIN_INLIERS_FOR_KEYPOINT_VERIFIED = 30

# Comprehensive product-to-standard color mappings for offline tie-breaking
COLOR_MAP = {
    # Red/Maroon/Wine
    "RED": "RED",
    "MAROON": "MAROON",
    "WINE": "WINE",
    "RUST": "BROWN",
    
    # Pink/Peach
    "PINK": "PINK",
    "RANI": "PINK",
    "ONION": "PINK",
    "PEACH": "PEACH",
    
    # Gold/Yellow/Chiku/Beige/Mustard/Orange
    "GOLD": "GOLD",
    "YELLOW": "YELLOW",
    "LAMON": "YELLOW",
    "MUSTURD": "YELLOW",
    "CHIKU": "CHIKU",
    "CREAM": "WHITE",
    "ORANGE": "ORANGE",
    
    # Green
    "GREEN": "GREEN",
    "MHENDI": "GREEN",
    "PISTA": "GREEN",
    "PARROT": "GREEN",
    "B.GREEN": "GREEN",
    
    # Blue/Teal/Firozi
    "BLUE": "BLUE",
    "SKY": "BLUE",
    "TEAL": "TEAL",
    "FIROZI": "TEAL",
    
    # Purple/Lavender
    "PURPLE": "PURPLE",
    "LAVENDER": "LAVENDER",
    
    # Neutral/Brown
    "BLACK": "BLACK",
    "WHITE": "WHITE",
    "GREY": "GREY",
    "BROWN": "BROWN"
}

STANDARD_COLORS = ["RED", "MAROON", "WINE", "PINK", "PEACH", "GOLD", "YELLOW", "CHIKU", "GREEN", "TEAL", "BLUE", "PURPLE", "LAVENDER", "BLACK", "WHITE", "GREY", "BROWN", "ORANGE"]

class MatcherService:
    def __init__(self):
        self.device = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
        self.model = None
        self.preprocess = None
        self.tokenizer = None
        self.index = None
        self.id_to_name_map = {}
        self.current_id = 0
        self.is_loaded = False
        self._hf_pulled = False  # ensures hf_sync.pull() runs at most once per process

    def load_model(self):
        """Load the local CLIP model weights."""
        try:
            logger.info(f"Loading weights from {MODEL_NAME}...")
            self.model, _, self.preprocess = open_clip.create_model_and_transforms(MODEL_NAME)
            self.model.to(self.device)
            self.model.eval()
            self.tokenizer = open_clip.get_tokenizer(MODEL_NAME)
            logger.info("Model loaded successfully!")
            self.is_loaded = True
            return True
        except Exception as e:
            logger.error(f"Failed to load model: {str(e)}")
            return False

    def load_db(self):
        """Load the FAISS index, label map, and color map from disk."""
        try:
            # On a hosted/ephemeral instance (HF_TOKEN + HF_DATASET_REPO set), pull the
            # latest index+labels down from the HF dataset repo before the very first
            # local read — a no-op locally where those env vars aren't set. Only ever
            # runs once per process; local disk is authoritative after that.
            if not self._hf_pulled:
                hf_sync.pull(INDEX_FILE, MAP_FILE)
                # Thumbnails pulled in the BACKGROUND, not inline here. Diagnosed
                # 2026-09-10: pulling all ~1000 individual thumbnail files via
                # snapshot_download blocked the container from ever binding to its
                # port, and Cloud Run's startup probe killed it (timed out at 88%,
                # ~3.5 minutes in) — a failed deploy, though the previous revision
                # kept serving traffic throughout (Cloud Run never cuts over to a
                # revision that fails its startup probe). _keypoint_rerank already
                # degrades gracefully when a thumbnail is missing (falls back to the
                # embedding-only pick), so search/verify stay fully functional while
                # this catches up in the background after a cold start — the
                # keypoint re-rank benefit just "warms up" over the following
                # couple of minutes instead of gating the whole service on it.
                threading.Thread(target=hf_sync.pull_thumbnails, args=(THUMB_DIR,), daemon=True).start()
                self._hf_pulled = True

            # Backward Compatibility: Check dimension
            if os.path.exists(INDEX_FILE):
                temp_index = faiss.read_index(INDEX_FILE)
                if temp_index.d != DIMENSION:
                    logger.warning(f"Index dimension mismatch (Found {temp_index.d}, Expected {DIMENSION}).")
                    logger.warning(f"Backing up old index and creating fresh one. PLEASE RE-UPLOAD CATALOGUE.")
                    os.rename(INDEX_FILE, INDEX_FILE + ".bak")
                    if os.path.exists(MAP_FILE): os.rename(MAP_FILE, MAP_FILE + ".bak")

            if os.path.exists(INDEX_FILE) and os.path.exists(MAP_FILE):
                logger.info(f"Loading persistent database from {INDEX_FILE}...")
                self.index = faiss.read_index(INDEX_FILE)
                with open(MAP_FILE, "r") as f:
                    loaded_map = json.load(f)
                    self.id_to_name_map = {int(k): v for k, v in loaded_map.items()}
                    self.current_id = max(self.id_to_name_map.keys()) + 1 if self.id_to_name_map else 0
                logger.info(f"Loaded {self.current_id} vectors successfully from disk.")
            else:
                logger.info("No persistent database found. Initializing a fresh index...")
                self.index = faiss.IndexFlatIP(DIMENSION)

            return True
        except Exception as e:
            logger.error(f"Failed to load database: {str(e)}")
            return False

    def save_db_local(self):
        """Serialize the FAISS index and Label Map to local disk only — no HF
        push. Fast (a few ms even for a large index); callers that also need
        durability on hosted/ephemeral compute (Cloud Run) must call
        hf_sync.push() themselves, in the background, after this returns.
        Split out from save_db() 5 Sep 2026: the HF push was the whole reason
        every /add took ~60s end-to-end (confirmed live) — add_product/
        delete_product now call this instead so the caller decides sync-vs-
        background push rather than always blocking on it."""
        try:
            faiss.write_index(self.index, INDEX_FILE)
            with open(MAP_FILE, "w") as f:
                json.dump(self.id_to_name_map, f)
            logger.info("Database saved to disk.")
        except Exception as e:
            logger.error(f"Failed to save database: {str(e)}")

    def save_db(self):
        """save_db_local() + an immediate, blocking HF push. Kept for
        one-shot/offline callers (e.g. scripts/rebuild_matcher_index.py's
        final flush) that want a hard durability guarantee before exiting —
        the HTTP path (matcher_server.py) does NOT use this anymore; it calls
        save_db_local() synchronously and schedules hf_sync.push() as a
        FastAPI BackgroundTask instead, so a client doesn't wait ~60s per
        upload for a push it doesn't need to see complete."""
        self.save_db_local()
        hf_sync.push(INDEX_FILE, MAP_FILE)  # no-op locally; durable backup when hosted

    def _extract_colors_from_query(self, pil_image):
        """
        AI-based color classification using the pre-loaded SigLIP model.
        Returns a dictionary of color names and their normalized probabilities.
        """
        if not self.is_loaded:
            self.load_model()
            
        try:
            # Color list and corresponding standard text prompts
            color_list = STANDARD_COLORS
            text_prompts = [f"a photo of a {c.lower()} dress" for c in color_list]
            
            # Tokenize prompts (use cached tokenizer if available)
            tokenizer = self.tokenizer if self.tokenizer else open_clip.get_tokenizer(MODEL_NAME)
            text_tokens = tokenizer(text_prompts).to(self.device)
            
            # Preprocess image
            proc_img = self.preprocess(pil_image.convert('RGB')).unsqueeze(0).to(self.device)
            
            with torch.no_grad():
                # Encode image and text
                img_features = self.model.encode_image(proc_img)
                txt_features = self.model.encode_text(text_tokens)
                
                # Normalize features
                img_features /= img_features.norm(dim=-1, keepdim=True)
                txt_features /= txt_features.norm(dim=-1, keepdim=True)
                
                # Compute cosine similarities and apply softmax
                similarities = (100.0 * img_features @ txt_features.T).softmax(dim=-1)[0]
                
            # Convert to standard python dict
            color_probs = {color_list[i]: float(similarities[i].item()) for i in range(len(color_list))}
            # Keep only colors with probability > 0.01 to filter out noise
            found_colors = {c: p for c, p in color_probs.items() if p > 0.01}
            logger.info(f"AI Detected Colors: {found_colors}")
            return found_colors
        except Exception as e:
            logger.error(f"AI Color Classification failed: {str(e)}")
            return {}

    def _preprocess_image(self, pil_image, for_query=False):
        """
        Runs complete image preprocessing ONCE per input image:
        1. Corrects EXIF orientation.
        2. Isolates the dress using rembg background removal onto a white background.
        3. Auto-crops tightly to the dress bounding box (removes empty white space).
           This normalizes both flat mannequin and real model shoot photos to the same
           garment-focused frame, dramatically reducing domain gap.
        4. Enhances Contrast (15%) and Sharpness (20%) to highlight embroidery patterns.
           Skipped for query images (for_query=True) because enhancement shifts model-photo
           embeddings further from the clean catalogue reference, hurting accuracy.
        """
        # Fix EXIF orientation
        img = ImageOps.exif_transpose(pil_image)

        # Downscale before background removal. rembg's segmentation cost scales with
        # input resolution, and the model's own preprocessing later squashes everything
        # to 224x224 anyway — feeding it a 4000px+ source photo (real incoming photos
        # have been seen up to ~3240x4320) buys no accuracy, only latency.
        MAX_DIM = 1024
        if max(img.size) > MAX_DIM:
            img.thumbnail((MAX_DIM, MAX_DIM), Image.LANCZOS)

        # Remove background and replace with white background.
        # u2net instead of rembg's newer default (BRIA RMBG 2.0): ~40% faster warm and a
        # ~176MB model vs ~1GB, with identical crop bbox + visually identical output on
        # test images so far — validated on a small sample only, worth re-checking if
        # accuracy regresses on real traffic.
        rgba_image = None
        try:
            from rembg import remove, new_session
            if not hasattr(MatcherService, "_rembg_session"):
                MatcherService._rembg_session = new_session("u2net")
            rgba_image = remove(img, session=MatcherService._rembg_session)
            white_bg = Image.new("RGB", rgba_image.size, (255, 255, 255))
            white_bg.paste(rgba_image, mask=rgba_image.split()[3])
            img = white_bg
        except Exception as e:
            logger.error(f"Background removal failed: {str(e)}")
            img = img.convert("RGB")

        # Tight auto-crop using the alpha mask bounding box.
        # This is the key fix for model photos: after background removal, the alpha
        # channel tells us exactly where the dress pixels are. We crop tightly to
        # that region (with a small 5% padding) so the model has the same visual
        # frame as a flat mannequin photo — eliminating background white space.
        try:
            if rgba_image is not None:
                alpha = rgba_image.split()[3]  # Alpha channel
                bbox = alpha.getbbox()  # (left, top, right, bottom) of non-transparent pixels
                if bbox:
                    bw, bh = rgba_image.size
                    # Fabric Block Cropping: Crop INWARD to destroy silhouette and force focus on embroidery
                    width = bbox[2] - bbox[0]
                    height = bbox[3] - bbox[1]
                    # Crop 20% from left/right, 15% from top/bottom
                    inward_x = int(width * 0.20)
                    inward_y = int(height * 0.15)
                    left = bbox[0] + inward_x
                    top = bbox[1] + inward_y
                    right = bbox[2] - inward_x
                    bottom = bbox[3] - inward_y
                    
                    # Ensure we don't invert bounds
                    if right > left and bottom > top:
                        img = img.crop((left, top, right, bottom))
                        logger.info(f"Fabric Block Cropped: {bbox} → ({left},{top},{right},{bottom})")
        except Exception as e:
            logger.error(f"Auto-crop failed: {str(e)}")
            
        # Enhance Contrast (15%) and Sharpness (20%) to highlight embroidery and thread details.
        # Skipped for query images — applying to model/AI photos shifts their embeddings away
        # from the clean catalogue references, degrading match accuracy.
        try:
            img = ImageEnhance.Contrast(img).enhance(1.15)
            img = ImageEnhance.Sharpness(img).enhance(1.20)
        except Exception as e:
            logger.error(f"Embroidery enhancement failed: {str(e)}")

        return img

    def _get_combined_embedding(self, processed_img):
        """Get 768-dim full image embedding."""
        full_emb  = self._pil_to_embedding(processed_img)
        return full_emb.astype(np.float32)

    def _pil_to_embedding(self, processed_img):
        """Convert a preprocessed PIL image to a normalized 768-dim embedding using SigLIP."""
        if not self.is_loaded:
            self.load_model()
            
        img = self.preprocess(processed_img).unsqueeze(0).to(self.device)
        with torch.no_grad():
            emb = self.model.encode_image(img)

        emb = F.normalize(emb, p=2, dim=1)
        return emb.cpu().numpy()

    def get_augmented_embeddings(self, processed_img):
        """Generate original + 5 augmented embeddings from the preprocessed image."""
        variants = [
            processed_img,
            ImageOps.mirror(processed_img),
            ImageEnhance.Brightness(processed_img).enhance(1.25),
            ImageEnhance.Brightness(processed_img).enhance(0.75),
            processed_img.rotate(5,  expand=True, fillcolor=(255, 255, 255)),
            processed_img.rotate(-5, expand=True, fillcolor=(255, 255, 255)),
        ]
        return [self._get_combined_embedding(v) for v in variants]

    def _base_design_code(self, product_name):
        """'SRS-7042-GOLD' -> 'SRS-7042'. Product names are always
        '<PREFIX>-<code>-<color...>', and the code itself never contains a '-', so
        splitting on the first two hyphens reliably isolates the design from its
        colorway. Used by _keypoint_rerank to avoid re-ranking same-design ties (see
        its docstring) — keypoint matching runs on a grayscale image and can't tell
        two colorways of the identical embroidery/weave pattern apart."""
        parts = product_name.split('-', 2)
        return f"{parts[0]}-{parts[1]}" if len(parts) >= 2 else product_name

    def _thumbnail_path(self, product_name):
        safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in product_name)
        return os.path.join(THUMB_DIR, f"{safe}.jpg")

    def _save_thumbnail_if_missing(self, product_name, pil_image):
        """Keep ONE original (unpreprocessed) reference photo per product as a small
        JPEG, purely for _keypoint_rerank to compare against later — first-come only,
        never overwritten, so this stays cheap even on repeated adds."""
        path = self._thumbnail_path(product_name)
        if os.path.exists(path):
            return
        try:
            thumb = pil_image.convert("RGB")
            thumb.thumbnail((512, 512), Image.LANCZOS)
            thumb.save(path, "JPEG", quality=85)
        except Exception as e:
            logger.error(f"Failed to save thumbnail for {product_name}: {str(e)}")

    def _load_thumbnail_pil(self, product_name):
        path = self._thumbnail_path(product_name)
        if not os.path.exists(path):
            return None
        try:
            return Image.open(path).convert("RGB")
        except Exception as e:
            logger.error(f"Failed to load thumbnail for {product_name}: {str(e)}")
            return None

    def _orb_inlier_count(self, pil_a, pil_b, max_dim=600, nfeatures=1500):
        """ORB keypoint detection + ratio-test matching + RANSAC homography, returning
        the number of geometrically-consistent inlier matches between two images —
        a much sharper same-design-or-not signal than a single embedding similarity
        score for images with strong local texture (embroidery, beadwork)."""
        def to_gray_cv(pil_img):
            im = pil_img.convert("L")
            im.thumbnail((max_dim, max_dim), Image.LANCZOS)
            return np.array(im)

        a, b = to_gray_cv(pil_a), to_gray_cv(pil_b)
        orb = cv2.ORB_create(nfeatures=nfeatures)
        kp1, des1 = orb.detectAndCompute(a, None)
        kp2, des2 = orb.detectAndCompute(b, None)
        if des1 is None or des2 is None or len(kp1) < 8 or len(kp2) < 8:
            return 0

        bf = cv2.BFMatcher(cv2.NORM_HAMMING)
        matches = bf.knnMatch(des1, des2, k=2)
        # Lowe's ratio test — keep a match only if it's clearly better than the next-best.
        # Guard len(pair) == 2: knnMatch can return fewer than k candidates for a
        # descriptor when the other image has very few keypoints.
        good = [pair[0] for pair in matches if len(pair) == 2 and pair[0].distance < 0.75 * pair[1].distance]
        if len(good) < 4:
            return len(good)

        src = np.float32([kp1[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
        dst = np.float32([kp2[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
        _, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
        return int(mask.sum()) if mask is not None else 0

    def _best_orb_score(self, query_img, candidate_img):
        """Max of matching the candidate as-is vs. mirrored — ORB descriptors aren't
        mirror-invariant on their own (a horizontally mirrored query collapsed to
        near-zero inliers against its own true match without this check)."""
        return max(
            self._orb_inlier_count(query_img, candidate_img),
            self._orb_inlier_count(query_img, ImageOps.mirror(candidate_img)),
        )

    def _keypoint_rerank(self, pil_images, product_a, product_b):
        """
        Free, local, zero-API-cost tie-break for two candidates the embedding search
        left in a near-tie (see the trigger in search()). Re-runs the same background-
        removal + fabric-block preprocessing used for embeddings on the query and on
        each candidate's stored thumbnail, so the keypoint match compares embroidery-
        focused, background-free patches instead of picking up spurious matches from
        shared studio backdrops.

        NEVER raises and only ever returns product_a or product_b — any failure
        (missing thumbnail, OpenCV error) falls back to product_a (the embedding's
        own top pick), so this can only help or be neutral, never break a query.
        """
        try:
            thumb_a_pil = self._load_thumbnail_pil(product_a)
            thumb_b_pil = self._load_thumbnail_pil(product_b)
            if thumb_a_pil is None or thumb_b_pil is None:
                logger.info("Keypoint re-rank skipped: missing thumbnail for one/both candidates")
                return product_a

            query_processed = self._preprocess_image(pil_images[0])
            a_processed = self._preprocess_image(thumb_a_pil)
            b_processed = self._preprocess_image(thumb_b_pil)

            score_a = self._best_orb_score(query_processed, a_processed)
            score_b = self._best_orb_score(query_processed, b_processed)
            logger.info(f"Keypoint re-rank: {product_a}={score_a} inliers vs {product_b}={score_b} inliers")
            return product_b if score_b > score_a else product_a
        except Exception as e:
            logger.error(f"Keypoint re-rank failed, falling back to embedding pick: {str(e)}")
            return product_a

    def verify_with_keypoints(self, pil_images, product_name):
        """
        Absolute (not relative) keypoint sanity check on a SINGLE candidate —
        different from _keypoint_rerank, which only ever compares two close
        candidates against each other. This answers "does the fine detail actually
        support this being the same design", which margin-based confidence cannot:
        an out-of-catalog garment can land at, say, 0.89 similarity against one
        catalog item with no other candidate close enough to look like a "close
        call" — margin alone would call that confident. A low inlier count here is
        real evidence the match is wrong regardless of how the embedding score
        looked, or how uncontested it was among catalog candidates.

        Returns an int inlier count, or None if no thumbnail is available for
        product_name (verification skipped, not failed) or on any internal error —
        callers should treat None as "couldn't check", not "check failed".
        """
        try:
            thumb_pil = self._load_thumbnail_pil(product_name)
            if thumb_pil is None:
                return None
            query_processed = self._preprocess_image(pil_images[0])
            candidate_processed = self._preprocess_image(thumb_pil)
            return self._best_orb_score(query_processed, candidate_processed)
        except Exception as e:
            logger.error(f"Keypoint sanity check failed for {product_name}: {str(e)}")
            return None

    def add_product(self, pil_images, product_name):
        """Add one or more images for a product to the index, preprocessing them first."""
        total_embs = 0
        for img in pil_images:
            self._save_thumbnail_if_missing(product_name, img)
            # Preprocess the original image once
            processed_img = self._preprocess_image(img)
            augmented_embs = self.get_augmented_embeddings(processed_img)
            for emb in augmented_embs:
                vec = np.ascontiguousarray(emb, dtype=np.float32)
                self.index.add(vec)
                self.id_to_name_map[self.current_id] = product_name
                self.current_id += 1
                total_embs += 1

        # Local-only save — HF durability push is the HTTP caller's job now
        # (matcher_server.py schedules it as a background task); an in-process
        # caller like scripts/rebuild_matcher_index.py that never sees an
        # HTTP response should call hf_sync.push()/save_db() itself once, at
        # the end of its own batch, not per-product.
        self.save_db_local()
        return total_embs

    def search(self, pil_images):
        """
        Coverage-aware search across 1-4 query images.
        """
        self.load_db() # Reload database from disk to maintain real-time sync with other processes
        if self.current_id == 0:
            return 0.0, "Database Empty", {}

        # Build TTA (Test-Time Augmentation) centroid using Combined Embeddings.
        # Capture the first preprocessed image to use for color detection — after
        # background removal only the dress fabric is visible, so the color classifier
        # is not confused by the model's skin, hair, or environment.
        all_embeddings = []
        first_processed_img = None
        for img in pil_images:
            processed_img = self._preprocess_image(img)
            if first_processed_img is None:
                first_processed_img = processed_img
            
            # The database already contains augmented versions.
            # Querying with an averaged TTA vector shifts the embedding away from the exact match.
            # We simply use the original processed image embedding.
            all_embeddings.append(self._get_combined_embedding(processed_img))

        stacked = np.vstack(all_embeddings)
        avg = stacked.mean(axis=0, keepdims=True)
        norm = np.linalg.norm(avg, axis=1, keepdims=True)
        query_vec = (avg / (norm + 1e-8)).astype(np.float32)

        # Search FAISS for shape, style, and structure
        k = min(500, self.current_id)
        cos_sim, idx_array = self.index.search(query_vec, k)

        # Product-Level Scoring — color-agnostic (no boost applied).
        # Aggregating by design code instead gave wrong results: designs with more
        # color variants had more vectors in the top-k pool and unfairly outscored
        # designs with fewer variants. Product-level keeps comparisons fair.
        product_scores = {}
        for i in range(k):
            matched_id = int(idx_array[0][i])
            if matched_id == -1 or matched_id not in self.id_to_name_map:
                continue

            product = self.id_to_name_map[matched_id]
            semantic_score = float(cos_sim[0][i])

            if product not in product_scores:
                product_scores[product] = []
            product_scores[product].append(semantic_score)

        if not product_scores:
            return 0.0, "Unknown", {}

        product_final = {}
        for p, scores in product_scores.items():
            product_final[p] = max(scores)

        best_product = max(product_final, key=product_final.get)
        best_score = product_final[best_product]

        # Free, local keypoint tie-break for genuinely close calls between DIFFERENT
        # designs. Validated 2026-09-10 on the 30 most mutually-confusable designs in
        # the real catalog (held-out real photos, n=84): raised accuracy from 84.5%
        # (71/84, pure embedding) to 85.7% (72/84). Restricted to cross-design ties
        # only — same-design colorway ties are deliberately excluded, see
        # _keypoint_rerank's docstring for why (grayscale ORB can't tell colorways
        # of the same embroidery pattern apart, and was measured actively harmful
        # there). An AI zero-shot color classifier was also tried as a re-ranker here
        # and measured to be badly harmful (63.1% on the same test) — do not re-add
        # it without new evidence; see matcher_service_experimental.py's history for
        # the full ablation if this needs revisiting.
        runner_up, runner_up_score = None, -1.0
        for p, s in product_final.items():
            if p != best_product and s > runner_up_score:
                runner_up, runner_up_score = p, s

        is_cross_design = (runner_up is not None
                            and self._base_design_code(best_product) != self._base_design_code(runner_up))

        if is_cross_design and best_score > 0 and runner_up_score / best_score >= KEYPOINT_RERANK_CLOSE_CALL_RATIO:
            logger.info(f"Close call ({best_product}={best_score:.4f} vs {runner_up}={runner_up_score:.4f}) — invoking keypoint re-rank")
            reranked = self._keypoint_rerank(pil_images, best_product, runner_up)
            if reranked != best_product:
                logger.info(f"Keypoint re-rank overrode embedding pick: {best_product} -> {reranked}")
                best_product = reranked
                best_score = product_final[best_product]

        logger.info(f"Top matches: {sorted(product_final.items(), key=lambda x: x[1], reverse=True)[:5]}"); return best_score, best_product, product_final

    def get_stats(self):
        self.load_db() # Reload database from disk to maintain real-time sync with other processes
        return {
            "total_images_indexed": self.current_id,
            "unique_products": len(set(self.id_to_name_map.values())),
            "model_loaded": self.is_loaded
        }

    def get_products(self):
        self.load_db() # Reload database from disk to maintain real-time sync with other processes
        counts = {}
        for name in self.id_to_name_map.values():
            counts[name] = counts.get(name, 0) + 1
        return [{"name": name, "embeddings": count} for name, count in counts.items()]

    def delete_product(self, product_name):
        """Delete all reference vectors and labels for a product."""
        self.load_db() # Reload database from disk to maintain real-time sync with other processes
        if not self.id_to_name_map:
            return False
            
        # Find which vector IDs are to be kept and which are to be deleted
        keep_ids = sorted([vid for vid, name in self.id_to_name_map.items() if name != product_name])
        delete_ids = [vid for vid, name in self.id_to_name_map.items() if name == product_name]
        
        if not delete_ids:
            return False # Product not found
            
        # Reconstruct the keep vectors
        keep_vectors = []
        new_id_to_name_map = {}
        new_id = 0
        
        for old_vid in keep_ids:
            # Reconstruct single vector
            vec = self.index.reconstruct(int(old_vid))
            keep_vectors.append(vec)
            new_id_to_name_map[new_id] = self.id_to_name_map[old_vid]
            new_id += 1
            
        # Create fresh index and copy vectors
        self.index = faiss.IndexFlatIP(DIMENSION)
        if keep_vectors:
            stacked = np.vstack(keep_vectors).astype(np.float32)
            self.index.add(stacked)
            
        self.id_to_name_map = new_id_to_name_map
        self.current_id = new_id

        # Clean up the now-orphaned thumbnail too, best-effort.
        try:
            thumb_path = self._thumbnail_path(product_name)
            if os.path.exists(thumb_path):
                os.remove(thumb_path)
        except Exception as e:
            logger.error(f"Failed to remove thumbnail for deleted product {product_name}: {str(e)}")

        # Local-only save — see add_product's matching comment; the HTTP
        # caller (matcher_server.py's DELETE handler) schedules the HF push.
        self.save_db_local()
        return True

# Singleton instance
matcher = MatcherService()
matcher.load_db()
# Optimization: Load model on first use to speed up API startup
