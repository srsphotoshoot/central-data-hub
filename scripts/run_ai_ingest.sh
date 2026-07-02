#!/bin/bash
# Nightly AI photo ingest for CDH dress matcher.
# Picks up any new model-shoot photos added to Google Drive since last run.
# Run via: pm2 start scripts/run_ai_ingest.sh --interpreter bash --name cdh-ai-ingest --cron "0 2 * * *" --no-autorestart

set -e
cd "/Users/romitaggarwal/Desktop/AI/central data hub"
export KMP_DUPLICATE_LIB_OK=TRUE

source venv/bin/activate
python ingest_ai_photos.py
python heal_index.py
