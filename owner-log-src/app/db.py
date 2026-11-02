"""SQLite storage for Owner Log.

One aircraft per instance. Everything an owner has to prove or pay for:
inspections, squawks, directives, equipment, flights, costs and reserves.
"""
from __future__ import annotations

import os
import sqlite3
import threading
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

DATA_DIR = os.environ.get("OWL_DATA_DIR", "/data")
DB_PATH = os.path.join(DATA_DIR, "owner-log.db")

_local = threading.local()
_generation = 0

SCHEMA_VERSION = 1

TIMERS = ["tach", "hobbs", "tt"]
TIMER_LABELS = {"tach": "Tach", "hobbs": "Hobbs", "tt": "Airframe total time"}

ITEM_CATEGORIES = ["Inspection", "Maintenance", "Compliance", "Admin"]
SQUAWK_SEVERITY = ["low", "medium", "high", "critical"]
SQUAWK_STATUS = ["open", "in_progress", "deferred", "resolved"]
DIRECTIVE_KINDS = ["AD", "SB", "SD", "Notice"]
DIRECTIVE_STATUS = ["open", "complied", "recurring", "not_applicable"]
EQUIPMENT_CATEGORIES = [
    "Airframe",
    "Engine",
    "Propeller",
    "Avionics",
    "Instrument",
    "Electrical",
    "Interior",
    "Other",
]
COST_CATEGORIES = [
    "Fuel",
    "Oil",
    "Maintenance",
    "Parts",
    "Annual",
    "Avionics",
    "Hangar",
    "Insurance",
    "Registration",
    "Subscriptions",
    "Training",
    "Tie-down",
    "Loan",
    "Other",
]
FIXED_BY_DEFAULT = {"Hangar", "Insurance", "Registration", "Subscriptions", "Loan", "Tie-down"}
PERSON_ROLES = ["Owner", "Co-owner", "Pilot", "Mechanic", "CFI", "Other"]

# name, category, interval_hours, interval_months, timer, airworthiness, reference
DEFAULT_ITEMS = [
    ("Annual inspection", "Inspection", 0, 12, "tach", 1, "14 CFR 91.409(a)"),
    ("100-hour inspection", "Inspection", 100, 0, "tach", 0, "14 CFR 91.409(b)"),
    ("Transponder test", "Compliance", 0, 24, "tach", 1, "14 CFR 91.413"),
    ("Static system and altimeter", "Compliance", 0, 24, "tach", 1, "14 CFR 91.411"),
    ("ELT inspection", "Compliance", 0, 12, "tach", 1, "14 CFR 91.207(d)"),
    ("ELT battery", "Compliance", 0, 12, "tach", 1, "14 CFR 91.207(c)"),
    ("Oil and filter change", "Maintenance", 50, 6, "tach", 0, "Engine manufacturer"),
    ("Aircraft registration", "Admin", 0, 84, "tach", 1, "14 CFR 47.40"),
    ("Insurance renewal", "Admin", 0, 12, "tach", 0, ""),
]


def connect() -> sqlite3.Connection:
    """One connection per thread; reopened when the database file is replaced."""
    conn = getattr(_local, "conn", None)
    if conn is not None and getattr(_local, "generation", -1) != _generation:
        try:
            conn.close()
        except sqlite3.Error:
            pass
        conn = None
        _local.conn = None
    if conn is None:
        os.makedirs(DATA_DIR, exist_ok=True)
        conn = sqlite3.connect(DB_PATH, timeout=30.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA busy_timeout = 30000")
        _local.conn = conn
        _local.generation = _generation
    return conn


def close() -> None:
    conn = getattr(_local, "conn", None)
    if conn is not None:
        conn.close()
        _local.conn = None


def invalidate() -> None:
    global _generation
    _generation += 1
    close()


def query(sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
    return connect().execute(sql, tuple(params)).fetchall()


def one(sql: str, params: Iterable[Any] = ()) -> sqlite3.Row | None:
    return connect().execute(sql, tuple(params)).fetchone()


def scalar(sql: str, params: Iterable[Any] = (), default: Any = 0) -> Any:
    row = one(sql, params)
    if row is None or row[0] is None:
        return default
    return row[0]


def execute(sql: str, params: Iterable[Any] = ()) -> int:
    conn = connect()
    cur = conn.execute(sql, tuple(params))
    conn.commit()
    return cur.lastrowid or 0


def executemany(sql: str, rows: Iterable[Iterable[Any]]) -> None:
    conn = connect()
    conn.executemany(sql, [tuple(r) for r in rows])
    conn.commit()


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def now() -> str:
    return utcnow().isoformat(timespec="seconds")


DDL = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aircraft (
    id             INTEGER PRIMARY KEY CHECK (id = 1),
    tail           TEXT NOT NULL DEFAULT '',
    make           TEXT NOT NULL DEFAULT '',
    model          TEXT NOT NULL DEFAULT '',
    serial         TEXT NOT NULL DEFAULT '',
    year           TEXT NOT NULL DEFAULT '',
    category       TEXT NOT NULL DEFAULT 'Experimental',
    home_base      TEXT NOT NULL DEFAULT '',
    engine_make    TEXT NOT NULL DEFAULT '',
    engine_model   TEXT NOT NULL DEFAULT '',
    engine_serial  TEXT NOT NULL DEFAULT '',
    engine_tbo     REAL NOT NULL DEFAULT 0,
    prop_make      TEXT NOT NULL DEFAULT '',
    prop_model     TEXT NOT NULL DEFAULT '',
    prop_serial    TEXT NOT NULL DEFAULT '',
    prop_tbo       REAL NOT NULL DEFAULT 0,
    tach           REAL NOT NULL DEFAULT 0,
    hobbs          REAL NOT NULL DEFAULT 0,
    total_time     REAL NOT NULL DEFAULT 0,
    engine_smoh    REAL NOT NULL DEFAULT 0,
    prop_since     REAL NOT NULL DEFAULT 0,
    empty_weight   REAL NOT NULL DEFAULT 0,
    empty_arm      REAL NOT NULL DEFAULT 0,
    max_gross      REAL NOT NULL DEFAULT 0,
    fuel_capacity  REAL NOT NULL DEFAULT 0,
    fuel_burn      REAL NOT NULL DEFAULT 0,
    fuel_price     REAL NOT NULL DEFAULT 0,
    planned_hours  REAL NOT NULL DEFAULT 100,
    notes          TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'Maintenance',
    interval_hours  REAL NOT NULL DEFAULT 0,
    interval_months REAL NOT NULL DEFAULT 0,
    timer           TEXT NOT NULL DEFAULT 'tach',
    airworthiness   INTEGER NOT NULL DEFAULT 0,
    last_done_date  TEXT NOT NULL DEFAULT '',
    last_done_hours REAL,
    due_date        TEXT NOT NULL DEFAULT '',
    due_hours       REAL,
    active          INTEGER NOT NULL DEFAULT 1,
    reference       TEXT NOT NULL DEFAULT '',
    notes           TEXT NOT NULL DEFAULT '',
    sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS people (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL UNIQUE,
    role     TEXT NOT NULL DEFAULT 'Pilot',
    email    TEXT NOT NULL DEFAULT '',
    phone    TEXT NOT NULL DEFAULT '',
    share    REAL NOT NULL DEFAULT 0,
    certificate TEXT NOT NULL DEFAULT '',
    notes    TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_date   TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'Maintenance',
    summary      TEXT NOT NULL,
    work         TEXT NOT NULL DEFAULT '',
    performed_by TEXT NOT NULL DEFAULT '',
    certificate  TEXT NOT NULL DEFAULT '',
    tach         REAL,
    hobbs        REAL,
    total_time   REAL,
    item_id      INTEGER REFERENCES items(id) ON DELETE SET NULL,
    cost_cents   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(entry_date DESC);

CREATE TABLE IF NOT EXISTS squawks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    reported_on TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    severity    TEXT NOT NULL DEFAULT 'medium',
    status      TEXT NOT NULL DEFAULT 'open',
    grounding   INTEGER NOT NULL DEFAULT 0,
    person_id   INTEGER REFERENCES people(id) ON DELETE SET NULL,
    tach        REAL,
    resolved_on TEXT NOT NULL DEFAULT '',
    entry_id    INTEGER REFERENCES entries(id) ON DELETE SET NULL,
    resolution  TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_squawks_status ON squawks(status);

CREATE TABLE IF NOT EXISTS directives (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    kind            TEXT NOT NULL DEFAULT 'AD',
    number          TEXT NOT NULL DEFAULT '',
    title           TEXT NOT NULL DEFAULT '',
    issued_on       TEXT NOT NULL DEFAULT '',
    applicability   TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'open',
    recurring       INTEGER NOT NULL DEFAULT 0,
    interval_hours  REAL NOT NULL DEFAULT 0,
    interval_months REAL NOT NULL DEFAULT 0,
    complied_on     TEXT NOT NULL DEFAULT '',
    complied_hours  REAL,
    method          TEXT NOT NULL DEFAULT '',
    entry_id        INTEGER REFERENCES entries(id) ON DELETE SET NULL,
    url             TEXT NOT NULL DEFAULT '',
    notes           TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_directives_kind ON directives(kind);

CREATE TABLE IF NOT EXISTS equipment (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    category       TEXT NOT NULL DEFAULT 'Other',
    make           TEXT NOT NULL DEFAULT '',
    model          TEXT NOT NULL DEFAULT '',
    part_number    TEXT NOT NULL DEFAULT '',
    serial         TEXT NOT NULL DEFAULT '',
    installed_on   TEXT NOT NULL DEFAULT '',
    installed_tach REAL,
    tbo_hours      REAL NOT NULL DEFAULT 0,
    life_date      TEXT NOT NULL DEFAULT '',
    stc            TEXT NOT NULL DEFAULT '',
    removed_on     TEXT NOT NULL DEFAULT '',
    notes          TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS vor_checks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    checked_on  TEXT NOT NULL,
    place       TEXT NOT NULL DEFAULT '',
    method      TEXT NOT NULL DEFAULT 'VOT',
    bearing     TEXT NOT NULL DEFAULT '',
    error       TEXT NOT NULL DEFAULT '',
    signed_by   TEXT NOT NULL DEFAULT '',
    notes       TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS flights (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    flew_on     TEXT NOT NULL,
    person_id   INTEGER REFERENCES people(id) ON DELETE SET NULL,
    route       TEXT NOT NULL DEFAULT '',
    purpose     TEXT NOT NULL DEFAULT '',
    tach_start  REAL,
    tach_end    REAL,
    hobbs_start REAL,
    hobbs_end   REAL,
    hours       REAL NOT NULL DEFAULT 0,
    landings    INTEGER NOT NULL DEFAULT 0,
    fuel_gal    REAL NOT NULL DEFAULT 0,
    oil_qt      REAL NOT NULL DEFAULT 0,
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flights_date ON flights(flew_on DESC);

CREATE TABLE IF NOT EXISTS costs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    spent_on      TEXT NOT NULL,
    vendor        TEXT NOT NULL DEFAULT '',
    category      TEXT NOT NULL DEFAULT 'Other',
    description   TEXT NOT NULL DEFAULT '',
    amount_cents  INTEGER NOT NULL DEFAULT 0,
    kind          TEXT NOT NULL DEFAULT 'variable',
    person_id     INTEGER REFERENCES people(id) ON DELETE SET NULL,
    flight_id     INTEGER REFERENCES flights(id) ON DELETE SET NULL,
    entry_id      INTEGER REFERENCES entries(id) ON DELETE SET NULL,
    attachment_id INTEGER,
    deductible    INTEGER NOT NULL DEFAULT 0,
    notes         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_costs_date ON costs(spent_on DESC);

CREATE TABLE IF NOT EXISTS reserves (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL UNIQUE,
    rate_cents   INTEGER NOT NULL DEFAULT 0,
    target_cents INTEGER NOT NULL DEFAULT 0,
    active       INTEGER NOT NULL DEFAULT 1,
    notes        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS reserve_txns (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    reserve_id   INTEGER NOT NULL REFERENCES reserves(id) ON DELETE CASCADE,
    happened_on  TEXT NOT NULL,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    kind         TEXT NOT NULL DEFAULT 'accrual',
    flight_id    INTEGER REFERENCES flights(id) ON DELETE SET NULL,
    note         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_rtxn_reserve ON reserve_txns(reserve_id);

CREATE TABLE IF NOT EXISTS attachments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id      INTEGER,
    kind          TEXT NOT NULL DEFAULT 'document',
    stored_name   TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime          TEXT NOT NULL DEFAULT '',
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    caption       TEXT NOT NULL DEFAULT '',
    doc_type      TEXT NOT NULL DEFAULT '',
    width         INTEGER NOT NULL DEFAULT 0,
    height        INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    links_table   TEXT NOT NULL DEFAULT '',
    links_id      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_att_link ON attachments(links_table, links_id);
"""


def init_db(seed: bool = True) -> None:
    conn = connect()
    conn.executescript(DDL)
    conn.commit()
    if int(get_meta("schema_version", "0")) < SCHEMA_VERSION:
        set_meta("schema_version", str(SCHEMA_VERSION))
    if one("SELECT id FROM aircraft WHERE id = 1") is None:
        execute(
            "INSERT INTO aircraft (id, make, model, category) VALUES (1, ?, ?, ?)",
            ("Van's Aircraft", "RV-12iS", "Experimental"),
        )
    if seed and scalar("SELECT COUNT(*) FROM items") == 0:
        seed_items()
    if seed and scalar("SELECT COUNT(*) FROM reserves") == 0:
        executemany(
            "INSERT INTO reserves (name, rate_cents, notes) VALUES (?, ?, ?)",
            [
                ("Engine overhaul", 1500, "Set the rate from the overhaul quote and TBO"),
                ("Propeller", 200, ""),
                ("Avionics and paint", 300, ""),
                ("Unscheduled maintenance", 500, ""),
            ],
        )


def seed_items() -> None:
    rows = []
    for i, (name, cat, hours, months, timer, aw, ref) in enumerate(DEFAULT_ITEMS):
        rows.append((name, cat, hours, months, timer, aw, ref, i, 0 if name == "100-hour inspection" else 1))
    executemany(
        "INSERT INTO items (name, category, interval_hours, interval_months, timer,"
        " airworthiness, reference, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rows,
    )


def get_meta(key: str, default: str = "") -> str:
    row = one("SELECT value FROM meta WHERE key = ?", (key,))
    return row["value"] if row else default


def set_meta(key: str, value: str) -> None:
    execute(
        "INSERT INTO meta (key, value) VALUES (?, ?)"
        " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def aircraft() -> sqlite3.Row:
    row = one("SELECT * FROM aircraft WHERE id = 1")
    if row is None:
        init_db(seed=False)
        row = one("SELECT * FROM aircraft WHERE id = 1")
    assert row is not None
    return row


# ------------------------------------------------------------------- due dates

SOON_DAYS = 30
SOON_HOURS = 10


def add_months(start: date, months: float) -> date:
    """Calendar months, clamped to the end of a short month."""
    whole = int(months)
    year = start.year + (start.month - 1 + whole) // 12
    month = (start.month - 1 + whole) % 12 + 1
    day = start.day
    while day > 1:
        try:
            return date(year, month, day)
        except ValueError:
            day -= 1
    return date(year, month, 1)


def parse_date(text: str) -> date | None:
    try:
        return datetime.strptime((text or "")[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def current_hours(timer: str, craft: sqlite3.Row | None = None) -> float:
    craft = craft or aircraft()
    if timer == "hobbs":
        return float(craft["hobbs"] or 0)
    if timer == "tt":
        return float(craft["total_time"] or 0)
    return float(craft["tach"] or 0)


def due_status(
    next_date: date | None, hours_remaining: float | None
) -> tuple[str, float | None, int | None]:
    """Return (status, hours remaining, days remaining)."""
    days = (next_date - date.today()).days if next_date else None
    overdue = (days is not None and days < 0) or (
        hours_remaining is not None and hours_remaining < 0
    )
    soon = (days is not None and days <= SOON_DAYS) or (
        hours_remaining is not None and hours_remaining <= SOON_HOURS
    )
    if overdue:
        return "overdue", hours_remaining, days
    if soon:
        return "due_soon", hours_remaining, days
    return "ok", hours_remaining, days


def item_due(item: sqlite3.Row, craft: sqlite3.Row | None = None) -> dict:
    """Work out when a timed item is next due, by date and by hours."""
    craft = craft or aircraft()
    next_date = parse_date(item["due_date"])
    if next_date is None and item["interval_months"]:
        last = parse_date(item["last_done_date"])
        if last:
            next_date = add_months(last, float(item["interval_months"]))

    next_hours = item["due_hours"]
    if next_hours is None and item["interval_hours"]:
        last_hours = item["last_done_hours"]
        if last_hours is not None:
            next_hours = float(last_hours) + float(item["interval_hours"])

    remaining = None
    if next_hours is not None:
        remaining = round(float(next_hours) - current_hours(item["timer"], craft), 1)

    status, hours_left, days_left = due_status(next_date, remaining)
    if next_date is None and next_hours is None:
        status = "unset"
    return {
        "id": item["id"],
        "name": item["name"],
        "category": item["category"],
        "timer": item["timer"],
        "airworthiness": bool(item["airworthiness"]),
        "reference": item["reference"],
        "notes": item["notes"],
        "active": bool(item["active"]),
        "interval_hours": float(item["interval_hours"] or 0),
        "interval_months": float(item["interval_months"] or 0),
        "last_done_date": item["last_done_date"],
        "last_done_hours": item["last_done_hours"],
        "next_date": next_date.isoformat() if next_date else "",
        "next_hours": round(float(next_hours), 1) if next_hours is not None else None,
        "hours_left": hours_left,
        "days_left": days_left,
        "status": status,
    }


def items_due(include_inactive: bool = False) -> list[dict]:
    craft = aircraft()
    sql = "SELECT * FROM items"
    if not include_inactive:
        sql += " WHERE active = 1"
    sql += " ORDER BY sort_order, id"
    rows = [item_due(r, craft) for r in query(sql)]
    order = {"overdue": 0, "due_soon": 1, "ok": 2, "unset": 3}
    rows.sort(key=lambda r: (order.get(r["status"], 9), r["days_left"] if r["days_left"] is not None else 99999))
    return rows


def directive_due(row: sqlite3.Row, craft: sqlite3.Row | None = None) -> dict:
    """Recurring directives get a next-due date and hour count."""
    craft = craft or aircraft()
    next_date = None
    next_hours = None
    if row["recurring"]:
        complied = parse_date(row["complied_on"])
        if complied and row["interval_months"]:
            next_date = add_months(complied, float(row["interval_months"]))
        if row["complied_hours"] is not None and row["interval_hours"]:
            next_hours = float(row["complied_hours"]) + float(row["interval_hours"])
    remaining = None
    if next_hours is not None:
        remaining = round(next_hours - float(craft["tach"] or 0), 1)
    if row["status"] == "not_applicable":
        status = "not_applicable"
    elif row["status"] == "open":
        status = "overdue"
    elif row["recurring"]:
        status, _, _ = due_status(next_date, remaining)
    else:
        status = "ok"
    data = dict(row)
    data.update(
        {
            "next_date": next_date.isoformat() if next_date else "",
            "next_hours": round(next_hours, 1) if next_hours is not None else None,
            "hours_left": remaining,
            "days_left": (next_date - date.today()).days if next_date else None,
            "due_status": status,
        }
    )
    return data


def directives_due(kind: str | None = None) -> list[dict]:
    craft = aircraft()
    sql = "SELECT * FROM directives"
    args: list = []
    if kind:
        sql += " WHERE kind = ?"
        args.append(kind)
    sql += " ORDER BY kind, number, id"
    return [directive_due(r, craft) for r in query(sql, args)]


def vor_status() -> dict:
    """IFR VOR checks are good for 30 days."""
    row = one("SELECT * FROM vor_checks ORDER BY checked_on DESC, id DESC LIMIT 1")
    if row is None:
        return {"status": "unset", "last": None, "next_date": "", "days_left": None}
    last = parse_date(row["checked_on"])
    next_date = (last + timedelta(days=30)) if last else None
    days = (next_date - date.today()).days if next_date else None
    status = "ok"
    if days is not None:
        status = "overdue" if days < 0 else "due_soon" if days <= 7 else "ok"
    return {
        "status": status,
        "last": row,
        "next_date": next_date.isoformat() if next_date else "",
        "days_left": days,
    }


def airworthiness() -> dict:
    """Is the aircraft legal and safe to fly right now, by our records?"""
    blocking = [
        item
        for item in items_due()
        if item["airworthiness"] and item["status"] == "overdue"
    ]
    open_ads = [
        d
        for d in directives_due()
        if d["due_status"] == "overdue" and d["kind"] in ("AD", "SD")
    ]
    grounding = query(
        "SELECT * FROM squawks WHERE grounding = 1 AND status != 'resolved'"
        " ORDER BY reported_on DESC"
    )
    ready = not blocking and not open_ads and not grounding
    return {
        "ready": ready,
        "blocking_items": blocking,
        "open_directives": open_ads,
        "grounding_squawks": grounding,
        "soon": [i for i in items_due() if i["status"] == "due_soon"],
    }


# ---------------------------------------------------------------------- money


def reserve_balances() -> list[dict]:
    out = []
    for row in query("SELECT * FROM reserves ORDER BY name"):
        balance = int(
            scalar(
                "SELECT SUM(amount_cents) FROM reserve_txns WHERE reserve_id = ?",
                (row["id"],),
                0,
            )
            or 0
        )
        out.append(
            {
                "id": row["id"],
                "name": row["name"],
                "rate_cents": int(row["rate_cents"] or 0),
                "target_cents": int(row["target_cents"] or 0),
                "active": bool(row["active"]),
                "notes": row["notes"],
                "balance_cents": balance,
                "percent": round(balance / row["target_cents"] * 100, 1)
                if row["target_cents"]
                else None,
            }
        )
    return out


def reserve_rate_total() -> int:
    return int(scalar("SELECT SUM(rate_cents) FROM reserves WHERE active = 1", (), 0) or 0)


def hours_between(start: str, end: str) -> float:
    return float(
        scalar(
            "SELECT SUM(hours) FROM flights WHERE flew_on >= ? AND flew_on <= ?",
            (start, end),
            0.0,
        )
        or 0
    )


def cost_summary(months: int = 12) -> dict:
    """Fixed, variable and per-hour costs over a trailing window."""
    end = date.today()
    start = add_months(end, -months)
    args = (start.isoformat(), end.isoformat())
    fixed = int(
        scalar(
            "SELECT SUM(amount_cents) FROM costs WHERE kind = 'fixed'"
            " AND spent_on >= ? AND spent_on <= ?",
            args,
            0,
        )
        or 0
    )
    variable = int(
        scalar(
            "SELECT SUM(amount_cents) FROM costs WHERE kind = 'variable'"
            " AND spent_on >= ? AND spent_on <= ?",
            args,
            0,
        )
        or 0
    )
    hours = hours_between(*args)
    reserve_rate = reserve_rate_total()
    variable_rate = variable / hours if hours else 0.0
    return {
        "months": months,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "fixed_cents": fixed,
        "variable_cents": variable,
        "total_cents": fixed + variable,
        "hours": round(hours, 1),
        "variable_per_hour_cents": int(round(variable_rate)),
        "fixed_per_hour_cents": int(round(fixed / hours)) if hours else 0,
        "total_per_hour_cents": int(round((fixed + variable) / hours)) if hours else 0,
        "reserve_rate_cents": reserve_rate,
        "wet_per_hour_cents": int(round(variable_rate + reserve_rate)),
        "all_in_per_hour_cents": int(round((fixed + variable) / hours + reserve_rate))
        if hours
        else 0,
    }


def hourly_projection(planned_hours: float) -> dict:
    """What an hour costs at a chosen yearly utilisation."""
    summary = cost_summary(12)
    craft = aircraft()
    fixed_annual = summary["fixed_cents"]
    variable_rate = summary["variable_per_hour_cents"]
    if not variable_rate and craft["fuel_burn"] and craft["fuel_price"]:
        variable_rate = int(round(float(craft["fuel_burn"]) * float(craft["fuel_price"]) * 100))
    reserve_rate = summary["reserve_rate_cents"]
    planned = max(1.0, float(planned_hours or 1))
    fixed_rate = int(round(fixed_annual / planned))
    return {
        "planned_hours": planned,
        "fixed_annual_cents": fixed_annual,
        "fixed_per_hour_cents": fixed_rate,
        "variable_per_hour_cents": variable_rate,
        "reserve_rate_cents": reserve_rate,
        "total_per_hour_cents": fixed_rate + variable_rate + reserve_rate,
        "annual_total_cents": int(
            round(fixed_annual + (variable_rate + reserve_rate) * planned)
        ),
    }
