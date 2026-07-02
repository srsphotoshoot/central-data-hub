import os
import json
import torch
import open_clip
import faiss
import numpy as np
from PIL import Image, ImageEnhance, ImageOps
import torch.nn.functional as F
import logging
from io import BytesIO

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cdh-matcher")

# Paths and Constants
DIMENSION = 768 # Full Image only (Pose Invariant)
MODEL_WEIGHTS = "/Users/romitaggarwal/hf_models/hub/models--Marqo--marqo-fashionSigLIP/snapshots/main/open_clip_pytorch_model.bin"
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "matcher")
INDEX_FILE = os.path.join(DATA_DIR, "dress_db.index")
MAP_FILE = os.path.join(DATA_DIR, "dress_labels.json")

# Ensure data directory exists
os.makedirs(DATA_DIR, exist_ok=True)

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

    def load_model(self):
        """Load the local CLIP model weights."""
        try:
            logger.info(f"Loading local weights from {MODEL_WEIGHTS}...")
            self.model, _, self.preprocess = open_clip.create_model_and_transforms(
                'ViT-B-16-SigLIP',
                pretrained=MODEL_WEIGHTS
            )
            self.model.to(self.device)
            self.model.eval()
            self.tokenizer = open_clip.get_tokenizer('ViT-B-16-SigLIP')
            logger.info("Model loaded successfully!")
            self.is_loaded = True
            return True
        except Exception as e:
            logger.error(f"Failed to load model: {str(e)}")
            return False

    def load_db(self):
        """Load the FAISS index, label map, and color map from disk."""
        try:
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

    def save_db(self):
        """Serialize the FAISS index and Label Map to disk."""
        try:
            faiss.write_index(self.index, INDEX_FILE)
            with open(MAP_FILE, "w") as f:
                json.dump(self.id_to_name_map, f)
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
            tokenizer = self.tokenizer if self.tokenizer else open_clip.get_tokenizer('ViT-B-16-SigLIP')
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
        
        # Remove background and replace with white background
        rgba_image = None
        try:
            from rembg import remove
            rgba_image = remove(img)
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

    def add_product(self, pil_images, product_name):
        """Add one or more images for a product to the index, preprocessing them first."""
        total_embs = 0
        for img in pil_images:
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
        
        # Save updated state to disk
        self.save_db()
        return True

# Singleton instance
matcher = MatcherService()
matcher.load_db()
# Optimization: Load model on first use to speed up API startup
