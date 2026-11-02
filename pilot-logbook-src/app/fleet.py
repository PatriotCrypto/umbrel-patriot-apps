"""Aircraft: the airplanes you fly, with their details, equipment, photo, POH and papers.

The aircraft table started as a copy of ForeFlight's aircraft list; this module adds the columns a pilot fills
in by hand and an optional lookup in the FAA aircraft registry. The lookup is the only network call here and
only happens when you press the button.
"""
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime
from html.parser import HTMLParser

EXTRA_COLS = [("serial", "TEXT"), ("engine", "TEXT"), ("equipment", "TEXT"), ("equipment_notes", "TEXT"),
              ("notes", "TEXT"), ("photo_doc", "INTEGER"), ("registration_expires", "TEXT"), ("faa_json", "TEXT"),
              ("faa_checked", "TEXT"), ("updated_at", "TEXT")]

CLASSES = [("airplane_single_engine_land", "Airplane, single-engine land"),
           ("airplane_single_engine_sea", "Airplane, single-engine sea"),
           ("airplane_multi_engine_land", "Airplane, multi-engine land"),
           ("airplane_multi_engine_sea", "Airplane, multi-engine sea"),
           ("rotorcraft_helicopter", "Helicopter"), ("rotorcraft_gyroplane", "Gyroplane"),
           ("glider", "Glider"), ("lighter_than_air_balloon", "Balloon"),
           ("weight_shift_control_land", "Weight-shift control"), ("powered_parachute_land", "Powered parachute"),
           ("powered_lift", "Powered lift")]
CLASS_LABEL = dict(CLASSES)
GEAR = [("", "Not set"), ("fixed_tricycle", "Fixed tricycle"), ("fixed_tailwheel", "Fixed tailwheel"),
        ("retractable_tricycle", "Retractable tricycle"), ("retractable_tailwheel", "Retractable tailwheel"),
        ("amphibian", "Amphibian"), ("floats", "Floats"), ("skids", "Skids"), ("skis", "Skis")]
ENGINES = [("", "Not set"), ("Piston", "Piston"), ("Turboprop", "Turboprop"), ("Jet", "Jet"),
           ("Electric", "Electric"), ("Non-Powered", "None (glider or balloon)")]

# Common equipment, grouped the way you'd describe the panel. Stored as a JSON list of these labels.
EQUIPMENT = [
    ("Navigation", ["GPS, IFR approach approved (WAAS)", "GPS, VFR only", "VOR", "ILS / glideslope", "DME", "ADF",
                    "Moving map / EFB mount"]),
    ("Communication and surveillance", ["Single nav/com", "Dual nav/com", "Intercom", "Transponder (Mode C)",
                                        "Transponder (Mode S)", "ADS-B Out", "ADS-B In (traffic and weather)",
                                        "ELT (406 MHz)", "ELT (121.5 MHz)"]),
    ("Instruments and autopilot", ["Glass cockpit (PFD / MFD)", "Analog six-pack", "Synthetic vision", "Autopilot",
                                   "Altitude hold", "Angle of attack indicator", "Engine monitor",
                                   "Fuel totalizer"]),
    ("Safety and comfort", ["Ballistic parachute", "Carbon monoxide detector", "Oxygen", "Heated pitot",
                            "Air conditioning", "Shoulder harnesses"]),
]
EQUIPMENT_ALL = [x for _, items in EQUIPMENT for x in items]

N_NUMBER = re.compile(r"^N?([1-9][0-9]{0,4}|[1-9][0-9]{0,3}[A-HJ-NP-Z]|[1-9][0-9]{0,2}[A-HJ-NP-Z]{2})$")
IDENT = re.compile(r"^[A-Z0-9][A-Z0-9\-]{0,11}$")


def ensure_schema(db):
    have = {r[1] for r in db.execute("PRAGMA table_info(aircraft)")}
    for col, typ in EXTRA_COLS:
        if col not in have:
            db.execute(f"ALTER TABLE aircraft ADD COLUMN {col} {typ}")
    db.commit()


def is_n_number(ident):
    return bool(N_NUMBER.match((ident or "").strip().upper()))


def equipment_of(row):
    try:
        v = json.loads(row["equipment"] or "[]")
        return [x for x in v if isinstance(x, str)]
    except (ValueError, TypeError, KeyError, IndexError):
        return []


def faa_of(row):
    try:
        v = json.loads(row["faa_json"] or "{}")
        return v if isinstance(v, dict) else {}
    except (ValueError, TypeError, KeyError, IndexError):
        return {}


def _yes(v):
    return str(v or "").strip().upper() in ("TRUE", "1", "YES", "Y")


def decorate(row, stats=None, docs=None, today=None):
    """A dict for templates: the row plus labels, equipment, registry data, flying and documents."""
    today = today or date.today()
    a = dict(row)
    a["class_label"] = CLASS_LABEL.get(a.get("aircraft_class") or "", (a.get("aircraft_class") or "").replace("_", " "))
    a["gear_label"] = dict(GEAR).get(a.get("gear_type") or "", (a.get("gear_type") or "").replace("_", " "))
    a["equipment_list"] = equipment_of(row)
    a["faa"] = faa_of(row)
    a["flags"] = [label for key, label in (("complex", "Complex"), ("high_perf", "High performance"),
                                            ("taa", "Technically advanced"), ("pressurized", "Pressurized"))
                  if _yes(a.get(key))]
    a["title"] = " ".join(x for x in (a.get("year"), a.get("make"), a.get("model")) if x) or "Details not entered"
    reg = a.get("registration_expires") or ""
    a["reg_days"] = None
    if reg:
        try:
            a["reg_days"] = (datetime.strptime(reg, "%Y-%m-%d").date() - today).days
        except ValueError:
            pass
    s = stats or {}
    a.update(hours=s.get("hours", 0.0), flights=s.get("flights", 0), last_flown=s.get("last"),
             landings=s.get("landings", 0))
    a["docs"] = docs or []
    a["poh"] = [d for d in a["docs"] if d["category"] == "manuals"]
    return a


def stats_by_aircraft(db):
    out = {}
    for r in db.execute("SELECT aircraft, COUNT(*) n, COALESCE(SUM(total),0) h, MAX(date) last, "
                        "COALESCE(SUM(COALESCE(day_landings,0)+COALESCE(night_landings,0)),0) l "
                        "FROM flights WHERE aircraft!='' GROUP BY aircraft"):
        out[r["aircraft"]] = {"flights": r["n"], "hours": r["h"], "last": r["last"], "landings": r["l"]}
    return out


def docs_by_aircraft(db):
    out = {}
    for r in db.execute("SELECT * FROM documents WHERE aircraft IS NOT NULL AND aircraft!='' "
                        "ORDER BY CASE category WHEN 'manuals' THEN 0 WHEN 'aircraft' THEN 1 ELSE 2 END, title"):
        out.setdefault(r["aircraft"], []).append(dict(r))
    return out


def sync_from_flights(db):
    """Every tail number in the logbook gets an aircraft entry, so it can be filled in here."""
    cur = db.execute("INSERT OR IGNORE INTO aircraft(ident, aircraft_class) SELECT DISTINCT upper(trim(aircraft)), "
                     "'airplane_single_engine_land' FROM flights WHERE trim(COALESCE(aircraft,''))!=''")
    if cur.rowcount:
        db.commit()


def listing(db, today=None):
    sync_from_flights(db)
    stats, docs = stats_by_aircraft(db), docs_by_aircraft(db)
    rows = [decorate(r, stats.get(r["ident"]), docs.get(r["ident"]), today)
            for r in db.execute("SELECT * FROM aircraft ORDER BY ident")]
    # most recently flown first, aircraft never flown at the end
    return sorted(rows, key=lambda a: (a["last_flown"] or "", a["ident"]), reverse=True)


def get(db, ident, today=None):
    sync_from_flights(db)
    r = db.execute("SELECT * FROM aircraft WHERE ident=?", (ident,)).fetchone()
    if not r:
        return None
    return decorate(r, stats_by_aircraft(db).get(ident), docs_by_aircraft(db).get(ident), today)


def parse_form(form, new=False):
    """(values, errors) from the add or edit form."""
    errors = []
    v = {}
    if new:
        ident = (form.get("ident") or "").strip().upper().replace(" ", "")
        if not IDENT.match(ident):
            errors.append("Enter the registration, for example N12345 (letters, digits and dashes).")
        v["ident"] = ident
    year = (form.get("year") or "").strip()
    if year and not (year.isdigit() and 1900 <= int(year) <= date.today().year + 1):
        errors.append("The year should look like 2016.")
    v["year"] = year
    for key, n in (("make", 80), ("model", 80), ("type_code", 10), ("serial", 40), ("engine", 120),
                   ("equipment_notes", 2000), ("notes", 5000)):
        v[key] = (form.get(key) or "").strip()[:n]
    v["type_code"] = v["type_code"].upper()
    cls = form.get("aircraft_class") or ""
    v["aircraft_class"] = cls if cls in CLASS_LABEL else "airplane_single_engine_land"
    v["gear_type"] = form.get("gear_type") if form.get("gear_type") in dict(GEAR) else ""
    v["engine_type"] = form.get("engine_type") if form.get("engine_type") in dict(ENGINES) else ""
    for key in ("complex", "high_perf", "taa", "pressurized"):
        v[key] = "TRUE" if form.get(key) else ""
    chosen = form.getlist("equipment") if hasattr(form, "getlist") else (form.get("equipment") or [])
    v["equipment"] = json.dumps([x for x in EQUIPMENT_ALL if x in chosen])
    reg = (form.get("registration_expires") or "").strip()
    if reg:
        try:
            datetime.strptime(reg, "%Y-%m-%d")
        except ValueError:
            errors.append("Enter the registration expiration as YYYY-MM-DD, or leave it empty.")
    v["registration_expires"] = reg
    v["equip_type"] = "aircraft"
    return v, errors


def save(db, v, ident=None):
    v = dict(v)
    v["updated_at"] = datetime.now().isoformat(timespec="seconds")
    if ident is None:
        ident = v.pop("ident")
        cols = ["ident"] + list(v)
        db.execute(f"INSERT INTO aircraft({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                   (ident, *v.values()))
    else:
        v.pop("ident", None)
        db.execute(f"UPDATE aircraft SET {', '.join(k + '=?' for k in v)} WHERE ident=?", (*v.values(), ident))
    db.commit()
    return ident


# ----------------------------------------------------------------------------- FAA registry lookup

REGISTRY_URL = "https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt="


class _Tables(HTMLParser):
    """Collects every table on the page as [caption, [[cell text, ...] per row]]."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self._cap, self._cell, self._in_cap, self._depth = [], None, None, False, 0

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._depth += 1
            self.tables.append([self._cap or "", []])
            self._cap = None
        elif tag == "caption":
            self._in_cap, self._cap = True, ""
        elif tag == "tr" and self.tables:
            self.tables[-1][1].append([])
        elif tag in ("td", "th") and self.tables:
            self._cell = ""

    def handle_endtag(self, tag):
        if tag == "caption":
            self._in_cap = False
            if self.tables and self._depth and not self.tables[-1][0]:
                self.tables[-1][0], self._cap = self._cap.strip(), None
        elif tag in ("td", "th") and self._cell is not None and self.tables:
            rows = self.tables[-1][1]
            if not rows:
                rows.append([])
            rows[-1].append(" ".join(self._cell.split()))
            self._cell = None
        elif tag == "table":
            self._depth = max(0, self._depth - 1)

    def handle_data(self, data):
        if self._in_cap:
            self._cap += data
        elif self._cell is not None:
            self._cell += data


def _norm(label):
    return " ".join(label.replace(":", " ").split()).lower()


def parse_registry(html):
    """The FAA's N-number result page as {section: {label: value}}. Each row holds label/value pairs."""
    p = _Tables()
    p.feed(html)
    out = {}
    for caption, rows in p.tables:
        sec = " ".join(caption.split()) or "Other"
        d = out.setdefault(sec, {})
        for cells in rows:
            for i in range(0, len(cells) - 1, 2):
                label, value = cells[i].strip(), cells[i + 1].strip()
                if label and len(label) < 60 and value and value.lower() != "none":
                    d.setdefault(label, value)
    return out


def _us_date(s):
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s.strip(), fmt).date().isoformat()
        except (ValueError, AttributeError):
            pass
    return ""


_KEEP_UPPER = {"LLC", "LP", "LLP", "USA", "II", "III", "IV", "JR", "SR", "PA", "LSA", "AG", "GMBH", "SA", "CO-OP"}


def _title(s):
    """The registry shouts in capitals: VANS AIRCRAFT INC becomes Vans Aircraft Inc."""
    s = (s or "").strip()
    if not s.isupper():
        return s
    return " ".join(w if w in _KEEP_UPPER or any(c.isdigit() for c in w) else w.capitalize() for w in s.split())


TYPE_AIRCRAFT = {"fixed wing single-engine": "airplane_single_engine_land",
                 "fixed wing multi-engine": "airplane_multi_engine_land",
                 "rotorcraft": "rotorcraft_helicopter", "gyroplane": "rotorcraft_gyroplane", "glider": "glider",
                 "balloon": "lighter_than_air_balloon", "weight-shift-control": "weight_shift_control_land",
                 "powered parachute": "powered_parachute_land", "powered lift": "powered_lift"}
TYPE_ENGINE = {"reciprocating": "Piston", "4 cycle": "Piston", "2 cycle": "Piston", "turbo-prop": "Turboprop",
               "turbo-shaft": "Turboprop", "turbo-fan": "Jet", "turbo-jet": "Jet", "electric": "Electric",
               "none": "Non-Powered"}


def registry_fields(sections):
    """Map the registry page onto aircraft columns. Returns (values, summary) or raises LookupError."""
    flat = {}
    for sec, d in sections.items():
        for k, v in d.items():
            flat.setdefault(_norm(k), v)
            flat.setdefault(_norm(sec) + "|" + _norm(k), v)
    if not any(k in flat for k in ("serial number", "manufacturer name", "model")):
        raise LookupError("The FAA registry has no current registration for that N-number.")
    g = flat.get
    vals = {"make": _title(g("manufacturer name", "")), "model": g("model", ""), "year": g("mfr year", ""),
            "serial": g("serial number", "")}
    cls = TYPE_AIRCRAFT.get((g("type aircraft") or "").lower())
    if cls:
        vals["aircraft_class"] = cls
    eng = TYPE_ENGINE.get((g("type engine") or "").lower())
    if eng:
        vals["engine_type"] = eng
    engine = " ".join(x for x in (_title(g("engine manufacturer", "")), g("engine model", "")) if x)
    if engine:
        vals["engine"] = engine
    exp = _us_date(g("expiration date", ""))
    if exp:
        vals["registration_expires"] = exp
    if not vals["year"].isdigit():
        vals["year"] = ""
    summary = {}
    for label, keys in (("Status", ["status"]), ("Registration type", ["type registration"]),
                        ("Certificate issued", ["certificate issue date"]),
                        ("Airworthiness class", ["classification", "airworthiness classification"]),
                        ("Category", ["category"]), ("Airworthiness date", ["a/w date", "airworthiness date"]),
                        ("Registration expires", ["expiration date"]), ("Mode S code (hex)", ["mode s code (base 16 / hex)"]),
                        ("Registered owner", ["registered owner|name"]), ("Owner city", ["registered owner|city"]),
                        ("Owner state", ["registered owner|state"])):
        v = next((g(k) for k in keys if g(k)), "")
        if v:
            summary[label] = _title(v) if label.startswith("Owner") or label == "Registered owner" else v
    return {k: v for k, v in vals.items() if v}, summary


def lookup(ident, timeout=12, opener=None):
    """Ask the FAA registry about an N-number. Returns (values, summary); raises LookupError with a
    message for the pilot when the number isn't registered or the registry can't be reached."""
    n = (ident or "").strip().upper()
    if not is_n_number(n):
        raise LookupError("Only U.S. N-numbers can be looked up. Enter the details by hand.")
    url = REGISTRY_URL + urllib.parse.quote(n.lstrip("N"))
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) PilotLog/1.7 (self-hosted)",
                                               "Accept": "text/html"})
    try:
        with (opener or urllib.request.urlopen)(req, timeout=timeout) as resp:
            html = resp.read(2_000_000).decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise LookupError("Couldn't reach the FAA registry right now. Enter the details by hand, or try again later.") from e
    return registry_fields(parse_registry(html))
