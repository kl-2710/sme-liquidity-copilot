"""UC-01 - Chẩn đoán vốn lưu động: module tính toán lõi (hàm Python thuần, không dùng LLM).

Công thức theo Bộ đặc tả tv1.formulas.v4 (các Formula ID có trong FORMULA_IDS bên dưới).
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Optional

from src.schemas import (
    BuyerDriver,
    DiscountOpportunity,
    Drivers,
    Inputs,
    MetricItem,
    Meta,
    MoneyMetrics,
    ProductDriver,
    Reconciliation,
    SupplierDriver,
    WorkingCapitalResult,
)

MIN_HISTORY_INVOICES: int = 5
AGING_KEYS: tuple[str, ...] = ("not_due", "1_30", "31_60", "61_90", "over_90")
LATE_LOOKBACK_DAYS: int = 180
SLOW_THRESHOLD_DAYS: dict[str, int] = {"NVL": 60, "HH": 60, "BTP": 30, "TP": 30}
VND_TOLERANCE: float = 1.0
DAY_TOLERANCE: float = 1e-8

# Ánh xạ Formula ID đã đối chiếu với sheet TV1_Cong_thuc trong workbook.
FORMULA_IDS: dict[str, str] = {
    "ar_vnd": "T1-A01", "ap_vnd": "T1-A02", "inv_vnd": "T1-A04",
    "revenue_vnd": "T1-A05", "revenue_credit_vnd": "T1-A05", "cogs_vnd": "T1-A05",
    "pur_vnd": "T1-A05", "pur_credit_vnd": "T1-A05",
    "dso_days": "T1-B01", "dio_days": "T1-B02", "dpo_days": "T1-B03",
    "dpo_pur_days": "T1-B04", "ccc_days": "T1-B05",
    "twc_vnd": "T1-F01", "cash_per_1_day_dso_vnd": "T1-F02",
    "cash_per_1_day_dio_vnd": "T1-F02", "cash_per_1_day_dpo_vnd": "T1-F02",
    "cash_per_1_day_dpo_pur_vnd": "T1-F02", "ar_overdue_vnd": "T1-C01",
    "ar_overdue_share": "T1-C01", "top1_share": "T1-C04", "top3_share": "T1-C04",
    "hhi": "T1-C04", "slow_inventory_vnd": "T1-D02", "slow_inventory_share": "T1-D02",
    "ap_overdue_vnd": "T1-E01", "ap_overdue_share": "T1-E01", "gross_margin": "T1-F05",
    "ccc_pur_days": "T1-B05",
}

# Chỉ tiêu bị đánh dấu invalid_data khi một phép đối soát thất bại
_INVALID_IF: dict[str, tuple[str, ...]] = {
    "ar": ("ar_vnd", "dso_days", "ccc_days", "twc_vnd"),
    "inv": ("inv_vnd", "dio_days", "ccc_days", "twc_vnd"),
    "ap": ("ap_vnd", "dpo_days", "dpo_pur_days", "ccc_days", "twc_vnd"),
    "ccc": ("ccc_days",),
}


def round_half_up(value: float, ndigits: int) -> float:
    """Làm tròn half-up (không dùng làm tròn chẵn của Python) để hiển thị."""
    return float(Decimal(str(value)).quantize(Decimal(1).scaleb(-ndigits), rounding=ROUND_HALF_UP))


def _div(a: float, b: float) -> Optional[float]:
    """a / b, trả None nếu mẫu số <= 0."""
    return a / b if b > 0 else None


def _aging_bucket(dpd: int) -> str:
    """Phân nhóm tuổi nợ theo số ngày quá hạn (DPD)."""
    if dpd <= 0:
        return "not_due"
    if dpd <= 30:
        return "1_30"
    if dpd <= 60:
        return "31_60"
    if dpd <= 90:
        return "61_90"
    return "over_90"


def _missing_due_ar(sales: list[dict[str, Any]]) -> float:
    """AR còn dư nhưng thiếu due_date (không xếp được vào 5 nhóm tuổi nợ)."""
    return sum(max(0.0, s["invoice_amount"] - s["paid_amount"] - float(s.get("credit_amount") or 0))
               for s in sales if s.get("due_date") is None)


def _share(part: float, total: float) -> float:
    return part / total if total > 0 else 0.0


# ---------------------------------------------------------------------------
# Buyers (T1-A01, DSO_k)
# ---------------------------------------------------------------------------
def _buyers(sales: list[dict[str, Any]], as_of: date, rev: float, period_days: int, payment_events: list[dict[str, Any]] | None = None) -> tuple[list[BuyerDriver], float]:
    agg: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "name": "", "ar": 0.0, "overdue": 0.0, "aging": {k: 0.0 for k in AGING_KEYS},
        "late_pos_w": 0.0, "late_pos_days": 0.0, "early_days": 0.0, "signed_days": 0.0,
        "collection_days": 0.0, "paid_w": 0.0, "terms_w": 0.0, "terms_days": 0.0,
        "max_dpd": 0, "open_count": 0, "overdue_count": 0, "history_count": 0, "history_invoice_ids": set(), "ids": [],
    })
    lookback_start = as_of - timedelta(days=LATE_LOOKBACK_DAYS)
    for inv in sales:
        buyer_id = inv["buyer_id"]
        g = agg[buyer_id]
        g["name"] = g["name"] or inv["buyer_name"]
        g["ids"].append(inv.get("source_row_id", inv["invoice_id"]))
        open_amt = max(0.0, inv["invoice_amount"] - inv["paid_amount"] - float(inv.get("credit_amount") or 0))
        if open_amt > 0:
            due = inv.get("due_date")
            dpd = max(0, (as_of - due).days) if due else None
            g["ar"] += open_amt
            g["open_count"] += 1
            if dpd is not None:
                g["aging"][_aging_bucket(dpd)] += open_amt
                g["max_dpd"] = max(g["max_dpd"], dpd)
                if dpd > 0:
                    g["overdue"] += open_amt
                    g["overdue_count"] += 1
        issue_date, due_date, paid_date = inv.get("issue_date"), inv.get("due_date"), inv.get("paid_date")
        if issue_date and due_date and period_start_in_range(issue_date, as_of, period_days):
            g["terms_w"] += inv["invoice_amount"]
            g["terms_days"] += inv["invoice_amount"] * max(0, (due_date - issue_date).days)
    # Hành vi thu tiền tính theo từng payment allocation nếu có; không gộp nhiều lần thu thành một ngày.
    sales_by_id = {str(row["invoice_id"]): row for row in sales}
    if payment_events is None:
        payment_events = [{"invoice_id": row["invoice_id"], "amount_vnd": row.get("paid_amount", 0),
            "paid_date": row.get("paid_date")} for row in sales if row.get("paid_amount", 0) > 0]
    for event in payment_events:
        inv = sales_by_id.get(str(event.get("invoice_id")))
        paid_date, paid = event.get("paid_date"), float(event.get("amount_vnd") or 0)
        if inv is None or paid_date is None or paid <= 0 or not (lookback_start < paid_date <= as_of):
            continue
        g = agg[inv["buyer_id"]]
        due_date, issue_date = inv.get("due_date"), inv.get("issue_date")
        g["history_invoice_ids"].add(str(inv["invoice_id"]))
        g["paid_w"] += paid
        if issue_date:
            g["collection_days"] += paid * max(0, (paid_date - issue_date).days)
            g["collection_w"] = g.get("collection_w", 0.0) + paid
        if due_date is None:  # thiếu due_date: không góp hành vi trễ, không gán 0 ngày
            continue
        delay_signed = (paid_date - due_date).days
        g["late_pos_w"] += paid
        g["late_pos_days"] += paid * max(0, delay_signed)
        g["early_days"] += paid * max(0, -delay_signed)
        g["signed_days"] += paid * delay_signed
    ar_total = sum(g["ar"] for g in agg.values())
    out: list[BuyerDriver] = []
    for buyer_id, g in agg.items():
        dso_k = _div(g["ar"], rev)
        paid_w = g["paid_w"]
        late_w = g["late_pos_w"]
        late_pos = g["late_pos_days"] / late_w if late_w > 0 else None
        early = g["early_days"] / late_w if late_w > 0 else None
        out.append(BuyerDriver(
            buyer_id=buyer_id, buyer_name=g["name"], ar_vnd=g["ar"],
            share_of_ar=_share(g["ar"], ar_total),
            dso_days=dso_k * period_days if dso_k is not None else None,
            overdue_ar_vnd=g["overdue"], overdue_share=_share(g["overdue"], g["ar"]),
            overdue_share_of_total_ar=_share(g["overdue"], ar_total),
            aging_vnd=g["aging"], late_positive_wavg_days=late_pos,
            late_signed_wavg_days=g["signed_days"] / late_w if late_w > 0 else None,
            early_wavg_days=early, collection_days_wavg=g["collection_days"] / g["collection_w"] if g.get("collection_w", 0) > 0 else None,
            avg_terms_days=g["terms_days"] / g["terms_w"] if g["terms_w"] > 0 else None,
            max_days_past_due=g["max_dpd"], open_invoice_count=g["open_count"],
            overdue_invoice_count=g["overdue_count"], history_invoice_count=len(g["history_invoice_ids"]),
            paid_amount_vnd=paid_w,
            coverage_status="ok" if len(g["history_invoice_ids"]) >= MIN_HISTORY_INVOICES else "insufficient_history",
            behaviour_late=len(g["history_invoice_ids"]) >= MIN_HISTORY_INVOICES and late_pos is not None and late_pos > 0,
            evidence_ids=sorted(set(g["ids"])),
        ))
    out.sort(key=lambda b: (-b.ar_vnd, b.buyer_id))
    return out, ar_total


def period_start_in_range(d: date, as_of: date, period_days: int) -> bool:
    return as_of - timedelta(days=period_days - 1) <= d <= as_of


# ---------------------------------------------------------------------------
# Products (T1-A04, DIO_l) - chỉ hàng sở hữu, loại HGC (excluded == 1)
# ---------------------------------------------------------------------------
def _products(inventory: list[dict[str, Any]], as_of: date, cogs: float, period_days: int,
              warnings: list[str]) -> tuple[list[ProductDriver], float, float]:
    agg: dict[str, dict[str, Any]] = {}
    excluded_total = 0.0
    for lot in inventory:
        value = lot["qty"] * lot["unit_cost_vnd"]
        if lot["excluded"] == 1:
            excluded_total += value
            continue
        cat = lot["category"].upper()
        threshold = int(lot.get("slow_threshold") or SLOW_THRESHOLD_DAYS.get(cat) or 0) or None
        g = agg.setdefault(lot["product_id"], {
            "name": lot["product_name"], "cat": cat, "threshold": threshold, "inv": 0.0,
            "wdays": 0.0, "maxd": 0, "slow": 0.0, "lot_count": 0, "ids": [],
        })
        if g["cat"] != cat:
            warnings.append(f"Product {lot['product_id']} has lots in different categories ({g['cat']} vs {cat})")
        days = (as_of - lot["received_date"]).days
        thr = threshold
        if thr is None:
            warnings.append(f"Unknown inventory category '{cat}' (lot {lot['lot_id']}): not flagged as slow-moving")
        g["inv"] += value
        g["wdays"] += value * days
        g["maxd"] = max(g["maxd"], days)
        g["lot_count"] += 1
        g["ids"].append(lot.get("source_row_id", lot["lot_id"]))
        if thr is not None and days > thr:
            g["slow"] += value

    inv_total = sum(g["inv"] for g in agg.values())
    out: list[ProductDriver] = []
    for pid, g in agg.items():
        dio_l = _div(g["inv"], cogs)
        thr = g.get("threshold") or SLOW_THRESHOLD_DAYS.get(g["cat"])
        out.append(ProductDriver(
            product_id=pid, product_name=g["name"], category=g["cat"], inv_vnd=g["inv"],
            share_of_inv=_share(g["inv"], inv_total),
            dio_days=dio_l * period_days if dio_l is not None else None,
            slow_threshold_days=thr, max_days_in_stock=g["maxd"],
            slow_moving_value_vnd=g["slow"], slow_flag=g["slow"] > 0,
            age_value_wavg_days=g["wdays"] / g["inv"] if g["inv"] > 0 else None,
            lot_count=g["lot_count"], evidence_ids=sorted(set(g["ids"])),
        ))
    out.sort(key=lambda p: p.inv_vnd, reverse=True)
    return out, inv_total, excluded_total


# ---------------------------------------------------------------------------
# Suppliers (T1-A02, DPO_s, AP quá hạn, cơ hội chiết khấu trả sớm)
# ---------------------------------------------------------------------------
def _suppliers(purchases: list[dict[str, Any]], as_of: date, cogs: float,
               period_days: int, payment_events: list[dict[str, Any]] | None = None) -> tuple[list[SupplierDriver], float]:
    agg: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "name": "", "ap": 0.0, "overdue": 0.0, "opps": [], "purchases": 0.0,
        "terms_w": 0.0, "terms_days": 0.0, "open_count": 0, "overdue_count": 0,
        "ids": [],
        "late_payment_amount": 0.0, "late_payment_weighted_days": 0.0, "history_payment_ids": set(),
    })
    for p in purchases:
        sid = p["supplier_id"]
        g = agg[sid]
        g["name"] = g["name"] or p["supplier_name"]
        g["ids"].append(p.get("source_row_id", p["purchase_id"]))
        issue, due = p.get("purchase_date"), p.get("due_date")
        amount = float(p["amount_vnd"])
        if issue and period_start_in_range(issue, as_of, period_days):
            g["purchases"] += amount
            if due:
                term_days = max(0, (due - issue).days)
                g["terms_w"] += amount
                g["terms_days"] += amount * term_days
        open_amt = max(0.0, amount - float(p.get("paid_amount_vnd") or 0) - float(p.get("credit_amount_vnd") or 0))
        if open_amt <= 0:
            continue
        g["ap"] += open_amt
        g["open_count"] += 1
        if due:
            if due < as_of:
                g["overdue"] += open_amt
                g["overdue_count"] += 1
                g["max_dpd"] = max(g.get("max_dpd", 0), (as_of - due).days)  # số ngày trễ tối đa so với hạn
            # cửa sổ cộng dồn [as_of, as_of+h] trên cơ sở net-of-VAT; không cộng các cột với nhau
            if due == as_of:
                g["due_today"] = g.get("due_today", 0.0) + open_amt
            if as_of <= due <= as_of + timedelta(days=7):
                g["due_7d"] = g.get("due_7d", 0.0) + open_amt
            if as_of <= due <= as_of + timedelta(days=30):
                g["due_30d"] = g.get("due_30d", 0.0) + open_amt
        d = float(p.get("early_discount_rate") or 0)
        days_early = int(p.get("days_early") or 0)
        deadline = p.get("discount_deadline")
        if 0 < d < 1 and days_early > 0 and deadline is not None and deadline >= as_of:
            simple = d / (1 - d) * 365 / days_early
            ear = (1 / (1 - d)) ** (365 / days_early) - 1
            g["opps"].append(DiscountOpportunity(
                purchase_id=p["purchase_id"], base_vnd=open_amt, discount_rate=d, days_early=days_early,
                saving_vnd=open_amt * d, simple_annual_rate_pct=simple * 100.0,
                early_payment_date=deadline.isoformat(), normal_due_date=due.isoformat() if due else None,
                cash_required_vnd=open_amt * (1 - d), ear_pct=ear * 100.0,
            ))
    purchases_by_id = {str(row["purchase_id"]): row for row in purchases}
    if payment_events is None:
        payment_events = [{"invoice_id": row["purchase_id"], "amount_vnd": row.get("paid_amount_vnd", 0),
            "paid_date": row.get("paid_date")} for row in purchases if row.get("paid_amount_vnd", 0) > 0]
    lookback_start = as_of - timedelta(days=LATE_LOOKBACK_DAYS)
    for event in payment_events:
        purchase = purchases_by_id.get(str(event.get("invoice_id")))
        paid_date, paid = event.get("paid_date"), float(event.get("amount_vnd") or 0)
        if purchase is None or paid_date is None or paid <= 0 or not (lookback_start < paid_date <= as_of):
            continue
        g = agg[purchase["supplier_id"]]
        due = purchase.get("due_date")
        g["history_payment_ids"].add(str(purchase["purchase_id"]))
        if due is None:  # thiếu due_date: không góp hành vi trả trễ, không gán 0 ngày
            continue
        delay = max(0, (paid_date - due).days)
        g["late_payment_amount"] += paid
        g["late_payment_weighted_days"] += paid * delay
    ap_total = sum(g["ap"] for g in agg.values())
    purchases_total = sum(g["purchases"] for g in agg.values())
    out: list[SupplierDriver] = []
    for sid, g in agg.items():
        dpo_s = _div(g["ap"], cogs)
        terms = g["terms_days"] / g["terms_w"] if g["terms_w"] > 0 else None
        out.append(SupplierDriver(
            supplier_id=sid, supplier_name=g["name"], ap_vnd=g["ap"],
            share_of_ap=_share(g["ap"], ap_total),
            dpo_days=dpo_s * period_days if dpo_s is not None else None,
            overdue_ap_vnd=g["overdue"], overdue_share=_share(g["overdue"], g["ap"]),
            early_payment_saving_vnd=sum(o.saving_vnd for o in g["opps"]),
            discount_opportunities=g["opps"], purchases_in_period_vnd=g["purchases"],
            purchase_share=_share(g["purchases"], purchases_total), critical_supplier=None,
            avg_terms_days=terms,
            payment_late_wavg_days=g["late_payment_weighted_days"] / g["late_payment_amount"] if g["late_payment_amount"] > 0 else None,
            history_payment_count=len(g["history_payment_ids"]),
            open_invoice_count=g["open_count"], overdue_invoice_count=g["overdue_count"],
            max_days_past_due=g.get("max_dpd", 0),
            due_today_vnd=g.get("due_today", 0.0), due_7d_vnd=g.get("due_7d", 0.0), due_30d_vnd=g.get("due_30d", 0.0),
            short_terms=terms is not None and terms < 30, evidence_ids=sorted(set(g["ids"])),
        ))
    out.sort(key=lambda s: (-s.ap_vnd, s.supplier_id))
    return out, ap_total


def _fmt(raw: float, unit: str, key: str = "") -> tuple[str, float]:
    """display_value (chuỗi) + display_number. ROUND_HALF_UP: ngày 1 lẻ, % 1 lẻ, VND số nguyên.
    HHI giữ thang 0-1 (3 lẻ). raw_value luôn giữ nguyên, không làm tròn."""
    d = Decimal(str(raw))
    if unit == "vnd":
        n = d.quantize(Decimal(1), rounding=ROUND_HALF_UP)
        return f"{int(n):,}", float(n)
    if unit == "ratio" and key == "hhi":
        n = d.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
        return str(n), float(n)
    if unit == "ratio":
        n = (d * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
        return f"{n}%", float(n)
    n = d.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    return str(n), float(n)


def _metric(key: str, name: str, raw: Optional[float], unit: str, invalid: set[str],
            numerator: float | None = None, denominator: float | None = None,
            period_days: int | None = None, reason: str | None = None) -> MetricItem:
    """Giữ raw_value chưa làm tròn; chỉ làm tròn ở display_value."""
    if raw is None:
        status = "not_applicable" if denominator == 0 else "missing_data"
    else:
        status = "invalid_data" if key in invalid else "provisional"  # demo_v4 luôn provisional
    display, display_number = _fmt(raw, unit, key) if raw is not None else (None, None)
    if key not in FORMULA_IDS:
        raise KeyError(f"Chưa ánh xạ Formula ID cho metric '{key}'")
    return MetricItem(id=key, name=name, raw_value=raw, display_value=display, display_number=display_number,
        unit="day" if unit == "days" else unit,
        reason_code="DEMO_ASSUMPTIONS" if status == "provisional" else ("ZERO_DENOMINATOR" if status == "not_applicable" else None),
        assumption_ids=["A-DEMO"],
        status=status, reason=reason or ("Mẫu số bằng 0." if status == "not_applicable" else None),
        numerator=numerator, denominator=denominator, period_days=period_days,
        method="closing_snapshot", formula_id=FORMULA_IDS[key])


def calculate_working_capital(snapshot: dict[str, Any]) -> WorkingCapitalResult:
    """Tính UC-01 bằng Python thuần từ snapshot; LLM không tham gia phép tính."""
    m = snapshot["meta"]
    as_of = date.fromisoformat(m["as_of"])
    period_start = date.fromisoformat(m["period_start"])
    period_days = int(m["period_days"])
    snapshot_id = m["snapshot_id"]
    warnings: list[str] = []
    rev = float(snapshot["financials"]["revenue_vnd"])
    cogs = float(snapshot["financials"]["cogs_vnd"])
    sales_period = [s for s in snapshot["sales"] if period_start <= s.get("recognition_date", s["issue_date"]) <= as_of]
    purchases_period = [p for p in snapshot["purchases"] if period_start <= p["purchase_date"] <= as_of]
    pur = sum(float(p["amount_vnd"]) for p in purchases_period)
    sales_credit_flags = [s.get("is_credit") for s in sales_period]
    purchase_credit_flags = [p.get("is_credit") for p in purchases_period]
    sales_credit_flag_available = any(v is not None for v in sales_credit_flags)
    purchase_credit_flag_available = any(v is not None for v in purchase_credit_flags)
    rev_credit = sum(float(s["invoice_amount"]) for s in sales_period if s.get("is_credit") is True) if sales_credit_flag_available else rev
    pur_credit = sum(float(p["amount_vnd"]) for p in purchases_period if p.get("is_credit") is True) if purchase_credit_flag_available else pur
    dso_denominator = rev_credit if sales_credit_flag_available else rev
    dpo_pur_denominator = pur_credit if purchase_credit_flag_available else pur
    buyers, ar = _buyers(snapshot["sales"], as_of, dso_denominator, period_days, snapshot.get("payment_events"))
    products, inv, excluded = _products(snapshot["inventory"], as_of, cogs, period_days, warnings)
    suppliers, ap = _suppliers(snapshot["purchases"], as_of, cogs, period_days, snapshot.get("purchase_payment_events"))

    def days(num: float, den: float) -> Optional[float]:
        q = _div(num, den)
        return q * period_days if q is not None else None
    dso, dio, dpo, dpo_pur = days(ar, dso_denominator), days(inv, cogs), days(ap, cogs), days(ap, dpo_pur_denominator)
    ccc = dso + dio - dpo if None not in (dso, dio, dpo) else None
    ccc_pur = dso + dio - dpo_pur if None not in (dso, dio, dpo_pur) else None
    twc = ar + inv - ap
    rev_per_day, dso_rev_per_day = _div(rev, period_days), _div(dso_denominator, period_days)
    cogs_per_day, pur_per_day = _div(cogs, period_days), _div(pur, period_days)
    pur_credit_per_day = _div(dpo_pur_denominator, period_days)
    sales_invoice_total = sum(float(s["invoice_amount"]) for s in sales_period)
    revenue_diff_share = abs(sales_invoice_total - rev) / rev if rev > 0 else None
    revenue_recon_ok = (revenue_diff_share <= 0.02) if rev > 0 else abs(sales_invoice_total - rev) <= VND_TOLERANCE

    def total(items: list[Any], attr: str) -> float:
        return sum(float(getattr(i, attr) or 0.0) for i in items)
    d_ar, d_inv, d_ap = abs(total(buyers, "ar_vnd") - ar), abs(total(products, "inv_vnd") - inv), abs(total(suppliers, "ap_vnd") - ap)
    d_dso = abs(total(buyers, "dso_days") - dso) if dso is not None else 0.0
    d_dio = abs(total(products, "dio_days") - dio) if dio is not None else 0.0
    d_dpo = abs(total(suppliers, "dpo_days") - dpo) if dpo is not None else 0.0
    d_ccc = abs(total(buyers, "dso_days") + total(products, "dio_days") - total(suppliers, "dpo_days") - ccc) if ccc is not None else 0.0
    d_aging = abs(sum(sum(b.aging_vnd.values()) for b in buyers) + _missing_due_ar(snapshot["sales"]) - ar)
    recon = Reconciliation(matches_ar=d_ar <= VND_TOLERANCE and d_dso <= DAY_TOLERANCE and d_aging <= VND_TOLERANCE,
        matches_inv=d_inv <= VND_TOLERANCE and d_dio <= DAY_TOLERANCE,
        matches_ap=d_ap <= VND_TOLERANCE and d_dpo <= DAY_TOLERANCE, matches_ccc=d_ccc <= DAY_TOLERANCE,
        details={"ar_vnd": d_ar, "aging_vnd": d_aging, "inv_vnd": d_inv, "ap_vnd": d_ap, "dso_days": d_dso,
                 "dio_days": d_dio, "dpo_days": d_dpo, "ccc_days": d_ccc})
    invalid: set[str] = set()
    if not recon.matches_ar:
        invalid.update(["ar_vnd", "dso_days", "ccc_days", "twc_vnd", "ar_overdue_vnd", "ar_overdue_share", "top1_share", "top3_share", "hhi"])
    if not recon.matches_inv:
        invalid.update(["inv_vnd", "dio_days", "ccc_days", "twc_vnd", "slow_inventory_vnd", "slow_inventory_share"])
    if not recon.matches_ap:
        invalid.update(["ap_vnd", "dpo_days", "dpo_pur_days", "ccc_days", "twc_vnd", "ap_overdue_vnd", "ap_overdue_share"])
    if not recon.matches_ccc:
        invalid.add("ccc_days")
    if not revenue_recon_ok:
        invalid.update(["revenue_vnd", "dso_days", "ccc_days"])
        warnings.append("DQ-01: doanh thu tài chính lệch tổng hóa đơn theo ngày ghi nhận vượt ngưỡng 2%; cần đối chiếu.")
    for label, ok in (("AR", recon.matches_ar), ("INV", recon.matches_inv), ("AP", recon.matches_ap), ("CCC", recon.matches_ccc)):
        if not ok: warnings.append(f"Đối soát {label} không đạt; các chỉ tiêu liên quan được đánh dấu invalid_data.")
    for label, den in (("doanh thu", rev), ("COGS", cogs), ("mua hàng", pur)):
        if den <= 0: warnings.append(f"Mẫu số {label} bằng 0; chỉ tiêu phụ thuộc được trả null/not_applicable.")

    ar_overdue = sum(b.overdue_ar_vnd for b in buyers)
    ar_overdue_share = _div(ar_overdue, ar)
    ap_overdue = sum(s.overdue_ap_vnd for s in suppliers)
    ap_overdue_share = _div(ap_overdue, ap)
    slow_inv = sum(p.slow_moving_value_vnd for p in products)
    slow_share = _div(slow_inv, inv)
    buyer_shares = sorted((b.share_of_ar for b in buyers), reverse=True)
    top1 = buyer_shares[0] if ar > 0 and buyer_shares else None
    top3 = sum(buyer_shares[:3]) if ar > 0 and buyer_shares else None
    hhi = sum(b.share_of_ar ** 2 for b in buyers) if ar > 0 else None
    gross_margin = _div(rev - cogs, rev)

    aging_amounts = {k: sum(b.aging_vnd[k] for b in buyers) for k in AGING_KEYS}
    aging_counts = {k: 0 for k in AGING_KEYS}
    missing_due_amount = 0.0
    for inv_row in snapshot["sales"]:
        open_amt = max(0.0, inv_row["invoice_amount"] - inv_row["paid_amount"] - float(inv_row.get("credit_amount") or 0))
        if open_amt <= 0: continue
        due = inv_row.get("due_date")
        if due is None:
            missing_due_amount += open_amt
            continue
        dpd = max(0, (as_of - due).days)
        aging_counts[_aging_bucket(dpd)] += 1
    aging = {k: {"value_vnd": aging_amounts[k], "share": _share(aging_amounts[k], ar),
                 "invoice_count": aging_counts[k]} for k in AGING_KEYS}
    aging["days_1_30"] = aging["1_30"]
    aging["days_31_60"] = aging["31_60"]
    aging["days_61_90"] = aging["61_90"]
    aging["bucket_definition"] = {"not_due": "due_date >= as_of", "1_30": "1-30 days overdue",
        "31_60": "31-60 days overdue", "61_90": "61-90 days overdue", "over_90": ">90 days overdue"}
    aging["missing_due_date_vnd"] = missing_due_amount
    aging["classified_ar_vnd"] = sum(aging_amounts.values())
    aging["known_overdue_share_of_total_ar"] = _div(ar_overdue, ar)
    has_gap = missing_due_amount > VND_TOLERANCE
    aging["overdue_share_complete"] = None if has_gap else _div(ar_overdue, ar)
    if has_gap:
        warnings.append(f"MISSING_DUE_DATE: {missing_due_amount:,.0f} VND AR thiếu due_date; quá hạn chỉ là cận dưới.")
    ar_overdue_share_out = None if has_gap else ar_overdue_share

    exclusions = [{"owner_id": snapshot["meta"]["firm_id"], "product_line": row["product_name"],
        "excluded_value_vnd": row["qty"] * row["unit_cost_vnd"], "exclusion_reason": "Hàng nhận gia công/hàng không thuộc sở hữu DN",
        "lot_ids": [row["lot_id"]]} for row in snapshot["inventory"] if row["excluded"] == 1]
    discount_records = []
    for s in suppliers:
        for opp in s.discount_opportunities:
            item = opp.model_dump()
            item["supplier_id"] = s.supplier_id
            item["supplier_name"] = s.supplier_name
            discount_records.append(item)
    duplicates = {}
    for table_name, rows, key in (("sales", snapshot["sales"], "invoice_id"), ("purchases", snapshot["purchases"], "purchase_id")):
        keys = [r[key] for r in rows]
        duplicates[table_name] = len(keys) - len(set(keys))
    data_quality = [
        {"id": "T1-J02-duplicates", "check": "Duplicate invoice keys", "scope": "sales/purchases",
         "value": sum(duplicates.values()), "affected_value_vnd": None, "status": "ok" if sum(duplicates.values()) == 0 else "invalid_data",
         "reason": "Kiểm tra khóa hóa đơn trong snapshot.", "source_ids": [], "affected_metric_ids": [], "remediation": "Khử trùng lặp trước khi tính."},
        {"id": "T1-J02-excluded", "check": "Inventory excluded from owned INV", "scope": "inventory",
         "value": len(exclusions), "affected_value_vnd": excluded, "status": "ok",
         "reason": "Hàng bị loại được báo riêng, không cộng vào INV.", "source_ids": [x["product_line"] for x in exclusions],
         "affected_metric_ids": ["inv_vnd", "dio_days", "twc_vnd"], "remediation": "Xác minh quyền sở hữu từng lô."},
        {"id": "DQ-01", "check": "Financial revenue vs sales invoices by recognition date", "scope": "period",
         "value": revenue_diff_share, "affected_value_vnd": abs(sales_invoice_total - rev), "status": "ok" if revenue_recon_ok else "invalid_data",
         "reason": "So sánh doanh thu tài chính với tổng hóa đơn theo revenue_recognition_date; nếu thiếu cột thì dùng issue_date như dữ liệu mẫu.",
         "source_ids": [f"{snapshot_id}:D_financials", f"{snapshot_id}:D_sales"],
         "affected_metric_ids": ["revenue_vnd", "dso_days", "ccc_days"], "remediation": "Đối chiếu recognition_date, hóa đơn điều chỉnh và sổ doanh thu."},
        {"id": "T1-J01-ledger-reconciliation", "check": "Subledger to GL roll-forward", "scope": "AR/AP/cash/inventory",
         "value": None, "affected_value_vnd": None, "status": "not_tested",
         "reason": "Workbook không có sổ cái kiểm soát và luồng tiền đầy đủ.", "source_ids": [],
         "affected_metric_ids": [], "remediation": "Bổ sung số dư đầu kỳ, phát sinh, điều chỉnh và số dư kiểm soát."},
        {"id": "T1-J02-coverage", "check": "Population coverage", "scope": "all ledgers",
         "value": None, "affected_value_vnd": None, "status": "not_tested",
         "reason": "Không có tổng phạm vi sổ kiểm soát để tính tỷ lệ coverage.", "source_ids": [],
         "affected_metric_ids": [], "remediation": "Đối chiếu population với sổ nguồn."},
    ]
    unsupported = [
        {"formula_id": "T1-A03", "status": "missing_data", "reason": "Không có số tiền gồm VAT và các sự kiện thu/chi theo từng lần."},
        {"formula_id": "T1-A06", "status": "missing_data", "reason": "Chỉ có số dư cuối kỳ; không có số dư đầu kỳ hoặc số dư hằng ngày để tính bình quân."},
        {"formula_id": "T1-B07", "status": "missing_data", "reason": "Chỉ có một kỳ; không có lịch sử cùng phương pháp để tính xu hướng."},
        {"formula_id": "T1-C05", "status": "missing_data", "reason": "Không có cờ tranh chấp/hủy/vỡ nợ, PD/LGD có nguồn."},
        {"formula_id": "T1-C06", "status": "missing_data", "reason": "Chưa có tham số horizon và logic cohort đủ tuổi được cấu hình; payment allocation riêng lẻ chưa đủ để suy ra collection_rate_h."},
        {"formula_id": "T1-D03", "status": "missing_data", "reason": "Không có SKU, nhu cầu, tồn an toàn và đơn hàng có thể sử dụng."},
        {"formula_id": "T1-D04", "status": "missing_data", "reason": "Không có NRV/giá thanh lý/chi phí hoàn thiện và bán."},
        {"formula_id": "T1-D05", "status": "missing_data", "reason": "Không có thẩm định, quyền cầm giữ, haircut hoặc dư nợ bảo đảm."},
        {"formula_id": "T1-E01-AP_due_h", "status": "partial_net_basis", "reason": "due_today/7d/30d chỉ có trên cơ sở net-of-VAT (số dư còn dư); lịch tiền gross gồm VAT chưa hỗ trợ."},
        {"formula_id": "T1-E03", "status": "missing_data", "reason": "Không có cờ nhà cung cấp thiết yếu được xác nhận."},
        {"formula_id": "T1-F03", "status": "missing_data", "reason": "Không có số dư ngân hàng đã đối chiếu, tiền phong tỏa và hạn mức cam kết."},
        {"formula_id": "T1-F04", "status": "missing_data", "reason": "Không có lịch nghĩa vụ bắt buộc và khoản thu xác nhận."},
        {"formula_id": "T1-F05-DSCR", "status": "missing_data", "reason": "Có thể tính biên gộp; chưa có CFADS và lịch gốc/lãi để tính DSCR."},
        {"formula_id": "T1-J01", "status": "missing_data", "reason": "Không có sổ cái và số dư kiểm soát độc lập."},
    ]
    _deps = {"DSO": dso, "DIO": dio, "DPO_COGS": dpo}
    ccc_reason = None if ccc is not None else "Phụ thuộc không tính được: " + ", ".join(k for k, v in _deps.items() if v is None)
    metrics = [
        _metric("ar_vnd", "Phải thu thương mại (AR)", ar, "vnd", invalid, ar, None, period_days),
        _metric("ap_vnd", "Phải trả thương mại (AP)", ap, "vnd", invalid, ap, None, period_days),
        _metric("inv_vnd", "Tồn kho thuộc sở hữu (loại HGC)", inv, "vnd", invalid, inv, None, period_days),
        _metric("revenue_vnd", "Doanh thu trong kỳ", rev, "vnd", invalid, rev, None, period_days),
        _metric("revenue_credit_vnd", "Doanh thu bán chịu trong kỳ", rev_credit, "vnd", invalid, rev_credit, None, period_days),
        _metric("cogs_vnd", "Giá vốn trong kỳ (COGS)", cogs, "vnd", invalid, cogs, None, period_days),
        _metric("pur_vnd", "Mua hàng trong kỳ", pur, "vnd", invalid, pur, None, period_days),
        _metric("pur_credit_vnd", "Mua chịu trong kỳ", pur_credit, "vnd", invalid, pur_credit, None, period_days),
        _metric("dso_days", "DSO", dso, "days", invalid, ar, dso_denominator, period_days),
        _metric("dio_days", "DIO", dio, "days", invalid, inv, cogs, period_days),
        _metric("dpo_days", "DPO trên COGS", dpo, "days", invalid, ap, cogs, period_days),
        _metric("dpo_pur_days", "DPO trên mua chịu", dpo_pur, "days", invalid, ap, dpo_pur_denominator, period_days),
        _metric("ccc_days", "Chu kỳ chuyển đổi tiền mặt (CCC)", ccc, "days", invalid, dso, None, period_days, reason=ccc_reason),
        _metric("ccc_pur_days", "CCC trên tổng mua (giả định mua chịu)", ccc_pur, "days", invalid, dso, None, period_days),
        _metric("twc_vnd", "Vốn lưu động thương mại thuần (TWC = AR + INV - AP)", twc, "vnd", invalid, ar + inv, ap, period_days),
        _metric("cash_per_1_day_dso_vnd", "Vốn tương đương 1 ngày DSO", dso_rev_per_day, "vnd", invalid, dso_denominator, period_days, period_days),
        _metric("cash_per_1_day_dio_vnd", "Vốn tương đương 1 ngày DIO", cogs_per_day, "vnd", invalid, cogs, period_days, period_days),
        _metric("cash_per_1_day_dpo_vnd", "Vốn tương đương 1 ngày DPO trên COGS", cogs_per_day, "vnd", invalid, cogs, period_days, period_days),
        _metric("cash_per_1_day_dpo_pur_vnd", "Vốn tương đương 1 ngày DPO trên mua chịu", pur_credit_per_day, "vnd", invalid, dpo_pur_denominator, period_days, period_days),
        _metric("ar_overdue_vnd", "Phải thu quá hạn", ar_overdue, "vnd", invalid, ar_overdue, ar, period_days),
        _metric("ar_overdue_share", "Tỷ trọng phải thu quá hạn", ar_overdue_share_out, "ratio", invalid, ar_overdue, ar, period_days,
            reason="MISSING_DUE_DATE" if has_gap else None),
        _metric("top1_share", "Tỷ trọng AR của khách hàng lớn nhất", top1, "ratio", invalid, top1, ar, period_days),
        _metric("top3_share", "Tỷ trọng AR của ba khách hàng lớn nhất", top3, "ratio", invalid, top3, ar, period_days),
        _metric("hhi", "Chỉ số tập trung HHI phải thu", hhi, "ratio", invalid, hhi, ar, period_days),
        _metric("slow_inventory_vnd", "Giá trị tồn kho chậm luân chuyển", slow_inv, "vnd", invalid, slow_inv, inv, period_days),
        _metric("slow_inventory_share", "Tỷ trọng tồn kho chậm luân chuyển", slow_share, "ratio", invalid, slow_inv, inv, period_days),
        _metric("ap_overdue_vnd", "Phải trả quá hạn", ap_overdue, "vnd", invalid, ap_overdue, ap, period_days),
        _metric("ap_overdue_share", "Tỷ trọng phải trả quá hạn", ap_overdue_share, "ratio", invalid, ap_overdue_share, ap, period_days),
        _metric("gross_margin", "Biên lợi nhuận gộp", gross_margin, "ratio", invalid, rev - cogs, rev, period_days),
    ]
    _DEPS = {"dso_days": ["ar_vnd", "revenue_credit_vnd"], "dio_days": ["inv_vnd", "cogs_vnd"],
             "dpo_days": ["ap_vnd", "cogs_vnd"], "dpo_pur_days": ["ap_vnd", "pur_credit_vnd"],
             "ccc_days": ["dso_days", "dio_days", "dpo_days"], "ccc_pur_days": ["dso_days", "dio_days", "dpo_pur_days"],
             "twc_vnd": ["ar_vnd", "inv_vnd", "ap_vnd"]}
    for x in metrics:
        x.dependency_ids = _DEPS.get(x.id, [])
    _st = {x.id: x.status for x in metrics}
    for mm in metrics:
        if mm.id == "ccc_days" and mm.raw_value is None and "not_applicable" in (_st["dso_days"], _st["dio_days"], _st["dpo_days"]):
            mm.status = "not_applicable"
    snapshot_id = m["snapshot_id"]
    evidence_tables_by_metric = {
        "ar_vnd": ["D_sales"], "ar_overdue_vnd": ["D_sales"], "ar_overdue_share": ["D_sales"],
        "top1_share": ["D_sales"], "top3_share": ["D_sales"], "hhi": ["D_sales"],
        "ap_vnd": ["D_purchases"], "ap_overdue_vnd": ["D_purchases"], "ap_overdue_share": ["D_purchases"],
        "dpo_days": ["D_purchases", "D_financials"], "dpo_pur_days": ["D_purchases"],
        "ccc_days": ["D_sales", "D_purchases", "D_inventory", "D_financials"],
        "ccc_pur_days": ["D_sales", "D_purchases", "D_inventory", "D_financials"],
        "inv_vnd": ["D_inventory"], "slow_inventory_vnd": ["D_inventory"], "slow_inventory_share": ["D_inventory"],
        "revenue_vnd": ["D_financials"], "revenue_credit_vnd": ["D_sales"], "cogs_vnd": ["D_financials"], "gross_margin": ["D_financials"],
        "pur_vnd": ["D_purchases"], "pur_credit_vnd": ["D_purchases"], "dso_days": ["D_sales", "D_financials"], "dio_days": ["D_inventory", "D_financials"],
        "twc_vnd": ["D_sales", "D_purchases", "D_inventory"],
        "cash_per_1_day_dso_vnd": ["D_financials"], "cash_per_1_day_dio_vnd": ["D_financials"],
        "cash_per_1_day_dpo_vnd": ["D_financials"], "cash_per_1_day_dpo_pur_vnd": ["D_purchases"],
    }
    for metric in metrics:
        metric.evidence_ids = [f"{snapshot_id}:{table_name}" for table_name in evidence_tables_by_metric.get(metric.id, [])]
    lookback_start = as_of - timedelta(days=LATE_LOOKBACK_DAYS)
    explanation = (
        f"Số dư AR/AP/INV là snapshot tại {as_of}; doanh thu, COGS và mua hàng trong kỳ "
        f"{period_start}–{as_of} ({period_days} ngày). DSO=AR/Rev_credit×N khi có cờ bán chịu; nếu không, dùng Rev theo giả định. "
        f"DIO=INV/COGS×N; DPO=AP/COGS×N; DPO_PUR=AP/PUR_credit×N khi có cờ mua chịu; "
        f"CCC=DSO+DIO−DPO; TWC=AR+INV−AP. "
        f"INV chỉ tính hàng thuộc sở hữu; loại {excluded:,.0f} VND hàng HGC. "
        + ("Workbook đang được đánh dấu là dữ liệu thử nghiệm hư cấu; không đại diện doanh nghiệp thật."
           if m.get("data_is_synthetic", True) else "Workbook được cấu hình là dữ liệu không giả lập; cần đối chiếu với sổ nguồn trước khi dùng ra quyết định.")
    )
    insights: list[dict[str, Any]] = []
    actions: list[dict[str, Any]] = []
    if buyers and ar > 0:
        lead = buyers[0]
        if lead.share_of_ar > 0:
            insight_id = "INS-AR-CONCENTRATION"
            insights.append({"insight_id": insight_id, "theme": "receivables_concentration", "priority": "review",
                "observation": f"{lead.buyer_name} chiếm {lead.share_of_ar:.1%} số dư AR tại ngày chốt.",
                "interpretation": "Đây là mức độ tập trung số dư, không tự chứng minh khách hàng trả chậm.",
                "business_implication": "Biến động lịch thanh toán của khách hàng này có thể ảnh hưởng đáng kể đến số dư phải thu.",
                "evidence_refs": [f"{snapshot_id}:D_sales"], "metric_refs": ["top1_share", "ar_vnd"],
                "formula_ids": ["T1-A01", "T1-C04"], "assumptions": ["Số dư hóa đơn được xác định theo giả định trả một lần của workbook mẫu."],
                "limitations": ["Chưa có lịch thu tiền tương lai được xác nhận."], "confidence_reason": "Tính trực tiếp từ các hóa đơn mở trong snapshot."})
            actions.append({"action_id": "ACT-AR-VERIFY", "linked_insight_ids": [insight_id],
                "target_entity_ids": [lead.buyer_id], "proposed_step": "Đối chiếu từng hóa đơn mở và xác nhận ngày thanh toán dự kiến với khách hàng.",
                "rationale": "Ưu tiên kiểm chứng số dư tập trung trước khi đưa ra dự báo thu tiền.",
                "indicative_equivalent_capital_vnd": None, "prerequisites": ["Xác minh công nợ với sổ phụ và hợp đồng."],
                "owner_role": "Kế toán công nợ", "urgency_reason": "Khách hàng này chiếm tỷ trọng AR lớn nhất trong snapshot.",
                "verification_metric": "AR_open_by_buyer"})
    if ar_overdue > 0:
        insight_id = "INS-AR-OVERDUE"
        insights.append({"insight_id": insight_id, "theme": "receivables_overdue", "priority": "review",
            "observation": f"AR quá hạn là {ar_overdue:,.0f} VND, tương đương {ar_overdue_share:.1%} tổng AR.",
            "interpretation": "Khoản quá hạn được xác định theo due_date < as_of; không suy diễn khả năng mất vốn từ DPD đơn lẻ.",
            "business_implication": "Cần phân biệt hóa đơn quá hạn với hóa đơn chưa đến hạn trong kế hoạch thu.",
            "evidence_refs": [f"{snapshot_id}:D_sales"], "metric_refs": ["ar_overdue_vnd", "ar_overdue_share"],
            "formula_ids": ["T1-A01", "T1-C01"], "assumptions": ["Workbook mẫu giả định hóa đơn thanh toán một lần."],
            "limitations": ["Dữ liệu mẫu hiện không có payment allocations từng phần." if not m.get("payment_allocations_available") else "Cần đối chiếu các phân bổ thanh toán với sổ ngân hàng."], "confidence_reason": "Tính từ dư hóa đơn mở và ngày đến hạn."})
        actions.append({"action_id": "ACT-AR-OVERDUE", "linked_insight_ids": [insight_id],
            "target_entity_ids": [b.buyer_id for b in buyers if b.overdue_ar_vnd > 0],
            "proposed_step": "Lập danh sách hóa đơn quá hạn, đối chiếu chứng từ và ghi nhận cam kết thanh toán.",
            "rationale": "Giảm rủi ro bỏ sót khoản quá hạn và cải thiện độ tin cậy của kế hoạch thu.",
            "indicative_equivalent_capital_vnd": None, "prerequisites": ["Xác minh hóa đơn, khoản điều chỉnh và tranh chấp."],
            "owner_role": "Kế toán công nợ", "urgency_reason": "Có số dư quá hạn tại ngày chốt.",
            "verification_metric": "AR_overdue_vnd"})
    if slow_inv > 0:
        insight_id = "INS-INVENTORY-SLOW"
        slow_lines = [p.product_name for p in products if p.slow_flag]
        insights.append({"insight_id": insight_id, "theme": "inventory_age", "priority": "review",
            "observation": f"Tồn kho vượt ngưỡng tuổi được cấu hình là {slow_inv:,.0f} VND ({slow_share:.1%} INV).",
            "interpretation": "Ngưỡng tuổi là tham số cần hiệu chỉnh theo loại hàng và mô hình DN; tuổi tồn kho không đồng nghĩa toàn bộ giá trị sẽ mất.",
            "business_implication": "Cần xác minh hàng còn dùng được, gắn với đơn hàng nào và có thể tái sử dụng hay không.",
            "evidence_refs": [f"{snapshot_id}:D_inventory"], "metric_refs": ["slow_inventory_vnd", "slow_inventory_share"],
            "formula_ids": ["T1-A04", "T1-D01", "T1-D02"], "assumptions": ["Ngưỡng tồn kho lấy từ cột slow_threshold trong workbook; nếu thiếu mới dùng ngưỡng mặc định."],
            "limitations": ["Không có dữ liệu nhu cầu/NRV để kết luận giá trị thu hồi."], "confidence_reason": "Tính từ tuổi tồn và ngưỡng được khai báo."})
        actions.append({"action_id": "ACT-INVENTORY-REVIEW", "linked_insight_ids": [insight_id],
            "target_entity_ids": slow_lines, "proposed_step": "Đối chiếu từng dòng hàng chậm với đơn hàng, khả năng tái sử dụng và phương án xử lý.",
            "rationale": "Không giả định rằng ghi giảm sổ sách sẽ tạo tiền mặt.",
            "indicative_equivalent_capital_vnd": None, "prerequisites": ["Bổ sung nhu cầu, tình trạng chất lượng và NRV nếu cần."],
            "owner_role": "Quản lý kho và kế hoạch sản xuất", "urgency_reason": "Có tồn kho vượt ngưỡng demo.",
            "verification_metric": "owned_inventory_slow_value_vnd"})
    if ap_overdue > 0:
        insight_id = "INS-AP-OVERDUE"
        insights.append({"insight_id": insight_id, "theme": "supplier_obligations", "priority": "review",
            "observation": f"AP quá hạn là {ap_overdue:,.0f} VND, tương đương {ap_overdue_share:.1%} AP.",
            "interpretation": "DPO là chỉ số số học; AP quá hạn không được coi là lợi thế tài trợ tự động.",
            "business_implication": "Cần xác nhận hạn thanh toán và thỏa thuận gia hạn với nhà cung cấp.",
            "evidence_refs": [f"{snapshot_id}:D_purchases"], "metric_refs": ["ap_overdue_vnd", "ap_overdue_share"],
            "formula_ids": ["T1-A02", "T1-E01", "T1-B03"], "assumptions": ["Số dư AP theo giả định thanh toán một lần."],
            "limitations": ["Chưa có dòng tiền và lịch nghĩa vụ bắt buộc để đánh giá khả năng chi trả."],
            "confidence_reason": "Tính từ hóa đơn mua mở và ngày đến hạn."})
        actions.append({"action_id": "ACT-AP-OVERDUE", "linked_insight_ids": [insight_id],
            "target_entity_ids": [s.supplier_id for s in suppliers if s.overdue_ap_vnd > 0],
            "proposed_step": "Xác nhận các khoản AP quá hạn và thỏa thuận lịch trả với nhà cung cấp.",
            "rationale": "Tránh đánh đồng DPO cao với việc thanh toán đúng thỏa thuận.",
            "indicative_equivalent_capital_vnd": None, "prerequisites": ["Đối chiếu hóa đơn và mọi gia hạn đã được chấp thuận."],
            "owner_role": "Kế toán phải trả", "urgency_reason": "Có nghĩa vụ thương mại đã quá hạn.",
            "verification_metric": "AP_overdue_vnd"})
    return WorkingCapitalResult(
        status="invalid_data" if invalid else "provisional",
        meta=Meta(run_id=f"run-{uuid.uuid4().hex[:12]}", firm_id=m["firm_id"], as_of=m["as_of"],
            period_start=m["period_start"], period_end=m["period_end"], period_days=period_days,
            snapshot_id=snapshot_id, lookback_start=lookback_start.isoformat(), lookback_end=as_of.isoformat(),
            generated_at=datetime.now().astimezone().isoformat(),
            data_source=m.get("source"), data_is_synthetic=bool(m.get("data_is_synthetic", True))),
        inputs=Inputs(revenue_vnd=rev, revenue_credit_vnd=rev_credit, cogs_vnd=cogs, ar_vnd=ar,
            inv_vnd=inv, ap_vnd=ap, pur_vnd=pur, pur_credit_vnd=pur_credit,
            excluded_inventory_vnd=excluded, balance_method="closing_snapshot",
            tax_basis="net_of_VAT",
            credit_sales_assumption=("Dùng cột is_credit trong D_sales." if any(v is not None for v in sales_credit_flags) else "Không có cột is_credit; giả định toàn bộ doanh thu là bán chịu."),
            credit_purchases_assumption=("Dùng cột is_credit trong D_purchases." if any(v is not None for v in purchase_credit_flags) else "Không có cột is_credit; giả định toàn bộ mua hàng là mua chịu.")),
        result_metrics=metrics,
        money=MoneyMetrics(revenue_per_day_vnd=rev_per_day, cogs_per_day_vnd=cogs_per_day,
            purchases_per_day_vnd=pur_per_day, credit_purchases_per_day_vnd=pur_credit_per_day, trade_working_capital_vnd=twc,
            cash_per_1_day_dso_vnd=dso_rev_per_day, cash_per_1_day_dio_vnd=cogs_per_day,
            cash_per_1_day_dpo_vnd=cogs_per_day,
            interpretation={"twc_definition": "AR + INV_owned - AP_trade at closing date",
                "one_day_values_are_estimates": True, "cash_release_guaranteed": False}),
        drivers=Drivers(buyers=buyers, products=products, suppliers=suppliers,
            receivables_aging_vnd=aging,
            concentration={"top1_share": top1, "top3_share": top3, "hhi": hhi,
                "ranked_buyer_ids": [b.buyer_id for b in buyers], "concentration_threshold": None,
                "threshold_source": "Không có ngưỡng được xác minh; không tự gắn cờ."},
            inventory_exclusions=exclusions, early_payment_discounts=discount_records,
            ranked_views={"top_buyers": [b.buyer_id for b in buyers[:3]],
                "top_products": [p.product_id for p in products[:3]],
                "flagged_buyers": [b.buyer_id for b in buyers if b.overdue_ar_vnd > 0],
                "slow_moving_lines": [p.product_id for p in products if p.slow_flag],
                "short_terms_suppliers": [s.supplier_id for s in suppliers if s.short_terms]}),
        reconciliation=recon, explanation=explanation, warnings=warnings,
        data_quality=data_quality, unsupported_metrics=unsupported,
        evidence=[{"evidence_id": f"{snapshot_id}:{table}", "source_table": table,
            "source_row_ids": [str(row.get("source_row_id")) for row in snapshot.get(rows_key, [])],
            "source_columns": columns, "filter": {"firm_id": m["firm_id"], "as_of": m["as_of"]},
            "as_of": m["as_of"], "aggregate_value": None, "unit": "rows", "status": "source_rows_available"}
            for table, rows_key, columns in (
                ("D_sales", "sales", ["firm_id", "invoice_id", "buyer", "amount_vnd", "issue_date", "due_date", "paid_date"]),
                ("D_purchases", "purchases", ["firm_id", "invoice_id", "supplier", "amount_vnd", "issue_date", "due_date", "paid_date"]),
                ("D_inventory", "inventory", ["firm_id", "product_line", "inventory_type", "qty", "unit_cost_vnd", "days_in_stock", "excluded"]))]
            + [{"evidence_id": f"{snapshot_id}:D_financials", "source_table": "D_financials",
                "source_row_ids": [f"{m['firm_id']}:{period_start}..{as_of}"],
                "source_columns": ["firm_id", "period", "revenue_vnd", "cogs_vnd"],
                "filter": {"firm_id": m["firm_id"], "as_of": m["as_of"]},
                "as_of": m["as_of"], "aggregate_value": None, "unit": "rows", "status": "source_rows_available"}],
        explanation_detail={"formula_ids": ["T1-A01", "T1-A02", "T1-A04", "T1-A05", "T1-B01", "T1-B02", "T1-B03", "T1-B04", "T1-B05", "T1-B06", "T1-C01", "T1-C02", "T1-C03", "T1-C04", "T1-D01", "T1-D02", "T1-E01", "T1-E02", "T1-E04", "T1-F01", "T1-F02", "T1-F05", "T1-J02", "T1-J03"],
            "expressions": {"DSO": "AR / Rev × N", "DIO": "INV_owned / COGS × N", "DPO": "AP_trade / COGS × N",
                "DPO_PUR": "AP_trade / PUR × N", "CCC": "DSO + DIO - DPO", "TWC": "AR + INV_owned - AP_trade"},
            "input_refs": ["D_financials", "D_sales", "D_purchases", "D_inventory"],
            "filter_definition": {"firm_id": m["firm_id"], "as_of": m["as_of"], "period": f"{period_start}..{as_of}",
                "balance_method": "closing_snapshot", "inventory": "excluded=0"},
            "assumptions": [("Có bảng phân bổ thanh toán; dư hóa đơn được tính theo các lần thu." if m.get("payment_allocations_available") else "Không có bảng phân bổ thanh toán; workbook dùng giả định thanh toán một lần."),
                "Toàn bộ doanh thu giả định là bán chịu.",
                "Toàn bộ mua hàng trong kỳ giả định là mua chịu.", "Tồn kho dùng giá gốc do chưa có NRV.",
                "Số dư dùng phương pháp snapshot cuối kỳ."],
            "excluded_records": exclusions, "calculation_method": "Deterministic Python calculations; no LLM arithmetic."},
        analysis={"ccc_decomposition": {"components": [
            {"metric_id": "DSO", "value_days": dso, "sign": 1},
            {"metric_id": "DIO", "value_days": dio, "sign": 1},
            {"metric_id": "DPO", "value_days": dpo, "sign": -1}],
            "largest_positive_component": "DSO" if dso is not None and (dio is None or dso >= dio) else "DIO",
            "buyer_contributions": [{"entity_id": b.buyer_id, "days": b.dso_days} for b in buyers],
            "product_contributions": [{"entity_id": p.product_id, "days": p.dio_days} for p in products],
            "supplier_contributions": [{"entity_id": s.supplier_id, "days": s.dpo_days} for s in suppliers]}},
        insights=insights, actions=actions,
        narrative={"executive_summary": f"CCC {ccc:.1f} ngày và TWC {twc:,.0f} VND tại {as_of}." if ccc is not None else f"TWC {twc:,.0f} VND tại {as_of}; CCC không áp dụng do thiếu mẫu số.",
            "receivables": f"AR {ar:,.0f} VND; quá hạn {ar_overdue:,.0f} VND.",
            "inventory": f"INV thuộc sở hữu {inv:,.0f} VND; tồn vượt ngưỡng tuổi được cấu hình {slow_inv:,.0f} VND.",
            "payables": f"AP {ap:,.0f} VND; quá hạn {ap_overdue:,.0f} VND.",
            "priorities": [x["insight_id"] for x in insights], "limitations": [x["reason"] for x in unsupported]},
        benchmark=[
            {"metric_id": "dso_days", "value": dso, "range": [32.0, 47.5], "source": "TV1_Nguong (tham chiếu trong workbook; chưa xác minh độc lập)",
             "reference_period": None, "balance_method": "average balance / 365", "peer_model": "DN dệt may niêm yết, khác quy mô và mô hình",
             "comparability": "descriptive_only", "status": "descriptive_only", "reason": "Khác phương pháp snapshot cuối kỳ / 90 ngày."},
            {"metric_id": "dio_days", "value": dio, "range": [57.6, 82.6], "source": "TV1_Nguong (tham chiếu trong workbook; chưa xác minh độc lập)",
             "reference_period": None, "balance_method": "average balance / 365", "peer_model": "DN dệt may niêm yết, khác quy mô và mô hình",
             "comparability": "descriptive_only", "status": "descriptive_only", "reason": "Khác phương pháp snapshot cuối kỳ / 90 ngày."},
            {"metric_id": "dpo_days", "value": dpo, "range": [16.1, 38.8], "source": "TV1_Nguong (tham chiếu trong workbook; chưa xác minh độc lập)",
             "reference_period": None, "balance_method": "average balance / 365", "peer_model": "DN dệt may niêm yết, khác quy mô và mô hình",
             "comparability": "descriptive_only", "status": "descriptive_only", "reason": "Khác phương pháp snapshot cuối kỳ / 90 ngày."},
            {"metric_id": "ccc_days", "value": ccc, "range": [64.9, 98.0], "source": "TV1_Nguong (tham chiếu trong workbook; chưa xác minh độc lập)",
             "reference_period": None, "balance_method": "average balance / 365", "peer_model": "DN dệt may niêm yết, khác quy mô và mô hình",
             "comparability": "descriptive_only", "status": "descriptive_only", "reason": "Khác phương pháp snapshot cuối kỳ / 90 ngày."}],
        compatibility={"dso": round_half_up(dso, 1) if dso is not None else None,
            "dio": round_half_up(dio, 1) if dio is not None else None,
            "dpo": round_half_up(dpo, 1) if dpo is not None else None,
            "ccc": round_half_up(ccc, 1) if ccc is not None else None,
            "dpo_on_purchases": round_half_up(dpo_pur, 1) if dpo_pur is not None else None},
    )