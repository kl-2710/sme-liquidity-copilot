"""Tools layer: UC-01 tính toán bằng Python trên workbook; forecast/catalogue vẫn là demo stub.

Mọi công cụ giữ định dạng {"inputs": ..., "result": ..., "explanation": ...}.
"""
from __future__ import annotations

import re
import threading
import unicodedata
import uuid
from typing import Any, Callable

from src.core.config import TOOL_TIMEOUT
from src.core.data_loader import get_snapshot
from src.uc01_working_capital.working_capital import calculate_working_capital, round_half_up
from src.uc02_cash_forecast.cash_forecast import calculate_cash_forecast
from src.uc02_cash_forecast.schemas import CashForecastResult

# ---------------------------------------------------------------------------
# Dữ liệu giả lập
# ---------------------------------------------------------------------------
_FINANCING_CATALOGUE: list[dict[str, Any]] = [
    {"product": "Invoice Discounting (Exporter A invoices)", "type": "invoice_financing",
     "annual_rate_pct": 11.5, "fee_pct": 0.5, "max_vnd": 800_000_000, "lead_days": 5},
    {"product": "Supply-Chain Finance (Anchor-backed)", "type": "scf",
     "annual_rate_pct": 9.8, "fee_pct": 0.3, "max_vnd": 1_000_000_000, "lead_days": 10},
    {"product": "Short-term Revolving Credit Line", "type": "credit_line",
     "annual_rate_pct": 13.0, "fee_pct": 0.2, "max_vnd": 1_500_000_000, "lead_days": 14},
    {"product": "Working Capital Loan (90 days)", "type": "term_loan",
     "annual_rate_pct": 12.2, "fee_pct": 0.8, "max_vnd": 700_000_000, "lead_days": 21},
]


def _norm_name(value: Any) -> str:
    """Chuẩn hóa tên để so khớp: NFC, bỏ khoảng trắng thừa, không phân biệt hoa/thường."""
    return " ".join(unicodedata.normalize("NFC", str(value or "")).split()).casefold()


# Money mentions in a draft body: "VND 871,565,000" (optionally "... million/billion") or "871,565,000 VND".
_AMOUNT_RE = re.compile(r"\bVND\s*\d[\d,.]*\d(?:\s*(?:million|billion)\b)?|(?<![\w.,])\d[\d,.]*\d\s*VND\b", re.IGNORECASE)


def _wrap(inputs: dict[str, Any], result: Any, explanation: str) -> dict[str, Any]:
    """Đóng gói kết quả theo định dạng chuẩn 3 key bắt buộc."""
    return {"inputs": inputs, "result": result, "explanation": explanation}


# ---------------------------------------------------------------------------
# Tier 0
# ---------------------------------------------------------------------------
def _legacy_view(full: dict[str, Any]) -> dict[str, Any]:
    """Giữ khóa tương thích cho agent cũ, đồng thời trả toàn bộ hợp đồng UC-01."""
    shown = {m["id"]: m.get("display_value") for m in full.get("result_metrics", [])}
    compat = full.get("compatibility", {})
    result = dict(full)
    result.update(dso_days=compat.get("dso"), dio_days=compat.get("dio"),
        dpo_days=compat.get("dpo"), ccc_days=compat.get("ccc"),
        dpo_pur_days=compat.get("dpo_on_purchases"),
        drivers=full.get("drivers", {}), formula_version=full.get("meta", {}).get("formula_version", "tv1.formulas.v4"))
    result["metric_values"] = shown
    result["result"] = {"metrics": full.get("result_metrics", []), "compatibility": full.get("compatibility", {})}
    result["formula_version"] = full.get("meta", {}).get("formula_version", "tv1.formulas.v4")
    return result


def get_working_capital(firm_id: str, as_of: str = "2026-09-30", period_days: int = 90) -> dict[str, Any]:
    """(Tier 0) UC-01: chẩn đoán vốn lưu động từ workbook dữ liệu được cấu hình."""
    snapshot = get_snapshot(firm_id, as_of, period_days)
    full = calculate_working_capital(snapshot).model_dump(mode="json")
    return _wrap({"firm_id": firm_id, "as_of": as_of, "period_days": period_days,
        "snapshot_id": snapshot["meta"]["snapshot_id"], "data_is_synthetic": snapshot["meta"]["data_is_synthetic"]},
        _legacy_view(full), full["explanation"])


# ---------------------------------------------------------------------------
# Tier 1
# ---------------------------------------------------------------------------
class ToolTimeoutError(TimeoutError):
    """Raised when a tool runs longer than TOOL_TIMEOUT seconds. The late result is discarded and never released."""
    code = "TOOL_TIMEOUT"
    retryable = True


def run_with_timeout(fn: Callable[..., Any], timeout: float, *args: Any, label: str = "tool", **kwargs: Any) -> Any:
    """Run `fn` in a daemon thread and give up after `timeout` seconds.

    Python cannot kill a running thread, so a timed-out job may finish in the background; its result is ignored and the daemon
    thread never blocks interpreter exit. Exceptions raised by `fn` are re-raised unchanged in the caller.
    """
    box: dict[str, Any] = {}

    def target() -> None:
        try:
            box["value"] = fn(*args, **kwargs)
        except BaseException as exc:  # noqa: BLE001 - re-raised in the caller
            box["error"] = exc

    worker = threading.Thread(target=target, name=f"{label}-worker", daemon=True)
    worker.start()
    worker.join(timeout)
    if worker.is_alive():
        raise ToolTimeoutError(f"TOOL_TIMEOUT: {label} exceeded {timeout:g} seconds")
    if "error" in box:
        raise box["error"]
    return box["value"]


def run_forecast(firm_id: str, as_of: str = "2026-09-30", weeks: int = 13, case_id: str = "base", extra_days: int = 7,
                 buffer_vnd: Any = None, weekly_only: bool = False) -> CashForecastResult:
    """UC-02 engine call (snapshot read + calculation) under the TOOL_TIMEOUT guard. Shared by the tool, the REST API and the UI."""
    def job() -> CashForecastResult:
        snapshot = get_snapshot(firm_id, as_of)
        return calculate_cash_forecast(snapshot, firm_id, as_of, weeks, case_id=case_id, extra_days=extra_days,
                                       buffer_vnd=buffer_vnd, weekly_only=weekly_only)
    return run_with_timeout(job, TOOL_TIMEOUT, label="forecast_cash")  # TOOL_TIMEOUT is read at call time (tests may patch it)


def forecast_cash(firm_id: str, as_of: str = "2026-09-30", weeks: int = 13, case_id: str = "base", extra_days: int = 7,
                  buffer_vnd: Any = None, weekly_only: bool = False) -> dict[str, Any]:
    """(Tier 1 - Advise) UC-02: 13-week cash forecast and deficit warning, calculated in Python from the UC-01 snapshot.

    Args:
        firm_id: Session firm (forced by the permission layer, never taken from the model).
        as_of: Cut-off date (ISO). Forecast days are as_of+1 .. as_of+7*weeks.
        weeks: Horizon, integer 1-13.
        case_id: "base" or "estimated_receipts_late" (sensitivity test: estimated receipt dates move later).
        extra_days: days added to estimated receipt dates in the late-receipts case (default 7; ignored in the base case).
        buffer_vnd: optional override of the firm's cash buffer (VND, not negative).
        weekly_only: when true the response keeps only the summary and the weekly schedule (no daily rows, events or episodes).

    Returns:
        {"inputs", "result", "explanation"}. `result` is the full CashForecastResult plus legacy keys `first_gap_week`,
        `max_gap_vnd` (peak gap to the buffer) and `status` used by the UC-03/UC-04 placeholders.

    Raises:
        ToolTimeoutError: the run exceeded TOOL_TIMEOUT seconds (code TOOL_TIMEOUT).
    """
    result = run_forecast(firm_id, as_of, weeks, case_id, extra_days, buffer_vnd, weekly_only)
    full = result.model_dump(mode="json")  # JSON-safe: dates as ISO strings, money as integer VND
    summary = full["summary"]
    full.update(first_gap_week=summary["first_gap_week"], max_gap_vnd=float(summary["max_gap_vnd"] or 0),
                status=summary["status"], data_source="uc1_workbook + data/cash_plans.csv")
    return _wrap({"firm_id": firm_id, "as_of": as_of, "weeks": weeks, "case_id": case_id, "extra_days": extra_days,
                  "weekly_only": weekly_only, "snapshot_id": result.meta.snapshot_id, "data_is_synthetic": result.meta.data_is_synthetic},
                 full, full["explanation"])


# ---------------------------------------------------------------------------
# Tier 1 (placeholders until UC-03 and UC-04 are built)
# ---------------------------------------------------------------------------
def match_financing(firm_id: str, gap_vnd: float, gap_week: int) -> dict[str, Any]:
    """(Tier 1) Xếp hạng phương án tài trợ từ Catalogue theo chi phí hiệu dụng.

    Args:
        firm_id: Mã doanh nghiệp.
        gap_vnd: Số tiền thiếu hụt cần tài trợ (VND).
        gap_week: Tuần bắt đầu thiếu hụt.

    Returns:
        Dict gồm inputs / result (danh sách xếp hạng) / explanation.
    """
    days_available = max(int(gap_week), 1) * 7
    options: list[dict[str, Any]] = []
    for p in _FINANCING_CATALOGUE:
        if p["max_vnd"] < gap_vnd or p["lead_days"] > days_available:
            continue
        tenor_days = 90
        est_cost = gap_vnd * (p["annual_rate_pct"] / 100 * tenor_days / 365 + p["fee_pct"] / 100)
        options.append({**p, "estimated_cost_vnd_90d": round(est_cost),
                        "days_before_gap": days_available - p["lead_days"]})
    options.sort(key=lambda x: x["estimated_cost_vnd_90d"])
    for rank, o in enumerate(options, start=1):
        o["rank"] = rank
    return _wrap(
        {"firm_id": firm_id, "gap_vnd": gap_vnd, "gap_week": gap_week,
         "data_source": "synthetic_demo_catalogue", "status": "provisional_demo"},
        {"ranked_options": options, "status": "provisional_demo", "data_source": "synthetic_demo_catalogue",
         "note": "DEMO ONLY. Options are filtered by amount capacity and lead time, then ranked by estimated cost. "
                 "The catalogue is fictional/illustrative; the lender decides."},
        "DEMO ONLY: the catalogue is illustrative, not an actual lender offer. Estimated 90-day cost = amount x (rate x 90/365 + fee).",
    )


def simulate_scenario(firm_id: str, levers: dict[str, float]) -> dict[str, Any]:
    """(Tier 1) So sánh chỉ số trước/sau; phép tính dùng raw_value chưa làm tròn."""
    wc = get_working_capital(firm_id)["result"]
    raw = {m["id"]: m.get("raw_value") for m in wc.get("result_metrics", [])}
    base_raw = {k: raw.get(k) for k in ("dso_days", "dio_days", "dpo_days", "ccc_days")}
    max_gap_before = forecast_cash(firm_id)["result"]["max_gap_vnd"]
    dso_c = float(levers.get("dso_change_days", 0))
    dio_c = float(levers.get("dio_change_days", 0))
    dpo_c = float(levers.get("dpo_change_days", 0))
    money = wc["money"]
    daily_rev = float(money["cash_per_1_day_dso_vnd"] or 0)
    daily_cogs = float(money["cogs_per_day_vnd"] or 0)
    released = -dso_c * daily_rev - dio_c * daily_cogs + dpo_c * daily_cogs
    after_raw = {"dso_days": (base_raw["dso_days"] + dso_c) if base_raw["dso_days"] is not None else None,
        "dio_days": (base_raw["dio_days"] + dio_c) if base_raw["dio_days"] is not None else None,
        "dpo_days": (base_raw["dpo_days"] + dpo_c) if base_raw["dpo_days"] is not None else None}
    after_raw["ccc_days"] = (after_raw["dso_days"] + after_raw["dio_days"] - after_raw["dpo_days"]
        if all(after_raw[k] is not None for k in ("dso_days", "dio_days", "dpo_days")) else None)
    before_display = {k: round_half_up(v, 1) if v is not None else None for k, v in base_raw.items()}
    after_display = {k: round_half_up(v, 1) if v is not None else None for k, v in after_raw.items()}
    return _wrap(
        {"firm_id": firm_id, "levers": levers, "data_source": "UC-01 workbook + synthetic demo cash forecast"},
        {"before": before_display | {"max_gap_vnd": max_gap_before},
         "after": after_display | {"max_gap_vnd": max(0.0, max_gap_before - released)},
         "cash_released_vnd": round_half_up(released, 0), "status": "provisional_demo",
         "note": "Chỉ số vốn dùng UC-01; max_gap dùng dự báo tiền demo, không phải dự báo thực tế."},
        "Cash released = -dDSO × revenue/day - dDIO × COGS/day + dDPO × COGS/day. "
        "Chỉ số UC-01 dùng giá trị thô chưa làm tròn; ước tính max_gap vẫn là kịch bản demo.",
    )


# ---------------------------------------------------------------------------
# Tier 2
# ---------------------------------------------------------------------------

def draft_action(firm_id: str, action_type: str, details: dict[str, Any]) -> dict[str, Any]:
    """(Tier 2) Tạo bản nháp action. KHÔNG gửi đi đâu."""
    safe_details = dict(details) if isinstance(details, dict) else {}
    if action_type == "payment_reminder":
        recipient = str(safe_details.get("recipient", "")).strip()
        if not recipient:
            return _wrap(
                {"firm_id": firm_id, "action_type": action_type, "details": safe_details},
                {"status": "blocked", "reason": "Missing recipient; the overdue amount cannot be verified."},
                "Draft not created."
            )
        wc = get_working_capital(firm_id=firm_id)
        wc_result = wc.get("result", {}) if isinstance(wc, dict) else {}
        buyers = wc_result.get("drivers", {}).get("buyers", [])
        key = _norm_name(recipient)
        buyer = next(
            (b for b in buyers
             if key in (_norm_name(b.get("buyer_name", "")), _norm_name(b.get("buyer_id", "")))),
            None
        )
        if buyer is None:
            return _wrap(
                {"firm_id": firm_id, "action_type": action_type, "details": safe_details},
                {"status": "blocked", "reason": f"Recipient '{recipient}' was not found among this firm's buyers."},
                "Draft not created."
            )
        verified_amount = buyer.get("overdue_ar_vnd")
        if verified_amount is None or float(verified_amount) <= 0:
            return _wrap(
                {"firm_id": firm_id, "action_type": action_type, "details": safe_details},
                {"status": "blocked", "reason": "The recipient has no verified positive overdue receivable."},
                "Draft not created."
            )
        verified_amount = float(verified_amount)
        safe_details["amount_vnd"] = round(verified_amount)
        body_key = next(
            (key for key in ("body", "content", "message") if isinstance(safe_details.get(key), str)),
            None
        )
        amount_text = f"VND {verified_amount:,.0f}"
        if body_key:
            safe_details[body_key] = _AMOUNT_RE.sub(amount_text, safe_details[body_key])
            if amount_text not in safe_details[body_key]:
                safe_details[body_key] += f"\nVerified overdue amount: {amount_text}."
        draft_id = f"DRAFT-{uuid.uuid4().hex[:5].upper()}"
        return _wrap(
            {"firm_id": firm_id, "action_type": action_type, "details": safe_details},
            {
                "draft_id": draft_id,
                "status": "pending_approval",
                "action_type": action_type,
                "content": safe_details,
                "verified_amount_vnd": round(verified_amount),
                "recipient": buyer.get("buyer_name") or recipient
            },
            "Draft stored locally only. Nothing was sent. The owner must approve in the UI."
        )
    draft_id = f"DRAFT-{uuid.uuid4().hex[:5].upper()}"
    return _wrap(
        {"firm_id": firm_id, "action_type": action_type, "details": safe_details},
        {"draft_id": draft_id, "status": "pending_approval", "action_type": action_type, "content": safe_details},
        "Draft stored locally only. Nothing was sent. The owner must approve in the UI."
    )


# ---------------------------------------------------------------------------
# Registry (Tier 3 submit_action cố ý KHÔNG nằm ở đây)
# ---------------------------------------------------------------------------
TOOL_REGISTRY: dict[str, Callable[..., dict[str, Any]]] = {
    "get_working_capital": get_working_capital,
    "forecast_cash": forecast_cash,
    "match_financing": match_financing,
    "simulate_scenario": simulate_scenario,
    "draft_action": draft_action,
}