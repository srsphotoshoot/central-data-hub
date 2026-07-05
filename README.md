# Central Data Hub (CDH) — v2.0 (Local-First Edition)

Central Data Hub is a FastAPI backend that acts as a shared data warehouse and router between an external ERP ("Decent ERP"), several internal ingestion pipelines (Telegram bot, AI photo downloader, Google Drive catalog sync, an AI dress-matcher), and client apps — notably the separate **`sales_app`** project, which both pulls a shared product catalog from CDH and pushes its own sales/product/user data into it.

This document maps every code path exhaustively: every route, every background process, every data source, and every known gap or rough edge. It reflects the code as it stands today, not the aspirational architecture in the original Quick Start section below.

---

## 1. Quick Start (as originally documented)

### 1.1 One-Time Setup
```bash
./setup.sh
```

### 1.2 Launch the Platform
```bash
./run.sh
```
- **Dashboard**: http://localhost:5173
- **API Docs**: http://localhost:8000/docs

In practice, on this machine the components run as individual **PM2** processes (see §9) rather than via `run.sh` directly.

---

## 2. High-level architecture

```
                    ┌─────────────────────────────┐
  Decent ERP ──────►│  ingestion.py                │  (manual trigger only —
  (external, manual │  fetch_and_store_data()      │   NOT on a schedule,
   admin "Sync"      └──────────────┬───────────────┘   see §5)
   button only)                     │ writes RawData
                                     ▼
  sales_app ─POST──►┌─────────────────────────────────────┐
  (webhook push)     │  main.py  (FastAPI, port 8000)      │
                     │  POST /api/v1/webhook/{source}      │──► RawData table
  Telegram bot ─────►│  (writes RawData only — no inline    │
  Drive sync ───────►│   processing, by design)              │
  matcher_server ◄───┤                                       │
  (proxied, port     └───────────────┬───────────────────────┘
   8001)                             │ polled every 5s
                                      ▼
                     ┌─────────────────────────────────────┐
                     │  worker.py  (PM2: cdh-worker)        │
                     │  processing.process_raw_data()       │
                     │  RawData → (MappingRule) → Processed │
                     │  Data, then dispatcher.py fires      │
                     │  outbound webhooks to subscribers    │
                     └───────────────┬───────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────────┐
                    ▼                 ▼                     ▼
          sales_app pulls     Dashboard reads         Subscribers with a
        GET /api/v1/data/     /api/v1/data/* and      registered callback_url
        {category}            /admin/* endpoints      get an outbound POST
        (manual "Sync from                            (dispatcher.py, no retry)
         Hub" button)
```

Everything is keyed loosely by **string fields** (`source`, `category`, `entity_id`) — there are no foreign keys or SQLAlchemy relationships anywhere in the schema.

---

## 3. Database (`database.py`) — SQLite, no migrations

`DATABASE_URL` env var (default: a hardcoded absolute path to `central_hub.db` in this repo). SQLite gets `check_same_thread=False`; a non-SQLite URL (Postgres) additionally gets connection pooling (`pool_size=5, max_overflow=10`) — this conditional is the entire "cloud readiness" story. There is **no Alembic / schema-versioning tool** — `init_db()` just runs `Base.metadata.create_all()` on startup, and `scripts/migrate_to_pg.py` is a one-shot data copy, not a migration tool (see §10).

| Table | Columns | Written by | Read by |
|---|---|---|---|
| `raw_data` (`RawData`) | `id, source, endpoint, method, headers(JSON), data(JSON), received_at, is_processed, processed_at` | webhook receiver, `ingestion.py`, gatepass self-trigger | `processing.py` (marks processed), `/admin/raw` |
| `processed_data` (`ProcessedData`) | `id, category, entity_id(indexed), content(JSON), updated_at` | `processing.py` (upsert/delete by `entity_id`), `scripts/import_sales_app.py` | `/api/v1/data/{category}`, all `/api/v1/products\|sale-orders\|...` compat routes, `/api/production/*` analytics, `/admin/transactions`, `/admin/stats` |
| `api_keys` (`APIKey`) | `id, key(unique), project_name, scope(JSON list, nullable=global), callback_url(nullable), is_active` | admin key-creation endpoint, `scripts/setup_sales_app.py` | all three auth dependencies (§4), `dispatcher.py` |
| `mapping_rules` (`MappingRule`) | `id, source, target_category, field_mappings(JSON), is_active` | admin rule endpoints, `scripts/setup_sales_app.py` | `processing.py` |
| `gatepass_entries` (`GatepassEntry`) | full gate-pass schema: `timestamp, type, status, cdh_verified, date, challanNo, partyName, designNo, description, quantity, unitType, orderNo, transportName, biltyNo, dept, parcelFrom, initiatedBy, guardHoldReason, guardNotes, meta` | gatepass routes in `main.py` | gatepass routes, SSE stream |
| `catalog_products` (`CatalogProduct`) | `id, name, description, category, fabric, hsn_code, gst_rate, cost_price, price, mrp, sizes(JSON), status, image_url, crm_tags(JSON), variants(JSON: color→Drive file-id list)` | catalog CRUD routes, `scripts/import_catalog_from_drive.py` | catalog routes, `services/ai_image_downloader.py`, `services/drive_watcher.py` |

`central_hub.db` is confirmed SQLite (WAL mode — `.db-shm`/`.db-wal` sidecar files present). **Note**: `n8n_current.sqlite` also sits in this repo's root — that is n8n's own workflow-automation database, unrelated to CDH's schema; don't confuse the two.

---

## 4. Auth — a single header, three dependencies

Every protected route uses `X-API-KEY` (`APIKeyHeader`, `auto_error=False`) — there is no session/cookie auth anywhere.

- **`get_admin_key`** — compares the header verbatim to `CDH_ADMIN_KEY` env var. 403 on mismatch/missing. Guards all `/admin/*` routes, PM2 control, and catalog writes.
- **`get_webhook_auth`** — accepts either the admin key **or** any row in `api_keys` with `is_active=True`. Guards the generic webhook receiver and the "create gatepass entry" route.
- **`get_api_key(category)`** — used only by the data-reader endpoint. Admin key bypasses all scope checks. A project key with a non-null `scope` list must have the requested `category` in that list, or it gets `403 "Project not authorized for category: {category}"`.

---

## 5. Inbound data — how things get into CDH

### 5.1 From `sales_app` (and any other project) — webhook push
`POST /api/v1/webhook/{source}` — reads the raw JSON body + headers, stores it verbatim as a new `RawData` row (`endpoint=f"webhook/{source}"`, `method="WEBHOOK"`). **Deliberately does not process inline** — the call to trigger processing is commented out in the code, with a note that this avoids exhausting the DB connection pool under load. Processing happens exclusively via `worker.py`'s 5-second poll loop (§7), or manually via `POST /admin/process`.

`scripts/setup_sales_app.py` is what makes `sales_app`'s pushes actually land somewhere useful: it registers a fixed API key (`cdh_sales_app_key_2026`) scoped to `["products","sales","logs"]`, plus two `MappingRule`s (`sales_app` → category `sales`, field-mapping `orderId/customer/cart/totalValue`; `sales_app_products` → category `products`, passthrough).

### 5.2 From Decent ERP — **manual only, no scheduler**
`ingestion.py`'s `fetch_and_store_data(endpoint, source, method, payload)` calls `{DECENT_ERP_API_URL}/{endpoint}` with a Bearer token (`DECENT_ERP_API_KEY`) and stores the whole response as one `RawData` row.

**This is only ever invoked by**:
1. `POST /api/v1/admin/ingest?endpoint=` (SSRF-guarded by a regex on `endpoint`), triggered manually.
2. The dashboard's "Sync Active" button, which calls that same admin endpoint.

**There is no cron/scheduled Decent ERP puller anywhere in this codebase** — `worker.py` imports `processing` but never calls `ingestion.fetch_and_store_data`. If continuous ERP ingestion is assumed elsewhere in the org's mental model of this system, that assumption is currently false; someone has to click "Sync Active" (or hit the admin endpoint) for new ERP data to arrive at all.

### 5.3 From the Telegram bot, Drive sync, AI downloader (`services/`)
See §8 — these write into the matcher's own FAISS index and/or `catalog_products` / filesystem cache, not directly into `raw_data`/`processed_data` (except the AI dress-matcher's corrections log).

### 5.4 Gatepass entries (a semi-separate subsystem living in the same `main.py`)
`POST /api/entries` creates a gate-pass record directly in `gatepass_entries` (not routed through the Raw→Processed pipeline at all), broadcasts it over Server-Sent Events (`/api/events`), and additionally fires a **self-triggered mirror webhook** (`inbound_webhook_self_trigger`) that stores a `RawData` copy with `source="passify"` — so gatepass activity *also* shows up in the generic raw-data feed, redundantly. `POST /api/v1/webhook/passify` is a compatibility endpoint that normalizes field-name variants and does fuzzy-substring matching to auto-clear a pending incoming pass against an outgoing one.

---

## 6. Processing — Raw → Categorized (`processing.py`)

`process_raw_data()`, on every tick of `worker.py`'s loop:
1. Loads all **active** `MappingRule`s and all `RawData` rows where `is_processed = False`.
2. For each raw row, finds the first rule whose `source` matches the row's `source` (first match wins — no priority ordering exists if two rules ever shared a source).
3. Rule found → `category = rule.target_category`, fields renamed per `rule.field_mappings` (unmapped fields pass through unchanged). No rule found → `category = raw source string verbatim`, content untouched.
4. `entity_id` is guessed heuristically from the content: `orderId` → `uid` → `id` → `uuid` → else a synthetic `raw_{row.id}`.
5. Injects `content["_source"] = row.source` — this single field is what powers the dashboard's per-project grouping/filtering.
6. **Upsert-or-delete by `entity_id`**: if `content["_action"] == "DELETE"`, the matching `ProcessedData` row is deleted; otherwise it's updated in place or inserted new. This is how `sales_app`'s delete-product/delete-order/deactivate-user actions (which push a payload with `_action:'DELETE'`) actually remove data from CDH's mirror rather than leaving stale copies.
7. Marks the raw row processed, commits, closes the session, **then** — outside the DB session, to avoid holding a connection open during a network call — invokes `dispatcher.dispatch_processed_data(category, content)` for every item just processed.

---

## 7. Outbound dispatch (`dispatcher.py`) — no retries, no signing

For each processed item, queries `api_keys` for active rows with a non-null `callback_url` whose `scope` is either null (global subscriber) or includes the item's `category`, and `POST`s `{event:"data_available", category, data}` to each with a 5s timeout. Failures are logged and dropped — **there is no retry queue**, and outbound requests carry **no signature/secret header** (the code has a comment acknowledging this gap explicitly). Any integration relying on guaranteed delivery needs to poll `GET /api/v1/data/{category}` instead of trusting the push.

---

## 8. Background processes & services (`services/`, top-level scripts)

The 5-second Raw→Processed loop lives in **`worker.py`** (`run_pulse()`) — the sole always-on driver of processing + dispatch; it retries after a 10s sleep on any exception.

| Service | File | Role | Trigger | Talks to |
|---|---|---|---|---|
| Telegram bot | `services/telegram_bot.py` | Photo-based dress lookup + training via chat; corrections are routed through the local HTTP API (`POST /api/v1/matcher/add`) rather than the bot's own in-process matcher object, specifically to avoid a race where the bot's stale in-memory index would clobber vectors added elsewhere after bot startup | Telegram long-polling | Telegram Bot API, local matcher API |
| Drive catalog sync | `services/drive_watcher.py` | Walks a Drive folder tree (style → color → AI/flat-photo subfolders) every 15 min by default, ingests new photos into the matcher, tracks per-product sync state so nothing is reprocessed | Infinite loop, 60s backoff on auth failure | Google Drive API (service account preferred, falls back to OAuth `token.json` since no service-account file is present on disk) |
| AI image downloader | `services/ai_image_downloader.py` | Hourly sweep of every `catalog_products.variants[].images` Drive file-id, downloads any missing to a local disk cache | `while True: sync(); sleep(3600)` | Google Drive API |
| AI dress matcher (library) | `services/matcher_service.py` | SigLIP embedding + FAISS similarity search; preprocessing pipeline: EXIF-transpose → background removal → tight crop (with an inward "fabric block" crop specifically to defeat silhouette-only matching and force pattern/embroidery matching) → contrast enhancement → test-time augmentation on reference adds | imported by `matcher_server.py` and the Telegram bot | local model weights, `data/matcher/dress_db.index` + `dress_labels.json` |
| AI dress matcher (service) | `matcher_server.py` (top-level, not in `services/`) | Standalone FastAPI app on **port 8001**, deliberately a separate OS process so CPU-bound inference can't block `main.py`'s event loop; `main.py` proxies `/api/v1/matcher/*` to it | HTTP | — |
| Production analytics | `services/production_engine.py` | Pure computation (no process) building dashboard analytics from `ProcessedData` categories + a mock "job work"/karigar dataset; includes a demo randomizer for offline-mode UI testing | request-triggered from `main.py`'s `/api/production/*` routes | reads `ProcessedData`, writes `services/mock_job_work.json` |
| Drive OAuth bootstrap | `services/authenticate_drive.py` | One-shot interactive script to produce `token.json` from `credentials.json` (OAuth client secret) — run manually once so the above services can run headless afterward | manual | Google OAuth |

> **`matcher_server.py` is NOT the same "CRM" that `sales_app` pushes orders to.** `sales_app`'s `pushToCRM()` hits a hardcoded `127.0.0.1:8005`, which is a completely separate "Office CRM" project (own repo, `crm-be` symlink elsewhere on this machine) with zero code relationship to CDH. CDH's own matcher service is on port **8001**.

---

## 9. Process topology — PM2

Defined in `ecosystem.config.js`:

| PM2 name | Script | Confirmed live? |
|---|---|---|
| `cdh-backend` | `main.py` (FastAPI, port 8000) | ✅ online |
| `cdh-worker` | `worker.py` | ✅ online |
| `cdh-matcher-service` | `matcher_server.py` (port 8001) | ✅ online |
| `cdh-telegram-bot` | `services/telegram_bot.py` | ✅ online |
| `cdh-drive-sync` | `services/drive_watcher.py` | ✅ online |
| `cdh-ai-downloader` | `services/ai_image_downloader.py` | ✅ online |
| `cdh-frontend` | `npm run dev` (Vite, port 5173) | ✅ online |

**Two additional PM2 entries exist on this machine but are *not* in `ecosystem.config.js`** (started ad hoc via CLI) and are both currently `stopped` — and both are effectively broken/orphaned:
- `cdh-ai-ingest` → `scripts/run_ai_ingest.sh` (cron `0 2 * * *`), which tries to run `ingest_ai_photos.py` and `heal_index.py` — **neither file exists in this repo**.
- `cdh-full-reindex` → `full_reindex.py` — **this file does not exist either**. It was evidently registered with PM2 at some point and its source later deleted.

Leave these stopped, or explicitly remove the dangling PM2 registrations (`pm2 delete cdh-ai-ingest cdh-full-reindex`) if they're not going to be rebuilt — they currently do nothing but clutter `pm2 list`.

---

## 10. Scripts (`scripts/`)

| Script | Purpose |
|---|---|
| `setup_sales_app.py` | One-shot: registers `sales_app`'s API key + its two mapping rules (§5.1). Run once per fresh DB. |
| `import_catalog_from_drive.py` | One-shot bulk seeder: walks the full Drive catalog folder tree, builds `variants` (color → Drive file-ids) per product, upserts into `catalog_products`. `drive_watcher.py` incrementally extends what this seeds. |
| `import_sales_app.py` | One-shot backfill: reads `sales_app`'s local `products.json` directly off disk and inserts each as a `ProcessedData` row — a manual parallel path to the normal webhook ingestion, useful for bootstrapping CDH from an already-populated `sales_app` instance. |
| `migrate_to_pg.py` | Copies `raw_data, processed_data, api_keys, mapping_rules` from the local SQLite file into a Postgres `DATABASE_URL` via pandas. Refuses to run if `DATABASE_URL` is still a sqlite URL. **Does not migrate `gatepass_entries` or `catalog_products`** — those tables would be silently left behind in a cloud migration as it stands today. |
| `run_ai_ingest.sh` | **Currently broken** — see §9; its two target Python scripts don't exist in the repo. |

---

## 11. Frontend (`frontend/`) — two very different things live here

### 11.1 The live dashboard — `frontend/src/App.jsx`
A single ~1900-line component (Vite + React, PM2 `cdh-frontend`, port 5173) — the actual "Midnight Glass" admin UI. Resolves its API base to `http://<host>:8000/api/v1` on localhost/LAN, or `/cdh-api/api/v1` via Nginx when accessed externally (ngrok/Tailscale) — admin routes are intentionally not exposed on that external path.

**The admin `X-API-KEY` is hardcoded directly in this client-side source file.** Since this bundle ships to anyone who can load the dashboard, treat that key as effectively public and rotate/re-scope it if the dashboard is ever exposed beyond a trusted local network.

Seven tabs, each independently polling/calling:
1. **Dashboard** — stats cards, raw-data feed with a payload inspector; "Sync Active" → manual Decent ERP pull; "Run Processing" → manual `process_raw_data()` trigger.
2. **Operations** — "Transaction Pulse" timeline of recent `ProcessedData`, filterable by source project.
3. **Integrations** — create/list API keys + scopes + callback URLs. **The "revoke key" button calls `DELETE /admin/keys/{id}`, which does not exist as a backend route — this button currently 404s and does nothing.**
4. **Processing Rules** — create/delete `MappingRule`s.
5. **Product Catalog** — full CRUD against `catalog_products`, including CRM-tag editing.
6. **Dress Matcher** — stats, product list, verify/add against the matcher service.
7. **Ecosystem Control** — live PM2 process list + start/stop/restart, tunnel status, tailed logs (polls every 3-5s — deliberately lightweight after an earlier incident, see §12).

A global 10-second poll refreshes stats/raw/keys/rules/transactions, guarded against overlapping in-flight requests.

### 11.2 Orphaned code — `frontend/src/components/*.jsx`
13 files (~7600 lines) implementing a **completely separate, unused** "Gate Pass Management System" UI (Login, Guard/Dept portals, `PassForm` with voice input, `EntryLog`, `GatePassRequests`, `ProductionDashboard`, etc.) that targets `main.py`'s `/api/entries`, `/api/events`, `/api/production/*` routes — but **nothing in `App.jsx` or `main.jsx` imports from this folder**. It also defaults to `http://localhost:5001/api`, a different port than CDH's own 8000. This looks like a copy of a separate "Passify" gatepass project's frontend that was dropped into this repo but never wired up. **Do not assume these views are live** — they aren't reachable from the running dashboard.

---

## 12. Known production incidents baked into the code (read before "simplifying" anything)

Two comments in `main.py` document real outages and the fixes that resulted — don't revert these without re-reading them:

- **`/api/v1/admin/transactions` and `/api/v1/admin/raw`**: `sales_app`-sourced rows can carry ~3MB JSON blobs. Deserializing ~50 of these per request via the ORM's automatic JSON decoding was materializing ~150MB of Python objects per poll, triggering a GC pause long enough to freeze the *entire* interpreter (every thread, not just one request). Fix: check each row's raw content length via SQL (`LENGTH(content)`) before deciding whether to fully deserialize; oversized rows get a cheap `json_extract`-based partial payload instead of a full decode.
- **PM2 log tailing** (`_tail_file` in `main.py`): originally read the *whole* growing log file on every poll; switched to reading only the tail chunk to avoid a self-reinforcing freeze under the Ecosystem Control tab's polling.

---

## 13. Deployment

- **Local (current)**: SQLite + all seven PM2 processes running directly on this Mac (§9).
- **Docker** (`Dockerfile` + `docker-compose.yml`): two-stage build — stage 1 builds the frontend, stage 2 (`python:3.10-slim`) runs `gunicorn -w 4 -k uvicorn.workers.UvicornWorker main:app` on port 8000. `docker-compose.yml` adds a Postgres 15 container. **Gap**: the compose stack only stands up the API + DB — it does not containerize `worker.py`, `matcher_server.py`, the Telegram bot, or the Drive sync daemon. A bare `docker-compose up` would accept webhooks and store `RawData`, but nothing would ever process it into `ProcessedData` or dispatch it onward, and none of the AI/Drive/Telegram pipelines would run.
- **Cloud DB migration**: `python scripts/migrate_to_pg.py` (see §10's caveat about the two tables it skips).

### Environment variables
| Var | Consumed by | Notes |
|---|---|---|
| `DATABASE_URL` | `database.py`, `migrate_to_pg.py` | Default: hardcoded local sqlite path |
| `DECENT_ERP_API_URL`, `DECENT_ERP_API_KEY` | `ingestion.py` | Both required or ingestion silently no-ops (§5.2) |
| `CDH_ADMIN_KEY` | `main.py` (`get_admin_key`) | No default — if unset, all admin/webhook-admin auth fails closed |
| `MATCHER_SERVICE_URL` | `main.py` | Default `http://localhost:8001` |
| `TELEGRAM_BOT_TOKEN` | `services/telegram_bot.py` | Bot exits immediately if unset |
| `DRIVE_CATALOG_FOLDER_ID` | `services/drive_watcher.py` | Falls back to a hardcoded folder ID (also separately hardcoded, without env override, in `scripts/import_catalog_from_drive.py`) |
| `DRIVE_SCAN_INTERVAL_SEC` | `services/drive_watcher.py` | Default 900s (15 min) |
| `KMP_DUPLICATE_LIB_OK` | set globally (`.env`, every PM2 app, and force-set in `import_catalog_from_drive.py`) | Works around an OpenMP duplicate-library crash common to torch/FAISS on macOS |
| `CDH_API_PORT`, `CDH_HOST` | present in `.env` but **not read anywhere** in the Python code — dead config; `main.py` hardcodes port 8000 in its own entrypoint |

### Credential files
- **`credentials.json`** — Google OAuth **client secret**, used only by `services/authenticate_drive.py` to run the one-time interactive consent flow.
- **`token.json`** — the resulting **user OAuth token** (full read/write Drive scope, not read-only), consumed by the catalog image proxy, the AI downloader, Drive watcher (as a fallback when a service-account file — referenced but not present on disk — is missing), and the catalog import script.
- No `.env.example` exists in this repo — only a populated `.env`.

---

## 14. Known issues / rough edges

- **No scheduled Decent ERP ingestion** — someone must manually trigger a sync; there is no cron pulling ERP data automatically (§5.2).
- **Dashboard's "revoke API key" button is non-functional** — calls a `DELETE /admin/keys/{id}` route that doesn't exist in `main.py` (§11.1).
- **Two PM2 processes reference deleted source files** (`cdh-ai-ingest`, `cdh-full-reindex`) and sit permanently stopped (§9).
- **`PATCH /api/entries/{id}` and `DELETE /api/entries/{id}` have no auth dependency at all**, unlike `POST /api/entries` which requires `get_webhook_auth` — an inconsistency worth closing if the gatepass subsystem is still in active use.
- **Dashboard's admin API key is hardcoded in client-side JS** — treat it as public if the dashboard is ever reachable outside a trusted network.
- **13 orphaned React components** (~7600 lines) implementing an entire unused gatepass UI sit in `frontend/src/components/` — not wired into the live app, and pointing at a different port (5001) than CDH's own (8000). Safe to remove or should be clearly labeled if kept for reference.
- **Outbound webhook dispatch has no retry queue and no request signing** — a subscriber's callback endpoint being briefly down means that update is simply lost, not retried.
- **`scripts/migrate_to_pg.py` doesn't migrate `gatepass_entries` or `catalog_products`** — a straight run would silently leave those behind on a cloud migration.
- **`docker-compose.yml` only stands up the API + Postgres** — none of `worker.py`, the matcher service, the Telegram bot, or Drive sync are containerized, so a container-only deployment would receive data but never process, dispatch, or enrich it.
- Ledger lookups (`/api/v1/customers/{c}/ledger`) fall back to **hardcoded mock data** when no real match is found — don't mistake that for real customer data if a lookup unexpectedly "succeeds."
