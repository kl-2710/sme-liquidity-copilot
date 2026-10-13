"""Nạp snapshot UC-01 từ workbook đặc tả/dữ liệu mẫu hoặc file do người dùng chỉ định.
Mặc định đọc data/Đặc tả công thức_UC1.xlsx. Dữ liệu trong workbook được ghi rõ là DỮ LIỆU THỬ NGHIỆM, không phải dữ liệu doanh nghiệp thật.
"""
from __future__ import annotations
import hashlib, json, os, re
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from openpyxl import load_workbook
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")
_env_workbook = os.getenv("UC1_WORKBOOK_PATH", "")
def _resolve_workbook() -> Path:
    """Ưu tiên uc1_workbook.xlsx (tên ASCII); nếu không có thì lấy file .xlsx đầu tiên trong data/.
    Tránh phụ thuộc tên file có dấu (dễ hỏng mã hóa khi nén/giải nén ZIP)."""
    d = BASE_DIR / "data"
    preferred = d / "uc1_workbook.xlsx"
    if preferred.exists():
        return preferred
    found = sorted(p for p in d.glob("*.xlsx") if not p.name.startswith("~$"))
    return found[0] if found else preferred

DEFAULT_WORKBOOK_PATH = _resolve_workbook()
WORKBOOK_PATH = Path(_env_workbook) if _env_workbook else DEFAULT_WORKBOOK_PATH
DATA_IS_SYNTHETIC = os.getenv("UC1_DATA_IS_SYNTHETIC", "true").strip().lower() in {"1", "true", "yes", "y"}
if not WORKBOOK_PATH.is_absolute():
    WORKBOOK_PATH = (BASE_DIR / WORKBOOK_PATH).resolve()

class DataValidationError(ValueError):
    """Lỗi thiếu hoặc không hợp lệ của dữ liệu đầu vào."""

class UC1Error(DataValidationError):
    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(f"{code}: {message}")
        self.code, self.retryable = code, retryable

def _date(v: Any) -> date | None:
    if v in (None, ""): return None
    if isinstance(v, datetime): return v.date()
    if isinstance(v, date): return v
    return date.fromisoformat(str(v)[:10])

def _bool_or_none(value: Any) -> bool | None:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    value = str(value).strip().lower()
    if value in {"1", "true", "yes", "y", "có"}:
        return True
    if value in {"0", "false", "no", "n", "không"}:
        return False
    raise DataValidationError(f"Giá trị cờ không hợp lệ: {value!r}")


def _rows(ws) -> list[dict[str, Any]]:
    rows = list(ws.iter_rows(values_only=True))
    header_idx = next((i for i, row in enumerate(rows) if row and "firm_id" in row), None)
    if header_idx is None: raise DataValidationError(f"Không tìm thấy dòng tiêu đề firm_id trong sheet {ws.title}")
    headers = [str(x).strip() if x is not None else "" for x in rows[header_idx]]
    result = []
    for values in rows[header_idx + 1:]:
        if not values or all(v is None for v in values): continue
        result.append({headers[i]: values[i] if i < len(values) else None for i in range(len(headers)) if headers[i]})
    return result

def _optional_rows(wb, sheet_name: str, firm_id: str) -> list[dict[str, Any]]:
    if sheet_name not in wb.sheetnames:
        return []
    return [r for r in _rows(wb[sheet_name]) if str(r.get("firm_id")) == firm_id]


def get_snapshot(firm_id: str, as_of: str = "2026-09-30", period_days: int = 90) -> dict[str, Any]:
    """Tạo snapshot theo kỳ có trong workbook; không nội suy kỳ chưa có dữ liệu."""
    try:
        as_of_d = date.fromisoformat(as_of)
    except ValueError as exc:
        raise UC1Error("INVALID_REQUEST", "as_of phải theo định dạng YYYY-MM-DD") from exc
    if period_days <= 0:
        raise UC1Error("INVALID_REQUEST", "period_days phải lớn hơn 0")
    if not WORKBOOK_PATH.exists():
        raise UC1Error("MISSING_CORE_SOURCE", f"Không tìm thấy workbook dữ liệu: {WORKBOOK_PATH.name}")
    wb = load_workbook(WORKBOOK_PATH, data_only=True, read_only=True)
    try:
        required = {"D_firms", "D_financials", "D_sales", "D_purchases", "D_inventory"}
        missing = required.difference(wb.sheetnames)
        if missing:
            raise UC1Error("MISSING_CORE_SOURCE", f"Workbook thiếu sheet: {sorted(missing)}")
        firms = [r for r in _rows(wb["D_firms"]) if str(r.get("firm_id")) == firm_id]
        if not firms:
            raise DataValidationError(f"Không tìm thấy firm_id '{firm_id}' trong D_firms")
        financials = [r for r in _rows(wb["D_financials"]) if str(r.get("firm_id")) == firm_id]
        if not financials:
            raise UC1Error("SNAPSHOT_NOT_FOUND", f"Không có dữ liệu tài chính cho {firm_id}")
        matches = []
        for row in financials:
            match = re.fullmatch(r"\s*(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})\s*", str(row.get("period") or ""))
            if match:
                start_date, end_date = date.fromisoformat(match.group(1)), date.fromisoformat(match.group(2))
                if end_date == as_of_d:
                    matches.append((row, start_date, end_date))
        if len(matches) != 1:
            available = [str(r.get("period")) for r in financials]
            raise UC1Error("INVALID_PERIOD_ALIGNMENT", f"as_of={as_of} phải bằng period_end; kỳ có sẵn: {available}")
        fin, period_start, period_end = matches[0]
        actual_days = (period_end - period_start).days + 1
        if int(fin.get("period_days") or actual_days) != period_days or actual_days != period_days:
            raise UC1Error("INVALID_REQUEST", f"Kỳ dài {actual_days} ngày, yêu cầu N={period_days}. Không tự nội suy dữ liệu.")

        sales_raw = [r for r in _rows(wb["D_sales"]) if str(r.get("firm_id")) == firm_id]
        sales = []
        for r in sales_raw:
            issue, due = _date(r.get("issue_date")), _date(r.get("due_date"))
            if issue is None or issue > as_of_d:
                continue
            sales.append({"firm_id": firm_id, "invoice_id": str(r.get("invoice_id")), "buyer_id": str(r.get("buyer") or "UNKNOWN"),
                "buyer_name": str(r.get("buyer") or ""), "issue_date": issue,
                "recognition_date": _date(r.get("revenue_recognition_date")) or issue, "due_date": due,
                "invoice_amount": float(r.get("amount_vnd") or 0), "paid_amount": 0.0, "credit_amount": 0.0,
                "paid_date": None, "is_credit": _bool_or_none(r.get("is_credit")),
                "source_row_id": str(r.get("invoice_id")), "is_open": True})
        sale_by_id = {r["invoice_id"]: r for r in sales}
        raw_allocations = _optional_rows(wb, "payment_allocations", firm_id)
        payment_events = []
        if "payment_allocations" in wb.sheetnames:
            for r in raw_allocations:
                inv_id = str(r.get("invoice_id") or "")
                paid_date = _date(r.get("paid_date") or r.get("payment_date"))
                amount = float(r.get("amount_net_vnd") or r.get("amount_gross_vnd") or 0)
                if inv_id in sale_by_id and paid_date is not None and paid_date <= as_of_d and amount > 0:
                    payment_events.append({"firm_id": firm_id, "invoice_id": inv_id,
                        "allocation_id": str(r.get("allocation_id") or f"ALLOC-{len(payment_events)+1}"),
                        "amount_vnd": amount, "paid_date": paid_date})
                    sale_by_id[inv_id]["paid_amount"] += amount
                    sale_by_id[inv_id]["paid_date"] = max(sale_by_id[inv_id]["paid_date"] or paid_date, paid_date)
        else:
            for r in sales_raw:
                inv_id, paid_date = str(r.get("invoice_id")), _date(r.get("paid_date"))
                if inv_id in sale_by_id and paid_date is not None and paid_date <= as_of_d:
                    amount = sale_by_id[inv_id]["invoice_amount"]
                    sale_by_id[inv_id]["paid_amount"], sale_by_id[inv_id]["paid_date"] = amount, paid_date
                    payment_events.append({"firm_id": firm_id, "invoice_id": inv_id, "allocation_id": f"SAMPLE-{inv_id}",
                        "amount_vnd": amount, "paid_date": paid_date})
        for r in _optional_rows(wb, "credit_notes", firm_id):
            inv_id, credit_date = str(r.get("invoice_id") or ""), _date(r.get("credit_date"))
            if inv_id in sale_by_id and credit_date is not None and credit_date <= as_of_d:
                sale_by_id[inv_id]["credit_amount"] += float(r.get("amount_net_vnd") or 0)
        for row in sales:
            if row["paid_amount"] < -1 or row["credit_amount"] < -1 or row["paid_amount"] + row["credit_amount"] > row["invoice_amount"] + 1:
                raise DataValidationError(f"Dữ liệu AR không hợp lệ tại hóa đơn {row['invoice_id']}: tổng thu/credit vượt giá trị hóa đơn.")
            row["paid_amount"] = max(0.0, row["paid_amount"])
            row["credit_amount"] = max(0.0, row["credit_amount"])
            row["is_open"] = row["invoice_amount"] - row["paid_amount"] - row["credit_amount"] > 0

        purchases_raw = [r for r in _rows(wb["D_purchases"]) if str(r.get("firm_id")) == firm_id]
        purchases = []
        for r in purchases_raw:
            issue, due = _date(r.get("issue_date")), _date(r.get("due_date"))
            if issue is None or issue > as_of_d:
                continue
            rate, discount_days = float(r.get("early_discount_pct") or 0), int(r.get("discount_days") or 0)
            deadline = issue + timedelta(days=discount_days) if discount_days > 0 else None
            days_early = (due - deadline).days if due and deadline else 0
            purchases.append({"firm_id": firm_id, "purchase_id": str(r.get("invoice_id")),
                "supplier_id": str(r.get("supplier") or "UNKNOWN"), "supplier_name": str(r.get("supplier") or ""),
                "purchase_date": issue, "due_date": due, "amount_vnd": float(r.get("amount_vnd") or 0),
                "paid_amount_vnd": 0.0, "credit_amount_vnd": 0.0, "paid_date": None,
                "early_discount_rate": rate, "days_early": max(0, days_early), "discount_deadline": deadline,
                "discount_days": discount_days, "is_credit": _bool_or_none(r.get("is_credit")),
                "source_row_id": str(r.get("invoice_id")), "is_open": True,
                "in_period": period_start <= issue <= period_end})
        purchase_by_id = {r["purchase_id"]: r for r in purchases}
        raw_purchase_payments = _optional_rows(wb, "purchase_payment_allocations", firm_id)
        purchase_payment_events = []
        if "purchase_payment_allocations" in wb.sheetnames:
            for r in raw_purchase_payments:
                inv_id = str(r.get("invoice_id") or "")
                paid_date = _date(r.get("paid_date") or r.get("payment_date"))
                amount = float(r.get("amount_net_vnd") or r.get("amount_gross_vnd") or 0)
                if inv_id in purchase_by_id and paid_date is not None and paid_date <= as_of_d and amount > 0:
                    purchase_payment_events.append({"firm_id": firm_id, "invoice_id": inv_id,
                        "allocation_id": str(r.get("allocation_id") or f"PALLOC-{len(purchase_payment_events)+1}"),
                        "amount_vnd": amount, "paid_date": paid_date})
                    purchase_by_id[inv_id]["paid_amount_vnd"] += amount
                    purchase_by_id[inv_id]["paid_date"] = max(purchase_by_id[inv_id]["paid_date"] or paid_date, paid_date)
        else:
            for r in purchases_raw:
                inv_id, paid_date = str(r.get("invoice_id")), _date(r.get("paid_date"))
                if inv_id in purchase_by_id and paid_date is not None and paid_date <= as_of_d:
                    amount = purchase_by_id[inv_id]["amount_vnd"]
                    purchase_by_id[inv_id]["paid_amount_vnd"], purchase_by_id[inv_id]["paid_date"] = amount, paid_date
                    purchase_payment_events.append({"firm_id": firm_id, "invoice_id": inv_id, "allocation_id": f"PSAMPLE-{inv_id}",
                        "amount_vnd": amount, "paid_date": paid_date})
        for r in _optional_rows(wb, "purchase_credits", firm_id):
            inv_id, credit_date = str(r.get("invoice_id") or ""), _date(r.get("credit_date"))
            if inv_id in purchase_by_id and credit_date is not None and credit_date <= as_of_d:
                purchase_by_id[inv_id]["credit_amount_vnd"] += float(r.get("amount_net_vnd") or 0)
        for row in purchases:
            if row["paid_amount_vnd"] < -1 or row["credit_amount_vnd"] < -1 or row["paid_amount_vnd"] + row["credit_amount_vnd"] > row["amount_vnd"] + 1:
                raise DataValidationError(f"Dữ liệu AP không hợp lệ tại hóa đơn {row['purchase_id']}: tổng trả/credit vượt giá trị hóa đơn.")
            row["paid_amount_vnd"] = max(0.0, row["paid_amount_vnd"])
            row["credit_amount_vnd"] = max(0.0, row["credit_amount_vnd"])
            row["is_open"] = row["amount_vnd"] - row["paid_amount_vnd"] - row["credit_amount_vnd"] > 0

        inv_raw = [r for r in _rows(wb["D_inventory"]) if str(r.get("firm_id")) == firm_id]
        inventory = []
        for idx, r in enumerate(inv_raw, start=1):
            qty, unit_cost = float(r.get("qty") or 0), float(r.get("unit_cost_vnd") or 0)
            age, line = int(r.get("days_in_stock") or 0), str(r.get("product_line") or f"LOT-{idx}")
            inventory.append({"firm_id": firm_id, "lot_id": f"{firm_id}-LOT-{idx:03d}", "product_id": line,
                "product_name": line, "category": str(r.get("inventory_type") or "UNKNOWN").upper(),
                "qty": qty, "unit_cost_vnd": unit_cost, "received_date": as_of_d - timedelta(days=age),
                "excluded": int(r.get("excluded") or 0), "days_in_stock": age, "slow_threshold": r.get("slow_threshold"),
                "source_row_id": line, "ownership_status": "excluded_customer_owned" if int(r.get("excluded") or 0) else "owned"})
        for row in sales:
            if row["invoice_amount"] < 0 or row["paid_amount"] < 0 or row["credit_amount"] < 0:
                raise DataValidationError(f"Giá trị AR âm không hợp lệ tại hóa đơn {row['invoice_id']}.")
        for row in purchases:
            if row["amount_vnd"] < 0 or row["paid_amount_vnd"] < 0 or row["credit_amount_vnd"] < 0:
                raise DataValidationError(f"Giá trị AP âm không hợp lệ tại hóa đơn {row['purchase_id']}.")
        sales_period = [row for row in sales if period_start <= row["issue_date"] <= period_end]
        purchase_period = [row for row in purchases if period_start <= row["purchase_date"] <= period_end]
        if sales_period and any(row["is_credit"] is not None for row in sales_period) and any(row["is_credit"] is None for row in sales_period):
            raise DataValidationError("Cột D_sales.is_credit có giá trị trống trong kỳ; cần bổ sung đầy đủ trước khi tính Rev_credit.")
        if purchase_period and any(row["is_credit"] is not None for row in purchase_period) and any(row["is_credit"] is None for row in purchase_period):
            raise DataValidationError("Cột D_purchases.is_credit có giá trị trống trong kỳ; cần bổ sung đầy đủ trước khi tính PUR_credit.")
        sales_ids = [row["invoice_id"] for row in sales]
        purchase_ids = [row["purchase_id"] for row in purchases]
        if len(sales_ids) != len(set(sales_ids)):
            raise UC1Error("DUPLICATE_KEY", "Dữ liệu D_sales có invoice_id trùng lặp; cần xử lý trước khi tính.")
        if len(purchase_ids) != len(set(purchase_ids)):
            raise UC1Error("DUPLICATE_KEY", "Dữ liệu D_purchases có invoice_id trùng lặp; cần xử lý trước khi tính.")
        payload = {"firm_id": firm_id, "period": str(fin.get("period")), "sales": sales, "payments": payment_events,
            "purchases": purchases, "purchase_payments": purchase_payment_events, "inventory": inventory}
        digest = hashlib.sha256(json.dumps(payload, default=str, sort_keys=True).encode("utf-8")).hexdigest()
        return {"meta": {"firm_id": firm_id, "as_of": as_of_d.isoformat(), "period_start": period_start.isoformat(),
                "period_end": period_end.isoformat(), "period_days": period_days, "snapshot_id": f"snap-{digest[:12]}",
                "formula_version": "tv1.formulas.v4", "config_version": "tv1.demo.v1", "source": str(WORKBOOK_PATH), "data_is_synthetic": DATA_IS_SYNTHETIC,
                "payment_allocations_available": "payment_allocations" in wb.sheetnames,
                "purchase_payment_allocations_available": "purchase_payment_allocations" in wb.sheetnames},
            "firm": {"firm_id": firm_id, "firm_name": str(firms[0].get("name") or ""), "industry": firms[0].get("industry"),
                "supply_chain_position": firms[0].get("supply_chain_position"), "min_cash_buffer_vnd": firms[0].get("min_cash_buffer_vnd")},
            "financials": {"revenue_vnd": float(fin.get("revenue_vnd") or 0), "cogs_vnd": float(fin.get("cogs_vnd") or 0),
                "opening_cash_vnd": fin.get("opening_cash_vnd")},
            "sales": sales, "payment_events": payment_events, "purchases": purchases,
            "purchase_payment_events": purchase_payment_events, "inventory": inventory}
    finally:
        wb.close()