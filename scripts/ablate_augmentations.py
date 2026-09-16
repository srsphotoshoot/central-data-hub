"""Stage 2: augmentation ablation. faiss+numpy only, no torch (see stage 1 for why).
Each product is a consecutive block of 6 vectors in a fixed order:
  0=original 1=mirror 2=bright1.25 3=bright0.75 4=rot+5 5=rot-5
so an augmentation subset is simulated by masking vector positions."""
import os, sys, json
os.environ["KMP_DUPLICATE_LIB_OK"]="TRUE"
import numpy as np, faiss
from collections import defaultdict
SP=os.environ.get("EVAL_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "matcher_eval"))
os.makedirs(SP, exist_ok=True)

labels={int(k):v for k,v in json.load(open("data/matcher/dress_labels.json")).items()}
index=faiss.read_index("data/matcher/dress_db.index"); N=index.ntotal
X=index.reconstruct_n(0,N).astype(np.float32); X/=(np.linalg.norm(X,axis=1,keepdims=True)+1e-8)
byp=defaultdict(list)
for i in sorted(labels): byp[labels[i]].append(i)
augpos=np.zeros(N,dtype=np.int8)
for p,ids in byp.items():
    for j,i in enumerate(ids): augpos[i]=j%6
owner=np.array([labels[i] for i in range(N)])

Q=np.load(f"{SP}/qemb.npy"); GT=json.load(open(f"{SP}/qgt.json"))
S=Q@X.T
def dz(n): p=n.split("-"); return "-".join(p[:2])

def ev(mask,name,base=None):
    cols=np.where(mask)[0]; Sm=S[:,cols]; own=owner[cols]
    uniq,inv=np.unique(own,return_inverse=True); P=len(uniq)
    f=d=0
    for r in range(Sm.shape[0]):
        best=np.full(P,-1e9,dtype=np.float32); np.maximum.at(best,inv,Sm[r])
        pick=uniq[int(np.argmax(best))]
        f+= pick==GT[r]; d+= dz(pick)==dz(GT[r])
    n=Sm.shape[0]
    delta=""
    if base: delta=f"   full {f-base[0]:+d}   design {d-base[1]:+d}"
    print(f"  {name:<34} full {f:3d}/{n} ({100*f/n:5.1f}%)   design {d:3d}/{n} ({100*d/n:5.1f}%){delta}")
    return f,d

print(f"=== AUGMENTATION ABLATION (n={len(GT)} real photos, embedding-only pick) ===")
base=ev(np.ones(N,dtype=bool),"ALL 6  (current production)")
print()
for m,nm in [((augpos!=2)&(augpos!=3),"drop BOTH brightness"),
             (augpos!=2,"drop bright+1.25 only"),
             (augpos!=3,"drop bright-0.75 only"),
             ((augpos!=4)&(augpos!=5),"drop rotations"),
             (augpos!=1,"drop mirror"),
             ((augpos==0)|(augpos==1),"original + mirror only"),
             (augpos==0,"original only (no augmentation)")]:
    ev(m,nm,base)
