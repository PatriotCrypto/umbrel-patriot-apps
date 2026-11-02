"""Owner Log — self-hosted aircraft ownership records.

Inspections and maintenance due, squawks, directives, equipment, flights,
costs and reserves, for one aircraft, on your own server.
"""
from __future__ import annotations

import hashlib
import os
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from urllib.parse import quote, urlencode

from fastapi import FastAPI, Request
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    PlainTextResponse,
    RedirectResponse,
    Response,
)
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from . import charts, db, exports, files, report
from .security import CSRF_FIELD, SecurityMiddleware, get_form

VERSION = "1.0.0"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATE_DIR = os.path.join(BASE_DIR, "templates")


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init_db(seed=os.environ.get("OWL_SEED", "1") != "0")
    files.ensure_dirs()
    yield


app = FastAPI(
    title="Owner Log",
    version=VERSION,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)
app.add_middleware(SecurityMiddleware)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=TEMPLATE_DIR)


def _asset_version() -> str:
    digest = hashlib.sha256()
    for name in ("app.css",):
        try:
            with open(os.path.join(STATIC_DIR, name), "rb") as fh:
                digest.update(fh.read())
        except OSError:
            digest.update(name.encode())
    return digest.hexdigest()[:12]


ASSET_VERSION = _asset_version()

NAV = [
    ("/", "Status", "gauge"),
    ("/maintenance", "Maintenance", "wrench"),
    ("/squawks", "Squawks", "alert"),
    ("/compliance", "Compliance", "shield"),
    ("/equipment", "Equipment", "chip"),
    ("/flights", "Flights", "plane"),
    ("/costs", "Costs", "dollar"),
    ("/logbook", "Logbook", "book"),
    ("/documents", "Documents", "file"),
    ("/aircraft", "Aircraft", "tag"),
    ("/settings", "Settings", "cog"),
]


# ------------------------------------------------------------------ helpers


def money(cents) -> str:
    return f"${(int(cents or 0)) / 100:,.2f}"


def rate(cents) -> str:
    return f"${(int(cents or 0)) / 100:,.2f}/hr"


def hours_fmt(value) -> str:
    return f"{float(value or 0):,.1f}"


def to_float(value, default: float = 0.0) -> float:
    try:
        text = str(value).strip().replace(",", "")
        if not text:
            return default
        if ":" in text:
            hh, mm = text.split(":", 1)
            return float(hh) + float(mm or 0) / 60
        return float(text)
    except (TypeError, ValueError):
        return default


def opt_float(value):
    text = str(value or "").strip()
    return to_float(text) if text else None


def to_int(value, default: int = 0) -> int:
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return default


def to_cents(value) -> int:
    text = str(value or "").strip().replace("$", "").replace(",", "")
    if not text:
        return 0
    try:
        return int(round(float(text) * 100))
    except ValueError:
        return 0


def to_date(value, default: str | None = None) -> str:
    text = str(value or "").strip()[:10]
    try:
        datetime.strptime(text, "%Y-%m-%d")
        return text
    except ValueError:
        return default if default is not None else date.today().isoformat()


def opt_id(value):
    number = to_int(value, 0)
    return number if number > 0 else None


def checked(value) -> int:
    return 1 if str(value or "").strip() not in ("", "0", "off", "false") else 0


def render(request: Request, template: str, status_code: int = 200, **context):
    craft = db.aircraft()
    base = {
        "request": request,
        "csrf_field": CSRF_FIELD,
        "csrf_token": getattr(request.state, "csrf_token", ""),
        "asset_version": ASSET_VERSION,
        "nav": NAV,
        "path": request.url.path,
        "craft": craft,
        "craft_name": craft["tail"] or f"{craft['make']} {craft['model']}".strip() or "My Aircraft",
        "version": VERSION,
        "money": money,
        "rate": rate,
        "hours_fmt": hours_fmt,
        "msg": request.query_params.get("msg", ""),
        "err": request.query_params.get("err", ""),
        "today": date.today().isoformat(),
        "timers": db.TIMERS,
        "timer_labels": db.TIMER_LABELS,
    }
    base.update(context)
    return templates.TemplateResponse(request, template, base, status_code=status_code)


def back(path: str, msg: str = "", err: str = "") -> RedirectResponse:
    params = {}
    if msg:
        params["msg"] = msg
    if err:
        params["err"] = err
    return RedirectResponse(
        path + (("?" + urlencode(params)) if params else ""), status_code=303
    )


def people_list():
    return db.query("SELECT * FROM people ORDER BY name")


@app.get("/healthz", response_class=PlainTextResponse)
def healthz() -> str:
    db.scalar("SELECT 1")
    return "ok"


# ------------------------------------------------------------------- status


@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request):
    craft = db.aircraft()
    status = db.airworthiness()
    items = db.items_due()
    squawks = db.query(
        "SELECT s.*, p.name AS person_name FROM squawks s"
        " LEFT JOIN people p ON p.id = s.person_id"
        " WHERE s.status != 'resolved' ORDER BY"
        " CASE s.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1"
        "  WHEN 'medium' THEN 2 ELSE 3 END, s.reported_on DESC LIMIT 6"
    )
    recent_flights = db.query(
        "SELECT f.*, p.name AS pilot FROM flights f"
        " LEFT JOIN people p ON p.id = f.person_id"
        " ORDER BY f.flew_on DESC, f.id DESC LIMIT 5"
    )
    summary = db.cost_summary(12)
    year_start = (date.today() - timedelta(days=365)).isoformat()
    hours_year = db.hours_between(year_start, date.today().isoformat())

    return render(
        request,
        "dashboard.html",
        title="Status",
        status=status,
        items=[i for i in items if i["status"] in ("overdue", "due_soon")][:8],
        all_items=items,
        squawks=squawks,
        open_squawks=int(
            db.scalar("SELECT COUNT(*) FROM squawks WHERE status != 'resolved'") or 0
        ),
        recent_flights=recent_flights,
        summary=summary,
        hours_year=round(hours_year, 1),
        reserves=db.reserve_balances(),
        vor=db.vor_status(),
        engine_percent=round(
            float(craft["engine_smoh"] or 0) / float(craft["engine_tbo"]) * 100, 1
        )
        if craft["engine_tbo"]
        else None,
        hours_chart=charts.bar_chart(flight_month_series(6), unit="hours"),
    )


def flight_month_series(count: int) -> list[tuple[str, float]]:
    today = date.today().replace(day=1)
    months = []
    cursor = today
    for _ in range(count):
        months.append(cursor)
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    buckets = {m.strftime("%Y-%m"): 0.0 for m in reversed(months)}
    for row in db.query(
        "SELECT substr(flew_on, 1, 7) AS ym, SUM(hours) AS h FROM flights GROUP BY ym"
    ):
        if row["ym"] in buckets:
            buckets[row["ym"]] = round(float(row["h"] or 0), 1)
    return [
        (datetime.strptime(k, "%Y-%m").strftime("%b"), v) for k, v in buckets.items()
    ]


@app.get("/api/status")
def api_status():
    status = db.airworthiness()
    craft = db.aircraft()
    return JSONResponse(
        {
            "aircraft": dict(craft),
            "airworthy": status["ready"],
            "blocking": [i["name"] for i in status["blocking_items"]],
            "grounding_squawks": len(status["grounding_squawks"]),
            "open_squawks": int(
                db.scalar("SELECT COUNT(*) FROM squawks WHERE status != 'resolved'") or 0
            ),
            "due": [
                {
                    "name": i["name"],
                    "status": i["status"],
                    "next_date": i["next_date"],
                    "hours_left": i["hours_left"],
                }
                for i in db.items_due()
                if i["status"] in ("overdue", "due_soon")
            ],
            "cost": db.cost_summary(12),
            "reserves": db.reserve_balances(),
        }
    )


# ----------------------------------------------------------------- aircraft


@app.get("/aircraft", response_class=HTMLResponse)
def aircraft_page(request: Request):
    craft = db.aircraft()
    return render(
        request,
        "aircraft.html",
        title="Aircraft",
        engine_percent=round(
            float(craft["engine_smoh"] or 0) / float(craft["engine_tbo"]) * 100, 1
        )
        if craft["engine_tbo"]
        else None,
        prop_percent=round(
            float(craft["prop_since"] or 0) / float(craft["prop_tbo"]) * 100, 1
        )
        if craft["prop_tbo"]
        else None,
    )


@app.post("/aircraft")
async def aircraft_save(request: Request):
    form = await get_form(request)
    db.execute(
        "UPDATE aircraft SET tail = ?, make = ?, model = ?, serial = ?, year = ?,"
        " category = ?, home_base = ?, engine_make = ?, engine_model = ?,"
        " engine_serial = ?, engine_tbo = ?, prop_make = ?, prop_model = ?,"
        " prop_serial = ?, prop_tbo = ?, empty_weight = ?, empty_arm = ?,"
        " max_gross = ?, fuel_capacity = ?, fuel_burn = ?, fuel_price = ?,"
        " planned_hours = ?, notes = ? WHERE id = 1",
        (
            str(form.get("tail", "")).strip()[:12].upper(),
            str(form.get("make", "")).strip()[:60],
            str(form.get("model", "")).strip()[:60],
            str(form.get("serial", "")).strip()[:60],
            str(form.get("year", "")).strip()[:8],
            str(form.get("category", "")).strip()[:40],
            str(form.get("home_base", "")).strip()[:40],
            str(form.get("engine_make", "")).strip()[:60],
            str(form.get("engine_model", "")).strip()[:60],
            str(form.get("engine_serial", "")).strip()[:60],
            max(0.0, to_float(form.get("engine_tbo"))),
            str(form.get("prop_make", "")).strip()[:60],
            str(form.get("prop_model", "")).strip()[:60],
            str(form.get("prop_serial", "")).strip()[:60],
            max(0.0, to_float(form.get("prop_tbo"))),
            to_float(form.get("empty_weight")),
            to_float(form.get("empty_arm")),
            to_float(form.get("max_gross")),
            to_float(form.get("fuel_capacity")),
            to_float(form.get("fuel_burn")),
            to_float(form.get("fuel_price")),
            max(1.0, to_float(form.get("planned_hours"), 100.0)),
            str(form.get("notes", "")).strip(),
        ),
    )
    return back("/aircraft", "Aircraft details saved.")


@app.post("/aircraft/times")
async def aircraft_times(request: Request):
    form = await get_form(request)
    db.execute(
        "UPDATE aircraft SET tach = ?, hobbs = ?, total_time = ?, engine_smoh = ?,"
        " prop_since = ? WHERE id = 1",
        (
            max(0.0, to_float(form.get("tach"))),
            max(0.0, to_float(form.get("hobbs"))),
            max(0.0, to_float(form.get("total_time"))),
            max(0.0, to_float(form.get("engine_smoh"))),
            max(0.0, to_float(form.get("prop_since"))),
        ),
    )
    return back("/aircraft", "Times updated.")


@app.post("/aircraft/overhaul")
async def aircraft_overhaul(request: Request):
    form = await get_form(request)
    what = str(form.get("what", "engine"))
    when = to_date(form.get("when"))
    if what == "prop":
        db.execute("UPDATE aircraft SET prop_since = 0 WHERE id = 1")
        label = "Propeller overhaul"
    else:
        db.execute("UPDATE aircraft SET engine_smoh = 0 WHERE id = 1")
        label = "Engine overhaul"
    craft = db.aircraft()
    db.execute(
        "INSERT INTO entries (entry_date, kind, summary, work, performed_by, tach,"
        " hobbs, total_time, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            when,
            "Overhaul",
            label,
            str(form.get("notes", "")).strip(),
            str(form.get("performed_by", "")).strip()[:120],
            craft["tach"],
            craft["hobbs"],
            craft["total_time"],
            db.now(),
        ),
    )
    return back("/aircraft", f"{label} recorded and the counter reset to zero.")


# -------------------------------------------------------------- maintenance


@app.get("/maintenance", response_class=HTMLResponse)
def maintenance_page(request: Request):
    show_all = request.query_params.get("all") == "1"
    return render(
        request,
        "maintenance.html",
        title="Maintenance",
        items=db.items_due(include_inactive=show_all),
        show_all=show_all,
        categories=db.ITEM_CATEGORIES,
        craft=db.aircraft(),
    )


@app.post("/items/add")
async def items_add(request: Request):
    form = await get_form(request)
    name = str(form.get("name", "")).strip()[:120]
    if not name:
        return back("/maintenance", err="Give the item a name.")
    timer = str(form.get("timer", "tach"))
    if timer not in db.TIMERS:
        timer = "tach"
    order = int(db.scalar("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM items") or 1)
    db.execute(
        "INSERT INTO items (name, category, interval_hours, interval_months, timer,"
        " airworthiness, last_done_date, last_done_hours, due_date, due_hours,"
        " reference, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            name,
            str(form.get("category", "Maintenance"))[:40],
            max(0.0, to_float(form.get("interval_hours"))),
            max(0.0, to_float(form.get("interval_months"))),
            timer,
            checked(form.get("airworthiness")),
            to_date(form.get("last_done_date"), ""),
            opt_float(form.get("last_done_hours")),
            to_date(form.get("due_date"), ""),
            opt_float(form.get("due_hours")),
            str(form.get("reference", "")).strip()[:80],
            str(form.get("notes", "")).strip(),
            order,
        ),
    )
    return back("/maintenance", f"Added {name}.")


@app.post("/items/{item_id}/update")
async def items_update(request: Request, item_id: int):
    form = await get_form(request)
    timer = str(form.get("timer", "tach"))
    if timer not in db.TIMERS:
        timer = "tach"
    db.execute(
        "UPDATE items SET name = ?, category = ?, interval_hours = ?,"
        " interval_months = ?, timer = ?, airworthiness = ?, last_done_date = ?,"
        " last_done_hours = ?, due_date = ?, due_hours = ?, reference = ?,"
        " notes = ?, active = ? WHERE id = ?",
        (
            str(form.get("name", "")).strip()[:120] or "Item",
            str(form.get("category", "Maintenance"))[:40],
            max(0.0, to_float(form.get("interval_hours"))),
            max(0.0, to_float(form.get("interval_months"))),
            timer,
            checked(form.get("airworthiness")),
            to_date(form.get("last_done_date"), ""),
            opt_float(form.get("last_done_hours")),
            to_date(form.get("due_date"), ""),
            opt_float(form.get("due_hours")),
            str(form.get("reference", "")).strip()[:80],
            str(form.get("notes", "")).strip(),
            checked(form.get("active")),
            item_id,
        ),
    )
    return back("/maintenance", "Item saved.")


@app.post("/items/{item_id}/complete")
async def items_complete(request: Request, item_id: int):
    """Mark an inspection done: writes a logbook entry and moves the due date."""
    item = db.one("SELECT * FROM items WHERE id = ?", (item_id,))
    if item is None:
        return back("/maintenance", err="That item no longer exists.")
    form = await get_form(request)
    craft = db.aircraft()
    when = to_date(form.get("done_date"))
    hours_raw = str(form.get("done_hours", "")).strip()
    hours = to_float(hours_raw) if hours_raw else db.current_hours(item["timer"], craft)

    entry_id = db.execute(
        "INSERT INTO entries (entry_date, kind, summary, work, performed_by,"
        " certificate, tach, hobbs, total_time, item_id, cost_cents, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            when,
            item["category"],
            item["name"],
            str(form.get("work", "")).strip(),
            str(form.get("performed_by", "")).strip()[:120],
            str(form.get("certificate", "")).strip()[:60],
            craft["tach"],
            craft["hobbs"],
            craft["total_time"],
            item_id,
            to_cents(form.get("cost")),
            db.now(),
        ),
    )
    db.execute(
        "UPDATE items SET last_done_date = ?, last_done_hours = ?, due_date = '',"
        " due_hours = NULL WHERE id = ?",
        (when, hours, item_id),
    )
    cents = to_cents(form.get("cost"))
    if cents:
        db.execute(
            "INSERT INTO costs (spent_on, vendor, category, description, amount_cents,"
            " kind, entry_id) VALUES (?, ?, ?, ?, ?, 'variable', ?)",
            (
                when,
                str(form.get("performed_by", "")).strip()[:120],
                "Maintenance",
                item["name"],
                cents,
                entry_id,
            ),
        )
    return back("/maintenance", f"{item['name']} signed off.")


@app.post("/items/{item_id}/delete")
async def items_delete(request: Request, item_id: int):
    db.execute("DELETE FROM items WHERE id = ?", (item_id,))
    return back("/maintenance", "Item removed.")


@app.post("/items/restore-defaults")
async def items_restore(request: Request):
    existing = {r["name"].lower() for r in db.query("SELECT name FROM items")}
    added = 0
    for i, (name, cat, hours, months, timer, aw, ref) in enumerate(db.DEFAULT_ITEMS):
        if name.lower() in existing:
            continue
        db.execute(
            "INSERT INTO items (name, category, interval_hours, interval_months,"
            " timer, airworthiness, reference, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (name, cat, hours, months, timer, aw, ref, 100 + i),
        )
        added += 1
    return back("/maintenance", f"Added {added} missing default item(s).")


# ------------------------------------------------------------------ squawks


@app.get("/squawks", response_class=HTMLResponse)
def squawks_page(request: Request):
    status = request.query_params.get("status", "")
    where = []
    args: list = []
    if status in db.SQUAWK_STATUS:
        where.append("s.status = ?")
        args.append(status)
    elif status != "all":
        where.append("s.status != 'resolved'")
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    rows = db.query(
        "SELECT s.*, p.name AS person_name,"
        " (SELECT COUNT(*) FROM attachments a WHERE a.links_table = 'squawks'"
        "  AND a.links_id = s.id) AS photo_count"
        " FROM squawks s LEFT JOIN people p ON p.id = s.person_id"
        f"{clause} ORDER BY CASE s.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1"
        " WHEN 'medium' THEN 2 ELSE 3 END, s.reported_on DESC, s.id DESC",
        args,
    )
    return render(
        request,
        "squawks.html",
        title="Squawks",
        rows=rows,
        status=status,
        severities=db.SQUAWK_SEVERITY,
        statuses=db.SQUAWK_STATUS,
        people=people_list(),
        counts={
            s: int(db.scalar("SELECT COUNT(*) FROM squawks WHERE status = ?", (s,)) or 0)
            for s in db.SQUAWK_STATUS
        },
    )


@app.post("/squawks/add")
async def squawks_add(request: Request):
    form = await get_form(request)
    title = str(form.get("title", "")).strip()[:160]
    if not title:
        return back("/squawks", err="Describe the squawk in a few words.")
    severity = str(form.get("severity", "medium"))
    if severity not in db.SQUAWK_SEVERITY:
        severity = "medium"
    craft = db.aircraft()
    squawk_id = db.execute(
        "INSERT INTO squawks (reported_on, title, description, severity, status,"
        " grounding, person_id, tach, created_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)",
        (
            to_date(form.get("reported_on")),
            title,
            str(form.get("description", "")).strip(),
            severity,
            checked(form.get("grounding")),
            opt_id(form.get("person_id")),
            opt_float(form.get("tach")) if str(form.get("tach", "")).strip() else craft["tach"],
            db.now(),
        ),
    )
    for upload in form.getlist("photos"):
        if not getattr(upload, "filename", ""):
            continue
        data = await upload.read()
        try:
            files.save_upload(
                data,
                upload.filename,
                getattr(upload, "content_type", ""),
                kind="photo",
                links_table="squawks",
                links_id=squawk_id,
            )
        except files.UploadError:
            continue
    return back("/squawks", "Squawk logged.")


@app.post("/squawks/{squawk_id}/update")
async def squawks_update(request: Request, squawk_id: int):
    row = db.one("SELECT * FROM squawks WHERE id = ?", (squawk_id,))
    if row is None:
        return back("/squawks", err="That squawk no longer exists.")
    form = await get_form(request)
    status = str(form.get("status", row["status"]))
    if status not in db.SQUAWK_STATUS:
        status = row["status"]
    severity = str(form.get("severity", row["severity"]))
    if severity not in db.SQUAWK_SEVERITY:
        severity = row["severity"]
    resolved_on = row["resolved_on"]
    entry_id = row["entry_id"]
    resolution = str(form.get("resolution", row["resolution"])).strip()

    if status == "resolved" and row["status"] != "resolved":
        resolved_on = to_date(form.get("resolved_on"))
        craft = db.aircraft()
        entry_id = db.execute(
            "INSERT INTO entries (entry_date, kind, summary, work, performed_by,"
            " certificate, tach, hobbs, total_time, created_at)"
            " VALUES (?, 'Repair', ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                resolved_on,
                f"Squawk resolved: {row['title']}",
                resolution,
                str(form.get("performed_by", "")).strip()[:120],
                str(form.get("certificate", "")).strip()[:60],
                craft["tach"],
                craft["hobbs"],
                craft["total_time"],
                db.now(),
            ),
        )
    db.execute(
        "UPDATE squawks SET title = ?, description = ?, severity = ?, status = ?,"
        " grounding = ?, resolution = ?, resolved_on = ?, entry_id = ? WHERE id = ?",
        (
            str(form.get("title", row["title"])).strip()[:160] or row["title"],
            str(form.get("description", row["description"])).strip(),
            severity,
            status,
            checked(form.get("grounding")),
            resolution,
            resolved_on,
            entry_id,
            squawk_id,
        ),
    )
    return back("/squawks", "Squawk updated.")


@app.post("/squawks/{squawk_id}/delete")
async def squawks_delete(request: Request, squawk_id: int):
    for row in db.query(
        "SELECT id FROM attachments WHERE links_table = 'squawks' AND links_id = ?",
        (squawk_id,),
    ):
        files.delete_attachment(row["id"])
    db.execute("DELETE FROM squawks WHERE id = ?", (squawk_id,))
    return back("/squawks", "Squawk deleted.")


# --------------------------------------------------------------- compliance


@app.get("/compliance", response_class=HTMLResponse)
def compliance_page(request: Request):
    kind = request.query_params.get("kind", "")
    rows = db.directives_due(kind if kind in db.DIRECTIVE_KINDS else None)
    return render(
        request,
        "compliance.html",
        title="Compliance",
        rows=rows,
        kind=kind,
        kinds=db.DIRECTIVE_KINDS,
        statuses=db.DIRECTIVE_STATUS,
        vor=db.vor_status(),
        vor_rows=db.query("SELECT * FROM vor_checks ORDER BY checked_on DESC LIMIT 12"),
        counts={
            "open": sum(1 for r in rows if r["due_status"] == "overdue"),
            "due_soon": sum(1 for r in rows if r["due_status"] == "due_soon"),
            "total": len(rows),
        },
    )


@app.post("/directives/add")
async def directives_add(request: Request):
    form = await get_form(request)
    number = str(form.get("number", "")).strip()[:60]
    title = str(form.get("title", "")).strip()[:300]
    if not number and not title:
        return back("/compliance", err="Enter a number or a title.")
    kind = str(form.get("kind", "AD"))
    if kind not in db.DIRECTIVE_KINDS:
        kind = "AD"
    status = str(form.get("status", "open"))
    if status not in db.DIRECTIVE_STATUS:
        status = "open"
    db.execute(
        "INSERT INTO directives (kind, number, title, issued_on, applicability,"
        " status, recurring, interval_hours, interval_months, complied_on,"
        " complied_hours, method, url, notes)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            kind,
            number,
            title,
            to_date(form.get("issued_on"), ""),
            str(form.get("applicability", "")).strip()[:300],
            status,
            checked(form.get("recurring")),
            max(0.0, to_float(form.get("interval_hours"))),
            max(0.0, to_float(form.get("interval_months"))),
            to_date(form.get("complied_on"), ""),
            opt_float(form.get("complied_hours")),
            str(form.get("method", "")).strip()[:300],
            str(form.get("url", "")).strip()[:500],
            str(form.get("notes", "")).strip(),
        ),
    )
    return back("/compliance", f"{kind} {number} added.")


@app.post("/directives/{directive_id}/update")
async def directives_update(request: Request, directive_id: int):
    row = db.one("SELECT * FROM directives WHERE id = ?", (directive_id,))
    if row is None:
        return back("/compliance", err="That record no longer exists.")
    form = await get_form(request)
    status = str(form.get("status", row["status"]))
    if status not in db.DIRECTIVE_STATUS:
        status = row["status"]
    db.execute(
        "UPDATE directives SET number = ?, title = ?, issued_on = ?,"
        " applicability = ?, status = ?, recurring = ?, interval_hours = ?,"
        " interval_months = ?, complied_on = ?, complied_hours = ?, method = ?,"
        " url = ?, notes = ? WHERE id = ?",
        (
            str(form.get("number", row["number"])).strip()[:60],
            str(form.get("title", row["title"])).strip()[:300],
            to_date(form.get("issued_on"), ""),
            str(form.get("applicability", "")).strip()[:300],
            status,
            checked(form.get("recurring")),
            max(0.0, to_float(form.get("interval_hours"))),
            max(0.0, to_float(form.get("interval_months"))),
            to_date(form.get("complied_on"), ""),
            opt_float(form.get("complied_hours")),
            str(form.get("method", "")).strip()[:300],
            str(form.get("url", "")).strip()[:500],
            str(form.get("notes", "")).strip(),
            directive_id,
        ),
    )
    return back("/compliance", "Record saved.")


@app.post("/directives/{directive_id}/delete")
async def directives_delete(request: Request, directive_id: int):
    db.execute("DELETE FROM directives WHERE id = ?", (directive_id,))
    return back("/compliance", "Record removed.")


@app.post("/directives/import")
async def directives_import(request: Request):
    form = await get_form(request)
    upload = form.get("file")
    if upload is None or not getattr(upload, "filename", ""):
        return back("/compliance", err="Choose a CSV file first.")
    kind = str(form.get("kind", "SB"))
    if kind not in db.DIRECTIVE_KINDS:
        kind = "SB"
    data = await upload.read()
    try:
        message = exports.import_directives_csv(data, kind)
    except Exception as exc:
        return back("/compliance", err=f"Import failed: {exc}")
    return back("/compliance", message)


@app.post("/vor/add")
async def vor_add(request: Request):
    form = await get_form(request)
    db.execute(
        "INSERT INTO vor_checks (checked_on, place, method, bearing, error,"
        " signed_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            to_date(form.get("checked_on")),
            str(form.get("place", "")).strip()[:80],
            str(form.get("method", "VOT")).strip()[:40],
            str(form.get("bearing", "")).strip()[:40],
            str(form.get("error", "")).strip()[:40],
            str(form.get("signed_by", "")).strip()[:80],
            str(form.get("notes", "")).strip(),
        ),
    )
    return back("/compliance", "VOR check logged.")


@app.post("/vor/{check_id}/delete")
async def vor_delete(request: Request, check_id: int):
    db.execute("DELETE FROM vor_checks WHERE id = ?", (check_id,))
    return back("/compliance", "VOR check removed.")


# ---------------------------------------------------------------- equipment


@app.get("/equipment", response_class=HTMLResponse)
def equipment_page(request: Request):
    craft = db.aircraft()
    rows = []
    for row in db.query(
        "SELECT * FROM equipment ORDER BY removed_on != '', category, name, id"
    ):
        data = dict(row)
        if row["tbo_hours"] and row["installed_tach"] is not None:
            used = float(craft["tach"] or 0) - float(row["installed_tach"])
            data["used_hours"] = round(used, 1)
            data["remaining"] = round(float(row["tbo_hours"]) - used, 1)
            data["percent"] = min(100.0, round(used / float(row["tbo_hours"]) * 100, 1))
        else:
            data["used_hours"] = None
            data["remaining"] = None
            data["percent"] = None
        rows.append(data)
    return render(
        request,
        "equipment.html",
        title="Equipment",
        rows=rows,
        categories=db.EQUIPMENT_CATEGORIES,
    )


@app.post("/equipment/add")
async def equipment_add(request: Request):
    form = await get_form(request)
    name = str(form.get("name", "")).strip()[:120]
    if not name:
        return back("/equipment", err="Give the component a name.")
    db.execute(
        "INSERT INTO equipment (name, category, make, model, part_number, serial,"
        " installed_on, installed_tach, tbo_hours, life_date, stc, notes)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            name,
            str(form.get("category", "Other"))[:40],
            str(form.get("make", "")).strip()[:60],
            str(form.get("model", "")).strip()[:60],
            str(form.get("part_number", "")).strip()[:60],
            str(form.get("serial", "")).strip()[:60],
            to_date(form.get("installed_on"), ""),
            opt_float(form.get("installed_tach")),
            max(0.0, to_float(form.get("tbo_hours"))),
            to_date(form.get("life_date"), ""),
            str(form.get("stc", "")).strip()[:80],
            str(form.get("notes", "")).strip(),
        ),
    )
    return back("/equipment", f"Added {name}.")


@app.post("/equipment/{equipment_id}/update")
async def equipment_update(request: Request, equipment_id: int):
    form = await get_form(request)
    db.execute(
        "UPDATE equipment SET name = ?, category = ?, make = ?, model = ?,"
        " part_number = ?, serial = ?, installed_on = ?, installed_tach = ?,"
        " tbo_hours = ?, life_date = ?, stc = ?, removed_on = ?, notes = ?"
        " WHERE id = ?",
        (
            str(form.get("name", "")).strip()[:120] or "Component",
            str(form.get("category", "Other"))[:40],
            str(form.get("make", "")).strip()[:60],
            str(form.get("model", "")).strip()[:60],
            str(form.get("part_number", "")).strip()[:60],
            str(form.get("serial", "")).strip()[:60],
            to_date(form.get("installed_on"), ""),
            opt_float(form.get("installed_tach")),
            max(0.0, to_float(form.get("tbo_hours"))),
            to_date(form.get("life_date"), ""),
            str(form.get("stc", "")).strip()[:80],
            to_date(form.get("removed_on"), ""),
            str(form.get("notes", "")).strip(),
            equipment_id,
        ),
    )
    return back("/equipment", "Component saved.")


@app.post("/equipment/{equipment_id}/delete")
async def equipment_delete(request: Request, equipment_id: int):
    db.execute("DELETE FROM equipment WHERE id = ?", (equipment_id,))
    return back("/equipment", "Component removed.")


# ------------------------------------------------------------------ flights


@app.get("/flights", response_class=HTMLResponse)
def flights_page(request: Request):
    rows = db.query(
        "SELECT f.*, p.name AS pilot FROM flights f"
        " LEFT JOIN people p ON p.id = f.person_id"
        " ORDER BY f.flew_on DESC, f.id DESC LIMIT 200"
    )
    craft = db.aircraft()
    year_start = (date.today() - timedelta(days=365)).isoformat()
    return render(
        request,
        "flights.html",
        title="Flights",
        rows=rows,
        people=people_list(),
        craft=craft,
        total_hours=round(
            float(db.scalar("SELECT SUM(hours) FROM flights", (), 0.0) or 0), 1
        ),
        year_hours=round(db.hours_between(year_start, date.today().isoformat()), 1),
        total_landings=int(db.scalar("SELECT SUM(landings) FROM flights", (), 0) or 0),
        chart=charts.bar_chart(flight_month_series(8), unit="hours"),
    )


@app.post("/flights/add")
async def flights_add(request: Request):
    form = await get_form(request)
    craft = db.aircraft()
    tach_start = opt_float(form.get("tach_start"))
    tach_end = opt_float(form.get("tach_end"))
    hobbs_start = opt_float(form.get("hobbs_start"))
    hobbs_end = opt_float(form.get("hobbs_end"))

    hours = to_float(form.get("hours"), 0.0)
    if not hours and tach_start is not None and tach_end is not None:
        hours = max(0.0, tach_end - tach_start)
    if not hours and hobbs_start is not None and hobbs_end is not None:
        hours = max(0.0, hobbs_end - hobbs_start)
    hours = round(max(0.0, hours), 2)

    flew_on = to_date(form.get("flew_on"))
    flight_id = db.execute(
        "INSERT INTO flights (flew_on, person_id, route, purpose, tach_start,"
        " tach_end, hobbs_start, hobbs_end, hours, landings, fuel_gal, oil_qt,"
        " notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            flew_on,
            opt_id(form.get("person_id")),
            str(form.get("route", "")).strip()[:120],
            str(form.get("purpose", "")).strip()[:120],
            tach_start,
            tach_end,
            hobbs_start,
            hobbs_end,
            hours,
            to_int(form.get("landings"), 0),
            max(0.0, to_float(form.get("fuel_gal"))),
            max(0.0, to_float(form.get("oil_qt"))),
            str(form.get("notes", "")).strip(),
            db.now(),
        ),
    )

    # Roll the aircraft's counters forward.
    new_tach = max(float(craft["tach"] or 0), tach_end or 0)
    new_hobbs = max(float(craft["hobbs"] or 0), hobbs_end or 0)
    db.execute(
        "UPDATE aircraft SET tach = ?, hobbs = ?, total_time = ?, engine_smoh = ?,"
        " prop_since = ? WHERE id = 1",
        (
            new_tach,
            new_hobbs,
            round(float(craft["total_time"] or 0) + hours, 2),
            round(float(craft["engine_smoh"] or 0) + hours, 2),
            round(float(craft["prop_since"] or 0) + hours, 2),
        ),
    )

    # Put money aside for the engine, prop and the rest.
    for reserve in db.query("SELECT * FROM reserves WHERE active = 1 AND rate_cents > 0"):
        amount = int(round(float(reserve["rate_cents"]) * hours))
        if amount:
            db.execute(
                "INSERT INTO reserve_txns (reserve_id, happened_on, amount_cents,"
                " kind, flight_id, note) VALUES (?, ?, ?, 'accrual', ?, ?)",
                (reserve["id"], flew_on, amount, flight_id, f"{hours:g} h"),
            )

    fuel_cost = to_cents(form.get("fuel_cost"))
    if fuel_cost:
        db.execute(
            "INSERT INTO costs (spent_on, vendor, category, description,"
            " amount_cents, kind, flight_id, person_id)"
            " VALUES (?, ?, 'Fuel', ?, ?, 'variable', ?, ?)",
            (
                flew_on,
                str(form.get("fuel_vendor", "")).strip()[:120],
                f"{to_float(form.get('fuel_gal')):g} gal",
                fuel_cost,
                flight_id,
                opt_id(form.get("person_id")),
            ),
        )
    return back("/flights", f"Logged {hours:g} hours.")


@app.post("/flights/{flight_id}/delete")
async def flights_delete(request: Request, flight_id: int):
    row = db.one("SELECT * FROM flights WHERE id = ?", (flight_id,))
    if row is None:
        return back("/flights", err="That flight no longer exists.")
    craft = db.aircraft()
    hours = float(row["hours"] or 0)
    db.execute(
        "UPDATE aircraft SET total_time = ?, engine_smoh = ?, prop_since = ?"
        " WHERE id = 1",
        (
            max(0.0, round(float(craft["total_time"] or 0) - hours, 2)),
            max(0.0, round(float(craft["engine_smoh"] or 0) - hours, 2)),
            max(0.0, round(float(craft["prop_since"] or 0) - hours, 2)),
        ),
    )
    db.execute("DELETE FROM reserve_txns WHERE flight_id = ?", (flight_id,))
    db.execute("DELETE FROM flights WHERE id = ?", (flight_id,))
    return back("/flights", "Flight removed and the counters rolled back.")


# -------------------------------------------------------------------- costs


@app.get("/costs", response_class=HTMLResponse)
def costs_page(request: Request):
    params = request.query_params
    category = params.get("category", "")
    kind = params.get("kind", "")
    year = params.get("year", "")[:4]
    where = []
    args: list = []
    if category:
        where.append("c.category = ?")
        args.append(category)
    if kind in ("fixed", "variable"):
        where.append("c.kind = ?")
        args.append(kind)
    if year:
        where.append("substr(c.spent_on, 1, 4) = ?")
        args.append(year)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    rows = db.query(
        "SELECT c.*, p.name AS person_name, a.stored_name AS receipt_name"
        " FROM costs c LEFT JOIN people p ON p.id = c.person_id"
        " LEFT JOIN attachments a ON a.id = c.attachment_id"
        f"{clause} ORDER BY c.spent_on DESC, c.id DESC LIMIT 400",
        args,
    )
    summary = db.cost_summary(12)
    craft = db.aircraft()
    planned = to_float(params.get("planned"), float(craft["planned_hours"] or 100))
    by_category = db.query(
        "SELECT category, SUM(amount_cents) AS cents FROM costs"
        " GROUP BY category ORDER BY cents DESC"
    )
    shares = []
    total_all = int(db.scalar("SELECT SUM(amount_cents) FROM costs", (), 0) or 0)
    for person in db.query("SELECT * FROM people WHERE share > 0 ORDER BY name"):
        shares.append(
            {
                "name": person["name"],
                "share": float(person["share"]),
                "owed_cents": int(round(total_all * float(person["share"]) / 100)),
                "paid_cents": int(
                    db.scalar(
                        "SELECT SUM(amount_cents) FROM costs WHERE person_id = ?",
                        (person["id"],),
                        0,
                    )
                    or 0
                ),
            }
        )
    for share in shares:
        share["balance_cents"] = share["paid_cents"] - share["owed_cents"]

    return render(
        request,
        "costs.html",
        title="Costs",
        rows=rows,
        summary=summary,
        projection=db.hourly_projection(planned),
        planned=planned,
        categories=db.COST_CATEGORIES,
        people=people_list(),
        reserves=db.reserve_balances(),
        shares=shares,
        total_all=total_all,
        shown=sum(int(r["amount_cents"] or 0) for r in rows),
        filters={"category": category, "kind": kind, "year": year},
        years=[
            r["y"]
            for r in db.query(
                "SELECT DISTINCT substr(spent_on, 1, 4) AS y FROM costs ORDER BY y DESC"
            )
        ],
        category_chart=charts.hbar_chart(
            [(r["category"], float(r["cents"] or 0) / 100) for r in by_category],
            unit="dollars",
        ),
        month_chart=charts.bar_chart(cost_month_series(8), unit="dollars"),
    )


def cost_month_series(count: int) -> list[tuple[str, float]]:
    today = date.today().replace(day=1)
    months = []
    cursor = today
    for _ in range(count):
        months.append(cursor)
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    buckets = {m.strftime("%Y-%m"): 0.0 for m in reversed(months)}
    for row in db.query(
        "SELECT substr(spent_on, 1, 7) AS ym, SUM(amount_cents) AS c FROM costs"
        " GROUP BY ym"
    ):
        if row["ym"] in buckets:
            buckets[row["ym"]] = round(float(row["c"] or 0) / 100, 2)
    return [
        (datetime.strptime(k, "%Y-%m").strftime("%b"), v) for k, v in buckets.items()
    ]


@app.post("/costs/add")
async def costs_add(request: Request):
    form = await get_form(request)
    cents = to_cents(form.get("amount"))
    if not cents:
        return back("/costs", err="Enter an amount.")
    category = str(form.get("category", "Other"))
    if category not in db.COST_CATEGORIES:
        category = "Other"
    kind = str(form.get("kind", ""))
    if kind not in ("fixed", "variable"):
        kind = "fixed" if category in db.FIXED_BY_DEFAULT else "variable"
    attachment_id = None
    upload = form.get("receipt")
    if upload is not None and getattr(upload, "filename", ""):
        data = await upload.read()
        try:
            attachment_id = files.save_upload(
                data,
                upload.filename,
                getattr(upload, "content_type", ""),
                doc_type="Receipt",
            )
        except files.UploadError as exc:
            return back("/costs", err=str(exc))
    db.execute(
        "INSERT INTO costs (spent_on, vendor, category, description, amount_cents,"
        " kind, person_id, attachment_id, deductible, notes)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            to_date(form.get("spent_on")),
            str(form.get("vendor", "")).strip()[:120],
            category,
            str(form.get("description", "")).strip()[:300],
            cents,
            kind,
            opt_id(form.get("person_id")),
            attachment_id,
            checked(form.get("deductible")),
            str(form.get("notes", "")).strip(),
        ),
    )
    return back("/costs", "Cost added.")


@app.post("/costs/{cost_id}/delete")
async def costs_delete(request: Request, cost_id: int):
    db.execute("DELETE FROM costs WHERE id = ?", (cost_id,))
    return back("/costs", "Cost removed.")


@app.post("/reserves/add")
async def reserves_add(request: Request):
    form = await get_form(request)
    name = str(form.get("name", "")).strip()[:80]
    if not name:
        return back("/costs", err="Name the reserve.")
    if db.one("SELECT id FROM reserves WHERE name = ?", (name,)):
        return back("/costs", err=f"{name} already exists.")
    db.execute(
        "INSERT INTO reserves (name, rate_cents, target_cents, notes)"
        " VALUES (?, ?, ?, ?)",
        (
            name,
            to_cents(form.get("rate")),
            to_cents(form.get("target")),
            str(form.get("notes", "")).strip(),
        ),
    )
    return back("/costs", f"Added the {name} reserve.")


@app.post("/reserves/{reserve_id}/update")
async def reserves_update(request: Request, reserve_id: int):
    form = await get_form(request)
    db.execute(
        "UPDATE reserves SET rate_cents = ?, target_cents = ?, active = ?, notes = ?"
        " WHERE id = ?",
        (
            to_cents(form.get("rate")),
            to_cents(form.get("target")),
            checked(form.get("active")),
            str(form.get("notes", "")).strip(),
            reserve_id,
        ),
    )
    return back("/costs", "Reserve saved.")


@app.post("/reserves/{reserve_id}/txn")
async def reserves_txn(request: Request, reserve_id: int):
    form = await get_form(request)
    cents = to_cents(form.get("amount"))
    if not cents:
        return back("/costs", err="Enter an amount.")
    kind = str(form.get("kind", "deposit"))
    if kind not in ("deposit", "withdrawal", "accrual"):
        kind = "deposit"
    if kind == "withdrawal":
        cents = -abs(cents)
    db.execute(
        "INSERT INTO reserve_txns (reserve_id, happened_on, amount_cents, kind, note)"
        " VALUES (?, ?, ?, ?, ?)",
        (
            reserve_id,
            to_date(form.get("happened_on")),
            cents,
            kind,
            str(form.get("note", "")).strip()[:200],
        ),
    )
    return back("/costs", "Reserve updated.")


@app.post("/reserves/{reserve_id}/delete")
async def reserves_delete(request: Request, reserve_id: int):
    db.execute("DELETE FROM reserves WHERE id = ?", (reserve_id,))
    return back("/costs", "Reserve removed.")


# ------------------------------------------------------------------ logbook


@app.get("/logbook", response_class=HTMLResponse)
def logbook_page(request: Request):
    q = request.query_params.get("q", "").strip()
    where = []
    args: list = []
    if q:
        where.append("(e.summary LIKE ? OR e.work LIKE ? OR e.performed_by LIKE ?)")
        args += [f"%{q}%"] * 3
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    rows = db.query(
        "SELECT e.*, i.name AS item_name FROM entries e"
        " LEFT JOIN items i ON i.id = e.item_id"
        f"{clause} ORDER BY e.entry_date DESC, e.id DESC LIMIT 300",
        args,
    )
    return render(
        request,
        "logbook.html",
        title="Maintenance logbook",
        rows=rows,
        q=q,
        items=db.query("SELECT id, name FROM items ORDER BY name"),
        kinds=["Inspection", "Maintenance", "Repair", "Compliance", "Overhaul", "Other"],
        total=int(db.scalar("SELECT COUNT(*) FROM entries") or 0),
    )


@app.post("/logbook/add")
async def logbook_add(request: Request):
    form = await get_form(request)
    summary = str(form.get("summary", "")).strip()[:200]
    if not summary:
        return back("/logbook", err="Summarise the work in a few words.")
    craft = db.aircraft()
    entry_id = db.execute(
        "INSERT INTO entries (entry_date, kind, summary, work, performed_by,"
        " certificate, tach, hobbs, total_time, item_id, cost_cents, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            to_date(form.get("entry_date")),
            str(form.get("kind", "Maintenance"))[:40],
            summary,
            str(form.get("work", "")).strip(),
            str(form.get("performed_by", "")).strip()[:120],
            str(form.get("certificate", "")).strip()[:60],
            opt_float(form.get("tach")) if str(form.get("tach", "")).strip() else craft["tach"],
            opt_float(form.get("hobbs")) if str(form.get("hobbs", "")).strip() else craft["hobbs"],
            opt_float(form.get("total_time")) if str(form.get("total_time", "")).strip() else craft["total_time"],
            opt_id(form.get("item_id")),
            to_cents(form.get("cost")),
            db.now(),
        ),
    )
    for upload in form.getlist("attachments"):
        if not getattr(upload, "filename", ""):
            continue
        data = await upload.read()
        try:
            files.save_upload(
                data,
                upload.filename,
                getattr(upload, "content_type", ""),
                entry_id=entry_id,
                links_table="entries",
                links_id=entry_id,
            )
        except files.UploadError:
            continue
    item_id = opt_id(form.get("item_id"))
    if item_id and checked(form.get("completes")):
        item = db.one("SELECT * FROM items WHERE id = ?", (item_id,))
        if item is not None:
            db.execute(
                "UPDATE items SET last_done_date = ?, last_done_hours = ?,"
                " due_date = '', due_hours = NULL WHERE id = ?",
                (
                    to_date(form.get("entry_date")),
                    db.current_hours(item["timer"], craft),
                    item_id,
                ),
            )
    cents = to_cents(form.get("cost"))
    if cents:
        db.execute(
            "INSERT INTO costs (spent_on, vendor, category, description,"
            " amount_cents, kind, entry_id) VALUES (?, ?, 'Maintenance', ?, ?, 'variable', ?)",
            (
                to_date(form.get("entry_date")),
                str(form.get("performed_by", "")).strip()[:120],
                summary,
                cents,
                entry_id,
            ),
        )
    return back("/logbook", "Logbook entry saved.")


@app.post("/logbook/{entry_id}/delete")
async def logbook_delete(request: Request, entry_id: int):
    for row in db.query(
        "SELECT id FROM attachments WHERE links_table = 'entries' AND links_id = ?",
        (entry_id,),
    ):
        files.delete_attachment(row["id"])
    db.execute("DELETE FROM entries WHERE id = ?", (entry_id,))
    return back("/logbook", "Entry deleted.")


# ---------------------------------------------------------------- documents


@app.get("/documents", response_class=HTMLResponse)
def documents_page(request: Request):
    q = request.query_params.get("q", "").strip()
    where = []
    args: list = []
    if q:
        where.append("(original_name LIKE ? OR caption LIKE ? OR doc_type LIKE ?)")
        args += [f"%{q}%"] * 3
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    rows = db.query(
        f"SELECT * FROM attachments{clause} ORDER BY id DESC", args
    )
    return render(
        request,
        "documents.html",
        title="Documents",
        rows=rows,
        q=q,
        human_size=files.human_size,
        usage=files.disk_usage(),
        doc_types=[
            "Airworthiness certificate",
            "Registration",
            "Weight and balance",
            "POH or flight manual",
            "Insurance",
            "Form 337",
            "Logbook scan",
            "Invoice",
            "Receipt",
            "Service bulletin",
            "Photo",
            "Other",
        ],
    )


@app.post("/documents/upload")
async def documents_upload(request: Request):
    form = await get_form(request)
    doc_type = str(form.get("doc_type", "")).strip()[:60]
    caption = str(form.get("caption", "")).strip()[:300]
    saved = 0
    problem = ""
    for upload in form.getlist("documents"):
        if not getattr(upload, "filename", ""):
            continue
        data = await upload.read()
        try:
            files.save_upload(
                data,
                upload.filename,
                getattr(upload, "content_type", ""),
                caption=caption,
                doc_type=doc_type,
            )
            saved += 1
        except files.UploadError as exc:
            problem = str(exc)
    if saved:
        return back("/documents", f"Uploaded {saved} file(s).")
    return back("/documents", err=problem or "No files were uploaded.")


@app.post("/documents/{doc_id}/save")
async def documents_save(request: Request, doc_id: int):
    form = await get_form(request)
    db.execute(
        "UPDATE attachments SET caption = ?, doc_type = ? WHERE id = ?",
        (
            str(form.get("caption", "")).strip()[:300],
            str(form.get("doc_type", "")).strip()[:60],
            doc_id,
        ),
    )
    return back("/documents", "Document updated.")


@app.post("/documents/{doc_id}/delete")
async def documents_delete(request: Request, doc_id: int):
    files.delete_attachment(doc_id)
    return back("/documents", "Document deleted.")


@app.get("/files/{stored_name}")
def serve_file(stored_name: str, download: int = 0):
    row = db.one(
        "SELECT * FROM attachments WHERE stored_name = ?",
        (os.path.basename(stored_name),),
    )
    if row is None:
        return PlainTextResponse("Not found", status_code=404)
    try:
        path = files.stored_path(row["stored_name"])
    except files.UploadError:
        return PlainTextResponse("Not found", status_code=404)
    if not os.path.exists(path):
        return PlainTextResponse("Not found", status_code=404)
    inline = row["mime"] in files.PHOTO_TYPES or row["mime"] == "application/pdf"
    disposition = "inline" if inline and not download else "attachment"
    return FileResponse(
        path,
        media_type=row["mime"] or "application/octet-stream",
        headers={
            "Content-Disposition": f'{disposition}; filename="{quote(row["original_name"])}"',
            "Cache-Control": "private, max-age=86400",
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.get("/thumbs/{stored_name}")
def serve_thumb(stored_name: str):
    safe = os.path.basename(stored_name)
    if db.one("SELECT id FROM attachments WHERE stored_name = ?", (safe,)) is None:
        return PlainTextResponse("Not found", status_code=404)
    path = files.thumb_path(safe)
    if not os.path.exists(path):
        try:
            files.make_thumb(files.stored_path(safe), safe)
        except Exception:
            return PlainTextResponse("Not found", status_code=404)
    return FileResponse(
        path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=604800"}
    )


# ----------------------------------------------------------------- settings


@app.get("/settings", response_class=HTMLResponse)
def settings_page(request: Request):
    return render(
        request,
        "settings.html",
        title="Settings",
        people=people_list(),
        roles=db.PERSON_ROLES,
        usage=files.disk_usage(),
        counts={
            "items": int(db.scalar("SELECT COUNT(*) FROM items") or 0),
            "entries": int(db.scalar("SELECT COUNT(*) FROM entries") or 0),
            "squawks": int(db.scalar("SELECT COUNT(*) FROM squawks") or 0),
            "directives": int(db.scalar("SELECT COUNT(*) FROM directives") or 0),
            "equipment": int(db.scalar("SELECT COUNT(*) FROM equipment") or 0),
            "flights": int(db.scalar("SELECT COUNT(*) FROM flights") or 0),
            "costs": int(db.scalar("SELECT COUNT(*) FROM costs") or 0),
            "documents": int(db.scalar("SELECT COUNT(*) FROM attachments") or 0),
        },
    )


@app.post("/people/add")
async def people_add(request: Request):
    form = await get_form(request)
    name = str(form.get("name", "")).strip()[:80]
    if not name:
        return back("/settings", err="Enter a name.")
    if db.one("SELECT id FROM people WHERE name = ?", (name,)):
        return back("/settings", err=f"{name} is already listed.")
    db.execute(
        "INSERT INTO people (name, role, email, phone, share, certificate, notes)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            name,
            str(form.get("role", "Pilot"))[:40],
            str(form.get("email", "")).strip()[:160],
            str(form.get("phone", "")).strip()[:40],
            max(0.0, min(100.0, to_float(form.get("share")))),
            str(form.get("certificate", "")).strip()[:60],
            str(form.get("notes", "")).strip(),
        ),
    )
    return back("/settings", f"Added {name}.")


@app.post("/people/{person_id}/update")
async def people_update(request: Request, person_id: int):
    form = await get_form(request)
    db.execute(
        "UPDATE people SET role = ?, email = ?, phone = ?, share = ?,"
        " certificate = ?, notes = ? WHERE id = ?",
        (
            str(form.get("role", "Pilot"))[:40],
            str(form.get("email", "")).strip()[:160],
            str(form.get("phone", "")).strip()[:40],
            max(0.0, min(100.0, to_float(form.get("share")))),
            str(form.get("certificate", "")).strip()[:60],
            str(form.get("notes", "")).strip(),
            person_id,
        ),
    )
    return back("/settings", "Person saved.")


@app.post("/people/{person_id}/delete")
async def people_delete(request: Request, person_id: int):
    db.execute("DELETE FROM people WHERE id = ?", (person_id,))
    return back("/settings", "Person removed.")


@app.post("/settings/restore")
async def settings_restore(request: Request):
    form = await get_form(request)
    upload = form.get("backup")
    if upload is None or not getattr(upload, "filename", ""):
        return back("/settings", err="Choose a backup zip first.")
    data = await upload.read()
    try:
        message = exports.restore_zip(data)
    except Exception as exc:
        return back("/settings", err=f"Restore failed: {exc}")
    return back("/settings", message)


@app.post("/settings/import/flights")
async def import_flights(request: Request):
    form = await get_form(request)
    upload = form.get("file")
    if upload is None or not getattr(upload, "filename", ""):
        return back("/settings", err="Choose a CSV file first.")
    data = await upload.read()
    try:
        message = exports.import_flights_csv(data)
    except Exception as exc:
        return back("/settings", err=f"Import failed: {exc}")
    return back("/settings", message)


# ------------------------------------------------------------------ exports


def _attachment(content, filename: str, media_type: str) -> Response:
    body = content.encode("utf-8") if isinstance(content, str) else content
    return Response(
        body,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


def _stamp() -> str:
    return date.today().isoformat()


@app.get("/export/flights.csv")
def export_flights():
    return _attachment(exports.flights_csv(), f"owner-log-flights-{_stamp()}.csv", "text/csv")


@app.get("/export/costs.csv")
def export_costs():
    return _attachment(exports.costs_csv(), f"owner-log-costs-{_stamp()}.csv", "text/csv")


@app.get("/export/squawks.csv")
def export_squawks():
    return _attachment(exports.squawks_csv(), f"owner-log-squawks-{_stamp()}.csv", "text/csv")


@app.get("/export/logbook.csv")
def export_logbook():
    return _attachment(exports.entries_csv(), f"owner-log-logbook-{_stamp()}.csv", "text/csv")


@app.get("/export/directives.csv")
def export_directives():
    return _attachment(
        exports.directives_csv(), f"owner-log-directives-{_stamp()}.csv", "text/csv"
    )


@app.get("/export/owner-log.json")
def export_json():
    return _attachment(exports.full_json(), f"owner-log-{_stamp()}.json", "application/json")


@app.get("/export/backup.zip")
def export_backup():
    return _attachment(exports.backup_zip(), f"owner-log-backup-{_stamp()}.zip", "application/zip")


@app.get("/export/annual.pdf")
def export_annual():
    pdf = report.annual_packet_pdf()
    return _attachment(pdf, f"owner-log-annual-packet-{_stamp()}.pdf", "application/pdf")


@app.get("/export/compliance.pdf")
def export_compliance_pdf():
    pdf = report.compliance_pdf()
    return _attachment(pdf, f"owner-log-compliance-{_stamp()}.pdf", "application/pdf")


@app.get("/export/costs.pdf")
def export_costs_pdf():
    craft = db.aircraft()
    pdf = report.cost_pdf(float(craft["planned_hours"] or 100))
    return _attachment(pdf, f"owner-log-costs-{_stamp()}.pdf", "application/pdf")
