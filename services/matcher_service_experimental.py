import os
import json
import base64
import torch
import open_clip
import faiss
import cv2
import numpy as np
from PIL import Image, ImageEnhance, ImageOps
import torch.nn.functional as F
import logging
from io import BytesIO

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cdh-matcher")

# Paths and Constants
# [EXPERIMENT #4, tried 2026-09-10, REVERTED] Concatenating a full-bbox-crop embedding
# (silhouette preserved) alongside the fabric-block one was tested against real diagnosed
# mismatches (SRS-6002-LAVENDER vs SRS-8400-POWDER BLUE, etc.) and measured to make things
# WORSE, not better: full-crop-only similarity was higher than fabric-crop-only similarity
# for every genuinely-different-garment pair tested (e.g. 0.80 vs 0.74). Marqo-fashionSigLIP's
# whole-garment embedding apparently responds more to overall "ethnic wedding-wear" styling
# aesthetic than to structural cut/silhouette, so blending it in dilutes toward a *more*
# confusable signal instead of a disambiguating one. Do not re-attempt without re-measuring.
DIMENSION = 768 # Full Image only (Pose Invariant)
# Loaded straight from the Hugging Face Hub (auto-downloads + caches locally) instead of a
# fixed local path — the old local HF cache path was found broken (dangling symlink) during
# the 2026-09-05 recovery, and this also makes the service portable to any host (e.g. a
# Hugging Face Space) with zero local-path assumptions.
MODEL_NAME = "hf-hub:Marqo/marqo-fashionSigLIP"
# EXPERIMENTAL COPY — deliberately points at its own isolated test data directory so this
# never reads/writes the real production index (data/matcher/) that the live matcher_server.py
# and the ongoing catalog re-ingest use. Delete data/matcher_test_experimental/ freely to reset.
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "matcher_test_experimental")
INDEX_FILE = os.path.join(DATA_DIR, "dress_db.index")
MAP_FILE = os.path.join(DATA_DIR, "dress_labels.json")
# [EXPERIMENT #6] One representative reference photo per product, kept ONLY so the
# LLM re-ranker (see _llm_rerank) has something to show Claude for a close-call tie --
# the matcher itself never needed original images, only embeddings, until now.
THUMB_DIR = os.path.join(DATA_DIR, "thumbnails")

# Ensure data directories exist
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(THUMB_DIR, exist_ok=True)

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

# [EXPERIMENT #6] Runner-up must score at least this fraction of the top pick's score
# to count as a "close call" worth an LLM re-rank. 0.97 was picked to roughly match how
# tight the genuinely-confusable pairs measured 2026-09-10 actually were (e.g. 0.9265 vs
# a same-photo self-score near 1.0) without triggering on every merely-similar product.
LLM_RERANK_CLOSE_CALL_RATIO = 0.97

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
        self._loaded_mtime = None  # [EXPERIMENT #2] mtime of INDEX_FILE as of last load_db()

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

    def load_db(self, force=False):
        """Load the FAISS index, label map, and color map from disk.

        [EXPERIMENT #2] Skips the actual disk read when the index file's mtime hasn't
        changed since the last load (unless force=True). Original always reloaded
        unconditionally on every search()/get_stats()/get_products() call — needed when
        a separate Telegram-bot process could write to the index concurrently. Now the
        matcher runs single-process, so that was wasted I/O as the index grows.
        """
        try:
            if not os.path.exists(INDEX_FILE):
                if self.index is None:
                    logger.info("No persistent database found. Initializing a fresh index...")
                    self.index = faiss.IndexFlatIP(DIMENSION)
                    self._loaded_mtime = None
                return True

            current_mtime = os.path.getmtime(INDEX_FILE)
            if not force and self.index is not None and current_mtime == self._loaded_mtime:
                return True  # Already loaded this exact version — nothing to do.

            # Backward Compatibility: Check dimension (reuse this same read below instead
            # of reading the file twice).
            loaded_index = faiss.read_index(INDEX_FILE)
            if loaded_index.d != DIMENSION:
                logger.warning(f"Index dimension mismatch (Found {loaded_index.d}, Expected {DIMENSION}).")
                logger.warning(f"Backing up old index and creating fresh one. PLEASE RE-UPLOAD CATALOGUE.")
                os.rename(INDEX_FILE, INDEX_FILE + ".bak")
                if os.path.exists(MAP_FILE): os.rename(MAP_FILE, MAP_FILE + ".bak")
                self.index = faiss.IndexFlatIP(DIMENSION)
                self.id_to_name_map = {}
                self.current_id = 0
                self._loaded_mtime = None
                return True

            if os.path.exists(MAP_FILE):
                logger.info(f"Loading persistent database from {INDEX_FILE}...")
                self.index = loaded_index
                with open(MAP_FILE, "r") as f:
                    loaded_map = json.load(f)
                    self.id_to_name_map = {int(k): v for k, v in loaded_map.items()}
                    self.current_id = max(self.id_to_name_map.keys()) + 1 if self.id_to_name_map else 0
                self._loaded_mtime = current_mtime
                logger.info(f"Loaded {self.current_id} vectors successfully from disk.")
            elif self.index is None:
                logger.info("No persistent database found. Initializing a fresh index...")
                self.index = faiss.IndexFlatIP(DIMENSION)

            return True
        except Exception as e:
            logger.error(f"Failed to load database: {str(e)}")
            return False

    def save_db(self):
        """Serialize the FAISS index and Label Map to disk."""
        try:
            faiss.write_index(self.index, INDEX_FILE)
            with open(MAP_FILE, "w") as f:
                json.dump(self.id_to_name_map, f)
            self._loaded_mtime = os.path.getmtime(INDEX_FILE)  # [EXPERIMENT #2]
            logger.info("Database saved to disk.")
        except Exception as e:
            logger.error(f"Failed to save database: {str(e)}")

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
        3. Auto-crops tightly to the dress bounding box (removes empty white space),
           then crops INWARD (fabric-block crop) to destroy silhouette and force
           focus on embroidery/texture.
        4. Enhances Contrast (15%) and Sharpness (20%) to highlight embroidery patterns.

        Ports two production-only perf fixes this experimental copy had fallen behind
        on (services/matcher_service.py): downscaling to 1024px before rembg, and a
        cached u2net session instead of rembg's heavier default model.

        [EXPERIMENT #4, tried 2026-09-10, REVERTED] Also tried returning a second,
        full-bbox (silhouette-preserving) crop alongside this one and blending both
        into the embedding, on the theory that the fabric-block crop was throwing away
        the "these are different garment types" signal in real diagnosed mismatches
        (e.g. SRS-6002-LAVENDER vs SRS-8400-POWDER BLUE). Measured against those real
        cases and reverted: the full-bbox crop's embedding was LESS discriminating than
        the fabric-block crop's, not more (e.g. 0.80 vs 0.74 similarity for that same
        pair) — Marqo-fashionSigLIP's whole-garment embedding tracks overall "ethnic
        wedding-wear" styling aesthetic more than structural cut, so blending it in
        made cross-design confusion worse. See DIMENSION's comment. Do not re-attempt
        without re-measuring against real cases first.
        """
        # Fix EXIF orientation
        img = ImageOps.exif_transpose(pil_image)

        MAX_DIM = 1024
        if max(img.size) > MAX_DIM:
            img.thumbnail((MAX_DIM, MAX_DIM), Image.LANCZOS)

        # Remove background and replace with white background
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

        # Tight auto-crop using the alpha mask bounding box, then crop INWARD
        # (fabric-block crop) to destroy silhouette and force focus on embroidery.
        try:
            if rgba_image is not None:
                alpha = rgba_image.split()[3]  # Alpha channel
                bbox = alpha.getbbox()  # (left, top, right, bottom) of non-transparent pixels
                if bbox:
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
        try:
            img = ImageEnhance.Contrast(img).enhance(1.15)
            img = ImageEnhance.Sharpness(img).enhance(1.20)
        except Exception as e:
            logger.error(f"Embroidery enhancement failed: {str(e)}")

        return img

    def _get_combined_embedding(self, processed_img):
        """Get 768-dim full image embedding."""
        full_emb = self._pil_to_embedding(processed_img)
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

    def _thumbnail_path(self, product_name):
        safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in product_name)
        return os.path.join(THUMB_DIR, f"{safe}.jpg")

    def _save_thumbnail_if_missing(self, product_name, pil_image):
        """[EXPERIMENT #6] Keep ONE original (unpreprocessed) reference photo per
        product as a small JPEG, purely for the LLM re-ranker to show Claude later --
        first-come only, never overwritten, so this stays cheap even on repeated adds."""
        path = self._thumbnail_path(product_name)
        if os.path.exists(path):
            return
        try:
            thumb = pil_image.convert("RGB")
            thumb.thumbnail((512, 512), Image.LANCZOS)
            thumb.save(path, "JPEG", quality=85)
        except Exception as e:
            logger.error(f"Failed to save thumbnail for {product_name}: {str(e)}")

    def _load_thumbnail_b64(self, product_name):
        path = self._thumbnail_path(product_name)
        if not os.path.exists(path):
            return None
        try:
            with open(path, "rb") as f:
                return base64.standard_b64encode(f.read()).decode("utf-8")
        except Exception as e:
            logger.error(f"Failed to load thumbnail for {product_name}: {str(e)}")
            return None

    def _load_thumbnail_pil(self, product_name):
        path = self._thumbnail_path(product_name)
        if not os.path.exists(path):
            return None
        try:
            return Image.open(path).convert("RGB")
        except Exception as e:
            logger.error(f"Failed to load thumbnail for {product_name}: {str(e)}")
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

        self.save_db()
        return total_embs

    def _base_design_code(self, product_name):
        """[EXPERIMENT #1] 'SRS-7042-GOLD' -> 'SRS-7042'. Product names are always
        '<PREFIX>-<code>-<color...>', and the code itself never contains a '-', so
        splitting on the first two hyphens reliably isolates the design from its colorway."""
        parts = product_name.split('-', 2)
        return f"{parts[0]}-{parts[1]}" if len(parts) >= 2 else product_name

    def _color_of_product(self, product_name):
        """[EXPERIMENT #1] Normalize a product name's color suffix to a STANDARD_COLORS
        entry (via COLOR_MAP), or None if it doesn't map to anything recognized."""
        parts = product_name.split('-', 2)
        if len(parts) < 3:
            return None
        raw = parts[2].strip().upper()
        if raw in COLOR_MAP:
            return COLOR_MAP[raw]
        for key, std in COLOR_MAP.items():
            if key in raw:
                return std
        return None

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
        first_fabric_img = None
        for img in pil_images:
            processed_img = self._preprocess_image(img)
            if first_fabric_img is None:
                first_fabric_img = processed_img

            # The database already contains augmented versions.
            # Querying with an averaged TTA vector shifts the embedding away from the exact match.
            # We simply use the original processed image embedding.
            all_embeddings.append(self._get_combined_embedding(processed_img))

        stacked = np.vstack(all_embeddings)
        avg = stacked.mean(axis=0, keepdims=True)
        norm = np.linalg.norm(avg, axis=1, keepdims=True)
        query_vec = (avg / (norm + 1e-8)).astype(np.float32)

        # Search FAISS for shape, style, and structure.
        # [EXPERIMENT #3] Scale k with catalog size instead of a flat 500 — a fixed k risks
        # not surfacing the true best match once the catalog grows well past today's ~800
        # products, since every extra product adds more competing entries to the same top-k pool.
        unique_products_so_far = len(set(self.id_to_name_map.values()))
        k = min(self.current_id, max(500, unique_products_so_far * 10))
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

        # [EXPERIMENT #5] Soft color-aware re-ranking, applied BEFORE design selection
        # so it can also rule out cross-design mismatches, not just disambiguate
        # colorways within an already-chosen design (that's [EXPERIMENT #1] below).
        # Diagnosed 2026-09-10 (real learning_log.jsonl mismatches): SRS-6002-LAVENDER
        # was matched to SRS-8400-POWDER BLUE and SRS-18290-PEACH to SRS-8400-LAVENDER
        # — both wrong picks were a different color family than the query. The theory
        # was that a soft, capped multiplicative penalty could only help or be neutral.
        #
        # DISABLED 2026-09-10 after measurement proved that theory wrong: a controlled
        # A/B on the 30 most mutually-confusable designs in the real catalog (held-out
        # real photos, n=84) showed color re-rank ALONE dropped accuracy from 84.5%
        # (71/84, pure embedding) to 63.1% (53/84) — a 21-point regression, not a mild
        # nudge. Root cause: exactly the designs this was meant to help are the ones
        # where top-1 vs top-2 embedding scores are already razor-thin (that's *why*
        # they're confusable), so even a 15% penalty flips the winner constantly —
        # and the classifier itself was independently measured at only ~50% top-1
        # accuracy (confidently wrong sometimes, e.g. a labeled PEACH photo scored 91%
        # CHIKU). A few specific colorways (e.g. SRS-8795-LAVENDER, SRS-8586-FIROZI)
        # became "attractors" that wrongly absorbed many unrelated queries whenever the
        # classifier over-predicted their color. Keypoint re-rank alone, tested the same
        # way, was ~neutral (82.1%, 69/84) — this penalty was the entire regression.
        # Do NOT re-enable without re-running this same ablation and seeing a real gain.
        COLOR_RERANK_ENABLED = False
        COLOR_MISMATCH_PENALTY = 0.85
        COLOR_CONFIDENCE_FLOOR = 0.15
        detected_colors = self._extract_colors_from_query(first_fabric_img) if COLOR_RERANK_ENABLED else {}
        if detected_colors:
            top_color, top_prob = max(detected_colors.items(), key=lambda kv: kv[1])
            if top_prob >= COLOR_CONFIDENCE_FLOOR:
                for p in list(product_final.keys()):
                    pc = self._color_of_product(p)
                    if pc is not None and pc != top_color:
                        product_final[p] *= COLOR_MISMATCH_PENALTY

        # [EXPERIMENT #1] Two-stage selection: pick the DESIGN via embedding score first
        # (unchanged from before — the design containing the single highest-scoring entry
        # always wins, same as the old flat argmax), then disambiguate *which colorway* of
        # that design using the AI color classifier instead of trusting embedding noise to
        # have picked the right color variant. _extract_colors_from_query() already existed
        # but was never actually called from search() — this wires it in.
        design_scores = {}
        design_to_products = {}
        for name, score in product_final.items():
            design = self._base_design_code(name)
            design_to_products.setdefault(design, []).append(name)
            if score > design_scores.get(design, -1):
                design_scores[design] = score

        best_design = max(design_scores, key=design_scores.get)
        candidates = design_to_products[best_design]

        if len(candidates) == 1:
            best_product = candidates[0]
        else:
            # Reuse the color signal already computed above ([EXPERIMENT #5]) instead
            # of re-running the classifier a second time on the same image.
            best_product = None
            if detected_colors and top_prob >= COLOR_CONFIDENCE_FLOOR:
                color_matches = [c for c in candidates if self._color_of_product(c) == top_color]
                if color_matches:
                    best_product = max(color_matches, key=lambda c: product_final[c])
            if best_product is None:
                # No usable color signal, or none of this design's colorways matched the
                # detected color — fall back to the original embedding-only behavior.
                best_product = max(candidates, key=lambda c: product_final[c])

        best_score = product_final[best_product]

        # [EXPERIMENT #6/#7] Fine-grained tie-break for genuinely close calls that
        # survive everything above. Diagnosed 2026-09-10: some catalog designs (e.g.
        # SRS-6002-GOLD vs SRS-5854-GOLD) are near-duplicate garments that a global
        # SigLIP embedding measurably cannot separate (~0.93 cosine similarity either
        # way, confirmed against real photos) — no crop or color tweak fixes this, it
        # needs an actual close look. Only triggers when a DIFFERENT product is within
        # LLM_RERANK_CLOSE_CALL_RATIO of the top score, so it costs nothing on the
        # large majority of queries that aren't ambiguous.
        #
        # Two interchangeable implementations exist below — same signature
        # (pil_images, product_a, product_b) -> product_a or product_b, same
        # never-raises/fall-back-to-product_a contract:
        #   _keypoint_rerank  — FREE, local, no API key, no network. ORB keypoint
        #                       matching + RANSAC. Validated 2026-09-10 on the real
        #                       diagnosed near-duplicate pairs: ~1400 inlier matches
        #                       for the true design vs 0-12 for the confusable one,
        #                       even under brightness/rotation variation (a mirrored
        #                       query needed an explicit mirror-check to fix — ORB
        #                       descriptors aren't mirror-invariant on their own).
        #   _llm_rerank       — needs ANTHROPIC_API_KEY (small per-call cost). Likely
        #                       more robust on strongly deformed/flowy fabric where
        #                       keypoints shift unpredictably, but unvalidated so far
        #                       since it was never actually run against real photos.
        # Active by default: _keypoint_rerank (no account/billing setup required).
        # Swap the call below to self._llm_rerank(...) to use the paid path instead.
        runner_up, runner_up_score = None, -1.0
        for p, s in product_final.items():
            if p != best_product and s > runner_up_score:
                runner_up, runner_up_score = p, s

        # Only re-rank across DIFFERENT designs. Diagnosed 2026-09-10: 3 of 8 real
        # regressions from keypoint re-rank (SRS-8662-PINK/PURPLE, SRS-8704-RANI/PINK,
        # SRS-8683-RANI/PINK) were same-design, different-colorway ties -- ORB runs on
        # a grayscale conversion (_orb_inlier_count's to_gray_cv), so two colorways of
        # the identical embroidery/weave pattern look the same to it and it adds pure
        # noise there. The remaining 5 regressions were all between genuinely
        # near-duplicate DIFFERENT designs (the same catalog pairs the confusable-30
        # set was built from) where no crop/color/keypoint fix has helped so far.
        is_cross_design = (runner_up is not None
                            and self._base_design_code(best_product) != self._base_design_code(runner_up))

        if is_cross_design and best_score > 0 and runner_up_score / best_score >= LLM_RERANK_CLOSE_CALL_RATIO:
            logger.info(f"Close call ({best_product}={best_score:.4f} vs {runner_up}={runner_up_score:.4f}) — invoking keypoint re-rank")
            reranked = self._keypoint_rerank(pil_images, best_product, runner_up)
            if reranked != best_product:
                logger.info(f"Keypoint re-rank overrode embedding pick: {best_product} -> {reranked}")
                best_product = reranked
                best_score = product_final[best_product]

        logger.info(f"Top matches: {sorted(product_final.items(), key=lambda x: x[1], reverse=True)[:5]}"); return best_score, best_product, product_final

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
        """Max of matching the candidate as-is vs. mirrored. Diagnosed 2026-09-10:
        plain ORB matching collapsed to near-zero on a horizontally mirrored query
        (7 inliers vs the true design, indistinguishable from 4 vs a wrong one) —
        ORB descriptors aren't mirror-invariant. Checking both orientations and
        taking the best restored full separation (1401 vs 4) at negligible extra cost."""
        return max(
            self._orb_inlier_count(query_img, candidate_img),
            self._orb_inlier_count(query_img, ImageOps.mirror(candidate_img)),
        )

    def _keypoint_rerank(self, pil_images, product_a, product_b):
        """
        [EXPERIMENT #7] Free, local, zero-API-cost tie-break for two candidates the
        embedding search left in a near-tie — see the [EXPERIMENT #6/#7] comment in
        search() for validation numbers. Re-runs the same background-removal +
        fabric-block preprocessing used for embeddings on the query and on each
        candidate's stored thumbnail, so the keypoint match compares embroidery-focused,
        background-free patches instead of picking up spurious matches from shared
        studio backdrops (these catalogue photos are shot in a handful of recurring
        courtyard/palace locations).

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

    def _llm_rerank(self, pil_images, product_a, product_b):
        """
        [EXPERIMENT #6] Fine-grained tie-break for two candidates the embedding search
        left in a near-tie. Shows Claude the customer's query photo(s) plus one
        reference photo of each candidate and asks it to pick — a vision-capable model
        can reason about specific details (trim, motif density/placement, neckline,
        sleeve style) that a single cosine-similarity score collapses away, which is
        exactly the failure mode measured for genuinely near-duplicate catalogue
        designs (see the CLOSE_CALL_RATIO trigger in search()).

        NEVER raises and never returns anything other than product_a or product_b —
        any failure (no ANTHROPIC_API_KEY, network error, missing thumbnail for either
        candidate, malformed reply) silently falls back to product_a (the embedding's
        own top pick), so this can only help or be neutral, never break a query.
        """
        try:
            thumb_a = self._load_thumbnail_b64(product_a)
            thumb_b = self._load_thumbnail_b64(product_b)
            if thumb_a is None or thumb_b is None:
                logger.info("LLM re-rank skipped: missing thumbnail for one/both candidates")
                return product_a

            import anthropic
            client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from env; raises if unset

            def _query_img_b64(pil_img):
                buf = BytesIO()
                pil_img.convert("RGB").save(buf, "JPEG", quality=85)
                return base64.standard_b64encode(buf.getvalue()).decode("utf-8")

            content = [{"type": "text", "text": "Photo(s) of a dress a customer owns:"}]
            for img in pil_images[:2]:  # cap query photos to keep the call small/cheap
                content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": _query_img_b64(img)}})
            content.append({"type": "text", "text": "Catalogue Candidate A:"})
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": thumb_a}})
            content.append({"type": "text", "text": "Catalogue Candidate B:"})
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": thumb_b}})
            content.append({"type": "text", "text": (
                "An embedding search found Candidate A and Candidate B nearly tied as the "
                "match for the customer's dress. Which one is actually the SAME physical "
                "design (cut, embroidery pattern, trim, neckline) as the customer's photo(s), "
                "allowing for a different pose, lighting, or camera angle? Look closely at "
                "details like sleeve/trim style and embroidery placement/density. "
                "Respond with EXACTLY one character: A or B. No other text."
            )})

            response = client.messages.create(
                model="claude-opus-5",
                max_tokens=8,
                messages=[{"role": "user", "content": content}],
            )
            answer = "".join(b.text for b in response.content if b.type == "text").strip().upper()
            return product_b if answer.startswith("B") else product_a
        except Exception as e:
            logger.error(f"LLM re-rank failed, falling back to embedding pick: {str(e)}")
            return product_a

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
        
        # Save updated state to disk
        self.save_db()
        return True

# Singleton instance
matcher = MatcherService()
matcher.load_db()
# Optimization: Load model on first use to speed up API startup
