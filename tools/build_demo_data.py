"""Regenerate the sample data in js/data.js from the UC01-UC04 specification workbook (v10).

Usage:
    python tools/build_demo_data.py data/uc_workbook_v10.xlsx

The workbook ("Dac ta cong thuc FOB UC01-UC04 v10") holds one synthetic company, F01, an FOB garment maker (buys its own
materials, produces and sells finished goods; it holds no customer-owned stock) with a 171-day period. Every sheet has its title on row 2 and its header on row 4; columns are found by header name.

Read from the workbook:
- D_F01: profile, financials and configuration (key/value): period_start, as_of, N, revenue, COGS, cash, short-term
  investments, Rmin / Rtarget / Rupper, business_model, snapshot_id, the strategic-customer and essential-supplier
  declarations. The current assets of financials.current_assets are taken from F01_UC1 ("Tai san ngan han"), as the
  workbook's own name table (D_F01, "financials.current_assets") points there.
- D_sales, D_purchases, D_inventory: raw source columns only. Helper columns computed in the workbook (OpenFlag, DPD,
  Paid x Delay, Age, BookValue, ...) are ignored; the browser engine computes them.
- D_flows: planned cash flows (rows with firm == F01 and valid fields). Rows 16-45 are purchase invoices copied for
  reference (invoice_ref set): paid ones are in the past and unpaid ones are already scheduled from D_purchases, so they
  are left out to avoid counting them twice. The second table at the bottom (invoice_id / ConfirmedDate / known_at) is the
  confirmed receipt schedule: it moves the date of an existing sales invoice and adds no money, so it is stored on that
  invoice (7th field of the sales record) when known_at <= as_of.
- D_flows, third table ("Ngay" header): the 171-day daily cash history; its net flows give the sigma of the Miller-Orr reserve
  levels L / Z / H (config.js cash.mo.*). D_F01 revenue_ttm_actual is the 12-month revenue behind L. The script checks that the
  levels it recomputes match D_F01 rmin / rtarget / rupper within 1 VND.
- D_UC03: the financing catalogue (DATA.cat). Only products with a matching catalogue type are kept; fields that D_UC03
  does not have (provider, minimum / maximum amount, overdue cap, recourse, fee base) keep the previous value of the
  same product id, or of the same type for new ids. Excluded products are listed on stdout.

The script writes DATA.raw, DATA.cat, DATA.uc03 and DATA.uc04 and the what-if presets (SC, defined below: three-lever
presets on the v10 data). The
browser builds every UC01/UC02 result from DATA.raw with the same engine as uploaded files (BR-02.18), so no computed
figure is stored here.
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from datetime import date, datetime
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent
DATA_JS = ROOT / "js" / "data.js"
HEADER_ROW = 4  # every sheet: title on row 2, header on row 4

# The demo UI is in English, so party, lot and category names of the workbook are translated here.
# Keys are the workbook names with accents removed (see fold()), so this file holds no Vietnamese text.
NAMES = {
    # customers (v10, FOB buyers)
    "Khach mua FOB Lon K1": "Large FOB Buyer K1",
    "Khach mua FOB K2": "FOB Buyer K2",
    "Nha mua hang FOB K5": "FOB Buyer K5",
    "Nha xuat khau Lon K1": "Large Exporter K1",
    "Nha xuat khau K2": "Exporter K2",
    "Thuong hieu noi dia K3": "Domestic Brand K3",
    "Khach moi K4": "New Customer K4",
    "Cong ty may xuat khau K5": "Export Garment Company K5",
    "Thuong hieu thoi trang theo mua K6": "Seasonal Fashion Brand K6",
    "Dai ly vang lai K7": "Occasional Agent K7",
    "Cua hang nho K8": "Small Shop K8",
    "Khach ngung mua K9": "Lapsed Customer K9",
    # suppliers (the (F02)/(F03) tags of the old three-company demo are dropped: only F01 remains)
    "Nha phan phoi vai Beta (F02)": "Beta Fabric Distributor",
    "Bao bi – phu lieu Gamma (F03)": "Gamma Packaging & Trims",
    "Nha phan phoi vai Beta": "Beta Fabric Distributor",
    "Bao bi – phu lieu Gamma": "Gamma Packaging & Trims",
    "Chi – nut – khoa NCC4": "Thread, Button, Zipper SUP4",
    "Van tai noi dia NCC5": "Domestic Transport SUP5",
    "Xuong theu – in ngoai NCC6": "Outsourced Embroidery and Print Trims SUP6",
    "Dien luc khu cong nghiep": "Industrial Park Electricity",
    "Vai phu tro moi NCC7": "New Auxiliary Fabric Mill SUP7",
    "Vat tu tieu hao NCC8": "Consumables SUP8",
    "Phu lieu chi dinh NCC9": "Customer-Designated Trims SUP9",
    # inventory lots (v10 names first)
    "Vai chinh tu mua don FOB-0826": "Main fabric bought for order FOB-0826",
    "Phu lieu lot don FOB-0826": "Lining trims for order FOB-0826",
    "BTP da cat cho may – don FOB-0826": "Cut pieces awaiting sewing (WIP), order FOB-0826",
    "Vai tu mua cho don FOB K1": "Fabric bought for the K1 FOB order",
    "Vai tu mua cho don FOB K2": "Fabric bought for the K2 FOB order",
    "Phu lieu tu mua cho don FOB K3": "Trims bought for the K3 FOB order",
    "Phu lieu chinh don CMT-0826": "Main trims for order CMT-0826",
    "Phu lieu lot don CMT-0826": "Lining trims for order CMT-0826",
    "Vai kaki ton tu mua truoc": "Khaki fabric left over from last season",
    "Vai ren – lua mua thu (lo cu nhat)": "Lace and silk fabric bought on trial (oldest lot)",
    "Phu lieu chuyen dung (chi, nut, khoa)": "Special trims (thread, buttons, zippers)",
    "Phu lieu don hang bi huy mua He": "Trims for cancelled summer order",
    "Bao bi carton, tui PE": "Carton boxes and PE bags",
    "Nhan det, the bai da doi thiet ke": "Woven labels and hang tags on a redesigned template",
    "BTP da cat cho may – don CMT-0826": "Cut pieces awaiting sewing (WIP), order CMT-0826",
    "BTP cho kiem QC, sua loi": "Work in progress awaiting QC and rework",
    "BTP dang may – don K2": "Work in progress on the line, K2 order",
    "Thanh pham cho xuat – don K2": "Finished goods awaiting shipment, K2 order",
    "Thanh pham don K1 – khach cham nhan hang": "Finished goods for K1, customer slow to take delivery",
    "Thanh pham loi mau cho xu ly": "Finished goods with sample defects awaiting handling",
    "Vai mua ve de ban lai (dau cuon)": "Fabric bought for resale (roll ends)",
    "Phu lieu mua ban lai cho khach K3": "Trims bought for resale to customer K3",
    "Vai cua K1 giao de gia cong": "Fabric supplied by Large Exporter K1 for subcontracting",
    "Vai cua K2 giao de gia cong": "Fabric supplied by Exporter K2 for subcontracting",
    "Phu lieu K3 giao kem": "Trims supplied by Domestic Brand K3 for subcontracting",
    "Chi may & khoa keo (tieu hao hang ngay)": "Sewing thread and zippers (daily consumables)",
    "Vai lot mua thu (tuoi < nguong nhung dung cham)": "Autumn lining fabric (below the age limit but used slowly)",
    "Vai bo suu tap cu khong con don": "Fabric from an old collection with no order",
    "Keo, nhan det (ton an toan)": "Glue and woven labels (safety stock)",
    "Than ao cat san cho may (K2)": "Cut shirt bodies awaiting sewing (K2)",
    "Ao may xong cho theu (tuoi < nguong, un)": "Sewn shirts awaiting embroidery (below the age limit, backlog)",
    "Ao thun basic ton san ban nhanh": "Basic T-shirts in stock, fast-selling",
    "Thanh pham bo suu tap mua truoc": "Finished goods from last season's collection",
    "Thanh pham cho giao K2": "Finished goods awaiting delivery to K2",
    "Phu kien mua ve ban lai": "Accessories bought for resale",
    "Hang hoa loi mot": "Out-of-fashion trading goods",
    "Thanh pham sat nguong 30 ngay (28 ngay)": "Finished goods close to the 30-day limit (28 days)",
    "Vai dung nguong 60 ngay (khong > 60)": "Fabric exactly at the 60-day limit (not over 60)",
    "Thanh pham da cam co, luan chuyen tot": "Pledged finished goods, moving well",
}
# Planned-flow categories → engine category keys (KNOWN_CAT in js/engine.js); anything else is a generic planned outflow.
CATEGORY = {"Luong": "payroll", "Thue": "tax", "Thue xuong": "rent", "Goc vay": "debt_service", "Lai vay": "debt_service",
            "Tien ich (dien)": "utilities"}
YES, NO = {"co", "yes", "y", "1", "true"}, {"khong", "no", "n", "0", "false"}
# D_UC03 product group → DATA.cat type. NB (sell short-term investments), AP_EXT (supplier term extension) and INV_SALE
# (selling slow stock) have no catalogue type in the app: they are listed as excluded.
GROUP_TYPE = {"RF": "reverse_factoring", "FAC": "invoice_factoring", "INV_LOAN": "inventory_loan", "CL": "credit_line",
              "AR_EARLY": "dynamic_discounting"}
OBJECT_PARTY = {"OBJ-AR-K1": "Large Exporter K1", "OBJ-AR-K2": "Exporter K2", "OBJ-AR-K6": "Seasonal Fashion Brand K6"}
# UC03 product names (D_UC03 "San pham"), by product id.
PRODUCT_NAMES = {
    "NB-01": "Sell short-term investments (step 0)", "EX-01": "Extend non-essential supplier payments by 15–30 days",
    "EX-02": "Extend essential supplier payments", "AR-01": "Early collection of K1 invoices, 1% discount",
    "AR-02": "Early collection of K2 invoices", "RF-001": "Reverse factoring of K1 invoices", "FAC-001": "Factoring of K1 invoices",
    "FAC-002": "Factoring of K6 invoices", "INV-001": "Loan secured on normal inventory", "INV-002": "Clearance sale of slow TP/HH lots",
    "INV-003": "Loan secured on pledged lots", "CL-001": "Revolving credit line 1", "CL-002": "Revolving credit line 2",
    "TT-001": "Overdraft (no product data)",
}
ORDER_STATUS = {"dang hoat dong": "active", "khong gan don": "no_order", "hoan tat": "completed", "da huy": "cancelled",
                "thay doi thiet ke": "redesigned"}
CERTAINTY = {"Cao": 1, "Trung binh": 2, "Thap": 3}


def fold(s: str) -> str:
    """Remove accents (and map d-stroke to d) so workbook names match the keys of NAMES."""
    s = unicodedata.normalize("NFD", s).replace(chr(0x111), "d").replace(chr(0x110), "D")
    return "".join(c for c in s if not unicodedata.combining(c))


def tr(name) -> str:
    key = fold(str(name).strip())
    if key not in NAMES:
        raise SystemExit(f"No English name for {key!r}: add it to NAMES in tools/build_demo_data.py")
    return NAMES[key]


def as_date(v) -> date | None:
    if v in (None, ""):
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v).strip()[:10])
    except ValueError:
        return None


def iso(v) -> str | None:
    d = as_date(v)
    return d.isoformat() if d else None


def num(v) -> float | None:
    if v in (None, ""):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def flag(v) -> str:
    s = fold(str(v or "")).strip().lower()
    return "yes" if s in YES else "no" if s in NO else "unknown"


def table(wb, name: str, header_row: int = HEADER_ROW) -> list[dict]:
    """Rows under the header row as dicts keyed by header name; stops at the first fully empty row."""
    rows = list(wb[name].iter_rows(min_row=header_row, values_only=True))
    head = [str(h).strip() if h is not None else None for h in rows[0]]
    out = []
    for r in rows[1:]:
        if not r or all(v in (None, "") for v in r):
            break
        out.append({h: v for h, v in zip(head, r) if h})
    return out


def find_header(wb, name: str, first: str) -> int:
    """1-based row number of the header row whose first cell is `first` (for the second table of a sheet)."""
    for i, r in enumerate(wb[name].iter_rows(values_only=True), 1):
        if r and r[0] is not None and str(r[0]).strip() == first:
            return i
    raise SystemExit(f"{name}: header {first!r} not found")


def col(row: dict, *names):
    for n in names:
        if n in row:
            return row[n]
    raise SystemExit(f"Missing column {names[0]!r}; columns are {list(row)}")


def key_values(wb) -> dict:
    """D_F01: key/value block under the header row (Truong | Gia tri)."""
    out = {}
    for r in wb["D_F01"].iter_rows(min_row=HEADER_ROW + 1, values_only=True):
        if not r or r[0] in (None, ""):
            break
        out[str(r[0]).strip()] = r[1]
    return out


def declared(wb, first: str, label_col: int) -> dict:
    """D_F01 declaration tables (customers / suppliers): name → yes/no/unknown from column `label_col`."""
    start = find_header(wb, "D_F01", first)
    out = {}
    for r in wb["D_F01"].iter_rows(min_row=start + 1, values_only=True):
        if not r or r[0] in (None, ""):
            break
        out[tr(r[1])] = flag(r[label_col])
    return out


def build(path: Path) -> tuple[dict, list, list[str]]:
    wb = load_workbook(path, data_only=True, read_only=False)
    kv = key_values(wb)
    firm_id = str(kv["firm_id"]).strip()
    start, as_of, n = as_date(kv["period_start"]), as_date(kv["as_of"]), int(kv["N"])
    if (as_of - start).days + 1 != n:
        raise SystemExit(f"D_F01: N={n} does not match {start}..{as_of}")
    notes = []
    strategic = declared(wb, "customer_id", 2)
    essential = declared(wb, "supplier_id", 2)
    ca_row = next((r for r in table(wb, "F01_UC1") if fold(str(r.get("Chi tieu") or r.get(next(iter(r))) or "")).startswith("Tai san ngan han")), None)
    current_assets = num(list(ca_row.values())[1]) if ca_row else None

    sales_t = [r for r in table(wb, "D_sales") if col(r, "firm_id") == firm_id]
    pur_t = [r for r in table(wb, "D_purchases") if col(r, "firm_id") == firm_id]
    inv_t = [r for r in table(wb, "D_inventory") if col(r, "firm_id") == firm_id]
    flows_t = table(wb, "D_flows")

    # Confirmed receipt schedule (second table of D_flows): invoice_id, ConfirmedDate, known_at.
    conf = {}
    ch = find_header(wb, "D_flows", "invoice_id")
    for r in table(wb, "D_flows", ch):
        inv_id, d, known = str(r.get("invoice_id") or "").strip(), as_date(r.get("ConfirmedDate")), as_date(r.get("known_at"))
        if inv_id and d and (known is None or known <= as_of):
            conf[inv_id] = d.isoformat()
    sales = []
    for r in sales_t:
        sid = str(col(r, "invoice_id"))
        sales.append([sid, tr(col(r, "Tên khách", "Ten khach")), int(col(r, "Amount net")), iso(col(r, "IssueDate")),
                      iso(col(r, "DueDate")), iso(col(r, "PaidDate")), conf.get(sid), str(r.get("Status") or "").strip().lower() or None])
    missing = set(conf) - {s[0] for s in sales}
    if missing:
        raise SystemExit(f"Confirmed receipts for unknown invoices: {sorted(missing)}")
    purchases = [[str(col(r, "bill_id")), tr(col(r, "Tên NCC", "Ten NCC")), int(col(r, "Amount net")), iso(col(r, "IssueDate")),
                  iso(col(r, "DueDate")), iso(col(r, "PaidDate")), float(num(col(r, "DiscountPct")) or 0),
                  int(num(col(r, "DiscountDays")) or 0)] for r in pur_t]
    # [name, type, qty, unit cost, days in stock at as_of, owner, cancelled, pledged, lot id, order id, order status];
    # days from ReceivedDate (not the Age helper). Order status: active / no_order / completed / cancelled / redesigned.
    inventory = []
    for r in inv_t:
        owner = str(col(r, "Owner")).strip()
        status = fold(str(col(r, "OrderStatus") or "")).strip().lower()
        inventory.append([tr(col(r, "Mặt hàng / lô", "Mat hang / lo")), str(col(r, "Type")).strip().upper(), num(col(r, "Qty")),
                          num(col(r, "UnitCost")), (as_of - as_date(col(r, "ReceivedDate"))).days,
                          "own" if owner == firm_id else "customer", "yes" if status == "da huy" else "no", flag(col(r, "Pledged")),
                          str(col(r, "lot_id")).strip(), str(r.get("Order") or "").strip() or None, ORDER_STATUS.get(status, "unknown")])
    # Planned flows: firm == F01, a known direction, a valid date and amount; rows copied from D_purchases are skipped (see above).
    planned, skipped = [], 0
    for r in flows_t:
        if str(r.get("firm") or "").strip() != firm_id:
            continue
        d, amt, direction = as_date(r.get("date")), num(r.get("amount_vnd")), str(r.get("direction") or "").strip().upper()
        if not r.get("event_id") or d is None or amt is None or direction not in ("IN", "OUT"):
            continue
        if r.get("invoice_ref"):
            skipped += 1
            continue
        cat = CATEGORY.get(fold(str(r.get("category") or "")).strip(), "planned_outflow" if direction == "OUT" else "planned_inflow")
        certainty = "confirmed" if str(r.get("certainty") or "").strip().lower() == "confirmed" else "estimated"
        planned.append([str(r["event_id"]), d.isoformat(), direction, cat, int(amt), certainty, str(r["event_id"])])
    notes.append(f"D_flows: {len(planned)} planned flows; {skipped} rows copied from D_purchases skipped; "
                 f"{len(conf)} confirmed receipt date(s): {conf}")

    cash0 = int(num(kv["cash_total_vnd"]) - (num(kv.get("restricted_vnd")) or 0))
    rmin, rtarget, rupper = (num(kv[k]) for k in ("rmin_vnd", "rtarget_vnd", "rupper_vnd"))
    if not (0 <= rmin <= rtarget < rupper):
        raise SystemExit("D_F01: Rmin / Rtarget / Rupper are not ordered")
    # Daily cash history (third table of D_flows, header "Ngay"): [date, net flow] for the Miller-Orr sigma.
    hh = next(i for i, r in enumerate(wb["D_flows"].iter_rows(values_only=True), 1) if r and r[0] is not None and fold(str(r[0])).strip() == "Ngay")
    history = []
    for r in wb["D_flows"].iter_rows(min_row=hh + 1, values_only=True):
        if not r or as_date(r[0]) is None:
            break
        history.append([as_date(r[0]).isoformat(), int(num(r[4]))])
    ttm = num(kv["revenue_ttm_actual"])
    notes.append(f"D_flows: {len(history)} days of cash history ({history[0][0]}..{history[-1][0]}); revenue TTM {ttm:,.0f}")
    raw = {firm_id: {
        "firm": {"id": firm_id, "name": "Alpha Garment Subcontractor", "industry": "Garment manufacturing (FOB)", "position": "fob",
                 "business_model": str(kv["business_model"]).strip().upper(),
                 # Reserve levels come from Miller-Orr in the engine (config.js cash.mo.*): revenue_ttm and history feed L / Z / H.
                 "revenue_ttm": int(ttm),
                 "essential_suppliers": sorted(k for k, v in essential.items() if v == "yes"),
                 "non_essential_suppliers": sorted(k for k, v in essential.items() if v == "no"),
                 "strategic_customers": sorted(k for k, v in strategic.items() if v == "yes")},
        "snapshot": {"id": str(kv["snapshot_id"]).strip(), "as_of": as_of.isoformat(), "source": f"sample:{firm_id}",
                     "status": str(kv.get("status") or "provisional"), "horizon_weeks": int(num(kv["horizon_weeks"]))},
        # One financial row for the whole period (N days), with cash at the cut-off: Cash0 = cash_total − restricted.
        "fin": [{"period_start": start.isoformat(), "period_end": as_of.isoformat(), "revenue": int(num(kv["revenue_vnd"])),
                 "cogs": num(kv["cogs_vnd"]), "opening_cash": cash0, "st_investments": int(num(kv["short_investments_vnd"]) or 0),
                 "current_assets": int(round(current_assets)) if current_assets is not None else None}],
        "sales": sales, "purchases": purchases, "inventory": inventory, "planned": planned, "history": history,
        # D_F01 amount_basis net_noVAT; continuing_sales parameters (T2-21): credit days of new sales, incremental cost ratio and lag.
        "config": {"amount_basis": "net", "vat_rate": None,
                   "continuing": {"credit_days": int(num(kv["new_sales_credit_days"])), "cost_ratio": num(kv["incremental_cost_ratio"]),
                                  "cost_lag_days": int(num(kv["incremental_cost_lag_days"]))}},
    }}
    lvl = miller_orr(wb, ttm, [h[1] for h in history])
    for k, ref in zip(("L", "Z", "H"), (rmin, rtarget, rupper)):
        if abs(lvl[k] - ref) > 1:
            raise SystemExit(f"Miller-Orr {k} = {lvl[k]:,.2f} differs from D_F01 ({ref:,.2f}) by more than 1 VND")
    notes.append("Miller-Orr L/Z/H = " + " / ".join(f"{lvl[k] / 1e6:,.1f}M" for k in "LZH") + " (match D_F01 within 1 VND)")
    if int(num(kv["horizon_weeks"])) != 13:
        notes.append("horizon_weeks differs from CFG.tv2.horizonWeeks (13)")
    return raw, catalogue(wb, notes), notes


def miller_orr(wb, ttm: float, net: list[int]) -> dict:
    """Same formula as the engine (SRS 2.8.9, Nguong rows 5-12): L = MAX(lower_ratio x TTM; owner floor), D = (3 b sigma^2 / 4 i)^(1/3)."""
    p = {str(r[0]).strip(): r[1] for r in wb["Nguong"].iter_rows(min_row=HEADER_ROW + 1, values_only=True) if r and r[0]}
    n = len(net)
    mean = sum(net) / n
    var = sum((x - mean) ** 2 for x in net) / (n - 1)
    i = p["cash.mo.rate_annual"] / p["cash.mo.days_per_year"]
    d = (3 * p["cash.mo.transaction_cost"] * var / (4 * i)) ** (1 / 3)
    low = max(p["cash.mo.lower_ratio"] * ttm, p["cash.mo.lower_min_owner"] or 0)
    return {"L": low, "Z": low + d, "H": low + 3 * d}


def catalogue(wb, notes: list[str]) -> list[dict]:
    old = json.loads(re.search(r"const DATA=(\{.*?\});\s*\n", DATA_JS.read_text(encoding="utf-8"), re.S).group(1))["cat"]
    by_id, by_type = {c["id"]: c for c in old}, {}
    for c in old:
        by_type.setdefault(c["type"], c)
    start = find_header(wb, "D_UC03", "Mã")
    rows = [r for r in wb["D_UC03"].iter_rows(min_row=start, values_only=True)]
    # The product table is the second "Ma" header of the sheet (the first one is the parameter table).
    second = next(i for i, r in enumerate(rows) if i > 0 and r and str(r[0] or "").strip() == "Mã")
    head = [str(h).strip() if h else None for h in rows[second]]
    cat = []
    for r in rows[second + 1:]:
        if not r or r[0] in (None, ""):
            break
        p = {h: v for h, v in zip(head, r) if h}
        pid, group = str(p["Mã"]).strip(), str(p["Nhóm"]).strip()
        excluded = [why for why, hit in (("strategic or essential counterparty", flag(p["Chiến lược/thiết yếu"]) == "yes"),
                                         ("already pledged", flag(p["Đã cầm cố"]) == "yes"),
                                         ("no product data", flag(p["Có dữ liệu"]) == "no")) if hit]
        if group not in GROUP_TYPE:
            notes.append(f"D_UC03 {pid} ({group}) has no catalogue type in the app; not in DATA.cat")
            continue
        if excluded:
            notes.append(f"D_UC03 {pid} excluded (hard filter in the workbook): {', '.join(excluded)}")
            continue
        typ = GROUP_TYPE[group]
        base = dict(by_id.get(pid) or by_type[typ])
        rate, fee, adv = num(p["Lãi/năm"]) or 0, num(p["Phí %"]) or 0, num(p["Tỷ lệ ứng"]) or 0
        item = {**base, "id": pid, "type": typ, "rate": round(rate * 100, 4), "fee": round(fee * 100, 4),
                "adv": round(adv * 100, 4), "tenor": int(num(p["Hold (ngày)"]) or base["tenor"]), "dtf": int(num(p["Ngày có tiền"]) or 0)}
        if typ == "dynamic_discounting":
            item.update(disc=round(fee * 100, 4), fee=0, rate=0, adv=100)
        party = OBJECT_PARTY.get(str(p["Đối tượng"]).strip())
        if party:
            item["wl"] = party
        if typ == "credit_line":
            item["mx"] = int(num(p["Cơ sở (VND)"]))  # the unused limit is the most the line can give
        if pid not in by_id:
            item["provider"] = {"dynamic_discounting": f"{party} (early payment)" if party else "Buyer early payment"}.get(typ, base["provider"])
        cat.append(item)
    notes.append("DATA.cat: provider, mn, mo, recourse and fbase are not in D_UC03 and keep the previous value of the same id "
                 "(or of the same type for new ids); mx too, except credit lines (mx = unused limit from D_UC03).")
    return cat


def uc03_table(wb) -> dict:
    """D_UC03: parameters (first table), the 14-product table and the two scenario matrices (allowed groups, cause groups)."""
    rows = list(wb["D_UC03"].iter_rows(values_only=True))
    params, i = {}, HEADER_ROW
    while rows[i] and rows[i][0] not in (None, ""):
        params[str(rows[i][1]).strip()] = rows[i][2]
        i += 1
    ph = next(j for j, r in enumerate(rows) if j > i and r and str(r[0] or "").strip() == "Mã")
    head = [str(h).strip() if h else None for h in rows[ph]]
    products = []
    for r in rows[ph + 1:]:
        if not r or r[0] in (None, ""):
            break
        p = {h: v for h, v in zip(head, r) if h}
        pid = str(p["Mã"]).strip()
        if pid not in PRODUCT_NAMES:
            raise SystemExit(f"No English name for UC03 product {pid}")
        yes = lambda v: str(v or "").strip().upper() == "Y"
        products.append({"id": pid, "name": PRODUCT_NAMES[pid], "group": str(p["Nhóm"]).strip(), "option": str(p["Phương án"]).strip(),
                         "object": str(p["Đối tượng"]).strip(), "base_declared": num(p["Cơ sở (VND)"]) if str(p["Đối tượng"]).startswith("LIM-") else None,
                         "adv": num(p["Tỷ lệ ứng"]) or 0, "haircut": num(p["Haircut"]) or 0, "rate": num(p["Lãi/năm"]) or 0,
                         "fee_pct": num(p["Phí %"]) or 0, "fee_flat": num(p["Phí cố định"]) or 0, "hold": int(num(p["Hold (ngày)"]) or 0),
                         "dtf": int(num(p["Ngày có tiền"]) or 0), "certainty": CERTAINTY[fold(str(p["Độ chắc chắn"])).strip()],
                         "rel": int(num(p["Rel"]) or 0), "strategic": yes(p["Chiến lược/thiết yếu"]), "pledged": yes(p["Đã cầm cố"]),
                         "has_data": yes(p["Có dữ liệu"]), "early_repay": int(num(p["Trả trước được"]) or 0), "cause": str(p["Nguyên nhân"] or "").strip()})
    def matrix(first_cell: str, start: int) -> tuple[dict, int]:
        j = next(k for k, r in enumerate(rows) if k > start and r and str(r[0] or "").startswith(first_cell))
        cols = [str(c).strip() for c in rows[j][1:7]]
        out, k = {}, j + 1
        while k < len(rows) and rows[k] and rows[k][0] not in (None, ""):
            out[str(rows[k][0]).strip()] = {c: int(num(v) or 0) for c, v in zip(cols, rows[k][1:7])}
            k += 1
        return out, k
    allowed, end = matrix("Nhóm \\", ph)
    cause, _ = matrix("Nhóm \\", end)
    P = lambda k: num(params[k])
    return {"params": {"theta_pct": P("PARAM_THETA_PCT"), "min_days": int(P("PARAM_MIN_DAYS")), "cause_main": P("PARAM_CAUSE_MAIN"),
                       "cause_sec": P("PARAM_CAUSE_SEC"), "major_event": P("PARAM_MAJOR_EVENT"), "min_draw_pct": P("PARAM_MIN_DRAW_PCT"),
                       "max_sources": int(P("PARAM_MAX_SOURCES")), "urgent_days": int(P("PARAM_URGENT_DAYS")), "min_tenor": int(P("PARAM_MIN_TENOR")),
                       "key_partner": P("PARAM_KEY_PARTNER"), "max_per_option": int(P("MAX_PER_OPTION")), "all_l1": int(P("all_L1")),
                       "model_health": str(params["model_health"]).strip()},
            "products": products, "allowed": allowed, "cause": cause}


def uc04_setup(wb, names: dict) -> dict:
    """F01_UC4!A5:B27: the default UC04 setup (case, customer, supplier, lot and their parameters). IDs become the app's names."""
    kv = {}
    for r in wb["F01_UC4"].iter_rows(min_row=HEADER_ROW + 1, max_row=27, values_only=True):
        if r and r[0] not in (None, ""):
            kv[fold(str(r[0])).strip()] = r[1]
    g = lambda key: kv[key]
    lot, cust, sup = str(g("Lo thu ban")).strip(), str(g("Khach duoc chon")).strip(), str(g("NCC duoc chon")).strip()
    return {"customer_id": cust, "supplier_id": sup, "lot_id": lot,
            "case": int(num(g("Ma kich ban UC04"))), "customer": names[cust], "ar_share": num(g("Phan khoan thu chuyen lich")),
            "early_days": int(num(g("So ngay thu som"))), "discount": num(g("Chiet khau thu som")), "late_days": int(num(g("Stress so ngay khach tra cham"))),
            "allow_confirmed": int(num(g("Cho thu thay lich da xac nhan"))), "supplier": names[sup],
            "ap_share": num(g("Phan phai tra duoc gian")), "extend_days": int(num(g("So ngay gian tra"))), "ap_fee": num(g("Phi gian tra mot lan")),
            "allow_essential": int(num(g("Cho phep thu voi NCC thiet yeu"))), "lot": names[lot], "sale_share": num(g("Ty le lo ban")),
            "recovery": num(g("Ty le gia thu hoi")), "sale_lag": int(num(g("So ngay tu Start den ban/thu"))), "sale_cost": num(g("Chi phi tien khi ban")),
            "stress_sale_days": int(num(g("Stress ban ton tre them"))), "sale_confirmed": int(num(g("Xac nhan gia dinh co the ban lo"))),
            "partial_early": num(g("Ty le thu som thuc hien khi stress")), "critical_date": iso(g("Ngay doi chieu trong yeu")),
            "tolerance": num(g("Sai so tien kiem tra (VND)"))}


def presets(u: dict) -> list[dict]:
    """What-if presets on the v10 data: one UC04 change set each (the three levers of SRS 2.10.10), applied to the three scenarios.
    F01-C is the workbook default of F01_UC4 (case 1). There is no customer-owned stock in v10, so no ownership-block preset."""
    ar = {"customer_id": u["customer_id"], "share": u["ar_share"], "mode": "shift_days", "days": -u["early_days"], "discount": u["discount"]}
    ap = {"supplier_id": u["supplier_id"], "share": u["ap_share"], "days": u["extend_days"], "fee": u["ap_fee"], "consent_assumed": bool(u["allow_essential"])}
    inv = {"lot_id": u["lot_id"], "share": u["sale_share"], "basis": "recovery", "recovery": u["recovery"], "lag_days": u["sale_lag"],
           "selling_cost": u["sale_cost"], "sale_confirmed": bool(u["sale_confirmed"])}
    k1 = u["customer"].split()[-1]
    return [
        {"id": "F01-A", "name": f"{k1} pays half 7 days early (1% discount)", "ask": f"What if {k1} pays half of its invoices 7 days early?", "changes": {"ar": ar}},
        {"id": "F01-B", "name": "Beta: half of the payments 14 days later", "ask": "What if Beta lets us pay half of its invoices 14 days later?", "changes": {"ap": ap}},
        {"id": "F01-C", "name": f"{k1} early + Beta later + sell half of last season's finished goods", "main": True,
         "ask": f"What if {k1} pays half 7 days early, Beta lets us pay half 14 days later and we sell half of last season's finished goods?",
         "changes": {"ar": ar, "ap": ap, "inv": inv}},
        {"id": "F01-D", "name": f"{k1} pays half 14 days late", "ask": f"What if {k1} pays half of its invoices 14 days late?",
         "changes": {"ar": {**ar, "days": u["late_days"], "discount": 0}}},
        {"id": "F01-E", "name": "Sell half of last season's finished goods", "ask": "What if we sell half of last season's finished goods?", "changes": {"inv": inv}},
    ]


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    raw, cat, notes = build(Path(sys.argv[1]))
    wb = load_workbook(Path(sys.argv[1]), data_only=True, read_only=False)
    ids = {}
    for first, col_name in (("customer_id", 1), ("supplier_id", 1)):
        start = find_header(wb, "D_F01", first)
        for r in wb["D_F01"].iter_rows(min_row=start + 1, values_only=True):
            if not r or r[0] in (None, ""):
                break
            ids[str(r[0]).strip()] = tr(r[col_name])
    for r in table(wb, "D_inventory"):
        ids[str(r["lot_id"]).strip()] = tr(r["Mặt hàng / lô"])
    uc03, uc04 = uc03_table(wb), uc04_setup(wb, ids)
    sc = "let SC=" + json.dumps([{"firm": "F01", **x} for x in presets(uc04)], ensure_ascii=False) + ";"
    head = ("/* Sample data: the raw snapshot of F01 (generated by tools/build_demo_data.py from the FOB UC01-UC04 workbook v10), "
            "the financing catalogue and product table from D_UC03, the UC04 defaults of F01_UC4 and the what-if presets. */\n")
    id_map = {"customers": {k: v for k, v in ids.items() if k.startswith("BYR-")}, "suppliers": {k: v for k, v in ids.items() if k.startswith("SUP-")}}
    body = "const DATA=" + json.dumps({"cat": cat, "raw": raw, "ids": {"F01": id_map}, "uc03": {"F01": uc03}, "uc04": {"F01": uc04}}, ensure_ascii=False, separators=(",", ":")) + ";\n"
    DATA_JS.write_text(head + body + sc + "\n", encoding="utf-8")
    for f, r in raw.items():
        print(f, r["snapshot"]["id"], "as_of", r["snapshot"]["as_of"], "N", (date.fromisoformat(r["fin"][0]["period_end"]) -
              date.fromisoformat(r["fin"][0]["period_start"])).days + 1, "sales", len(r["sales"]), "purchases", len(r["purchases"]),
              "lots", len(r["inventory"]), "plans", len(r["planned"]), "model", r["firm"]["business_model"])
    print("catalogue:", ", ".join(c["id"] for c in cat))
    for n in notes:
        print("note:", n)


if __name__ == "__main__":
    main()
