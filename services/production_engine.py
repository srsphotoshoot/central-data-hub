import os
import json
import random
import datetime

# Global memory overrides
_plan_overrides = {}
_job_work_mock = None

SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))
MOCK_PATH = os.path.join(SERVICE_DIR, "mock_job_work.json")

def get_job_work_mock():
    global _job_work_mock
    if _job_work_mock is not None:
        return _job_work_mock

    if os.path.exists(MOCK_PATH):
        try:
            with open(MOCK_PATH, "r", encoding="utf-8") as f:
                _job_work_mock = json.load(f)
                return _job_work_mock
        except Exception:
            pass

    # High fidelity defaults
    _job_work_mock = [
        {
            "production_id": "17244",
            "production_code": "17244",
            "product_name": "Product 17244",
            "status": "In Progress",
            "subprocesses": {
                "embroidery": {
                    "karigar_name": "Ahmed", "due_days": 14, "submitted_qty": 300, "total_qty": 300,
                    "items": {
                        "touching": { "karigar_name": "Sohan", "due_days": 11, "submitted_qty": 300, "total_qty": 300 },
                        "embroidery": { "karigar_name": "Vikram", "due_days": 5, "submitted_qty": 300, "total_qty": 300 },
                        "latkan": { "karigar_name": "Farhan", "due_days": 9, "submitted_qty": 300, "total_qty": 300 },
                        "outing": { "karigar_name": "Farhan", "due_days": 8, "submitted_qty": 300, "total_qty": 300 },
                        "pleating": { "karigar_name": "Imran", "due_days": 8, "submitted_qty": 300, "total_qty": 300 }
                    }
                },
                "stitching": { "karigar_name": "Ramesh", "due_days": 12, "submitted_qty": 300, "total_qty": 300 },
                "finishing": { "karigar_name": "Sunil", "due_days": 9, "submitted_qty": 300, "total_qty": 300 }
            }
        },
        {
            "production_id": "1945",
            "production_code": "1945",
            "product_name": "Product 1945",
            "status": "In Progress",
            "subprocesses": {
                "embroidery": {
                    "karigar_name": "Mohan", "due_days": 3, "submitted_qty": 278, "total_qty": 300,
                    "items": {
                        "touching": { "karigar_name": "Mohan", "due_days": 10, "submitted_qty": 242, "total_qty": 300 },
                        "embroidery": { "karigar_name": "Mohan", "due_days": 4, "submitted_qty": 289, "total_qty": 300 },
                        "latkan": { "karigar_name": "Mohan", "due_days": 6, "submitted_qty": 254, "total_qty": 300 },
                        "outing": { "karigar_name": "Mohan", "due_days": 10, "submitted_qty": 246, "total_qty": 300 },
                        "pleating": { "karigar_name": "Mohan", "due_days": 9, "submitted_qty": 233, "total_qty": 300 }
                    }
                },
                "stitching": { "karigar_name": "Mohan", "due_days": 3, "submitted_qty": 247, "total_qty": 300 },
                "finishing": { "karigar_name": "Sunil", "due_days": 8, "submitted_qty": 288, "total_qty": 300 }
            }
        },
        {
            "production_id": "1945T",
            "production_code": "1945T",
            "product_name": "Product 1945T",
            "status": "In Progress",
            "subprocesses": {
                "embroidery": {
                    "karigar_name": "Imran", "due_days": 1, "submitted_qty": 15, "total_qty": 300,
                    "items": {
                        "touching": { "karigar_name": "Ahmed", "due_days": -3, "submitted_qty": 107, "total_qty": 300 },
                        "embroidery": { "karigar_name": "Rahul", "due_days": 6, "submitted_qty": 52, "total_qty": 300 },
                        "latkan": { "karigar_name": "Zaid", "due_days": 6, "submitted_qty": 126, "total_qty": 300 },
                        "outing": { "karigar_name": "Vikram", "due_days": 5, "submitted_qty": 232, "total_qty": 300 },
                        "pleating": { "karigar_name": "Amit", "due_days": -3, "submitted_qty": 70, "total_qty": 300 }
                    }
                },
                "stitching": { "karigar_name": "Deepak", "due_days": 3, "submitted_qty": 45, "total_qty": 300 },
                "finishing": { "karigar_name": "Kapil", "due_days": 6, "submitted_qty": 37, "total_qty": 300 }
            }
        },
        {
            "production_id": "TEST",
            "production_code": "TEST",
            "product_name": "Product TEST",
            "status": "In Progress",
            "subprocesses": {
                "embroidery": {
                    "karigar_name": "Imran", "due_days": -1, "submitted_qty": 0, "total_qty": 300,
                    "items": {
                        "touching": { "karigar_name": "Vikram", "due_days": -1, "submitted_qty": 0, "total_qty": 300 },
                        "embroidery": { "karigar_name": "Imran", "due_days": -1, "submitted_qty": 0, "total_qty": 300 },
                        "latkan": { "karigar_name": "Vikram", "due_days": -1, "submitted_qty": 0, "total_qty": 300 },
                        "outing": { "karigar_name": "Farhan", "due_days": -1, "submitted_qty": 0, "total_qty": 300 },
                        "pleating": { "karigar_name": "Vikram", "due_days": -1, "submitted_qty": 0, "total_qty": 300 }
                    }
                },
                "stitching": { "karigar_name": "Suresh", "due_days": -1, "submitted_qty": 0, "total_qty": 300 },
                "finishing": { "karigar_name": "Kapil", "due_days": -2, "submitted_qty": 0, "total_qty": 300 }
            }
        }
    ]
    save_job_work_mock(_job_work_mock)
    return _job_work_mock

def save_job_work_mock(data):
    try:
        with open(MOCK_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception:
        pass

def randomize_simulated_data(cdh_products=None):
    global _plan_overrides
    if cdh_products is None:
        cdh_products = []

    job_work = get_job_work_mock()
    scenarios = ['healthy', 'healthy', 'almost_done', 'slow', 'overdue', 'stuck', 'never_started', 'critical']

    for job in job_work:
        sc = random.choice(scenarios)
        procs = job.get("subprocesses", {})

        for proc_name, proc in procs.items():
            total = proc.get("total_qty", 300)

            if sc == 'healthy':
                proc["submitted_qty"] = total
                proc["due_days"] = random.randint(0, 9) + 5
            elif sc == 'almost_done':
                proc["submitted_qty"] = int(total * (0.8 + random.random() * 0.18))
                proc["due_days"] = random.randint(0, 5) + 2
            elif sc == 'slow':
                proc["submitted_qty"] = int(total * (0.05 + random.random() * 0.23))
                proc["due_days"] = random.randint(0, 4) + 1
            elif sc == 'overdue':
                proc["submitted_qty"] = int(total * (0.1 + random.random() * 0.5))
                proc["due_days"] = -random.randint(0, 5) - 1
            elif sc == 'stuck':
                if proc_name == 'embroidery':
                    proc["submitted_qty"] = total
                    proc["due_days"] = random.randint(0, 5) + 4
                else:
                    proc["submitted_qty"] = 0
                    proc["due_days"] = random.randint(0, 4) - 3
            elif sc == 'never_started':
                proc["submitted_qty"] = 0
                proc["due_days"] = random.randint(0, 4)
            elif sc == 'critical':
                proc["submitted_qty"] = 0
                proc["due_days"] = -random.randint(0, 7) - 1

            if "items" in proc:
                for item in proc["items"].values():
                    item_total = item.get("total_qty", 300)
                    if sc in ['healthy', 'almost_done']:
                        item["submitted_qty"] = item_total if sc == 'healthy' else int(item_total * (0.75 + random.random() * 0.24))
                        item["due_days"] = random.randint(0, 8) + 3
                    elif sc in ['never_started', 'critical', 'stuck'] and proc_name == 'embroidery':
                        item["submitted_qty"] = item_total if sc == 'stuck' else 0
                        item["due_days"] = proc["due_days"]
                    else:
                        item["submitted_qty"] = int(item_total * random.random() * 0.8)
                        item["due_days"] = random.randint(0, 11) - 4

    save_job_work_mock(job_work)

    # Seed random overrides for plans
    _plan_overrides = {}
    plan_scenarios = ['healthy', 'almost_done', 'slow', 'dead', 'overdue_del', 'near_deadline', 'completed']

    products_to_seed = cdh_products if len(cdh_products) > 0 else [{"product_code": str(17240 + i), "product_name": f"Product {17240 + i}"} for i in range(10)]

    for p in products_to_seed:
        code = str(p.get("product_code") or p.get("id"))
        sc = random.choice(plan_scenarios)
        prog = 0
        status = 'Pending'
        delta = 10

        if sc == 'completed':
            prog = 100
            status = 'Completed'
            delta = random.randint(0, 19) + 10
        elif sc == 'healthy':
            prog = random.randint(0, 29) + 55
            status = 'Running'
            delta = random.randint(0, 16) + 8
        elif sc == 'almost_done':
            prog = random.randint(0, 14) + 82
            status = 'Running'
            delta = random.randint(0, 6) + 3
        elif sc == 'slow':
            prog = random.randint(0, 22) + 5
            status = 'Running'
            delta = random.randint(0, 14) + 5
        elif sc == 'dead':
            prog = 0
            status = 'Pending'
            delta = random.randint(0, 14) + 5
        elif sc == 'overdue_del':
            prog = random.randint(0, 49) + 10
            status = 'Running'
            delta = -random.randint(0, 13) - 1
        elif sc == 'near_deadline':
            prog = random.randint(0, 39) + 30
            status = 'Running'
            delta = random.randint(0, 3) + 1

        today = datetime.date.today()
        promise = today + datetime.timedelta(days=delta)
        start = today - datetime.timedelta(days=random.randint(0, 19))

        _plan_overrides[code] = {
            "progress": prog,
            "status": status,
            "start_date": start.isoformat(),
            "promise_date": promise.isoformat()
        }

    return {
        "status": "randomized",
        "overridesCount": len(_plan_overrides)
    }

def calculate_dashboard_analytics(cdh_products=None, cdh_production=None, cdh_sales=None, cdh_stock=None):
    if cdh_products is None: cdh_products = []
    if cdh_production is None: cdh_production = []
    if cdh_sales is None: cdh_sales = []
    if cdh_stock is None: cdh_stock = []

    today = datetime.date.today()
    job_work = get_job_work_mock()

    # Format CDH raw stock list
    subpart_inventory = {}
    for s in cdh_stock:
        mat_name = s.get("material_name")
        if mat_name:
            subpart_inventory[mat_name] = s.get("quantity", 0)

    # Force Bead shortage if offline or stock missing
    if not subpart_inventory:
        subpart_inventory = {
            "Fabric": 5000,
            "Net": 2000,
            "Laces": 300,
            "Beads": 0, # Trigger alert
            "Thread": 1000
        }

    # 1. Process standard products list
    products = []
    for p in cdh_products:
        prod_name = p.get("product_name") or p.get("name")
        if prod_name and str(prod_name).isdigit():
            prod_name = f"Product {prod_name}"
        if not prod_name:
            prod_name = f"Product {p.get('product_code') or p.get('id') or 'Unknown'}"

        products.append({
            "id": str(p.get("product_code") or p.get("id")),
            "name": prod_name,
            "sku": p.get("product_code") or "N/A",
            "category": p.get("category") or "General",
            "subparts": p.get("subparts") or ["Fabric", "Thread", "Beads"]
        })

    # Map CDH production plans with overrides
    plans = []
    for p in cdh_production:
        code = str(p.get("production_code") or p.get("planning_no") or "")
        override = _plan_overrides.get(code, {})

        target = p.get("target_pcs", 300) or 300
        ready = p.get("ready_pcs", 0) or 0
        computed_progress = int(round((ready / target) * 100)) if target > 0 else 0

        prod_name = p.get("product_name") or p.get("item_name") or p.get("name")
        if prod_name and str(prod_name).isdigit():
            prod_name = f"Product {prod_name}"
        if not prod_name:
            prod_name = f"Product {code}" if code else "Product Unknown"

        plans.append({
            "product_id": code,
            "product_name": prod_name,
            "status": override.get("status") or p.get("status") or ("Completed" if computed_progress >= 100 else "Running"),
            "progress": override.get("progress") if override.get("progress") is not None else computed_progress,
            "target": target,
            "ready": ready,
            "start_date": override.get("start_date") or p.get("start_date") or (today - datetime.timedelta(days=10)).isoformat(),
            "promise_date": override.get("promise_date") or p.get("due_date_of_last_process") or (today + datetime.timedelta(days=10)).isoformat(),
            "subparts": [p.get("material_name")] if p.get("material_name") else ["Fabric", "Thread"],
            "karigar_name": p.get("karigar_name") or "Unassigned"
        })

    # Fallback
    if not plans:
        for idx, p in enumerate(products):
            code = p["id"]
            override = _plan_overrides.get(code, {})

            plans.append({
                "product_id": code,
                "product_name": p["name"],
                "status": override.get("status") or ("Completed" if idx % 3 == 0 else "Running" if idx % 3 == 1 else "Pending"),
                "progress": override.get("progress") if override.get("progress") is not None else (100 if idx % 3 == 0 else 45 if idx % 3 == 1 else 0),
                "target": 300,
                "ready": 300 if idx % 3 == 0 else 135 if idx % 3 == 1 else 0,
                "start_date": override.get("start_date") or (today - datetime.timedelta(days=12)).isoformat(),
                "promise_date": override.get("promise_date") or (today + datetime.timedelta(days=8)).isoformat(),
                "subparts": p["subparts"],
                "karigar_name": "Ahmed" if idx % 2 == 0 else "Imran"
            })

    # 2. Process Sales Order list
    sales_map = {}
    for s in cdh_sales:
        code = str(s.get("product") or s.get("product_code") or "")
        if code:
            sales_map[code] = sales_map.get(code, 0) + (s.get("order_pcs", 0) or 0)

    sales = []
    for p in plans:
        code = p["product_id"]
        qty = sales_map.get(code)
        if qty is None:
            # high fidelity fallback matching JS randomizer
            qty = random.randint(20, 169) if random.random() > 0.4 else 0
        sales.append({
            "product_id": code,
            "quantity": qty
        })

    active_sales = [s["quantity"] for s in sales if s["quantity"] > 0]
    avg_sales = sum(active_sales) / len(active_sales) if active_sales else 35

    # 3. Process inventory metrics
    inventory = []
    for idx, p in enumerate(plans):
        avail = random.randint(50, 449)
        res = random.randint(10, 89)

        if idx == 0:
            avail = 0
            res = 50
        elif idx == 1:
            avail = 5
            res = 50
        elif idx == 2:
            avail = 30
            res = 40

        inventory.append({
            "product_id": p["product_id"],
            "available_stock": avail,
            "reserved_stock": res
        })

    # 4. Job Work Map compiler
    job_work_map = {}
    for job in job_work:
        code = str(job.get("production_code") or "").strip()
        overdue_procs = []
        procs = job.get("subprocesses", {})
        overdue_count = 0

        for proc_name, proc in procs.items():
            sub = proc.get("submitted_qty", 0)
            tot = proc.get("total_qty", 1)

            if sub < tot:
                due = proc.get("due_days", 999)
                karigar = proc.get("karigar_name", "?")
                if due <= 0:
                    overdue_procs.append({"process": proc_name, "karigar": karigar, "days_overdue": abs(due)})
                    overdue_count += 1

                if "items" in proc:
                    for item_name, item in proc["items"].items():
                        item_sub = item.get("submitted_qty", 0)
                        item_tot = item.get("total_qty", 1)
                        if item_sub < item_tot:
                            item_due = item.get("due_days", 999)
                            if item_due <= 0:
                                overdue_procs.append({"process": item_name, "karigar": item.get("karigar_name", "?"), "days_overdue": abs(item_due)})
                                overdue_count += 1

        emb = procs.get("embroidery", {})
        stitch = procs.get("stitching", {})
        finish = procs.get("finishing", {})
        inter_stage_gaps = []

        emb_done = emb.get("submitted_qty", 0) >= emb.get("total_qty", 1)
        stitch_done = stitch.get("submitted_qty", 0) >= stitch.get("total_qty", 1)

        if emb and stitch and emb_done and (stitch.get("submitted_qty", 0) == 0 or not stitch.get("submitted_qty")):
            inter_stage_gaps.append({"from": "embroidery", "to": "stitching", "karigar": stitch.get("karigar_name", "?")})
        if stitch and finish and stitch_done and (finish.get("submitted_qty", 0) == 0 or not finish.get("submitted_qty")):
            inter_stage_gaps.append({"from": "stitching", "to": "finishing", "karigar": finish.get("karigar_name", "?")})

        zero_start_count = len([p for p in procs.values() if not p.get("submitted_qty") and p.get("total_qty", 0) > 0])

        job_work_map[code] = {
            "overdue_processes": overdue_procs,
            "overdue_count": overdue_count,
            "inter_stage_gaps": inter_stage_gaps,
            "zero_start_count": zero_start_count
        }

    # 5. Dynamic Attention scoring
    attention_report = []
    for plan in plans:
        pid = str(plan["product_id"]).strip()
        score = 0
        reasons = []

        progress = plan.get("progress") or 0
        status = plan.get("status") or ""
        start_str = plan.get("start_date")
        promise_str = plan.get("promise_date")

        # Delivery risks
        days_to_delivery = None
        is_delivery_overdue = False
        if promise_str:
            try:
                promise_date = datetime.date.fromisoformat(promise_str)
                days_to_delivery = (promise_date - today).days
                if days_to_delivery < 0:
                    is_delivery_overdue = True
                    score += 45
                    reasons.append(f"Delivery overdue by {abs(days_to_delivery)}d")
                elif days_to_delivery <= 3:
                    score += 30
                    reasons.append(f"Delivery due in {days_to_delivery}d — urgent")
                elif days_to_delivery <= 7:
                    score += 15
                    reasons.append(f"Delivery in {days_to_delivery}d")
            except Exception:
                pass

        # Est finish timeline
        if status == 'Running' and progress > 0 and start_str:
            try:
                start_date = datetime.date.fromisoformat(start_str)
                elapsed = max((today - start_date).days, 1)
                rate = progress / elapsed
                if rate > 0:
                    remaining_days = (100 - progress) / rate
                    if days_to_delivery is not None and not is_delivery_overdue:
                        if remaining_days > days_to_delivery:
                            score += 25
                            reasons.append("Est. finish will MISS promise date")
            except Exception:
                pass

        # Delayed start
        if start_str and progress == 0 and status != 'Running':
            try:
                start_date = datetime.date.fromisoformat(start_str)
                if start_date <= today:
                    score += 20
                    reasons.append("Planned start passed — still 0% progress")
            except Exception:
                pass

        # Slow running
        if status == 'Running' and progress < 30:
            score += 15
            reasons.append(f"Slow start — only {progress}% done")

        # Subprocess overdue
        jw = job_work_map.get(pid, {})
        overdue_count = jw.get("overdue_count", 0)
        overdue_procs = jw.get("overdue_processes", [])
        inter_stage_gaps = jw.get("inter_stage_gaps", [])
        zero_start_count = jw.get("zero_start_count", 0)

        if overdue_count > 0:
            score += overdue_count * 12
            names = [f"{p['process']} ({p['karigar']})" for p in overdue_procs[:2]]
            reasons.append(f"{overdue_count} subprocess(es) overdue: {', '.join(names)}")

        if inter_stage_gaps:
            score += len(inter_stage_gaps) * 20
            for gap in inter_stage_gaps:
                reasons.append(f"Handoff stuck: {gap['from']} done → {gap['to']} not started ({gap['karigar']})")

        if zero_start_count >= 2 and status != 'Completed':
            score += 15
            reasons.append(f"{zero_start_count} stages never started")

        # Sales spikes
        sale_qty = next((s["quantity"] for s in sales if str(s["product_id"]) == pid), 0)
        ratio = sale_qty / avg_sales if avg_sales > 0 else 0
        is_sales_spike = ratio >= 2.0
        is_high_demand = ratio >= 1.5

        if is_sales_spike:
            score += 40
            reasons.append(f"🔥 HIGH ORDERS: {ratio:.1f}x avg ({sale_qty} orders) — Speed up production to avoid stockout!")
        elif is_high_demand:
            score += 15
            reasons.append(f"📈 High demand: {ratio:.1f}x avg ({sale_qty} orders) — above-average sales volume")

        # Reproduction alert
        stock_obj = next((i for i in inventory if str(i["product_id"]) == pid), None)
        if stock_obj:
            avail = stock_obj["available_stock"]
            res = stock_obj["reserved_stock"]
            if avail < res and status != 'Running':
                score += 35
                reasons.append("Stock below demand — reproduction needed")

        # Dead jobs
        days_since_start = None
        if start_str:
            try:
                start_date = datetime.date.fromisoformat(start_str)
                days_since_start = (today - start_date).days
            except Exception:
                pass

        is_dead = progress == 0 and status != 'Completed' and days_since_start is not None and days_since_start >= 7
        if is_dead:
            score += 25
            reasons.append(f"Dead job — 0% progress for {days_since_start}d")

        attention_report.append({
            "production_code": pid,
            "attention_score": min(100, score),
            "reasons": reasons,
            "is_sales_spike": is_sales_spike,
            "is_high_demand": is_high_demand,
            "sales_ratio": round(ratio, 2),
            "sale_qty": sale_qty,
            "avg_sales": int(round(avg_sales)),
            "overdue_process_count": overdue_count,
            "overdue_processes": overdue_procs,
            "inter_stage_gaps": inter_stage_gaps,
            "zero_start_count": zero_start_count,
            "days_to_delivery": days_to_delivery,
            "is_delivery_overdue": is_delivery_overdue,
            "is_dead": is_dead,
            "days_since_start": days_since_start,
            "needs_attention": score > 0
        })

    attention_report.sort(key=lambda x: x["attention_score"], reverse=True)

    # 6. Compile Karigar Report
    karigar_data = {}

    def record_karigar(name, code, due, submitted, total):
        if not name or name == "?":
            return
        name = name.strip()
        if not name:
            return

        if name not in karigar_data:
            karigar_data[name] = {
                "active": 0, "overdue": 0, "zero_progress": 0,
                "total_overdue_days": 0, "jobs": set(), "never_started_jobs": set()
            }

        if submitted < total:
            karigar_data[name]["active"] += 1
            karigar_data[name]["jobs"].add(code)
            if due <= 0:
                karigar_data[name]["overdue"] += 1
                karigar_data[name]["total_overdue_days"] += abs(due)
            if submitted == 0:
                karigar_data[name]["zero_progress"] += 1
                karigar_data[name]["never_started_jobs"].add(code)

    for job in job_work:
        code = str(job.get("production_code") or "")
        procs = job.get("subprocesses", {})

        for proc_name, proc in procs.items():
            record_karigar(proc.get("karigar_name"), code, proc.get("due_days", 999), proc.get("submitted_qty", 0), proc.get("total_qty", 1))

            if "items" in proc:
                for item in proc["items"].values():
                    record_karigar(item.get("karigar_name"), code, item.get("due_days", 999), item.get("submitted_qty", 0), item.get("total_qty", 1))

    karigar_report = []
    for name, d in karigar_data.items():
        active = d["active"]
        overdue = d["overdue"]
        zero_prog = d["zero_progress"]

        status = 'ok'
        if active > 5:
            status = 'overloaded'
        elif overdue > 0 and zero_prog > 1:
            status = 'critical'
        elif overdue > 0 or zero_prog > 1:
            status = 'at_risk'
        elif zero_prog > 0:
            status = 'idle'

        karigar_report.append({
            "name": name,
            "active_jobs": active,
            "overdue_count": overdue,
            "zero_progress_count": zero_prog,
            "avg_days_overdue": round(d["total_overdue_days"] / overdue, 1) if overdue > 0 else 0,
            "unique_productions": len(d["jobs"]),
            "status": status
        })

    order_weight = {"overloaded": 0, "critical": 1, "at_risk": 2, "idle": 3, "ok": 4}
    karigar_report.sort(key=lambda x: (order_weight.get(x["status"], 4), -x["overdue_count"]))

    return {
        "products": products,
        "production_plans": plans,
        "inventory": inventory,
        "sales": sales,
        "subpart_inventory": subpart_inventory,
        "attention_scores": attention_report,
        "karigar_report": karigar_report,
        "job_work": job_work
    }
