"""Printable PDFs: the annual inspection packet, compliance, and costs."""
from __future__ import annotations

import io
from datetime import date

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from . import db

ACCENT = colors.HexColor("#C0272D")
INK = colors.HexColor("#1b1b1b")
MUTED = colors.HexColor("#6b6b6b")
RULE = colors.HexColor("#d8d8d8")
BAD = colors.HexColor("#C0272D")
OK = colors.HexColor("#1f7a4d")


def _styles() -> dict:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("t", parent=base["Title"], fontName="Helvetica-Bold",
                                fontSize=21, leading=25, textColor=INK,
                                alignment=TA_LEFT, spaceAfter=2),
        "sub": ParagraphStyle("s", parent=base["Normal"], fontName="Helvetica",
                              fontSize=10.5, leading=14, textColor=MUTED),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName="Helvetica-Bold",
                             fontSize=12.5, leading=15, textColor=ACCENT,
                             spaceBefore=14, spaceAfter=5),
        "body": ParagraphStyle("b", parent=base["Normal"], fontName="Helvetica",
                               fontSize=9.5, leading=12.5, textColor=INK),
        "cell": ParagraphStyle("c", parent=base["Normal"], fontName="Helvetica",
                               fontSize=8.8, leading=11, textColor=INK),
        "meta": ParagraphStyle("m", parent=base["Normal"], fontName="Helvetica-Oblique",
                               fontSize=8.5, leading=11, textColor=MUTED),
    }


def esc(text) -> str:
    return (
        str(text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "<br/>")
    )


def money(cents) -> str:
    return f"${int(cents or 0) / 100:,.2f}"


def _footer(canvas, doc) -> None:
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    width, _ = doc.pagesize
    canvas.drawString(doc.leftMargin, 0.52 * inch, doc.owl_footer)
    canvas.drawRightString(width - doc.rightMargin, 0.52 * inch,
                           f"Page {canvas.getPageNumber()}")
    canvas.setStrokeColor(RULE)
    canvas.line(doc.leftMargin, 0.72 * inch, width - doc.rightMargin, 0.72 * inch)
    canvas.restoreState()


def _doc(buffer, title: str):
    craft = db.aircraft()
    name = craft["tail"] or f"{craft['make']} {craft['model']}".strip() or "Aircraft"
    doc = SimpleDocTemplate(
        buffer, pagesize=letter,
        leftMargin=0.65 * inch, rightMargin=0.65 * inch,
        topMargin=0.7 * inch, bottomMargin=0.9 * inch,
        title=f"{name} — {title}",
    )
    doc.owl_footer = f"{name} · {title} · printed {date.today():%Y-%m-%d}"
    return doc, craft, name


def _table(data, doc, ratios, aligns=None) -> Table:
    table = Table(data, colWidths=[doc.width * r for r in ratios], repeatRows=1)
    style = [
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.6),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f6f6f6")]),
        ("GRID", (0, 0), (-1, -1), 0.4, RULE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
    ]
    for col in aligns or []:
        style.append(("ALIGN", (col, 1), (col, -1), "RIGHT"))
    table.setStyle(TableStyle(style))
    return table


def _header(story, styles, craft, name, title: str) -> None:
    story.append(Paragraph(esc(f"{name} — {title}"), styles["title"]))
    bits = [
        f"{craft['make']} {craft['model']}".strip(),
        f"S/N {craft['serial']}" if craft["serial"] else "",
        craft["year"],
        craft["home_base"],
    ]
    story.append(Paragraph(esc(" · ".join(b for b in bits if b)), styles["sub"]))
    story.append(Spacer(1, 8))
    times = (
        f"Tach {float(craft['tach'] or 0):,.1f} · "
        f"Hobbs {float(craft['hobbs'] or 0):,.1f} · "
        f"Airframe {float(craft['total_time'] or 0):,.1f} · "
        f"Engine since overhaul {float(craft['engine_smoh'] or 0):,.1f}"
    )
    story.append(Paragraph(esc(times), styles["body"]))


def annual_packet_pdf() -> bytes:
    """Everything an IA or DAR tends to ask for at the annual."""
    styles = _styles()
    buffer = io.BytesIO()
    doc, craft, name = _doc(buffer, "Annual inspection packet")
    story: list = []
    _header(story, styles, craft, name, "Annual inspection packet")

    status = db.airworthiness()
    verdict = "Records show no overdue airworthiness items." if status["ready"] else (
        "Records show overdue items — see below."
    )
    story.append(Paragraph(esc(verdict), styles["body"]))

    story.append(Paragraph("Inspections and recurring items", styles["h2"]))
    rows = [["Item", "Interval", "Last done", "Next due", "Status"]]
    for item in db.items_due(include_inactive=False):
        interval = []
        if item["interval_hours"]:
            interval.append(f"{item['interval_hours']:g} h")
        if item["interval_months"]:
            interval.append(f"{item['interval_months']:g} mo")
        last = item["last_done_date"] or "—"
        if item["last_done_hours"] is not None:
            last += f" @ {item['last_done_hours']:g}"
        due = item["next_date"] or "—"
        if item["next_hours"] is not None:
            due += f" / {item['next_hours']:g} h"
        rows.append(
            [
                Paragraph(esc(item["name"]), styles["cell"]),
                " + ".join(interval) or "—",
                last,
                due,
                item["status"].replace("_", " "),
            ]
        )
    story.append(_table(rows, doc, [0.33, 0.14, 0.2, 0.21, 0.12]))

    story.append(Paragraph("Airworthiness directives and service bulletins", styles["h2"]))
    directives = db.directives_due()
    if directives:
        rows = [["Type", "Number", "Title", "Complied", "Method", "Status"]]
        for d in directives:
            complied = d["complied_on"] or "—"
            if d["complied_hours"] is not None:
                complied += f" @ {d['complied_hours']:g}"
            rows.append(
                [
                    d["kind"],
                    Paragraph(esc(d["number"]), styles["cell"]),
                    Paragraph(esc(d["title"]), styles["cell"]),
                    complied,
                    Paragraph(esc(d["method"]), styles["cell"]),
                    d["due_status"].replace("_", " "),
                ]
            )
        story.append(_table(rows, doc, [0.08, 0.15, 0.3, 0.16, 0.19, 0.12]))
    else:
        story.append(Paragraph("No directives recorded.", styles["meta"]))

    story.append(Paragraph("Installed equipment", styles["h2"]))
    equipment = db.query(
        "SELECT * FROM equipment WHERE removed_on = '' ORDER BY category, name"
    )
    if equipment:
        rows = [["Component", "Category", "Make / model", "Part", "Serial", "Installed"]]
        for e in equipment:
            rows.append(
                [
                    Paragraph(esc(e["name"]), styles["cell"]),
                    e["category"],
                    Paragraph(esc(f"{e['make']} {e['model']}".strip()), styles["cell"]),
                    Paragraph(esc(e["part_number"]), styles["cell"]),
                    Paragraph(esc(e["serial"]), styles["cell"]),
                    e["installed_on"] or "—",
                ]
            )
        story.append(_table(rows, doc, [0.24, 0.13, 0.22, 0.14, 0.14, 0.13]))
    else:
        story.append(Paragraph("No equipment recorded.", styles["meta"]))

    story.append(Paragraph("Open squawks", styles["h2"]))
    squawks = db.query(
        "SELECT * FROM squawks WHERE status != 'resolved' ORDER BY reported_on"
    )
    if squawks:
        rows = [["Reported", "Squawk", "Severity", "Status", "Grounding"]]
        for s in squawks:
            rows.append(
                [
                    s["reported_on"],
                    Paragraph(esc(s["title"]), styles["cell"]),
                    s["severity"],
                    s["status"].replace("_", " "),
                    "yes" if s["grounding"] else "",
                ]
            )
        story.append(_table(rows, doc, [0.15, 0.45, 0.14, 0.15, 0.11]))
    else:
        story.append(Paragraph("No open squawks.", styles["meta"]))

    story.append(Paragraph("Maintenance since the last annual", styles["h2"]))
    last_annual = db.one(
        "SELECT last_done_date FROM items WHERE name LIKE 'Annual%' ORDER BY id LIMIT 1"
    )
    since = (last_annual["last_done_date"] if last_annual else "") or "0000-01-01"
    entries = db.query(
        "SELECT * FROM entries WHERE entry_date >= ? ORDER BY entry_date, id", (since,)
    )
    if entries:
        rows = [["Date", "Kind", "Work", "By", "Tach"]]
        for e in entries:
            rows.append(
                [
                    e["entry_date"],
                    e["kind"],
                    Paragraph(esc(e["summary"]), styles["cell"]),
                    Paragraph(esc(e["performed_by"]), styles["cell"]),
                    "" if e["tach"] is None else f"{e['tach']:g}",
                ]
            )
        story.append(_table(rows, doc, [0.14, 0.14, 0.4, 0.21, 0.11]))
    else:
        story.append(Paragraph("No entries recorded in this period.", styles["meta"]))

    story.append(Spacer(1, 14))
    story.append(
        Paragraph(
            "Prepared from the owner's own records. It is not a maintenance release "
            "and does not replace the aircraft's permanent logbooks.",
            styles["meta"],
        )
    )
    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buffer.getvalue()


def compliance_pdf() -> bytes:
    styles = _styles()
    buffer = io.BytesIO()
    doc, craft, name = _doc(buffer, "AD and SB compliance")
    story: list = []
    _header(story, styles, craft, name, "AD and SB compliance")

    for kind, label in (("AD", "Airworthiness directives"),
                        ("SD", "Safety directives"),
                        ("SB", "Service bulletins"),
                        ("Notice", "Notices and letters")):
        rows_in = [d for d in db.directives_due(kind)]
        if not rows_in:
            continue
        story.append(Paragraph(label, styles["h2"]))
        rows = [["Number", "Title", "Issued", "Recurs", "Complied", "Next due", "Status"]]
        for d in rows_in:
            recurs = []
            if d["interval_hours"]:
                recurs.append(f"{float(d['interval_hours']):g} h")
            if d["interval_months"]:
                recurs.append(f"{float(d['interval_months']):g} mo")
            next_due = d["next_date"] or ""
            if d["next_hours"] is not None:
                next_due = (next_due + " / " if next_due else "") + f"{d['next_hours']:g} h"
            rows.append(
                [
                    Paragraph(esc(d["number"]), styles["cell"]),
                    Paragraph(esc(d["title"]), styles["cell"]),
                    d["issued_on"] or "—",
                    " + ".join(recurs) or "—",
                    d["complied_on"] or "—",
                    next_due or "—",
                    d["due_status"].replace("_", " "),
                ]
            )
        story.append(_table(rows, doc, [0.15, 0.27, 0.11, 0.11, 0.12, 0.13, 0.11]))

    vor = db.vor_status()
    story.append(Paragraph("VOR checks", styles["h2"]))
    checks = db.query("SELECT * FROM vor_checks ORDER BY checked_on DESC LIMIT 20")
    if checks:
        rows = [["Date", "Place", "Method", "Bearing", "Error", "Signed"]]
        for c in checks:
            rows.append([c["checked_on"], Paragraph(esc(c["place"]), styles["cell"]),
                         c["method"], c["bearing"], c["error"],
                         Paragraph(esc(c["signed_by"]), styles["cell"])])
        story.append(_table(rows, doc, [0.14, 0.24, 0.14, 0.14, 0.14, 0.2]))
        if vor["next_date"]:
            story.append(Paragraph(esc(f"Next IFR check due {vor['next_date']}."),
                                   styles["meta"]))
    else:
        story.append(Paragraph("No VOR checks recorded.", styles["meta"]))

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buffer.getvalue()


def cost_pdf(planned_hours: float = 100.0) -> bytes:
    styles = _styles()
    buffer = io.BytesIO()
    doc, craft, name = _doc(buffer, "Cost of ownership")
    story: list = []
    _header(story, styles, craft, name, "Cost of ownership")

    summary = db.cost_summary(12)
    story.append(Paragraph("Last twelve months", styles["h2"]))
    rows = [
        ["Measure", "Amount"],
        ["Fixed costs", money(summary["fixed_cents"])],
        ["Variable costs", money(summary["variable_cents"])],
        ["Total spent", money(summary["total_cents"])],
        ["Hours flown", f"{summary['hours']:,.1f}"],
        ["Variable cost per hour", money(summary["variable_per_hour_cents"])],
        ["Fixed cost per hour", money(summary["fixed_per_hour_cents"])],
        ["Reserves set aside per hour", money(summary["reserve_rate_cents"])],
        ["All-in cost per hour", money(summary["all_in_per_hour_cents"])],
    ]
    story.append(_table(rows, doc, [0.6, 0.4], aligns=[1]))

    projection = db.hourly_projection(planned_hours)
    story.append(Paragraph("Projection", styles["h2"]))
    story.append(
        Paragraph(
            esc(
                f"At {projection['planned_hours']:g} hours a year, spreading "
                f"{money(projection['fixed_annual_cents'])} of fixed costs:"
            ),
            styles["body"],
        )
    )
    rows = [
        ["Component", "Per hour"],
        ["Fixed costs spread over the year", money(projection["fixed_per_hour_cents"])],
        ["Variable costs", money(projection["variable_per_hour_cents"])],
        ["Reserves", money(projection["reserve_rate_cents"])],
        ["Total per hour", money(projection["total_per_hour_cents"])],
        ["Total per year", money(projection["annual_total_cents"])],
    ]
    story.append(_table(rows, doc, [0.6, 0.4], aligns=[1]))

    story.append(Paragraph("Reserves", styles["h2"]))
    reserves = db.reserve_balances()
    if reserves:
        rows = [["Reserve", "Rate per hour", "Balance", "Target"]]
        for r in reserves:
            rows.append([
                Paragraph(esc(r["name"]), styles["cell"]),
                money(r["rate_cents"]),
                money(r["balance_cents"]),
                money(r["target_cents"]) if r["target_cents"] else "—",
            ])
        story.append(_table(rows, doc, [0.4, 0.2, 0.2, 0.2], aligns=[1, 2, 3]))

    story.append(Paragraph("Spending by category", styles["h2"]))
    cats = db.query(
        "SELECT category, kind, SUM(amount_cents) AS cents, COUNT(*) AS n"
        " FROM costs GROUP BY category ORDER BY cents DESC"
    )
    if cats:
        rows = [["Category", "Type", "Entries", "Total"]]
        for c in cats:
            rows.append([c["category"], c["kind"], str(c["n"]),
                         money(c["cents"])])
        story.append(_table(rows, doc, [0.4, 0.2, 0.15, 0.25], aligns=[2, 3]))
    else:
        story.append(Paragraph("No costs recorded.", styles["meta"]))

    story.append(Spacer(1, 12))
    story.append(
        Paragraph(
            "Figures come from the costs and flights recorded in this app. "
            "Depreciation and the cost of capital are not included.",
            styles["meta"],
        )
    )
    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buffer.getvalue()
