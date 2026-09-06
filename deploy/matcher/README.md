# Matcher — Cloud Run deployment

Self-contained build context for deploying just the image matcher
(`matcher_server.py` + `services/matcher_service.py` + `services/hf_sync.py`) to
Google Cloud Run. Nothing else from CDH is touched or deployed — `main.py`,
`cdh-backend`, the frontend, telegram bot, etc. stay exactly as they are, on
their own local PM2 processes.

## Why a separate folder

The repo root already has its own `Dockerfile` for the whole CDH app. To avoid
any collision or accidental coupling, this folder is a fully independent build
context: before each build/deploy, copy the current source files in here, then
build from here.

## Redeploy steps

From the repo root:

```bash
# 1. Sync current source into this self-contained build context
cp matcher_server.py deploy/matcher/matcher_server.py
mkdir -p deploy/matcher/services
cp services/matcher_service.py services/hf_sync.py deploy/matcher/services/

# 2. Build + push + deploy (from repo root)
gcloud builds submit --tag asia-south1-docker.pkg.dev/gen-lang-client-0091024231/cdh-matcher/matcher:latest \
  --machine-type=e2-highcpu-8 deploy/matcher

gcloud run deploy cdh-image-matcher \
  --image=asia-south1-docker.pkg.dev/gen-lang-client-0091024231/cdh-matcher/matcher:latest \
  --region=asia-south1 \
  --memory=8Gi --cpu=4 \
  --min-instances=0 --max-instances=1 --concurrency=10 \
  --cpu-boost \
  --set-env-vars="HF_TOKEN=...,HF_DATASET_REPO=sourya74/cdh-matcher-index,MATCHER_API_KEY=..." \
  --allow-unauthenticated
```

Region is `asia-south1` (Mumbai) — chosen for latency since the business and Sutra's users
are India-based. **Keep `--max-instances=1`** — going higher lets Cloud Run route some
requests to a second, cold instance even when the first is warm, which is confusing and
was previously misdiagnosed as "sometimes slow within the warm window." **Never set
`HF_HUB_OFFLINE=1`** — it also blocks `hf_sync`'s own downloads, not just the model's.

`--allow-unauthenticated` is required for the Sutra app to call it directly
over plain HTTPS + the `X-API-Key` header (`MATCHER_API_KEY`) — Cloud Run's own
IAM auth is not used here, since that would require the calling app to mint
Google-signed ID tokens instead of a simple shared secret.

## Persistence

The FAISS index + label map live in a private HF Dataset repo
(`sourya74/cdh-matcher-index`), pulled once at container cold-start and pushed
after every `/add` or product delete (see `services/hf_sync.py`). Cloud Run
itself keeps no durable local disk — this is the only durable copy once
deployed, aside from whatever's on the local Mac's `data/matcher/`.
