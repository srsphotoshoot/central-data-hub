# Standalone container for the CDH image matcher (matcher_server.py) only —
# nothing else from the CDH backend. Self-contained build context: see
# deploy/matcher/README.md for how the source files get here before building.
FROM python:3.11-slim

# onnxruntime (used by rembg) needs libgomp1 on debian slim.
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake both AI models into the image at build time instead of downloading them fresh
# on every cold start (Cloud Run's filesystem is ephemeral per instance — without this,
# every cold start re-pulled ~1GB+ from the network, adding ~30-45s of latency/cost).
RUN python -c "import open_clip; open_clip.create_model_and_transforms('hf-hub:Marqo/marqo-fashionSigLIP'); open_clip.get_tokenizer('hf-hub:Marqo/marqo-fashionSigLIP')"
# u2net (~176MB) instead of rembg's newer default BRIA RMBG 2.0 (~1GB) — small enough that
# actually creating the session here (unlike BRIA, which OOM-killed the build worker) works fine.
RUN python -c "from rembg import new_session; new_session('u2net')"

COPY matcher_server.py .
COPY services/ ./services/

ENV KMP_DUPLICATE_LIB_OK=TRUE
# Cloud Run injects $PORT (defaults to 8080); bind to it rather than the
# hardcoded 8001 that matcher_server.py uses when run directly with PM2.
ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "uvicorn matcher_server:app --host 0.0.0.0 --port ${PORT}"]
