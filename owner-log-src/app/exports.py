"""Exports, backups and imports."""
from __future__ import annotations

import csv
import io
import json
import os
import shutil
import zipfile

from . import db, files

MANIFEST = "owner-log-manifest.json"


def _rows(table: str, order: str) -> list[dict]:
    return [dict(r) for r in db.query(f"SELECT * FROM {table} ORDER BY {order}")]


def _writer(header: list[str]):
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(header)
    return buffer, writer


def flights_csv() -> str:
    buffer, writer = _writer(
        [
            "id", "date", "pilot", "route", "purpose", "tach_start", "tach_end",
            "hobbs_start", "hobbs_end", "hours", "landings", "fuel_gal", "oil_qt",
            "notes",
        ]
    )
    for row in db.query(
        "SELECT f.*, p.name AS pilot FROM flights f"
        " LEFT JOIN people p ON p.id = f.person_id ORDER BY f.flew_on, f.id"
    ):
        writer.writerow(
            [
                row["id"], row["flew_on"], row["pilot"] or "", row["route"],
                row["purpose"],
                "" if row["tach_start"] is None else f"{row['tach_start']:g}",
                "" if row["tach_end"] is None else f"{row['tach_end']:g}",
                "" if row["hobbs_start"] is None else f"{row['hobbs_start']:g}",
                "" if row["hobbs_end"] is None else f"{row['hobbs_end']:g}",
                f"{float(row['hours'] or 0):g}", row["landings"],
                f"{float(row['fuel_gal'] or 0):g}", f"{float(row['oil_qt'] or 0):g}",
                row["notes"],
            ]
        )
    return buffer.getvalue()


def costs_csv() -> str:
    buffer, writer = _writer(
        ["id", "date", "vendor", "category", "kind", "description", "amount",
         "paid_by", "deductible", "notes"]
    )
    for row in db.query(
        "SELECT c.*, p.name AS person FROM costs c"
        " LEFT JOIN people p ON p.id = c.person_id ORDER BY c.spent_on, c.id"
    ):
        writer.writerow(
            [
                row["id"], row["spent_on"], row["vendor"], row["category"],
                row["kind"], row["description"],
                f"{int(row['amount_cents'] or 0) / 100:.2f}", row["person"] or "",
                "yes" if row["deductible"] else "", row["notes"],
            ]
        )
    return buffer.getvalue()


def squawks_csv() -> str:
    buffer, writer = _writer(
        ["id", "reported", "title", "severity", "status", "grounding", "reported_by",
         "tach", "resolved", "resolution", "description"]
    )
    for row in db.query(
        "SELECT s.*, p.name AS person FROM squawks s"
        " LEFT JOIN people p ON p.id = s.person_id ORDER BY s.reported_on, s.id"
    ):
        writer.writerow(
            [
                row["id"], row["reported_on"], row["title"], row["severity"],
                row["status"], "yes" if row["grounding"] else "", row["person"] or "",
                "" if row["tach"] is None else f"{row['tach']:g}",
                row["resolved_on"], row["resolution"], row["description"],
            ]
        )
    return buffer.getvalue()


def entries_csv() -> str:
    buffer, writer = _writer(
        ["id", "date", "kind", "summary", "performed_by", "certificate", "tach",
         "hobbs", "total_time", "cost", "work"]
    )
    for row in db.query("SELECT * FROM entries ORDER BY entry_date, id"):
        writer.writerow(
            [
                row["id"], row["entry_date"], row["kind"], row["summary"],
                row["performed_by"], row["certificate"],
                "" if row["tach"] is None else f"{row['tach']:g}",
                "" if row["hobbs"] is None else f"{row['hobbs']:g}",
                "" if row["total_time"] is None else f"{row['total_time']:g}",
                f"{int(row['cost_cents'] or 0) / 100:.2f}",
                (row["work"] or "").replace("\r\n", "\n"),
            ]
        )
    return buffer.getvalue()


def directives_csv() -> str:
    buffer, writer = _writer(
        ["id", "kind", "number", "title", "issued", "status", "recurring",
         "interval_hours", "interval_months", "complied_on", "complied_hours",
         "method", "url", "applicability", "notes"]
    )
    for row in db.query("SELECT * FROM directives ORDER BY kind, number, id"):
        writer.writerow(
            [
                row["id"], row["kind"], row["number"], row["title"], row["issued_on"],
                row["status"], "yes" if row["recurring"] else "",
                f"{float(row['interval_hours'] or 0):g}",
                f"{float(row['interval_months'] or 0):g}",
                row["complied_on"],
                "" if row["complied_hours"] is None else f"{row['complied_hours']:g}",
                row["method"], row["url"], row["applicability"], row["notes"],
            ]
        )
    return buffer.getvalue()


def items_csv() -> str:
    buffer, writer = _writer(
        ["id", "name", "category", "interval_hours", "interval_months", "timer",
         "airworthiness", "last_done_date", "last_done_hours", "next_date",
         "next_hours", "status", "reference"]
    )
    for item in db.items_due(include_inactive=True):
        writer.writerow(
            [
                item["id"], item["name"], item["category"],
                f"{item['interval_hours']:g}", f"{item['interval_months']:g}",
                item["timer"], "yes" if item["airworthiness"] else "",
                item["last_done_date"],
                "" if item["last_done_hours"] is None else f"{item['last_done_hours']:g}",
                item["next_date"],
                "" if item["next_hours"] is None else f"{item['next_hours']:g}",
                item["status"], item["reference"],
            ]
        )
    return buffer.getvalue()


def full_json() -> str:
    data = {
        "app": "Hangar Owner Log",
        "schema_version": db.SCHEMA_VERSION,
        "exported_at": db.now() + "Z",
        "aircraft": dict(db.aircraft()),
        "items": _rows("items", "sort_order, id"),
        "people": _rows("people", "name"),
        "entries": _rows("entries", "entry_date, id"),
        "squawks": _rows("squawks", "reported_on, id"),
        "directives": _rows("directives", "kind, number"),
        "equipment": _rows("equipment", "category, name"),
        "vor_checks": _rows("vor_checks", "checked_on"),
        "flights": _rows("flights", "flew_on, id"),
        "costs": _rows("costs", "spent_on, id"),
        "reserves": _rows("reserves", "name"),
        "reserve_txns": _rows("reserve_txns", "happened_on, id"),
        "attachments": _rows("attachments", "id"),
        "computed": {
            "airworthy": db.airworthiness()["ready"],
            "cost_summary": db.cost_summary(12),
            "reserves": db.reserve_balances(),
        },
    }
    return json.dumps(data, indent=2, ensure_ascii=False, default=str)


def backup_zip() -> bytes:
    files.ensure_dirs()
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            MANIFEST,
            json.dumps(
                {
                    "app": "Hangar Owner Log",
                    "schema_version": db.SCHEMA_VERSION,
                    "created_at": db.now() + "Z",
                },
                indent=2,
            ),
        )
        db.connect().commit()
        if os.path.exists(db.DB_PATH):
            snapshot = os.path.join(db.DATA_DIR, "backup-snapshot.db")
            target = db.sqlite3.connect(snapshot)
            try:
                db.connect().backup(target)
            finally:
                target.close()
            archive.write(snapshot, "owner-log.db")
            os.remove(snapshot)
        for name in sorted(os.listdir(files.UPLOAD_DIR)):
            path = os.path.join(files.UPLOAD_DIR, name)
            if os.path.isfile(path):
                archive.write(path, f"uploads/{name}")
        archive.writestr("csv/flights.csv", flights_csv())
        archive.writestr("csv/costs.csv", costs_csv())
        archive.writestr("csv/squawks.csv", squawks_csv())
        archive.writestr("csv/logbook.csv", entries_csv())
        archive.writestr("csv/directives.csv", directives_csv())
        archive.writestr("csv/maintenance-items.csv", items_csv())
        archive.writestr("owner-log.json", full_json())
    return buffer.getvalue()


def restore_zip(data: bytes) -> str:
    files.ensure_dirs()
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        if "owner-log.db" not in names:
            raise ValueError("That zip has no owner-log.db, so it is not a backup.")
        db.invalidate()
        staging = db.DB_PATH + ".restoring"
        with archive.open("owner-log.db") as src, open(staging, "wb") as dst:
            shutil.copyfileobj(src, dst)
        for suffix in ("-wal", "-shm"):
            stale = db.DB_PATH + suffix
            if os.path.exists(stale):
                os.remove(stale)
        os.replace(staging, db.DB_PATH)
        restored = 0
        for name in names:
            if not name.startswith("uploads/") or name.endswith("/"):
                continue
            safe = os.path.basename(name)
            if not safe:
                continue
            with archive.open(name) as src, open(
                os.path.join(files.UPLOAD_DIR, safe), "wb"
            ) as dst:
                shutil.copyfileobj(src, dst)
            restored += 1
    db.invalidate()
    db.init_db(seed=False)
    return f"Restored the database and {restored} file(s)."


def _pick(row: dict, *options: str) -> str:
    for key, value in row.items():
        if key is None:
            continue
        flat = key.strip().lower().replace(" ", "_").replace("-", "_")
        if flat in options:
            return (value or "").strip()
    return ""


def _reader(data: bytes):
    text = data.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("That file has no header row.")
    return reader


def import_directives_csv(data: bytes, kind: str = "SB") -> str:
    """Import service bulletins or ADs from a CSV, such as a Van's export."""
    reader = _reader(data)
    added = 0
    for row in reader:
        number = _pick(row, "number", "document", "document_number", "sb", "ad",
                       "bulletin", "id", "reference")
        title = _pick(row, "title", "subject", "description", "name", "summary")
        if not number and not title:
            continue
        if db.one(
            "SELECT id FROM directives WHERE kind = ? AND number = ? AND number != ''",
            (kind, number),
        ):
            continue
        db.execute(
            "INSERT INTO directives (kind, number, title, issued_on, applicability,"
            " status, url, notes) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)",
            (
                kind,
                number[:60],
                title[:300],
                _pick(row, "date", "issued", "issued_on", "published", "revision_date")[:10],
                _pick(row, "applicability", "models", "model", "aircraft", "applies_to")[:300],
                _pick(row, "url", "link", "document_url", "href")[:500],
                _pick(row, "notes", "comments", "status_notes"),
            ),
        )
        added += 1
    return f"Imported {added} {kind} record(s). Review each one for applicability."


def import_flights_csv(data: bytes) -> str:
    """Import flights from a CSV, including a Pilot Logbook or ForeFlight export."""
    reader = _reader(data)
    people = {r["name"].lower(): r["id"] for r in db.query("SELECT id, name FROM people")}
    added = 0
    total_hours = 0.0
    for row in reader:
        flew_on = _pick(row, "date", "flew_on", "flight_date")[:10]
        if not flew_on:
            continue
        hours = 0.0
        for key in ("hours", "total_time", "totaltime", "duration", "flight_time"):
            raw = _pick(row, key)
            if raw:
                try:
                    hours = float(raw)
                    break
                except ValueError:
                    continue
        pilot = _pick(row, "pilot", "pilot_name", "pic", "pic_name")
        person_id = people.get(pilot.lower()) if pilot else None
        if pilot and person_id is None:
            person_id = db.execute(
                "INSERT INTO people (name, role) VALUES (?, 'Pilot')", (pilot[:80],)
            )
            people[pilot.lower()] = person_id
        route = _pick(row, "route") or " ".join(
            x for x in (_pick(row, "from", "departure", "origin"),
                        _pick(row, "to", "destination", "arrival")) if x
        )
        db.execute(
            "INSERT INTO flights (flew_on, person_id, route, purpose, hours,"
            " landings, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                flew_on,
                person_id,
                route[:120],
                _pick(row, "purpose", "remarks_short", "type")[:120],
                hours,
                int(float(_pick(row, "landings", "day_landings", "all_landings") or 0) or 0),
                _pick(row, "notes", "remarks", "comments"),
                db.now(),
            ),
        )
        added += 1
        total_hours += hours
    craft = db.aircraft()
    db.execute(
        "UPDATE aircraft SET total_time = ?, engine_smoh = ?, prop_since = ?"
        " WHERE id = 1",
        (
            round(float(craft["total_time"] or 0) + total_hours, 2),
            round(float(craft["engine_smoh"] or 0) + total_hours, 2),
            round(float(craft["prop_since"] or 0) + total_hours, 2),
        ),
    )
    return (
        f"Imported {added} flight(s), {total_hours:g} hours. "
        "Check the aircraft times afterwards."
    )
