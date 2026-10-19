"""Regenerate the sample data in js/data.js from the UC01 specification workbook.

Usage:
    python tools/build_demo_data.py <uc1_workbook.xlsx> <cash_plans.csv>

Both inputs live in the backend repository (data/uc1_workbook.xlsx, data/cash_plans.csv). The workbook holds the raw
synthetic invoices, inventory lots and financial rows that SRS v1.3 Appendix D (T39-T50) is computed from; the CSV
holds the planned cash flows (payroll, rent, tax, ...) used by UC02.

The script writes DATA.raw (one normalised snapshot per sample company, half-year period, N = 183 days) and keeps the
financing catalogue (DATA.cat) and the what-if presets (SC) of the current js/data.js unchanged. The browser builds
every UC01/UC02 result from DATA.raw with the same engine that processes uploaded files (BR-02.18), so no computed
figure is stored here.
"""
from __future__ import annotations

import csv
import json
import re
import sys
import unicodedata
from datetime import date, datetime, timedelta
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent
DATA_JS = ROOT / "js" / "data.js"
AS_OF = date(2026, 9, 30)
PERIOD_DAYS = 183  # half-year analysis period: period start = as_of - 182

# The demo UI is in English, so party and lot names of the workbook are translated once here (same names as the earlier data.js).
# Keys are the workbook names with accents removed (see tr()), so this file holds no Vietnamese text.
NAMES = {
    "Nha xuat khau Lon K1": "Large Exporter K1",
    "Nha xuat khau K2": "Exporter K2",
    "Thuong hieu noi dia K3": "Domestic Brand K3",
    "Nha phan phoi vai Beta (F02)": "Beta Fabric Distributor (F02)",
    "Bao bi – phu lieu Gamma (F03)": "Gamma Packaging & Trims (F03)",
    "Chi – nut – khoa NCC4": "Thread, Button, Zipper SUP4",
    "Van tai noi dia NCC5": "Domestic Transport SUP5",
    "Vai tu mua cho don FOB": "Fabric bought for FOB orders",
    "Phu lieu (chi, nut, khoa, nhan)": "Trims (thread, buttons, zippers, labels)",
    "Ban thanh pham tren chuyen": "Work in progress on the line",
    "Thanh pham cho xuat (don K2)": "Finished goods awaiting shipment (K2 order)",
    "Phu lieu don hang bi huy mua He": "Trims for cancelled summer order",
    "Vai cua Nha xuat khau K1 giao de gia cong": "Fabric supplied by Large Exporter K1 for subcontracting",
    "Xuong may gia cong Alpha (F01)": "Alpha Garment Subcontractor (F01)",
    "Xuong may KH2": "Garment Factory KH2",
    "Xuong may KH3": "Garment Factory KH3",
    "Xuong may KH4": "Garment Factory KH4",
    "Xuong may KH5": "Garment Factory KH5",
    "Nha may vai nuoc ngoai S1": "Overseas fabric mill S1",
    "Nha may vai nuoc ngoai S2": "Overseas fabric mill S2",
    "Logistics – thong quan S3": "Logistics and customs S3",
    "Vai cotton nhap khau": "Imported cotton fabric",
    "Vai polyester nhap khau": "Imported polyester fabric",
    "Vai kaki ton tu mua truoc": "Khaki fabric left over from last season",
    "Hang dang tren duong ve cang": "Goods in transit to port",
    "Giay cuon – NCC P1": "Paper rolls – SUP P1",
    "Muc in – NCC P2": "Printing ink – SUP P2",
    "Dien – NCC P3": "Electricity – SUP P3",
    "Giay cuon": "Paper rolls",
    "Muc in, keo": "Ink and glue",
    "Thung carton thanh pham": "Finished-goods cartons",
    "The bai in theo mau da doi thiet ke": "Cards printed on a redesigned template",
}

# Company profile declarations for the sample companies (the workbook has no business_model column).
# F01 is a garment subcontractor ("CMT combined with partial FOB"), F02 a fabric trader, F03 a trims/packaging maker.
PROFILE = {
    "F01": {"name": "Alpha Garment Subcontractor", "business_model": "CMT", "position": "cmt",
            "industry": "Garment subcontracting (CMT with some FOB orders)",
            # SRS T43 declares Beta as an essential supplier of F01.
            "essential_suppliers": ["Beta Fabric Distributor (F02)"]},
    "F02": {"name": "Beta Fabric Distributor", "business_model": "FOB", "position": "trading",
            "industry": "Fabric and trims trading", "essential_suppliers": []},
    "F03": {"name": "Gamma Packaging & Trims", "business_model": "FOB", "position": "trims_packaging",
            "industry": "Cartons, labels and hang tags for garment factories", "essential_suppliers": []},
}


def as_date(v) -> date | None:
    if v in (None, ""):
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return date.fromisoformat(str(v)[:10])


def iso(v) -> str | None:
    d = as_date(v)
    return d.isoformat() if d else None


def sheet(wb, name):
    rows = list(wb[name].iter_rows(values_only=True))
    hi = next(i for i, r in enumerate(rows) if r and "firm_id" in r)
    head = rows[hi]
    return [dict(zip(head, r)) for r in rows[hi + 1:] if r and any(v is not None for v in r)]


def fold(s: str) -> str:
    """Remove accents (and map d-stroke to d) so workbook names match the keys of NAMES."""
    s = unicodedata.normalize("NFD", s).replace(chr(0x111), "d").replace(chr(0x110), "D")
    return "".join(c for c in s if not unicodedata.combining(c))


def tr(name: str) -> str:
    return NAMES.get(fold(str(name).strip()), str(name).strip())


def build(workbook: Path, plans_csv: Path) -> dict:
    wb = load_workbook(workbook, data_only=True, read_only=True)
    firms, fins = sheet(wb, "D_firms"), sheet(wb, "D_financials")
    sales, purchases, inventory = sheet(wb, "D_sales"), sheet(wb, "D_purchases"), sheet(wb, "D_inventory")
    with plans_csv.open(encoding="utf-8-sig", newline="") as fh:
        plans = list(csv.DictReader(fh))
    start = AS_OF - timedelta(days=PERIOD_DAYS - 1)
    raw = {}
    for f in ("F01", "F02", "F03"):
        firm = next(r for r in firms if r["firm_id"] == f)
        fin = next(r for r in fins if r["firm_id"] == f)
        m = re.fullmatch(r"\s*(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})\s*", str(fin["period"]))
        fin_start, fin_end = (m.group(1), m.group(2)) if m else (None, AS_OF.isoformat())
        s_rows = [r for r in sales if r["firm_id"] == f]
        p_rows = [r for r in purchases if r["firm_id"] == f]
        revenue = sum(int(r["amount_vnd"]) for r in s_rows if start <= as_date(r["issue_date"]) <= AS_OF)
        prof = PROFILE[f]
        raw[f] = {
            "firm": {"id": f, "name": prof["name"], "industry": prof["industry"], "position": prof["position"],
                     "business_model": prof["business_model"],
                     # min_cash_buffer_vnd is the company's own target level; the engine uses it as Rtarget.
                     "rtarget": int(firm["min_cash_buffer_vnd"]),
                     "essential_suppliers": prof["essential_suppliers"], "strategic_customers": []},
            "snapshot": {"id": f"SNP-{f}-{AS_OF:%Y%m%d}-01", "as_of": AS_OF.isoformat(), "source": f"sample:{f}"},
            # Two financial rows: revenue over the half-year period (sum of sales invoices issued in it, as in
            # Appendix D) and the 90-day COGS row of the workbook (converted to N days by the engine, provisional).
            "fin": [
                {"period_start": start.isoformat(), "period_end": AS_OF.isoformat(), "revenue": revenue,
                 "revenue_basis": "sales_invoices"},
                {"period_start": fin_start, "period_end": fin_end, "revenue": int(fin["revenue_vnd"]),
                 "cogs": int(fin["cogs_vnd"]), "opening_cash": int(fin["opening_cash_vnd"])},
            ],
            "sales": [[str(r["invoice_id"]), tr(r["buyer"]), int(r["amount_vnd"]), iso(r["issue_date"]),
                       iso(r["due_date"]), iso(r["paid_date"])] for r in s_rows],
            "purchases": [[str(r["invoice_id"]), tr(r["supplier"]), int(r["amount_vnd"]), iso(r["issue_date"]),
                           iso(r["due_date"]), iso(r["paid_date"]), float(r["early_discount_pct"] or 0),
                           int(r["discount_days"] or 0)] for r in p_rows],
            # [name, type, qty, unit cost, days in stock, owner, cancelled, pledged]; declarations default to unknown.
            "inventory": [[tr(r["product_line"]), str(r["inventory_type"]), int(r["qty"]), int(r["unit_cost_vnd"]),
                           int(r["days_in_stock"]), "customer" if str(r["inventory_type"]) == "HGC" else "own",
                           "unknown", "unknown"] for r in inventory if r["firm_id"] == f],
            # [id, date, direction, category, amount, certainty, source id]; SRS-DECISION: the CSV has no certainty column, so plans are
            # 'estimated' (all sample plans are outflows, which stress_7 never moves).
            "planned": [[p["event_id"], p["date"], p["direction"], p["category"], int(float(p["amount_vnd"])),
                         "estimated", p["source_id"]] for p in plans if p["firm_id"] == f],
            "config": {"amount_basis": "net", "vat_rate": None},
        }
    return raw


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    raw = build(Path(sys.argv[1]), Path(sys.argv[2]))
    text = DATA_JS.read_text(encoding="utf-8")
    old = json.loads(re.search(r"const DATA=(\{.*?\});\s*\n", text, re.S).group(1))
    sc = re.search(r"(let SC=.*)$", text, re.S).group(1).strip()
    head = ("/* Sample data: raw snapshots of F01-F03 (generated by tools/build_demo_data.py from the UC01 workbook and "
            "cash_plans.csv), the synthetic financing catalogue and the what-if presets. */\n")
    body = "const DATA=" + json.dumps({"cat": old["cat"], "raw": raw}, ensure_ascii=False, separators=(",", ":")) + ";\n"
    DATA_JS.write_text(head + body + sc + "\n", encoding="utf-8")
    for f, r in raw.items():
        print(f, "sales", len(r["sales"]), "purchases", len(r["purchases"]), "lots", len(r["inventory"]),
              "plans", len(r["planned"]), "revenue (183 d)", r["fin"][0]["revenue"])


if __name__ == "__main__":
    main()
