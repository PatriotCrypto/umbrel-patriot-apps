"""End-to-end tests. Each test gets a fresh /data folder."""
from __future__ import annotations

import importlib
import io
import os
import sys
import zipfile
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("OWL_DATA_DIR", str(tmp_path / "data"))
    for name in [n for n in list(sys.modules) if n == "app" or n.startswith("app.")]:
        del sys.modules[name]
    main = importlib.import_module("app.main")
    with TestClient(main.app) as test_client:
        test_client.app_module = main
        yield test_client


def token(client: TestClient) -> str:
    client.get("/")
    return client.cookies.get("owl_csrf")


def post(client: TestClient, url: str, data=None, files=None):
    payload = dict(data or {})
    payload["csrf_token"] = token(client)
    return client.post(url, data=payload, files=files, follow_redirects=False)


def png_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (200, 150), "#C0272D").save(buffer, "PNG")
    return buffer.getvalue()


def days_ago(n: int) -> str:
    return (date.today() - timedelta(days=n)).isoformat()


def item_id(client, name: str) -> int:
    return client.app_module.db.one("SELECT id FROM items WHERE name = ?", (name,))["id"]


# ------------------------------------------------------------------- basics


def test_pages_render(client):
    assert client.get("/healthz").text == "ok"
    for path in ("/", "/aircraft", "/maintenance", "/squawks", "/compliance",
                 "/equipment", "/flights", "/costs", "/logbook", "/documents",
                 "/settings"):
        response = client.get(path)
        assert response.status_code == 200, path
        assert "Owner Log" in response.text


def test_security_headers_and_csrf(client):
    response = client.get("/")
    csp = response.headers["content-security-policy"]
    assert "script-src 'self'" in csp and "unsafe-inline" not in csp
    assert client.post("/items/add", data={"name": "X"}).status_code == 403
    assert client.post(
        "/items/add", data={"name": "X", "csrf_token": "wrong"}
    ).status_code == 403


def test_no_inline_styles(client):
    for path in ("/", "/maintenance", "/costs", "/compliance", "/settings"):
        html = client.get(path).text
        assert ' style="' not in html, path
        assert "onclick=" not in html, path


def test_default_items_seeded(client):
    html = client.get("/maintenance").text
    for name in ("Annual inspection", "Transponder test", "ELT battery",
                 "Static system and altimeter"):
        assert name in html


def test_default_reserves_seeded(client):
    assert client.app_module.db.scalar("SELECT COUNT(*) FROM reserves") == 4


# -------------------------------------------------------------- due dates


def test_annual_due_one_year_after_it_was_done(client):
    annual = item_id(client, "Annual inspection")
    post(client, f"/items/{annual}/update", data={
        "name": "Annual inspection", "category": "Inspection", "interval_months": "12",
        "interval_hours": "0", "timer": "tach", "airworthiness": "1", "active": "1",
        "last_done_date": days_ago(30),
    })
    items = {i["name"]: i for i in client.app_module.db.items_due()}
    item = items["Annual inspection"]
    assert item["status"] == "ok"
    assert item["days_left"] == 335
    expected = (date.today() - timedelta(days=30)).replace(year=date.today().year + 1)
    assert item["next_date"] == expected.isoformat()


def test_overdue_annual_blocks_airworthiness(client):
    annual = item_id(client, "Annual inspection")
    post(client, f"/items/{annual}/update", data={
        "name": "Annual inspection", "category": "Inspection", "interval_months": "12",
        "timer": "tach", "airworthiness": "1", "active": "1",
        "last_done_date": days_ago(400),
    })
    status = client.app_module.db.airworthiness()
    assert status["ready"] is False
    assert "Annual inspection" in [i["name"] for i in status["blocking_items"]]
    assert "Something needs attention" in client.get("/").text
    assert client.get("/api/status").json()["airworthy"] is False


def test_hour_based_item_counts_down_with_the_tach(client):
    oil = item_id(client, "Oil and filter change")
    post(client, "/aircraft/times", data={"tach": "120", "hobbs": "130",
                                          "total_time": "120", "engine_smoh": "120",
                                          "prop_since": "120"})
    post(client, f"/items/{oil}/update", data={
        "name": "Oil and filter change", "category": "Maintenance",
        "interval_hours": "50", "interval_months": "6", "timer": "tach", "active": "1",
        "last_done_date": days_ago(10), "last_done_hours": "100",
    })
    item = {i["name"]: i for i in client.app_module.db.items_due()}["Oil and filter change"]
    assert item["next_hours"] == 150.0
    assert item["hours_left"] == 30.0
    assert item["status"] == "ok"

    post(client, "/aircraft/times", data={"tach": "145", "hobbs": "155",
                                          "total_time": "145", "engine_smoh": "145",
                                          "prop_since": "145"})
    item = {i["name"]: i for i in client.app_module.db.items_due()}["Oil and filter change"]
    assert item["hours_left"] == 5.0
    assert item["status"] == "due_soon"


def test_item_uses_its_own_timer(client):
    post(client, "/aircraft/times", data={"tach": "100", "hobbs": "200",
                                          "total_time": "100", "engine_smoh": "100",
                                          "prop_since": "0"})
    post(client, "/items/add", data={
        "name": "Hobbs item", "category": "Maintenance", "interval_hours": "50",
        "timer": "hobbs", "last_done_hours": "180", "last_done_date": days_ago(5),
    })
    item = {i["name"]: i for i in client.app_module.db.items_due()}["Hobbs item"]
    assert item["next_hours"] == 230.0
    assert item["hours_left"] == 30.0


def test_completing_an_item_moves_it_and_writes_a_logbook_entry(client):
    annual = item_id(client, "Annual inspection")
    post(client, "/aircraft/times", data={"tach": "250", "hobbs": "260",
                                          "total_time": "250", "engine_smoh": "250",
                                          "prop_since": "250"})
    post(client, f"/items/{annual}/complete", data={
        "done_date": date.today().isoformat(),
        "performed_by": "Dale Hoffman", "certificate": "A&P IA 123456",
        "work": "Annual inspection carried out per the checklist.", "cost": "1450",
    })
    item = {i["name"]: i for i in client.app_module.db.items_due()}["Annual inspection"]
    assert item["last_done_date"] == date.today().isoformat()
    assert item["last_done_hours"] == 250.0
    assert item["status"] == "ok"

    entry = client.app_module.db.one("SELECT * FROM entries ORDER BY id DESC")
    assert entry["summary"] == "Annual inspection"
    assert entry["performed_by"] == "Dale Hoffman"
    assert entry["tach"] == 250.0
    assert client.app_module.db.scalar("SELECT SUM(amount_cents) FROM costs") == 145000


def test_restore_missing_defaults(client):
    annual = item_id(client, "Annual inspection")
    post(client, f"/items/{annual}/delete")
    assert "Annual inspection" not in client.get("/maintenance").text
    post(client, "/items/restore-defaults")
    assert "Annual inspection" in client.get("/maintenance").text


# ------------------------------------------------------------------ flights


def test_flight_rolls_the_timers_and_accrues_reserves(client):
    post(client, "/aircraft/times", data={"tach": "100", "hobbs": "110",
                                          "total_time": "100", "engine_smoh": "40",
                                          "prop_since": "40"})
    post(client, "/flights/add", data={
        "flew_on": date.today().isoformat(), "route": "KHAO KI69",
        "tach_start": "100", "tach_end": "101.5", "hobbs_start": "110",
        "hobbs_end": "111.8", "landings": "3",
    })
    craft = client.app_module.db.aircraft()
    assert craft["tach"] == 101.5
    assert craft["hobbs"] == 111.8
    assert craft["total_time"] == 101.5
    assert craft["engine_smoh"] == 41.5

    # Four seeded reserves at 15.00 + 2.00 + 3.00 + 5.00 = 25.00 an hour.
    accrued = client.app_module.db.scalar("SELECT SUM(amount_cents) FROM reserve_txns")
    assert accrued == int(round(2500 * 1.5))


def test_flight_hours_fall_back_to_hobbs_then_manual(client):
    post(client, "/flights/add", data={
        "flew_on": days_ago(2), "hobbs_start": "10", "hobbs_end": "12.2"})
    post(client, "/flights/add", data={"flew_on": days_ago(1), "hours": "0.8"})
    hours = client.app_module.db.scalar("SELECT SUM(hours) FROM flights")
    assert round(hours, 2) == 3.0


def test_deleting_a_flight_rolls_the_counters_back(client):
    post(client, "/aircraft/times", data={"tach": "50", "hobbs": "50",
                                          "total_time": "50", "engine_smoh": "50",
                                          "prop_since": "50"})
    post(client, "/flights/add", data={
        "flew_on": date.today().isoformat(), "tach_start": "50", "tach_end": "52"})
    assert client.app_module.db.aircraft()["total_time"] == 52.0
    post(client, "/flights/1/delete")
    assert client.app_module.db.aircraft()["total_time"] == 50.0
    assert client.app_module.db.scalar("SELECT COUNT(*) FROM reserve_txns") == 0


def test_flight_fuel_cost_is_recorded(client):
    post(client, "/flights/add", data={
        "flew_on": date.today().isoformat(), "hours": "2", "fuel_gal": "12.4",
        "fuel_cost": "74.40", "fuel_vendor": "Butler",
    })
    cost = client.app_module.db.one("SELECT * FROM costs")
    assert cost["amount_cents"] == 7440
    assert cost["category"] == "Fuel"
    assert cost["kind"] == "variable"


# ------------------------------------------------------------------ squawks


def test_squawk_lifecycle_and_logbook_entry(client):
    post(client, "/squawks/add", data={
        "title": "Right brake soft", "description": "Pulls left on rollout",
        "severity": "high", "grounding": "1", "reported_on": date.today().isoformat(),
    }, files={"photos": ("brake.png", png_bytes(), "image/png")})
    assert client.app_module.db.scalar("SELECT COUNT(*) FROM attachments") == 1
    assert client.app_module.db.airworthiness()["ready"] is False
    assert "Right brake soft" in client.get("/").text

    post(client, "/squawks/1/update", data={
        "title": "Right brake soft", "status": "resolved", "severity": "high",
        "resolved_on": date.today().isoformat(), "performed_by": "Me",
        "resolution": "Bled both brakes, replaced the right master cylinder.",
    })
    squawk = client.app_module.db.one("SELECT * FROM squawks WHERE id = 1")
    assert squawk["status"] == "resolved"
    assert squawk["entry_id"] is not None
    entry = client.app_module.db.one("SELECT * FROM entries WHERE id = ?",
                                     (squawk["entry_id"],))
    assert "Right brake soft" in entry["summary"]
    assert "master cylinder" in entry["work"]
    assert client.app_module.db.airworthiness()["ready"] is True


def test_non_grounding_squawk_does_not_block(client):
    post(client, "/squawks/add", data={"title": "Cabin light flickers",
                                       "severity": "low"})
    assert client.app_module.db.airworthiness()["ready"] is True


def test_squawk_filters(client):
    post(client, "/squawks/add", data={"title": "Open one", "severity": "low"})
    post(client, "/squawks/add", data={"title": "Second one", "severity": "low"})
    post(client, "/squawks/2/update", data={"title": "Second one",
                                            "status": "deferred", "severity": "low"})
    assert "Second one" in client.get("/squawks?status=deferred").text
    assert "Open one" not in client.get("/squawks?status=deferred").text


# --------------------------------------------------------------- compliance


def test_directive_recurrence(client):
    post(client, "/directives/add", data={
        "kind": "AD", "number": "2024-12-05", "title": "Fuel hose inspection",
        "status": "complied", "recurring": "1", "interval_months": "12",
        "complied_on": days_ago(380), "complied_hours": "100",
    })
    row = client.app_module.db.directives_due("AD")[0]
    assert row["due_status"] == "overdue"
    assert row["next_date"] < date.today().isoformat()

    post(client, "/directives/1/update", data={
        "number": "2024-12-05", "title": "Fuel hose inspection", "status": "complied",
        "recurring": "1", "interval_months": "12", "complied_on": days_ago(10),
    })
    assert client.app_module.db.directives_due("AD")[0]["due_status"] == "ok"


def test_open_ad_blocks_airworthiness_but_sb_does_not(client):
    post(client, "/directives/add", data={"kind": "SB", "number": "SB-00031",
                                          "title": "Flaperon hinge", "status": "open"})
    assert client.app_module.db.airworthiness()["ready"] is True
    post(client, "/directives/add", data={"kind": "AD", "number": "2025-01-01",
                                          "title": "Spar inspection", "status": "open"})
    assert client.app_module.db.airworthiness()["ready"] is False


def test_directive_csv_import_skips_duplicates(client):
    csv_text = (
        "Number,Title,Date,Models,Link\n"
        "SB-00031,Flaperon hinge bracket,2024-03-01,RV-12iS,https://example.org/a\n"
        "SB-00044,Fuel pump wiring,2025-06-14,RV-12iS,https://example.org/b\n"
    )
    response = post(client, "/directives/import",
                    data={"kind": "SB"},
                    files={"file": ("vans.csv", csv_text.encode(), "text/csv")})
    assert response.status_code == 303
    assert client.app_module.db.scalar("SELECT COUNT(*) FROM directives") == 2
    html = client.get("/compliance").text
    assert "SB-00031" in html and "Fuel pump wiring" in html

    post(client, "/directives/import", data={"kind": "SB"},
         files={"file": ("vans.csv", csv_text.encode(), "text/csv")})
    assert client.app_module.db.scalar("SELECT COUNT(*) FROM directives") == 2


def test_vor_check_thirty_day_window(client):
    post(client, "/vor/add", data={"checked_on": days_ago(35), "place": "KHAO",
                                   "method": "VOT", "error": "-2"})
    assert client.app_module.db.vor_status()["status"] == "overdue"
    post(client, "/vor/add", data={"checked_on": date.today().isoformat(),
                                   "place": "KHAO", "method": "VOT"})
    status = client.app_module.db.vor_status()
    assert status["status"] == "ok"
    assert status["days_left"] == 30


# ---------------------------------------------------------------- equipment


def test_equipment_time_in_service(client):
    post(client, "/aircraft/times", data={"tach": "500", "hobbs": "500",
                                          "total_time": "500", "engine_smoh": "500",
                                          "prop_since": "500"})
    post(client, "/equipment/add", data={
        "name": "Rotax 912iS", "category": "Engine", "make": "Rotax",
        "installed_on": days_ago(900), "installed_tach": "100", "tbo_hours": "2000",
        "serial": "9912345",
    })
    html = client.get("/equipment").text
    assert "Rotax 912iS" in html
    assert "400.0 h used" in html
    assert "1600.0 left" in html


# -------------------------------------------------------------------- costs


def test_cost_kind_defaults_by_category(client):
    post(client, "/costs/add", data={"spent_on": date.today().isoformat(),
                                     "amount": "450", "category": "Hangar"})
    post(client, "/costs/add", data={"spent_on": date.today().isoformat(),
                                     "amount": "80", "category": "Fuel"})
    kinds = {r["category"]: r["kind"] for r in
             client.app_module.db.query("SELECT category, kind FROM costs")}
    assert kinds["Hangar"] == "fixed"
    assert kinds["Fuel"] == "variable"


def test_cost_per_hour_maths(client):
    post(client, "/flights/add", data={"flew_on": days_ago(20), "hours": "10"})
    post(client, "/costs/add", data={"spent_on": days_ago(10), "amount": "1200",
                                     "category": "Hangar"})
    post(client, "/costs/add", data={"spent_on": days_ago(5), "amount": "300",
                                     "category": "Fuel"})
    summary = client.app_module.db.cost_summary(12)
    assert summary["hours"] == 10.0
    assert summary["fixed_cents"] == 120000
    assert summary["variable_cents"] == 30000
    assert summary["variable_per_hour_cents"] == 3000
    assert summary["fixed_per_hour_cents"] == 12000
    assert summary["reserve_rate_cents"] == 2500
    assert summary["all_in_per_hour_cents"] == 17500


def test_hourly_projection_spreads_fixed_costs(client):
    post(client, "/flights/add", data={"flew_on": days_ago(20), "hours": "10"})
    post(client, "/costs/add", data={"spent_on": days_ago(10), "amount": "6000",
                                     "category": "Hangar"})
    post(client, "/costs/add", data={"spent_on": days_ago(5), "amount": "500",
                                     "category": "Fuel"})
    at_50 = client.app_module.db.hourly_projection(50)
    at_100 = client.app_module.db.hourly_projection(100)
    assert at_50["fixed_per_hour_cents"] == 12000
    assert at_100["fixed_per_hour_cents"] == 6000
    assert at_100["variable_per_hour_cents"] == 5000
    assert at_100["total_per_hour_cents"] == 6000 + 5000 + 2500
    assert "$135.00" in client.get("/costs?planned=100").text


def test_projection_falls_back_to_fuel_burn(client):
    post(client, "/aircraft", data={"make": "Van's", "model": "RV-12iS",
                                    "fuel_burn": "5", "fuel_price": "6",
                                    "planned_hours": "100"})
    projection = client.app_module.db.hourly_projection(100)
    assert projection["variable_per_hour_cents"] == 3000


def test_reserve_balance_and_withdrawal(client):
    post(client, "/flights/add", data={"flew_on": days_ago(1), "hours": "10"})
    balances = {r["name"]: r for r in client.app_module.db.reserve_balances()}
    assert balances["Engine overhaul"]["balance_cents"] == 15000
    engine_id = balances["Engine overhaul"]["id"]
    post(client, f"/reserves/{engine_id}/txn", data={
        "amount": "50", "kind": "withdrawal", "happened_on": date.today().isoformat()})
    balances = {r["name"]: r for r in client.app_module.db.reserve_balances()}
    assert balances["Engine overhaul"]["balance_cents"] == 10000


def test_co_owner_shares(client):
    post(client, "/people/add", data={"name": "Wyley", "role": "Owner", "share": "50"})
    post(client, "/people/add", data={"name": "Dad", "role": "Co-owner", "share": "50"})
    post(client, "/costs/add", data={"spent_on": date.today().isoformat(),
                                     "amount": "1000", "category": "Maintenance",
                                     "person_id": "1"})
    html = client.get("/costs").text
    assert "Co-owner shares" in html
    assert "$500.00" in html


def test_receipt_upload(client):
    response = post(client, "/costs/add",
                    data={"spent_on": date.today().isoformat(), "amount": "99",
                          "category": "Parts"},
                    files={"receipt": ("r.png", png_bytes(), "image/png")})
    assert response.status_code == 303
    assert "receipt" in client.get("/costs").text


# ------------------------------------------------------- logbook, documents


def test_logbook_entry_can_complete_an_item(client):
    oil = item_id(client, "Oil and filter change")
    post(client, "/aircraft/times", data={"tach": "300", "hobbs": "300",
                                          "total_time": "300", "engine_smoh": "300",
                                          "prop_since": "300"})
    post(client, "/logbook/add", data={
        "entry_date": date.today().isoformat(), "kind": "Maintenance",
        "summary": "Oil and filter change", "work": "Aeroshell 15W50, new filter",
        "performed_by": "Me", "item_id": str(oil), "completes": "1", "cost": "95",
    })
    item = {i["name"]: i for i in client.app_module.db.items_due()}["Oil and filter change"]
    assert item["last_done_hours"] == 300.0
    assert client.app_module.db.scalar("SELECT SUM(amount_cents) FROM costs") == 9500


def test_document_upload_and_serve(client):
    pdf = b"%PDF-1.4\n% test\n"
    post(client, "/documents/upload",
         data={"doc_type": "Registration", "caption": "N912WG registration"},
         files={"documents": ("reg.pdf", pdf, "application/pdf")})
    html = client.get("/documents").text
    assert "N912WG registration" in html
    stored = client.app_module.db.one("SELECT stored_name FROM attachments")["stored_name"]
    served = client.get(f"/files/{stored}")
    assert served.status_code == 200 and served.content == pdf
    assert client.get("/files/..%2F..%2Fowner-log.db").status_code == 404


def test_rejected_upload_type(client):
    response = post(client, "/documents/upload",
                    files={"documents": ("x.exe", b"MZ", "application/x-msdownload")})
    assert "err=" in response.headers["location"]
    assert client.app_module.db.scalar("SELECT COUNT(*) FROM attachments") == 0


# ------------------------------------------------------------------ reports


def test_annual_packet_pdf(client):
    post(client, "/directives/add", data={"kind": "AD", "number": "2025-04-01",
                                          "title": "Wing bolt torque",
                                          "status": "complied",
                                          "complied_on": days_ago(100)})
    post(client, "/equipment/add", data={"name": "Garmin G3X", "category": "Avionics",
                                         "serial": "ABC123"})
    post(client, "/squawks/add", data={"title": "Nav light intermittent",
                                       "severity": "low"})
    post(client, "/logbook/add", data={"entry_date": days_ago(20),
                                       "summary": "Replaced tyres", "kind": "Maintenance"})
    response = client.get("/export/annual.pdf")
    assert response.status_code == 200
    assert response.content.startswith(b"%PDF")
    assert len(response.content) > 3000


def test_compliance_and_cost_pdfs(client):
    post(client, "/vor/add", data={"checked_on": date.today().isoformat(),
                                   "place": "KHAO"})
    post(client, "/directives/add", data={"kind": "SB", "number": "SB-1",
                                          "title": "Test"})
    post(client, "/costs/add", data={"spent_on": date.today().isoformat(),
                                     "amount": "100", "category": "Fuel"})
    assert client.get("/export/compliance.pdf").content.startswith(b"%PDF")
    assert client.get("/export/costs.pdf").content.startswith(b"%PDF")


def test_csv_exports(client):
    post(client, "/people/add", data={"name": "Wyley", "role": "Owner"})
    post(client, "/flights/add", data={"flew_on": days_ago(3), "hours": "1.5",
                                       "route": "KHAO local", "person_id": "1"})
    post(client, "/squawks/add", data={"title": "Test squawk", "severity": "medium"})
    assert "KHAO local" in client.get("/export/flights.csv").text
    assert "Test squawk" in client.get("/export/squawks.csv").text
    data = client.get("/export/owner-log.json").json()
    for key in ("aircraft", "items", "flights", "squawks", "directives", "reserves"):
        assert key in data


# --------------------------------------------------------- backup, imports


def test_backup_and_restore_round_trip(client):
    post(client, "/aircraft", data={"tail": "N912WG", "make": "Van's",
                                    "model": "RV-12iS", "planned_hours": "100"})
    post(client, "/flights/add", data={"flew_on": days_ago(5), "hours": "2.5"})
    post(client, "/documents/upload",
         files={"documents": ("keep.png", png_bytes(), "image/png")})

    backup = client.get("/export/backup.zip")
    with zipfile.ZipFile(io.BytesIO(backup.content)) as archive:
        names = archive.namelist()
        assert "owner-log.db" in names
        assert any(n.startswith("uploads/") for n in names)
        assert "csv/maintenance-items.csv" in names

    post(client, "/flights/add", data={"flew_on": days_ago(1), "hours": "9"})
    assert client.app_module.db.scalar("SELECT COUNT(*) FROM flights") == 2

    response = post(client, "/settings/restore",
                    files={"backup": ("b.zip", backup.content, "application/zip")})
    assert response.status_code == 303
    assert client.app_module.db.scalar("SELECT COUNT(*) FROM flights") == 1
    assert client.app_module.db.aircraft()["tail"] == "N912WG"


def test_restore_rejects_a_random_zip(client):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("a.txt", "nope")
    response = post(client, "/settings/restore",
                    files={"backup": ("x.zip", buffer.getvalue(), "application/zip")})
    assert "err=" in response.headers["location"]


def test_flight_csv_import_adds_pilots(client):
    csv_text = (
        "Date,Pilot,From,To,Hours,Landings\n"
        f"{days_ago(9)},Test Pilot,KHAO,KI69,1.4,2\n"
        f"{days_ago(4)},Dad,KHAO,KHAO,0.9,3\n"
    )
    response = post(client, "/settings/import/flights",
                    files={"file": ("flights.csv", csv_text.encode(), "text/csv")})
    assert response.status_code == 303
    assert client.app_module.db.scalar("SELECT COUNT(*) FROM flights") == 2
    assert round(client.app_module.db.scalar("SELECT SUM(hours) FROM flights"), 2) == 2.3
    names = {r["name"] for r in client.app_module.db.query("SELECT name FROM people")}
    assert {"Test Pilot", "Dad"} <= names
    assert client.app_module.db.aircraft()["total_time"] == 2.3


# ---------------------------------------------------------------- aircraft


def test_overhaul_resets_the_counter_and_logs_it(client):
    post(client, "/aircraft/times", data={"tach": "2100", "hobbs": "2200",
                                          "total_time": "2100", "engine_smoh": "2050",
                                          "prop_since": "2050"})
    post(client, "/aircraft/overhaul", data={"what": "engine",
                                             "when": date.today().isoformat(),
                                             "performed_by": "Shop"})
    craft = client.app_module.db.aircraft()
    assert craft["engine_smoh"] == 0
    assert craft["total_time"] == 2100
    entry = client.app_module.db.one("SELECT * FROM entries ORDER BY id DESC")
    assert entry["summary"] == "Engine overhaul"


def test_engine_tbo_progress_on_dashboard(client):
    post(client, "/aircraft", data={"make": "Van's", "model": "RV-12iS",
                                    "engine_tbo": "2000", "planned_hours": "100"})
    post(client, "/aircraft/times", data={"tach": "500", "hobbs": "500",
                                          "total_time": "500", "engine_smoh": "500",
                                          "prop_since": "0"})
    html = client.get("/").text
    assert "Engine to TBO" in html
    assert "25.0%" in html
