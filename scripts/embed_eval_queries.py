"""Stage 1: embed the query photos. torch FIRST, and never touch the faiss index here —
faiss+torch OpenMP interleaving segfaults on macOS (exit 139)."""
import os, sys
os.environ["KMP_DUPLICATE_LIB_OK"]="TRUE"; os.environ["OMP_NUM_THREADS"]="1"
import torch, open_clip            # torch before anything that pulls faiss
torch.set_num_threads(1)
sys.path.insert(0,".")
import json, time
import numpy as np
from PIL import Image
from services.matcher_service import matcher   # imports faiss, but we never call into it
SP=os.environ.get("EVAL_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "matcher_eval"))
os.makedirs(SP, exist_ok=True)

matcher.load_model()                            # NO load_db() -> no faiss index read
man=json.load(open(f"{SP}/manifest.json"))
print(f"embedding {len(man)} query photos...", file=sys.stderr, flush=True)
Q=[]; GT=[]; t0=time.time()
for k,m in enumerate(man,1):
    pi=matcher._preprocess_image(Image.open(m["file"]).convert("RGB"))
    Q.append(matcher._get_combined_embedding(pi).reshape(-1)); GT.append(m["gt"])
    if k%15==0: print(f"  {k}/{len(man)} ({time.time()-t0:.0f}s)", file=sys.stderr, flush=True)
Q=np.vstack(Q).astype(np.float32); Q/=(np.linalg.norm(Q,axis=1,keepdims=True)+1e-8)
np.save(f"{SP}/qemb.npy",Q); json.dump(GT,open(f"{SP}/qgt.json","w"))
print(f"saved {Q.shape} embeddings", file=sys.stderr)
