from fastapi import FastAPI, Depends, HTTPException, Security, Request, File, UploadFile, Form, BackgroundTasks
from sqlalchemy import text
from fastapi.security.api_key import APIKeyHeader
from sqlalchemy.orm import Session
from database import init_db, get_db, ProcessedData, RawData, MappingRule, APIKey, GatepassEntry, CatalogProduct
from ingestion import fetch_and_store_data
from processing import process_raw_data
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool
import faulthandler
import signal
faulthandler.register(signal.SIGUSR1, all_threads=True)
import os
import uvicorn
import datetime
import uuid
import json
import asyncio
from typing import List, Optional
from dotenv import load_dotenv
from PIL import Image
from io import BytesIO
import requests
from services.production_engine import calculate_dashboard_analytics, randomize_simulated_data

# The AI matcher (SigLIP model + FAISS index) runs in its own process
# (matcher_server.py) so its CPU-bound inference can't starve this API's
# event loop. These routes proxy to it — see MATCHER_SERVICE_URL below.
MATCHER_SERVICE_URL = os.getenv("MATCHER_SERVICE_URL", "http://localhost:8001")


def _proxy_to_matcher(method: str, path: str, **kwargs):
    resp = requests.request(method, f"{MATCHER_SERVICE_URL}{path}", timeout=180, **kwargs)
    resp.raise_for_status()
    return resp.json()


import logging

load_dotenv()

# Configure structured logging for production
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger("cdh-api")

app = FastAPI(title="Central Data Hub API")

# Add CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://romits-macbook-air-1.tailc0bf65.ts.net",
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_KEY_HEADER = APIKeyHeader(name="X-API-KEY", auto_error=False)

import re as _re

def get_admin_key(api_key_header: str = Security(API_KEY_HEADER)):
    """Guard for management-only endpoints. Requires CDH_ADMIN_KEY env var."""
    admin_key = os.getenv("CDH_ADMIN_KEY")
    if not admin_key or api_key_header != admin_key:
        raise HTTPException(status_code=403, detail="Admin access denied")
    return api_key_header

def get_webhook_auth(api_key_header: str = Security(API_KEY_HEADER), db: Session = Depends(get_db)):
    """Allows admin key OR any active database API key to push webhook data."""
    if not api_key_header:
        raise HTTPException(status_code=403, detail="API key required for webhook")
    if api_key_header == os.getenv("CDH_ADMIN_KEY"):
        return api_key_header
    key_entry = db.query(APIKey).filter(APIKey.key == api_key_header, APIKey.is_active == True).first()
    if key_entry:
        return api_key_header
    raise HTTPException(status_code=403, detail="Invalid webhook API key")

def get_api_key(category: str, api_key_header: str = Security(API_KEY_HEADER), db: Session = Depends(get_db)):
    if not api_key_header:
        raise HTTPException(status_code=403, detail="API Key missing")

    # Admin key bypasses scope checks
    admin_key = os.getenv("CDH_ADMIN_KEY")
    if admin_key and api_key_header == admin_key:
        return api_key_header

    key_entry = db.query(APIKey).filter(APIKey.key == api_key_header, APIKey.is_active == True).first()
    if not key_entry:
        raise HTTPException(status_code=403, detail="Invalid or inactive API Key")

    # Check if category is in scope (if scope is defined)
    if key_entry.scope and category not in key_entry.scope:
        raise HTTPException(status_code=403, detail=f"Project not authorized for category: {category}")

    return key_entry

@app.on_event("startup")
def startup_event():
    logger.info("🚀 Central Data Hub Starting...")
    init_db()
    logger.info("✅ Database Initialized")

@app.get("/")
def read_root():
    return {"message": "Central Data Hub v2.0 is operational"}

@app.get("/api/v1/status")
def get_status(db: Session = Depends(get_db)):
    """Deep health check that verifies database connectivity."""
    try:
        # Simple query to verify DB
        db.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception as e:
        logger.error(f"❌ Database connection failed: {str(e)}")
        db_status = "disconnected"
        raise HTTPException(status_code=503, detail="Database unreachable")
        
    return {
        "status": "healthy", 
        "version": "2.0.0",
        "database": db_status,
        "timestamp": datetime.datetime.utcnow().isoformat()
    }

@app.get("/api/v1/data/{category}")
def get_data(
    category: str, 
    limit: int = 100, 
    offset: int = 0, 
    since: Optional[datetime.datetime] = None,
    db: Session = Depends(get_db), 
    api_key: APIKey = Depends(get_api_key)
):
    """Fetch processed data with pagination and time filtering."""
    query = db.query(ProcessedData).filter(ProcessedData.category == category)
    
    if since:
        query = query.filter(ProcessedData.updated_at >= since)
        
    total = query.count()
    items = query.order_by(ProcessedData.updated_at.desc()).offset(offset).limit(limit).all()
    
    return {
        "category": category,
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [item.content for item in items]
    }

TRANSACTIONS_CONTENT_SIZE_CAP = 200_000  # bytes; see comment below


@app.get("/api/v1/admin/transactions")
async def get_admin_transactions(limit: int = 50, db: Session = Depends(get_db), _auth: str = Depends(get_admin_key)):
    """Fetch all processed data grouped by project/source for the timeline."""
    # Found via a SIGUSR1 faulthandler dump: a batch of `sales` rows each carry
    # a ~3MB content JSON blob (root cause unclear, but consistently reproduced
    # by the `sales_app` source). Decoding ~50 of these every 10s poll — via
    # the ORM's automatic JSON deserialization — was materializing ~150MB of
    # Python objects per request, which triggers a GC pause long/heavy enough
    # to stall the whole interpreter (every thread, not just the event loop),
    # freezing the entire API. This was the actual final cause of tonight's
    # dashboard freeze, hiding underneath every other fix applied.
    #
    # Fix: check each row's raw content length via SQL (cheap, no decode)
    # before deciding whether to deserialize it. Oversized rows get a small
    # SQL-level json_extract instead of a full Python-side json.loads.
    def _query():
        rows = db.execute(text(
            "SELECT id, category, entity_id, updated_at, content, LENGTH(content) AS content_len "
            "FROM processed_data ORDER BY updated_at DESC LIMIT :limit"
        ), {"limit": limit}).fetchall()

        results = []
        for row in rows:
            if row.content_len and row.content_len > TRANSACTIONS_CONTENT_SIZE_CAP:
                extracted = db.execute(text(
                    "SELECT json_extract(content, '$._source') AS source, "
                    "json_extract(content, '$.name') AS name, "
                    "json_extract(content, '$.customer.name') AS customer_name, "
                    "json_extract(content, '$.totalValue') AS total_value, "
                    "json_array_length(content, '$.cart') AS cart_len "
                    "FROM processed_data WHERE id = :id"
                ), {"id": row.id}).fetchone()
                content = {
                    "_source": extracted.source,
                    "_truncated": True,
                    "_original_size_bytes": row.content_len,
                    "name": extracted.name,
                    "customer": {"name": extracted.customer_name} if extracted.customer_name else None,
                    "totalValue": extracted.total_value,
                    "cart": [None] * (extracted.cart_len or 0),
                }
            else:
                content = json.loads(row.content) if row.content else None
            results.append({
                "id": row.id,
                "category": row.category,
                "entity_id": row.entity_id,
                "content": content,
                "updated_at": row.updated_at
            })
        return results
    return await run_in_threadpool(_query)

@app.post("/api/v1/webhook/{source}")
async def receive_webhook(source: str, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db), _auth: str = Depends(get_webhook_auth)):
    """Generic webhook endpoint to receive any JSON data from Decent API."""
    try:
        data = await request.json()
        headers = dict(request.headers)
        
        # Store in RawData
        new_raw = RawData(
            source=source,
            endpoint=f"webhook/{source}",
            method="WEBHOOK",
            headers=headers,
            data=data
        )
        db.add(new_raw)
        db.commit()
        db.refresh(new_raw)

        # Let cdh-worker handle the processing to prevent DB connection pool exhaustion
        # background_tasks.add_task(process_raw_data)
            
        return {"status": "success", "id": new_raw.id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid payload: {str(e)}")

# --- Admin Endpoints for Frontend Dashboard ---

@app.get("/api/v1/admin/stats")
async def get_admin_stats(db: Session = Depends(get_db), _auth: str = Depends(get_admin_key)):
    """Summary stats for the dashboard."""
    def _query():
        raw_count = db.query(RawData).count()
        processed_count = db.query(ProcessedData).count()
        categories = db.query(ProcessedData.category).distinct().all()
        return {
            "raw_count": raw_count,
            "processed_count": processed_count,
            "categories": [c[0] for c in categories],
            "uptime": "100%", # Placeholder
            "db_status": "connected"
        }
    return await run_in_threadpool(_query)

@app.get("/api/v1/admin/raw")
async def get_admin_raw_data(limit: int = 20, db: Session = Depends(get_db), _auth: str = Depends(get_admin_key)):
    """Latest raw data entries."""
    # Same class of fix as /api/v1/admin/transactions: recent `sales_app` rows
    # each carry a ~3MB `data` JSON blob, and this list (polled every 10s) was
    # decoding the full payload for every row even though the frontend list
    # view only renders id/source/endpoint/method/received_at — the full
    # payload is only needed on-demand in the Payload Inspector for one
    # clicked item. Skip decoding oversized payloads here; they get a small
    # placeholder instead of triggering the multi-row GC-pause freeze.
    def _query():
        rows = db.execute(text(
            "SELECT id, source, endpoint, method, headers, data, received_at, "
            "is_processed, processed_at, LENGTH(data) AS data_len "
            "FROM raw_data ORDER BY received_at DESC LIMIT :limit"
        ), {"limit": limit}).fetchall()

        results = []
        for row in rows:
            if row.data_len and row.data_len > TRANSACTIONS_CONTENT_SIZE_CAP:
                data = {"_truncated": True, "_original_size_bytes": row.data_len}
            else:
                data = json.loads(row.data) if row.data else None
            results.append({
                "id": row.id,
                "source": row.source,
                "endpoint": row.endpoint,
                "method": row.method,
                "headers": json.loads(row.headers) if row.headers else None,
                "data": data,
                "received_at": row.received_at,
                "is_processed": bool(row.is_processed),
                "processed_at": row.processed_at
            })
        return results
    return await run_in_threadpool(_query)

@app.post("/api/v1/admin/ingest")
async def trigger_ingest(endpoint: str = "/api/v1/test", db: Session = Depends(get_db), _auth: str = Depends(get_admin_key)):
    # Validate endpoint to prevent SSRF
    if not _re.match(r'^/[a-zA-Z0-9/_-]*$', endpoint):
        raise HTTPException(status_code=400, detail="Invalid endpoint format")
    """Manually trigger a sync from Decent ERP."""
    data = fetch_and_store_data(endpoint)
    if data:
        return {"status": "success", "message": f"Fetched data from {endpoint}"}
    return {"status": "failed", "message": "Failed to fetch data"}

@app.post("/api/v1/admin/process")
async def trigger_process(_auth: str = Depends(get_admin_key)):
    """Manually trigger the data processing pipeline."""
    try:
        process_raw_data()
        return {"status": "success", "message": "Processing complete"}
    except Exception as e:
        return {"status": "failed", "message": str(e)}

# --- Ecosystem Control & PM2 Process Manager ---
import subprocess
import json
import urllib.request


def _tail_file(path: str, limit: int) -> list:
    # Reads only the tail of the file instead of the whole thing. Some PM2
    # log files (notably cdh-backend's own) grow to tens of thousands of
    # lines; reading the full file on every 3s poll from the log viewer was
    # blocking the event loop and, since serving the request itself adds a
    # new log line, the read cost kept growing — a self-reinforcing freeze.
    chunk_size = max(limit * 300, 65536)
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(max(0, size - chunk_size))
        data = f.read()
    lines = data.decode("utf-8", errors="ignore").splitlines()
    return [line.strip() for line in lines[-limit:]]


def _pm2_list_sync():
    result = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, check=True)
    processes = json.loads(result.stdout)

    filtered = []
    for p in processes:
        monit = p.get("monit", {})
        pm_env = p.get("pm2_env", {})
        filtered.append({
            "id": p.get("pm_id"),
            "name": p.get("name"),
            "status": pm_env.get("status"),
            "restarts": pm_env.get("restart_time", 0),
            "uptime": pm_env.get("pm_uptime", 0),
            "cpu": monit.get("cpu", 0),
            "memory": monit.get("memory", 0),
            "error_log": pm_env.get("pm_err_log_path"),
            "out_log": pm_env.get("pm_out_log_path")
        })
    return filtered


@app.get("/api/v1/admin/pm2/list")
async def pm2_list(_auth: str = Depends(get_admin_key)):
    """Fetch live status of all system processes via PM2."""
    try:
        return await run_in_threadpool(_pm2_list_sync)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PM2 Query failed: {str(e)}")

@app.post("/api/v1/admin/pm2/action")
async def pm2_action(name: str, action: str, _auth: str = Depends(get_admin_key)):
    """Start, Stop, or Restart a PM2 process."""
    if action not in ["start", "stop", "restart"]:
        raise HTTPException(status_code=400, detail="Invalid action")
    # Validate process name to prevent injection (no spaces, quotes, or shell metacharacters)
    if not _re.match(r'^[a-zA-Z0-9_\-\.]+$', name):
        raise HTTPException(status_code=400, detail="Invalid process name")
    try:
        await run_in_threadpool(
            subprocess.run, ["pm2", action, name],
            capture_output=True, text=True, check=True
        )
        return {"status": "success", "message": f"Process '{name}' {action}ed successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PM2 Action failed: {str(e)}")

@app.get("/api/v1/admin/pm2/logs")
async def pm2_logs(name: str, log_type: str = "out", limit: int = 150, _auth: str = Depends(get_admin_key)):
    """Read recent console output or error logs of a PM2 process."""
    if log_type not in ["out", "err"]:
        raise HTTPException(status_code=400, detail="Invalid log type")
    try:
        def _read_logs():
            processes = _pm2_list_sync()
            target = next((p for p in processes if p.get("name") == name), None)
            if not target:
                return None
            log_path = target.get("error_log" if log_type == "err" else "out_log")
            if not log_path or not os.path.exists(log_path):
                return {"logs": ["Log file is empty or does not exist yet."]}
            return {"logs": _tail_file(log_path, limit)}

        result = await run_in_threadpool(_read_logs)
        if result is None:
            raise HTTPException(status_code=404, detail="Process not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read logs: {str(e)}")

@app.get("/api/v1/admin/tunnel/status")
async def tunnel_status(_auth: str = Depends(get_admin_key)):
    """Retrieve details of the active Ngrok Tunnel and Nginx mappings."""
    def _fetch_ngrok_url():
        with urllib.request.urlopen("http://127.0.0.1:4040/api/tunnels", timeout=1.0) as response:
            tunnels = json.loads(response.read().decode()).get("tunnels", [])
            return next((t.get("public_url") for t in tunnels if t.get("proto") == "https"), None)

    try:
        public_url = await run_in_threadpool(_fetch_ngrok_url)
    except Exception:
        public_url = "https://napping-briskness-shimmy.ngrok-free.dev"
        
    return {
        "public_url": public_url,
        "proxy_port": 8080,
        "mappings": [
            {"path": "/", "destination": "CDH Frontend (Port 5173)"},
            {"path": "/passify/", "destination": "Passify Gatepass API (Port 5001)"},
            {"path": "/sales/", "destination": "Sales SRS API (Port 4000)"},
            {"path": "/cdh-api/", "destination": "CDH API Backend (Port 8000)"}
        ]
    }

# --- API Key Management ---

@app.get("/api/v1/admin/keys")
async def list_keys(_auth: str = Depends(get_admin_key), db: Session = Depends(get_db)):
    return db.query(APIKey).all()

@app.post("/api/v1/admin/keys")
async def create_key(project_name: str, scope: List[str] = None, callback_url: str = None, _auth: str = Depends(get_admin_key), db: Session = Depends(get_db)):
    new_key = APIKey(
        key=f"cdh_{uuid.uuid4().hex[:12]}",
        project_name=project_name,
        scope=scope,
        callback_url=callback_url,
        is_active=True
    )
    db.add(new_key)
    db.commit()
    db.refresh(new_key)
    return new_key

# --- Mapping Rules Management ---

@app.get("/api/v1/admin/rules")
async def list_rules(_auth: str = Depends(get_admin_key), db: Session = Depends(get_db)):
    return db.query(MappingRule).all()

@app.post("/api/v1/admin/rules")
async def create_rule(source: str, target_category: str, field_mappings: dict = None, _auth: str = Depends(get_admin_key), db: Session = Depends(get_db)):
    new_rule = MappingRule(
        source=source,
        target_category=target_category,
        field_mappings=field_mappings,
        is_active=True
    )
    db.add(new_rule)
    db.commit()
    db.refresh(new_rule)
    return new_rule

# --- Dress Matcher Endpoints ---

@app.post("/api/v1/matcher/verify")
async def verify_dress(files: List[UploadFile] = File(...)):
    """
    Accepts 1-4 photos of a dress and verify it against the indexed catalog.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    file_payload = [("files", (f.filename, await f.read(), f.content_type)) for f in files[:4]]
    try:
        return await run_in_threadpool(_proxy_to_matcher, "POST", "/verify", files=file_payload)
    except requests.RequestException as e:
        raise HTTPException(status_code=503, detail=f"Matcher service unavailable: {e}")


@app.post("/api/v1/matcher/add")
async def add_dress_reference(
    product_name: str = Form(...),
    files: List[UploadFile] = File(...)
):
    """
    Add reference images for a product to the matcher index.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    file_payload = [("files", (f.filename, await f.read(), f.content_type)) for f in files]
    try:
        return await run_in_threadpool(
            _proxy_to_matcher, "POST", "/add",
            data={"product_name": product_name}, files=file_payload
        )
    except requests.RequestException as e:
        raise HTTPException(status_code=503, detail=f"Matcher service unavailable: {e}")

@app.get("/api/v1/matcher/stats")
async def get_matcher_stats():
    try:
        return await run_in_threadpool(_proxy_to_matcher, "GET", "/stats")
    except requests.RequestException as e:
        raise HTTPException(status_code=503, detail=f"Matcher service unavailable: {e}")

@app.get("/api/v1/matcher/sync_status")
async def get_matcher_sync_status():
    import os, json
    sync_file = "/Users/romitaggarwal/Desktop/AI/central data hub/data/matcher/sync_state.json"
    if not os.path.exists(sync_file):
        return {"status": "pending", "message": "Sync state file not created yet."}
    try:
        with open(sync_file, 'r') as f:
            data = json.load(f)
        return {"status": "success", "data": data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/v1/matcher/products")
async def get_matcher_products():
    try:
        return await run_in_threadpool(_proxy_to_matcher, "GET", "/products")
    except requests.RequestException as e:
        raise HTTPException(status_code=503, detail=f"Matcher service unavailable: {e}")

@app.delete("/api/v1/matcher/products/{product_name}")
async def delete_matcher_product(product_name: str):
    """
    Delete a product and all of its reference images from the matcher index.
    """
    try:
        return await run_in_threadpool(_proxy_to_matcher, "DELETE", f"/products/{product_name}")
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code == 404:
            raise HTTPException(status_code=404, detail=f"Product '{product_name}' not found in matcher database")
        raise HTTPException(status_code=503, detail=f"Matcher service unavailable: {e}")
    except requests.RequestException as e:
        raise HTTPException(status_code=503, detail=f"Matcher service unavailable: {e}")

@app.delete("/api/v1/admin/rules/{rule_id}")
async def delete_rule(rule_id: int, _auth: str = Depends(get_admin_key), db: Session = Depends(get_db)):
    rule = db.query(MappingRule).filter(MappingRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(rule)
    db.commit()
    return {"status": "success"}

# ─── Unified Gatepass & Production Flow Integration ──────────────────────────

# SSE Client Queue Registry
sse_queues = set()

def get_all_entries_dict(db: Session):
    entries = db.query(GatepassEntry).order_by(GatepassEntry.id.desc()).all()
    res = []
    for e in entries:
        meta_dict = {}
        if e.meta:
            try:
                meta_dict = json.loads(e.meta)
            except:
                pass
        entry_dict = {
            "id": e.id,
            "timestamp": e.timestamp,
            "type": e.type,
            "status": e.status,
            "cdh_verified": bool(e.cdh_verified),
            "date": e.date,
            "challanNo": e.challanNo,
            "partyName": e.partyName,
            "designNo": e.designNo,
            "description": e.description,
            "quantity": e.quantity,
            "unitType": e.unitType,
            "orderNo": e.orderNo,
            "transportName": e.transportName,
            "biltyNo": e.biltyNo,
            "dept": e.dept,
            "parcelFrom": e.parcelFrom,
            "initiatedBy": e.initiatedBy,
            "guardHoldReason": e.guardHoldReason,
            "guardNotes": e.guardNotes,
        }
        entry_dict.update(meta_dict)
        res.append(entry_dict)
    return res

def get_entry_dict(e: GatepassEntry):
    if not e:
        return None
    meta_dict = {}
    if e.meta:
        try:
            meta_dict = json.loads(e.meta)
        except:
            pass
    entry_dict = {
        "id": e.id,
        "timestamp": e.timestamp,
        "type": e.type,
        "status": e.status,
        "cdh_verified": bool(e.cdh_verified),
        "date": e.date,
        "challanNo": e.challanNo,
        "partyName": e.partyName,
        "designNo": e.designNo,
        "description": e.description,
        "quantity": e.quantity,
        "unitType": e.unitType,
        "orderNo": e.orderNo,
        "transportName": e.transportName,
        "biltyNo": e.biltyNo,
        "dept": e.dept,
        "parcelFrom": e.parcelFrom,
        "initiatedBy": e.initiatedBy,
        "guardHoldReason": e.guardHoldReason,
        "guardNotes": e.guardNotes,
    }
    entry_dict.update(meta_dict)
    return entry_dict

def match_incoming_entry(db: Session, challanNo, partyName, orderNo):
    pending = db.query(GatepassEntry).filter(GatepassEntry.type == 'incoming', GatepassEntry.status == 'pending').all()
    ch_str = str(challanNo or '').lower().strip()
    p_str = str(partyName or '').lower().strip()
    o_str = str(orderNo or '').lower().strip()
    
    for entry in pending:
        e_ch_str = str(entry.challanNo or '').lower().strip()
        e_p_str = str(entry.partyName or '').lower().strip()
        e_o_str = str(entry.orderNo or '').lower().strip()
        
        match_challan = bool(ch_str and e_ch_str and (ch_str in e_ch_str or e_ch_str in ch_str))
        match_order = bool(o_str and e_o_str and (o_str in e_o_str or e_o_str in o_str))
        match_party = bool(p_str and e_p_str and (p_str in e_p_str or e_p_str in p_str))
        
        if (match_challan or match_order) and match_party:
            return entry
        if match_challan and ch_str == e_ch_str and len(ch_str) > 3:
            return entry
    return None

def get_processed_category_data(db: Session, category: str):
    items = db.query(ProcessedData).filter(ProcessedData.category == category).all()
    return [item.content for item in items]

async def broadcast_entries(db: Session):
    entries = get_all_entries_dict(db)
    payload = f"event: entries-updated\ndata: {json.dumps(entries)}\n\n"
    for queue in list(sse_queues):
        await queue.put(payload)

# ── Gatepass Entry CRUD Routes ──────────────────────────────────────────────

@app.get("/api/entries")
async def get_entries(db: Session = Depends(get_db)):
    return get_all_entries_dict(db)

@app.post("/api/entries", status_code=201)
async def create_entry(request: Request, _auth: str = Depends(get_webhook_auth), db: Session = Depends(get_db)):
    body = await request.json()
    entry_id = body.get("id") or int(datetime.datetime.utcnow().timestamp() * 1000)
    
    known_cols = {
        'timestamp', 'type', 'status', 'cdh_verified', 'date', 'challanNo',
        'partyName', 'designNo', 'description', 'quantity', 'unitType',
        'orderNo', 'transportName', 'biltyNo', 'dept', 'parcelFrom',
        'initiatedBy', 'guardHoldReason', 'guardNotes'
    }
    
    meta_dict = {}
    for k, v in body.items():
        if k not in known_cols and k != 'id':
            meta_dict[k] = v
            
    new_entry = GatepassEntry(
        id=entry_id,
        timestamp=body.get("timestamp") or datetime.datetime.utcnow().isoformat(),
        type=body.get("type"),
        status=body.get("status") or "pending",
        cdh_verified=bool(body.get("cdh_verified", False)),
        date=body.get("date"),
        challanNo=body.get("challanNo"),
        partyName=body.get("partyName"),
        designNo=body.get("designNo"),
        description=body.get("description"),
        quantity=str(body.get("quantity")) if body.get("quantity") is not None else None,
        unitType=body.get("unitType") or "pcs",
        orderNo=body.get("orderNo"),
        transportName=body.get("transportName"),
        biltyNo=body.get("biltyNo"),
        dept=body.get("dept"),
        parcelFrom=body.get("parcelFrom"),
        initiatedBy=body.get("initiatedBy"),
        guardHoldReason=body.get("guardHoldReason"),
        guardNotes=body.get("guardNotes"),
        meta=json.dumps(meta_dict) if meta_dict else None
    )
    
    db.add(new_entry)
    db.commit()
    db.refresh(new_entry)
    
    await broadcast_entries(db)
    
    # Mirror Passify Express logic of self webhooking inside unified app
    # This automatically processes outgoing or incoming matching rules
    # by invoking the local webhook logic asynchronously without network latency
    asyncio.create_task(inbound_webhook_self_trigger(body, db))
    
    return get_entry_dict(new_entry)

async def inbound_webhook_self_trigger(body: dict, db: Session):
    # Mimics Node Express server syncing with CDH
    # Storing raw passify transaction in central RawData
    try:
        raw_data = RawData(
            source="passify",
            endpoint="webhook/passify",
            method="POST",
            data=body,
            received_at=datetime.datetime.utcnow(),
            is_processed=False
        )
        db.add(raw_data)
        db.commit()
    except Exception as e:
        logger.error(f"Failed to record self webhook trigger: {str(e)}")

VALID_TRANSITIONS = {
    'pending':       ['completed', 'rejected'],
    'rejected':      ['completed', 'dept_issued'],
    'dept_issued':   ['guard_cleared', 'guard_held'],
    'guard_held':    ['dept_issued'],
    'completed':     [],
    'guard_cleared': [],
}

EDITABLE_FIELDS = [
    'partyName', 'challanNo', 'designNo', 'quantity', 'unitType',
    'description', 'transportName', 'biltyNo', 'orderNo', 'guardHoldReason', 'cdh_verified',
]

@app.patch("/api/entries/{entry_id}")
async def patch_entry(entry_id: int, request: Request, db: Session = Depends(get_db)):
    body = await request.json()
    status = body.get("status")
    
    entry = db.query(GatepassEntry).filter(GatepassEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
        
    if status is not None:
        allowed = VALID_TRANSITIONS.get(entry.status, [])
        if status not in allowed:
            raise HTTPException(status_code=400, detail=f"Invalid transition: {entry.status} -> {status}")
        entry.status = status
        
    for field in EDITABLE_FIELDS:
        if field in body:
            val = body[field]
            if field == 'cdh_verified':
                setattr(entry, field, bool(val))
            elif field == 'quantity':
                setattr(entry, field, str(val) if val is not None else None)
            else:
                setattr(entry, field, val)
                
    db.commit()
    db.refresh(entry)
    
    await broadcast_entries(db)
    
    return get_entry_dict(entry)

@app.delete("/api/entries/{entry_id}")
async def delete_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.query(GatepassEntry).filter(GatepassEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
        
    res = get_entry_dict(entry)
    db.delete(entry)
    db.commit()
    
    await broadcast_entries(db)
    
    return res

# SSE stream channel
@app.get("/api/events")
async def get_events(request: Request):
    async def event_stream():
        queue = asyncio.Queue()
        sse_queues.add(queue)
        try:
            yield "event: connected\ndata: {}\n\n"
            while True:
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=25.0)
                    yield data
                except asyncio.TimeoutError:
                    yield ":\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            sse_queues.remove(queue)
            
    return StreamingResponse(event_stream(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
    })

# Inbound Webhook - CDH Sync Compatibility Endpoint
@app.post("/api/v1/webhook/passify")
async def inbound_webhook_passify(request: Request, db: Session = Depends(get_db)):
    body = await request.json()
    is_incoming = body.get("type") == 'incoming' or body.get("direction") == 'incoming' or body.get("type") == 'receipt'
    
    date = body.get("challan_date") or body.get("date") or datetime.date.today().isoformat()
    challanNo = body.get("challan_no") or body.get("challanNo") or ""
    partyName = body.get("customer_name") or body.get("partyName") or body.get("supplier_name") or ""
    designNo = body.get("item_design") or body.get("designNo") or ""
    description = body.get("description") or body.get("item_name") or ""
    quantity = str(body.get("quantity") or "")
    unitType = body.get("unit_type") or body.get("unitType") or "pcs"
    orderNo = body.get("order_no") or body.get("orderNo") or ""
    transportName = body.get("transport_name") or body.get("transportName") or ""
    biltyNo = body.get("bilty_no") or body.get("biltyNo") or ""
    dept = body.get("dept") or body.get("department") or "dispatch"
    
    if is_incoming:
        matched = match_incoming_entry(db, challanNo, partyName, orderNo)
        if matched:
            matched.status = 'completed'
            matched.cdh_verified = True
            db.commit()
            await broadcast_entries(db)
            return {"received": True, "matched_id": matched.id, "status": "completed"}
        else:
            return {"received": True, "matched_id": None, "note": "No pending entry found to auto-clear"}
            
    new_entry = GatepassEntry(
        id=int(datetime.datetime.utcnow().timestamp() * 1000),
        timestamp=datetime.datetime.utcnow().isoformat(),
        type='outgoing',
        status='dept_issued',
        initiatedBy='cdh',
        cdh_verified=True,
        date=date,
        challanNo=challanNo,
        partyName=partyName,
        designNo=designNo,
        description=description,
        quantity=quantity,
        unitType=unitType,
        orderNo=orderNo,
        transportName=transportName,
        biltyNo=biltyNo,
        dept=dept
    )
    
    db.add(new_entry)
    db.commit()
    await broadcast_entries(db)
    return {"received": True, "id": new_entry.id}

# ── Custom Product Catalog & CRM Tagging ─────────────────────────────────────────

@app.get("/api/v1/catalog")
async def get_catalog_products(db: Session = Depends(get_db)):
    products = db.query(CatalogProduct).order_by(CatalogProduct.updated_at.desc()).all()
    return products

@app.post("/api/v1/catalog")
async def create_catalog_product(request: Request, _auth: str = Depends(get_admin_key), db: Session = Depends(get_db)):
    body = await request.json()
    new_product = CatalogProduct(
        name=body.get("name"),
        description=body.get("description"),
        category=body.get("category"),
        fabric=body.get("fabric"),
        hsn_code=body.get("hsn_code"),
        gst_rate=body.get("gst_rate", 5.0),
        cost_price=body.get("cost_price", 0.0),
        mrp=body.get("mrp", 0.0),
        sizes=body.get("sizes", []),
        status=body.get("status", "Active"),
        price=body.get("price", 0.0),
        image_url=body.get("image_url"),
        crm_tags=body.get("crm_tags", []),
        variants=body.get("variants", [])
    )
    db.add(new_product)
    db.commit()
    db.refresh(new_product)
    return new_product

@app.put("/api/v1/catalog/{product_id}")
async def update_catalog_product(product_id: int, request: Request, _auth: str = Depends(get_admin_key), db: Session = Depends(get_db)):
    body = await request.json()
    product = db.query(CatalogProduct).filter(CatalogProduct.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
        
    for field in ["name", "description", "category", "fabric", "hsn_code", "gst_rate", "cost_price", "mrp", "sizes", "status", "price", "image_url", "crm_tags", "variants"]:
        if field in body:
            setattr(product, field, body[field])
        
    db.commit()
    db.refresh(product)
    return product

@app.delete("/api/v1/catalog/{product_id}")
async def delete_catalog_product(product_id: int, _auth: str = Depends(get_admin_key), db: Session = Depends(get_db)):
    product = db.query(CatalogProduct).filter(CatalogProduct.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    db.delete(product)
    db.commit()
    return {"status": "success"}

@app.get("/api/v1/catalog/image/{file_id}")
async def get_drive_image(file_id: str, w: int = None):
    import os, re as _re
    from fastapi.responses import FileResponse
    from PIL import Image

    # Sanitize file_id: only alphanumeric, underscore, hyphen allowed
    if not _re.match(r'^[a-zA-Z0-9_-]+$', file_id):
        raise HTTPException(status_code=400, detail="Invalid file_id")

    # Check local cache first
    local_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'ai_images')
    os.makedirs(local_dir, exist_ok=True)

    # Guard against path traversal via realpath comparison
    local_path = os.path.realpath(os.path.join(local_dir, f"{file_id}.jpg"))
    if not local_path.startswith(os.path.realpath(local_dir)):
        raise HTTPException(status_code=400, detail="Invalid file_id")

    thumb_path = os.path.realpath(os.path.join(local_dir, f"{file_id}_w{w}.jpg")) if w else local_path
    
    if os.path.exists(thumb_path):
        return FileResponse(thumb_path, media_type="image/jpeg")
        
    # If thumb doesn't exist but full image does, resize it
    if w and os.path.exists(local_path):
        try:
            with Image.open(local_path) as img:
                # Calculate new height maintaining aspect ratio
                ratio = w / float(img.size[0])
                h = int((float(img.size[1]) * float(ratio)))
                img = img.resize((w, h), Image.Resampling.LANCZOS)
                # Convert to RGB to save as JPEG safely (e.g. if original was RGBA png)
                if img.mode in ('RGBA', 'P'):
                    img = img.convert('RGB')
                img.save(thumb_path, format="JPEG", quality=85)
            return FileResponse(thumb_path, media_type="image/jpeg")
        except Exception as e:
            logger.error(f"Failed to resize image {file_id}: {e}")
            # Fallback to full image
            return FileResponse(local_path, media_type="image/jpeg")

    # If not in cache at all, download from Drive
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaIoBaseDownload
        import io

        # Authenticate with Drive API
        creds_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'token.json')
        if not os.path.exists(creds_file):
            raise HTTPException(status_code=500, detail="Drive credentials not found")
            
        SCOPES = ['https://www.googleapis.com/auth/drive']
        creds = Credentials.from_authorized_user_file(creds_file, SCOPES)
        service = build('drive', 'v3', credentials=creds)

        # Download the file
        request = service.files().get_media(fileId=file_id)
        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, request)
        done = False
        while not done:
            status, done = downloader.next_chunk()
        
        # Save to local cache
        buf.seek(0)
        with open(local_path, 'wb') as f:
            f.write(buf.read())
            
        # If width was requested, resize it before returning
        if w:
            try:
                with Image.open(local_path) as img:
                    ratio = w / float(img.size[0])
                    h = int((float(img.size[1]) * float(ratio)))
                    img = img.resize((w, h), Image.Resampling.LANCZOS)
                    if img.mode in ('RGBA', 'P'):
                        img = img.convert('RGB')
                    img.save(thumb_path, format="JPEG", quality=85)
                return FileResponse(thumb_path, media_type="image/jpeg")
            except Exception as e:
                logger.error(f"Failed to resize newly downloaded image {file_id}: {e}")
                
        return FileResponse(local_path, media_type="image/jpeg")
    except Exception as e:
        logger.error(f"Failed to fetch image {file_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch image from Google Drive")

# ── Backward Compatible /api/v1 and /api/cdh CDH Data Endpoints ────────────────

@app.get("/api/v1/products")
@app.get("/api/cdh/products")
async def get_cdh_products(db: Session = Depends(get_db)):
    return get_processed_category_data(db, 'products')

@app.get("/api/v1/production")
@app.get("/api/cdh/production")
async def get_cdh_production(db: Session = Depends(get_db)):
    return get_processed_category_data(db, 'production')

@app.get("/api/v1/sale-orders")
@app.get("/api/cdh/sale-orders")
async def get_cdh_sales(db: Session = Depends(get_db)):
    return get_processed_category_data(db, 'sales')

@app.get("/api/v1/raw-material-stock")
@app.get("/api/cdh/stock")
async def get_cdh_stock(db: Session = Depends(get_db)):
    return get_processed_category_data(db, 'raw-material-stock')

@app.get("/api/v1/challans")
@app.get("/api/cdh/challans")
async def get_cdh_challans(db: Session = Depends(get_db)):
    return get_processed_category_data(db, 'challans')

@app.get("/api/v1/returns")
@app.get("/api/cdh/returns")
async def get_cdh_returns(db: Session = Depends(get_db)):
    return get_processed_category_data(db, 'returns')

@app.get("/api/v1/customers/{customer}/ledger")
@app.get("/api/cdh/ledger/{customer}")
async def get_cdh_ledger(customer: str, db: Session = Depends(get_db)):
    items = db.query(ProcessedData).filter(ProcessedData.category == 'ledger').all()
    customer_lower = customer.lower()
    res = []
    for item in items:
        content = item.content
        if isinstance(content, dict):
            cust_name = str(content.get("customer", "")).lower()
            if customer_lower in cust_name:
                res.append(content)
    if not res:
        res = [
            {"date": (datetime.date.today() - datetime.timedelta(days=15)).isoformat(), "particulars": "Opening Balance", "debit": 0, "credit": 0, "balance": 45000},
            {"date": (datetime.date.today() - datetime.timedelta(days=10)).isoformat(), "particulars": "Sales Invoice #1024", "debit": 12500, "credit": 0, "balance": 57500},
            {"date": (datetime.date.today() - datetime.timedelta(days=5)).isoformat(), "particulars": "Payment Received", "debit": 0, "credit": 30000, "balance": 27500}
        ]
    return res

# ── Production Planning Dashboard & Analytics Endpoints ─────────────────────────

@app.get("/api/production/overview")
async def get_production_overview(db: Session = Depends(get_db)):
    products = get_processed_category_data(db, 'products')
    production = get_processed_category_data(db, 'production')
    sales = get_processed_category_data(db, 'sales')
    stock = get_processed_category_data(db, 'raw-material-stock')
    
    analytics = calculate_dashboard_analytics(products, production, sales, stock)
    return {**analytics, "offline": False}

@app.get("/api/production/attention")
async def get_production_attention(db: Session = Depends(get_db)):
    products = get_processed_category_data(db, 'products')
    production = get_processed_category_data(db, 'production')
    sales = get_processed_category_data(db, 'sales')
    stock = get_processed_category_data(db, 'raw-material-stock')
    
    analytics = calculate_dashboard_analytics(products, production, sales, stock)
    return {"attention_scores": analytics["attention_scores"], "offline": False}

@app.get("/api/production/karigars")
async def get_production_karigars(db: Session = Depends(get_db)):
    products = get_processed_category_data(db, 'products')
    production = get_processed_category_data(db, 'production')
    sales = get_processed_category_data(db, 'sales')
    stock = get_processed_category_data(db, 'raw-material-stock')
    
    analytics = calculate_dashboard_analytics(products, production, sales, stock)
    return {"karigar_report": analytics["karigar_report"], "offline": False}

@app.post("/api/production/randomize")
async def post_production_randomize(db: Session = Depends(get_db)):
    products = get_processed_category_data(db, 'products')
    result = randomize_simulated_data(products)
    return {**result, "offline": True}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
