"""UC-02: 13-week cash forecast and shortfall alert (formulas T2-01 .. T2-18, formula_version tv2.formulas.v1).

Pure calculation: no network, no LLM, no file writes. Money is Decimal end to end (reconciliation tolerance 1 VND).
Inputs come from the UC-01 snapshot (`get_snapshot`) plus the UC-01 result (buyer payment delays) plus the planned
cash flows in data/cash_plans.csv (payroll, rent, tax... the snapshot does not carry them).

Pipeline: cash0/buffer -> open invoice portions (T2-02/03) -> receipt/payment dates (T2-04/05/06) -> cash_events
-> daily ledger (T2-07/08/09) -> weekly roll-up -> gaps and alerts (T2-10..15) -> episodes -> drivers (T2-16/17)
-> case shift (T2-18) -> reconciliation.
"""
from __future__ import annotations

import csv
import hashlib
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_CEILING
from pathlib import Path
from typing import Any, Iterable, Mapping, Optional

from src.core.config import BASE_DIR
from src.uc02_cash_forecast.insights import build_evidence, build_fact_registry, build_insights, build_summary_text, format_dmy, format_vnd
from src.uc02_cash_forecast.schemas import (
    AlertConfig, AlertRule, Assumption, AuditRef, Capabilities, BuyerDelay, Narrative, BuyerReceiptShare, CashEvent, CashForecastResult, CashForecastSummary, CriticalDate,
    DailyForecast, DataQuality, DatedEvents, Direction, Episode, EventRef, ForecastDrivers, ForecastInputs,
    ForecastIssue, ForecastMeta, ForecastMetric, ForecastReconciliation, WeeklyForecast, CONFIG_VERSION,
    FORMULA_VERSION, SCHEMA_VERSION, _money_out,
)

ZERO = Decimal(0)
DEFAULT_AS_OF = "2026-09-30"
MAX_WEEKS = 13
CASE_BASE = "base"
CASE_LATE = "estimated_receipts_late"
DEFAULT_EXTRA_DAYS = 7
YELLOW_UPPER = Decimal("0.2")
ORANGE_UPPER = Decimal("0.5")
TOLERANCE_VND = Decimal(1)
LOOKBACK_DAYS, MIN_COUNT, FALLBACK_DAYS = 180, 5, 0  # fixed by the UC-01 history calculation that this module reuses
PLANS_PATH = BASE_DIR / "data" / "cash_plans.csv"
PLAN_COLUMNS = ("event_id", "firm_id", "date", "direction", "category", "amount_vnd", "source_id", "known_at")

SEVERITY = {"green": 0, "yellow": 1, "orange": 2, "red": 3}
COLOR_OF = {v: k for k, v in SEVERITY.items()}

# Issue codes that stop a full forecast. "missing" -> status missing_data, "invalid" -> status invalid_data.
_MISSING = {"MISSING_CASH_SNAPSHOT", "MISSING_BUFFER", "PLANS_SOURCE_MISSING", "UNSCHEDULED_AMOUNT"}
_INVALID = {"INVALID_BUFFER", "INVALID_RESTRICTED", "PLAN_INVALID_ROW", "PLAN_BEFORE_START", "DUPLICATE_EVENT_ID",
            "PLAN_DUPLICATES_INVOICE"}


class CashForecastError(ValueError):
    """Request-level error (the run is not executed). `code` follows SRS 3.10.3.2."""

    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(f"{code}: {message}")
        self.code, self.retryable = code, retryable


# ------------------------------------------------------------------------------------------------
# Small helpers
# ------------------------------------------------------------------------------------------------
def _dec(value: Any, field: str = "value") -> Decimal:
    """Decimal from int/float/str; NaN/Infinity and booleans are rejected."""
    if isinstance(value, bool):
        raise CashForecastError("INVALID_REQUEST", f"{field} must be a number")
    if isinstance(value, Decimal):
        out = value
    else:
        try:
            out = Decimal(str(value).strip())
        except (InvalidOperation, ValueError):
            raise CashForecastError("INVALID_REQUEST", f"{field} is not a number: {value!r}") from None
    if not out.is_finite():
        raise CashForecastError("INVALID_REQUEST", f"{field} must be finite")
    return out


def _to_date(value: Any) -> Optional[date]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _json_num(value: Optional[Decimal]) -> Optional[int | str]:
    return None if value is None else _money_out(value)


def classify_cash_detail(cash_end: Decimal, buffer: Decimal, yellow_upper: Decimal = YELLOW_UPPER,
                         orange_upper: Decimal = ORANGE_UPPER) -> tuple[str, Optional[Decimal], Decimal, Decimal, str, Optional[float]]:
    """T2-10, T2-11, T2-12 and the alert colour with its trace: (colour, ratio, gap_buffer, gap_zero, rule_id, threshold_value).

    The ratio is compared RAW (exactly 20% is yellow, exactly 50% is orange). Negative cash is always red.
    Buffer = 0: ratio is None; negative cash is red, non-negative is green. The two gaps are never added together.
    """
    gap_buffer = max(ZERO, buffer - cash_end)  # T2-10
    gap_zero = max(ZERO, -cash_end)            # T2-11
    if buffer == 0:
        if cash_end < 0:
            return "red", None, gap_buffer, gap_zero, "T2-ALERT-RED-NEGATIVE", 0.0
        return "green", None, gap_buffer, gap_zero, "T2-ALERT-GREEN-ZERO-BUFFER", None
    ratio = gap_buffer / buffer                # T2-12
    if cash_end < 0:
        return "red", ratio, gap_buffer, gap_zero, "T2-ALERT-RED-NEGATIVE", 0.0
    if ratio > orange_upper:
        return "red", ratio, gap_buffer, gap_zero, "T2-ALERT-RED-RATIO", float(orange_upper)
    if ratio > yellow_upper:
        return "orange", ratio, gap_buffer, gap_zero, "T2-ALERT-ORANGE", float(orange_upper)
    if ratio > 0:
        return "yellow", ratio, gap_buffer, gap_zero, "T2-ALERT-YELLOW", float(yellow_upper)
    return "green", ratio, gap_buffer, gap_zero, "T2-ALERT-GREEN", 0.0


def classify_cash(cash_end: Decimal, buffer: Decimal, yellow_upper: Decimal = YELLOW_UPPER,
                  orange_upper: Decimal = ORANGE_UPPER) -> tuple[str, Optional[Decimal], Decimal, Decimal]:
    """Colour, raw ratio, gap to buffer, gap to zero (see classify_cash_detail for the rule trace)."""
    return classify_cash_detail(cash_end, buffer, yellow_upper, orange_upper)[:4]


def alert_config(yellow: Decimal, orange: Decimal) -> AlertConfig:
    """The configured thresholds and the rules behind every colour (SRS 3.1.4: rule_id, threshold, basis, grain, config_version)."""
    y, o = float(yellow), float(orange)
    return AlertConfig(yellow_upper=y, orange_upper=o, rules=[
        AlertRule(rule_id="T2-ALERT-GREEN", level="green", condition="cash >= buffer (gap ratio = 0)", threshold_value=0.0),
        AlertRule(rule_id="T2-ALERT-YELLOW", level="yellow", condition="0 < gap ratio <= yellow_upper", threshold_value=y),
        AlertRule(rule_id="T2-ALERT-ORANGE", level="orange", condition="yellow_upper < gap ratio <= orange_upper", threshold_value=o),
        AlertRule(rule_id="T2-ALERT-RED-RATIO", level="red", condition="gap ratio > orange_upper", threshold_value=o),
        AlertRule(rule_id="T2-ALERT-RED-NEGATIVE", level="red", condition="cash < 0 (always red)", threshold_value=0.0),
        AlertRule(rule_id="T2-ALERT-GREEN-ZERO-BUFFER", level="green", condition="buffer = 0 and cash >= 0 (no ratio)", threshold_value=None)])


def _source_files(snapshot: Mapping[str, Any], plans_status: str) -> list[Path]:
    files: list[Path] = []
    src = (snapshot.get("meta") or {}).get("source")
    if src and Path(src).exists():
        files.append(Path(src))
    if plans_status == PLANS_PATH.name and PLANS_PATH.exists():
        files.append(PLANS_PATH)
    return files


def _checksum(files: Iterable[Path]) -> Optional[str]:
    files = list(files)
    if not files:
        return None
    h = hashlib.sha256()
    for f in files:
        h.update(f.name.encode()), h.update(f.read_bytes())
    return h.hexdigest()


def _rel(p: Path) -> str:
    try:
        return p.resolve().relative_to(BASE_DIR).as_posix()
    except ValueError:
        return p.resolve().as_posix()  # outside the project folder: keep the absolute path so the file can still be re-checked


def verify_sources_unchanged(meta: Any) -> Optional[bool]:
    """STALE_SNAPSHOT check before release: True = sources unchanged, False = changed since the run, None = nothing to compare."""
    m = meta if isinstance(meta, dict) else meta.model_dump()
    if not m.get("source_checksum"):
        return None
    paths = [Path(f) if Path(f).is_absolute() else BASE_DIR / f for f in m.get("source_files", [])]
    return all(p.exists() for p in paths) and _checksum(paths) == m["source_checksum"]


def load_cash_plans(firm_id: str, path: Optional[str | Path] = None) -> list[dict[str, str]]:
    """Planned cash flows (payroll, rent, tax, ...) for one firm from data/cash_plans.csv.

    Raises MISSING_CORE_SOURCE when the file is absent (a missing source is not the same as "no plans").
    Returns [] when the file exists but declares nothing for this firm.
    """
    p = Path(path) if path else PLANS_PATH
    if not p.exists():
        raise CashForecastError("MISSING_CORE_SOURCE", f"cash plans file not found: {p.name}")
    with p.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        missing = [c for c in PLAN_COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise CashForecastError("MISSING_CORE_SOURCE", f"cash plans file lacks columns: {missing}")
        return [dict(r) for r in reader if (r.get("firm_id") or "").strip() == firm_id]


@dataclass(frozen=True)
class _Delay:
    raw: Optional[Decimal]
    used: Decimal
    ceil: int
    method: str
    count: int
    name: str


def _delay_table(snapshot: Mapping[str, Any], buyer_delays: Optional[Mapping[str, Mapping[str, Any]]],
                 uc01_result: Any) -> tuple[dict[str, Mapping[str, Any]], Optional[str]]:
    """Per-buyer {late_positive_wavg_days, coverage_status, history_invoice_count} from UC-01 (T2-04). Returns (table, uc01 run_id)."""
    if buyer_delays is not None:
        return dict(buyer_delays), None
    if uc01_result is None:
        from src.uc01_working_capital.working_capital import calculate_working_capital  # UC-02 builds on UC-01
        uc01_result = calculate_working_capital(dict(snapshot))
    table = {b.buyer_id: {"late_positive_wavg_days": b.late_positive_wavg_days, "coverage_status": b.coverage_status,
                          "history_invoice_count": b.history_invoice_count, "buyer_name": b.buyer_name}
             for b in uc01_result.drivers.buyers}
    return table, getattr(getattr(uc01_result, "meta", None), "run_id", None)


def _resolve_delay(buyer_id: str, buyer_name: str, table: Mapping[str, Mapping[str, Any]]) -> _Delay:
    rec = table.get(buyer_id) or {}
    raw = rec.get("late_positive_wavg_days")
    count = int(rec.get("history_invoice_count") or 0)
    if raw is not None and rec.get("coverage_status", "ok") == "ok":
        used = Decimal(str(round(float(raw), 9)))  # remove float noise before CEILING
        return _Delay(Decimal(str(raw)), used, int(used.to_integral_value(rounding=ROUND_CEILING)),
                      "history_late_positive", count, buyer_name)
    return _Delay(None, Decimal(FALLBACK_DAYS), FALLBACK_DAYS, "fallback_on_time", count, buyer_name)


# ------------------------------------------------------------------------------------------------
# Event construction (T2-02 .. T2-06)
# ------------------------------------------------------------------------------------------------
def _sales_events(rows: Iterable[Mapping[str, Any]], start: date, end: date, case_id: str, extra_days: int,
                  table: Mapping[str, Mapping[str, Any]], issues: list[ForecastIssue]
                  ) -> tuple[list[CashEvent], dict[str, _Delay], list[tuple[str, Decimal]]]:
    events: list[CashEvent] = []
    delays: dict[str, _Delay] = {}
    advances: list[tuple[str, Decimal]] = []
    for row in rows:
        inv = str(row["invoice_id"])
        open_amt = (_dec(row.get("invoice_amount"), f"{inv}.invoice_amount") - _dec(row.get("paid_amount") or 0)
                    - _dec(row.get("credit_amount") or 0))          # T2-02 (payments/credits only up to the cut-off)
        if open_amt < 0:
            advances.append((inv, -open_amt))                       # advance/overpayment: kept apart, never netted
            continue
        if open_amt == 0:
            continue
        buyer_id, buyer_name = str(row.get("buyer_id")), str(row.get("buyer_name") or row.get("buyer_id"))
        due, confirmed = _to_date(row.get("due_date")), _to_date(row.get("confirmed_date"))
        common = dict(event_id=inv, source_type="sales_invoice", source_id=inv, direction="IN", category="invoice_receipt",
                      counterparty_id=buyer_id, counterparty_name=buyer_name, amount_vnd=open_amt, formula_id="T2-05")
        if confirmed is None and due is None:
            events.append(CashEvent(**common, date_method="unscheduled", scope="unscheduled"))
            continue
        assumptions: list[str] = []
        if confirmed is not None:                                   # T2-05: confirmed schedule first
            raw_date, method, delay_days, estimated = confirmed, "confirmed_schedule", None, False
        else:
            d = delays.setdefault(buyer_id, _resolve_delay(buyer_id, buyer_name, table))
            raw_date, delay_days, estimated = due + timedelta(days=d.ceil), d.ceil, True
            method = d.method
            assumptions.append("A-RECEIPT-HISTORY")
            if d.method == "fallback_on_time":
                assumptions.append("A-FALLBACK-ON-TIME")
        rolled = raw_date < start                                   # past dates move to Start (labelled assumption)
        base = max(start, raw_date)
        if rolled:
            assumptions.append("A-OVERDUE-ROLL")
        shift = extra_days if (case_id == CASE_LATE and estimated) else 0  # T2-18: only estimated receipts
        if shift:
            assumptions.append("A-CASE-LATE")
        active = base + timedelta(days=shift)
        events.append(CashEvent(**common, original_date=raw_date, base_date=base, cash_date=active, date_method=method,
                                roll_applied=rolled, case_shift_days=shift, delay_days_applied=delay_days,
                                scope="in_horizon" if active <= end else "beyond_horizon", assumption_ids=assumptions))
    return events, delays, advances


def _purchase_events(rows: Iterable[Mapping[str, Any]], start: date, end: date) -> tuple[list[CashEvent], list[tuple[str, Decimal]]]:
    events: list[CashEvent] = []
    advances: list[tuple[str, Decimal]] = []
    for row in rows:
        inv = str(row["purchase_id"])
        open_amt = (_dec(row.get("amount_vnd"), f"{inv}.amount_vnd") - _dec(row.get("paid_amount_vnd") or 0)
                    - _dec(row.get("credit_amount_vnd") or 0))      # T2-03
        if open_amt < 0:
            advances.append((inv, -open_amt))
            continue
        if open_amt == 0:
            continue
        sup_id, sup_name = str(row.get("supplier_id")), str(row.get("supplier_name") or row.get("supplier_id"))
        due, approved = _to_date(row.get("due_date")), _to_date(row.get("approved_date"))
        common = dict(event_id=inv, source_type="purchase_invoice", source_id=inv, direction="OUT",
                      category="supplier_payment", counterparty_id=sup_id, counterparty_name=sup_name,
                      amount_vnd=open_amt, formula_id="T2-06")
        raw_date = approved or due                                  # T2-06: approved schedule first, else due date
        if raw_date is None:
            events.append(CashEvent(**common, date_method="unscheduled", scope="unscheduled"))
            continue
        rolled = raw_date < start
        base = max(start, raw_date)
        events.append(CashEvent(**common, original_date=raw_date, base_date=base, cash_date=base,
                                date_method="approved_schedule" if approved else "due_date", roll_applied=rolled,
                                scope="in_horizon" if base <= end else "beyond_horizon",
                                assumption_ids=["A-OVERDUE-ROLL"] if rolled else []))
    return events, advances


def _plan_events(rows: Iterable[Mapping[str, Any]], as_of: date, start: date, end: date, synthetic: bool,
                 issues: list[ForecastIssue]) -> list[CashEvent]:
    events: list[CashEvent] = []
    for row in rows:
        eid = str(row.get("event_id") or "").strip()
        try:
            pdate = _to_date(row.get("date"))
            amount = _dec(row.get("amount_vnd"), f"{eid}.amount_vnd")
            direction = str(row.get("direction") or "").strip().upper()
            known_at = _to_date(row.get("known_at"))
        except (CashForecastError, ValueError):
            pdate, amount, direction, known_at = None, ZERO, "", None
        if not eid or pdate is None or amount <= 0 or direction not in ("IN", "OUT"):
            issues.append(ForecastIssue(code="PLAN_INVALID_ROW", severity="error", source_ids=[eid or "?"],
                                        message="Plan row needs event_id, ISO date, positive amount and direction IN/OUT."))
            continue
        if known_at is not None and known_at > as_of:               # not known at the cut-off
            issues.append(ForecastIssue(code="PLAN_NOT_YET_KNOWN", severity="info", source_ids=[eid],
                                        message="Plan became known after the cut-off and is ignored."))
            continue
        if pdate < start:
            issues.append(ForecastIssue(code="PLAN_BEFORE_START", severity="error", source_ids=[eid],
                                        message=f"Plan date {format_dmy(pdate)} is before the first forecast day {format_dmy(start)}."))
            continue
        events.append(CashEvent(event_id=eid, source_type="plan", source_id=str(row.get("source_id") or eid),
                                direction=direction, category=str(row.get("category") or "other").strip(),
                                counterparty_name="Planned item", amount_vnd=amount, original_date=pdate, base_date=pdate,
                                cash_date=pdate, date_method="plan", formula_id="T2-07" if direction == "IN" else "T2-08",
                                scope="in_horizon" if pdate <= end else "beyond_horizon",
                                assumption_ids=["A-DEMO-PLANS"] if synthetic else []))
    return events


# ------------------------------------------------------------------------------------------------
# Ledger, weekly roll-up, episodes, drivers
# ------------------------------------------------------------------------------------------------
def _ledger(cash0: Decimal, events: list[CashEvent], start: date, horizon_days: int, buffer: Decimal,
            yellow: Decimal, orange: Decimal) -> list[DailyForecast]:
    inflow: dict[date, Decimal] = defaultdict(Decimal)
    outflow: dict[date, Decimal] = defaultdict(Decimal)
    for e in events:
        if e.scope == "in_horizon":
            (inflow if e.direction == "IN" else outflow)[e.cash_date] += e.amount_vnd
    days: list[DailyForecast] = []
    cash = cash0
    for i in range(horizon_days):                                   # always 7*H rows, including quiet days
        d = start + timedelta(days=i)
        opening, cash = cash, cash + inflow[d] - outflow[d]         # T2-09: CashEnd = CashStart + In - Out
        color, ratio, gap_b, gap_z, rule, thr = classify_cash_detail(cash, buffer, yellow, orange)
        days.append(DailyForecast(date=d, week_number=i // 7 + 1, opening_vnd=opening, in_vnd=inflow[d], out_vnd=outflow[d],
                                  closing_vnd=cash, gap_buffer_vnd=gap_b, gap_zero_vnd=gap_z,
                                  gap_ratio=None if ratio is None else float(ratio), alert_color=color,
                                  severity=SEVERITY[color], alert_rule_id=rule, alert_threshold=thr))
    return days


def _weekly(days: list[DailyForecast], buffer: Decimal, yellow: Decimal, orange: Decimal) -> list[WeeklyForecast]:
    weeks: list[WeeklyForecast] = []
    for w in range(len(days) // 7):
        chunk = days[7 * w: 7 * w + 7]
        closing = chunk[-1].closing_vnd                              # closing of the week = closing of its last day
        color, ratio, gap_b, gap_z, rule, thr = classify_cash_detail(closing, buffer, yellow, orange)
        lowest = min(chunk, key=lambda x: (x.closing_vnd, x.date))   # T2-13 (ties: earliest day)
        worst = max(chunk, key=lambda x: x.severity)
        weeks.append(WeeklyForecast(
            week_number=w + 1, start_date=chunk[0].date, end_date=chunk[-1].date, opening_vnd=chunk[0].opening_vnd,
            in_vnd=sum((x.in_vnd for x in chunk), ZERO), out_vnd=sum((x.out_vnd for x in chunk), ZERO), closing_vnd=closing,
            min_daily_vnd=lowest.closing_vnd, min_daily_date=lowest.date, alert_color=color, gap_buffer_vnd=gap_b,
            gap_zero_vnd=gap_z, worst_daily_alert_color=COLOR_OF[worst.severity],
            max_daily_gap_buffer_vnd=max(x.gap_buffer_vnd for x in chunk), max_daily_gap_zero_vnd=max(x.gap_zero_vnd for x in chunk),
            negative_days=sum(1 for x in chunk if x.closing_vnd < 0), below_buffer_days=sum(1 for x in chunk if x.gap_buffer_vnd > 0),
            alert_rule_id=rule, alert_threshold=thr, gap_ratio=None if ratio is None else float(ratio)))
    return weeks


def _episodes(days: list[DailyForecast], threshold: Decimal, basis: str, cash0: Decimal) -> list[Episode]:
    """Runs of consecutive days below `threshold` (buffer or 0). Never summed: each run reports its own peak."""
    eps: list[Episode] = []
    i, n = 0, len(days)
    while i < n:
        if days[i].closing_vnd >= threshold:
            i += 1
            continue
        j, peak, peak_date = i, threshold - days[i].closing_vnd, days[i].date
        while j + 1 < n and days[j + 1].closing_vnd < threshold:
            j += 1
            gap = threshold - days[j].closing_vnd
            if gap > peak:
                peak, peak_date = gap, days[j].date
        recovered = j + 1 < n
        eps.append(Episode(basis=basis, start_date=days[i].date, end_date=days[j].date, duration_days=j - i + 1,
                           peak_date=peak_date, peak_gap_vnd=peak, recovery_date=days[j + 1].date if recovered else None,
                           censored=not recovered, started_before_horizon=(i == 0 and cash0 < threshold)))
        i = j + 1
    return eps


def _top3(events: Iterable[CashEvent]) -> list[EventRef]:
    ordered = sorted(events, key=lambda e: (-e.amount_vnd, e.event_id))[:3]  # amount desc, ties: event_id asc
    return [EventRef(event_id=e.event_id, category=e.category, counterparty_name=e.counterparty_name, amount_vnd=e.amount_vnd,
                     date=e.cash_date, source_ref=f"{e.source_type}:{e.source_id}", date_method=e.date_method) for e in ordered]


# ------------------------------------------------------------------------------------------------
# Main entry point
# ------------------------------------------------------------------------------------------------
def calculate_cash_forecast(snapshot: dict, firm_id: str, as_of: str = DEFAULT_AS_OF, weeks: int = MAX_WEEKS, *,
                            case_id: str = CASE_BASE, extra_days: int = DEFAULT_EXTRA_DAYS,
                            plans: Optional[list[Mapping[str, Any]]] = None, restricted_vnd: Any = 0,
                            buffer_vnd: Any = None, yellow_upper: Any = YELLOW_UPPER, orange_upper: Any = ORANGE_UPPER,
                            allow_partial: bool = False, buyer_delays: Optional[Mapping[str, Mapping[str, Any]]] = None,
                            uc01_result: Any = None, weekly_only: bool = False) -> CashForecastResult:
    """Compute the forecast for one firm. Raises CashForecastError for a bad request; data problems come back as a
    result whose summary.status is missing_data / invalid_data (never a silently "normal" colour).

    Args:
        snapshot: output of get_snapshot (meta, firm, financials, sales, purchases). Not modified.
        firm_id: session firm; must equal snapshot.meta.firm_id.
        as_of: cut-off date (ISO); must equal snapshot.meta.as_of. Forecast days are as_of+1 .. as_of+7*weeks.
        weeks: horizon H, integer 1..13.
        case_id: "base" or "estimated_receipts_late" (T2-18: estimated receipt dates move by `extra_days`).
        plans: planned flows (event_id, firm_id, date, direction, category, amount_vnd, source_id, known_at); None = data/cash_plans.csv.
        restricted_vnd: restricted cash deducted from cash at the cut-off (T2-01).
        buffer_vnd: overrides firm.min_cash_buffer_vnd.
        allow_partial: if only UNSCHEDULED amounts block the run, still compute and keep overall_level "unknown".
        buyer_delays / uc01_result: UC-01 payment-delay source; default recomputes UC-01 from the snapshot.
        weekly_only: payload mode. The full engine still runs (so every figure and the reconciliation are unchanged), but the response keeps only
            the summary and the 13-week `weekly_schedule`: `daily_schedule` is null and `cash_events`, `episodes` and the per-date drivers are empty.
    """
    # ---- 1. request validation ---------------------------------------------------------------
    if not isinstance(firm_id, str) or not firm_id:
        raise CashForecastError("INVALID_REQUEST", "firm_id is required")
    if isinstance(weeks, bool) or not isinstance(weeks, int) or not 1 <= weeks <= MAX_WEEKS:
        raise CashForecastError("INVALID_REQUEST", f"weeks must be an integer between 1 and {MAX_WEEKS}")
    if not isinstance(weekly_only, bool):
        raise CashForecastError("INVALID_REQUEST", "weekly_only must be true or false")
    if case_id not in (CASE_BASE, CASE_LATE):
        raise CashForecastError("INVALID_REQUEST", f"case_id must be '{CASE_BASE}' or '{CASE_LATE}'")
    if isinstance(extra_days, bool) or not isinstance(extra_days, int) or not 0 <= extra_days <= 90:
        raise CashForecastError("INVALID_REQUEST", "extra_days must be an integer between 0 and 90")
    yellow, orange = _dec(yellow_upper, "yellow_upper"), _dec(orange_upper, "orange_upper")
    if not (0 < yellow < orange <= 1):
        raise CashForecastError("INVALID_REQUEST", "alert thresholds must satisfy 0 < yellow_upper < orange_upper <= 1")
    try:
        as_of_d = date.fromisoformat(as_of)
    except (TypeError, ValueError):
        raise CashForecastError("INVALID_REQUEST", "as_of must be an ISO date (YYYY-MM-DD)") from None
    meta_in = snapshot.get("meta") or {}
    if meta_in.get("firm_id") != firm_id:
        raise CashForecastError("UNAUTHORIZED_FIRM", "the snapshot does not belong to the session firm")
    if str(meta_in.get("as_of")) != as_of_d.isoformat():
        raise CashForecastError("INVALID_DATE_ALIGNMENT", f"snapshot is for {meta_in.get('as_of')}, not {as_of}")
    start, end, horizon_days = as_of_d + timedelta(days=1), as_of_d + timedelta(days=7 * weeks), 7 * weeks
    synthetic = bool(meta_in.get("data_is_synthetic", True))
    issues: list[ForecastIssue] = []

    # ---- 2. cash and buffer (T2-01) ------------------------------------------------------------
    cash_raw = (snapshot.get("financials") or {}).get("opening_cash_vnd")
    cash_at_cutoff = None if cash_raw is None else _dec(cash_raw, "opening_cash_vnd")
    restricted = _dec(restricted_vnd if restricted_vnd is not None else 0, "restricted_vnd")
    if cash_at_cutoff is None:
        issues.append(ForecastIssue(code="MISSING_CASH_SNAPSHOT", severity="error", field="cash_snapshot.cash_vnd",
                                    message="Cash at the cut-off date is missing."))
    if restricted < 0:
        issues.append(ForecastIssue(code="INVALID_RESTRICTED", severity="error", field="restricted_vnd",
                                    message="Restricted cash must not be negative."))
    buf_raw = buffer_vnd if buffer_vnd is not None else (snapshot.get("firm") or {}).get("min_cash_buffer_vnd")
    buffer = None if buf_raw is None else _dec(buf_raw, "buffer_vnd")
    if buffer is None:
        issues.append(ForecastIssue(code="MISSING_BUFFER", severity="error", field="buffer_vnd",
                                    message="The cash buffer is missing (a buffer of 0 is different from a missing buffer)."))
    elif buffer < 0:
        issues.append(ForecastIssue(code="INVALID_BUFFER", severity="error", field="buffer_vnd",
                                    message="The cash buffer must not be negative."))
    cash0 = None if cash_at_cutoff is None else cash_at_cutoff - restricted  # T2-01

    # ---- 3. open invoices and plans -> cash_events --------------------------------------------------
    delay_table, uc01_run_id = _delay_table(snapshot, buyer_delays, uc01_result)
    sales_ev, delays, ar_adv = _sales_events(snapshot.get("sales") or [], start, end, case_id, extra_days, delay_table, issues)
    purch_ev, ap_adv = _purchase_events(snapshot.get("purchases") or [], start, end)
    plans_status = "param"
    if plans is None:
        try:
            plans, plans_status = load_cash_plans(firm_id), PLANS_PATH.name
        except CashForecastError as exc:
            plans, plans_status = [], "missing"
            issues.append(ForecastIssue(code="PLANS_SOURCE_MISSING", severity="error", message=str(exc), field="plans"))
    plan_ev = _plan_events(plans, as_of_d, start, end, synthetic, issues)
    events = sales_ev + purch_ev + plan_ev

    seen: dict[str, str] = {}
    for e in events:                                                # anti-duplication: one obligation, one event
        if e.event_id in seen:
            code = "PLAN_DUPLICATES_INVOICE" if "plan" in (e.source_type, seen[e.event_id]) else "DUPLICATE_EVENT_ID"
            issues.append(ForecastIssue(code=code, severity="error", source_ids=[e.event_id],
                                        message=f"{e.event_id} is scheduled twice (it appears in more than one source)."))
        seen[e.event_id] = e.source_type
    invoice_ids = {e.source_id for e in sales_ev + purch_ev}
    for e in plan_ev:
        if e.source_id in invoice_ids and e.source_id != e.event_id:
            issues.append(ForecastIssue(code="PLAN_DUPLICATES_INVOICE", severity="error", source_ids=[e.event_id, e.source_id],
                                        message="A plan duplicates an invoice already in the schedule."))
    unscheduled = {d: sum((e.amount_vnd for e in events if e.scope == "unscheduled" and e.direction == d), ZERO) for d in ("IN", "OUT")}
    beyond = {d: sum((e.amount_vnd for e in events if e.scope == "beyond_horizon" and e.direction == d), ZERO) for d in ("IN", "OUT")}
    for kind, amount in unscheduled.items():
        if amount > 0:
            ids = [e.event_id for e in events if e.scope == "unscheduled" and e.direction == kind]
            issues.append(ForecastIssue(code="UNSCHEDULED_AMOUNT", severity="error" if not allow_partial else "warning",
                                        source_ids=ids, field=f"unscheduled.{kind}",
                                        message=f"{len(ids)} {kind} item(s) with a combined VND {_money_out(amount)} have no usable date."))
    for src, items in (("sales", ar_adv), ("purchases", ap_adv)):
        if items:
            issues.append(ForecastIssue(code="ADVANCE_OR_OVERPAYMENT", severity="warning", source_ids=[i for i, _ in items],
                                        message=f"{len(items)} {src} invoice(s) are overpaid; kept apart, never netted against others."))
    if any(e.roll_applied for e in events):
        issues.append(ForecastIssue(code="OVERDUE_ROLL", severity="info", source_ids=[e.event_id for e in events if e.roll_applied],
                                    message="Items whose expected date is already past are placed on the first forecast day (assumption)."))
    if any(d.method == "fallback_on_time" for d in delays.values()):
        issues.append(ForecastIssue(code="FALLBACK_DELAY", severity="info",
                                    source_ids=[k for k, d in delays.items() if d.method == "fallback_on_time"],
                                    message=f"Buyers with fewer than {MIN_COUNT} invoices in history are assumed to pay on the due date."))
    if any(beyond.values()):
        issues.append(ForecastIssue(code="BEYOND_HORIZON", severity="info", message="Some items fall after the forecast end and are excluded."))

    # ---- 4. status ------------------------------------------------------------------------------------------
    codes = {i.code for i in issues if i.severity == "error" or (i.severity == "warning" and i.code == "UNSCHEDULED_AMOUNT")}
    invalid, missing = bool(codes & _INVALID), bool(codes & _MISSING)
    hard_missing = bool({"MISSING_CASH_SNAPSHOT", "MISSING_BUFFER", "PLANS_SOURCE_MISSING"} & codes)
    blocked = invalid or hard_missing or ("UNSCHEDULED_AMOUNT" in codes and not allow_partial) or cash0 is None or buffer is None
    status = "invalid_data" if invalid else ("missing_data" if missing else ("provisional" if synthetic or events else "ok"))

    run_id, now = f"run-{uuid.uuid4().hex[:12]}", datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    src_files = _source_files(snapshot, plans_status)
    meta = ForecastMeta(run_id=run_id, firm_id=firm_id, snapshot_id=meta_in.get("snapshot_id"), as_of=as_of_d, start_date=start,
                        end_date=end, horizon_weeks=weeks, case_id=case_id, generated_at=now,
                        source_run_ids={"UC01": uc01_run_id} if uc01_run_id else {}, data_is_synthetic=synthetic,
                        source_files=[_rel(f) for f in src_files], source_checksum=_checksum(src_files), weekly_only=weekly_only)
    used_ids = {a for e in events for a in e.assumption_ids}
    texts = {
        "A-DEMO-CASH": "Opening cash is the demo field D_financials.opening_cash_vnd, re-assumed as cash at the cut-off date; restricted cash is assumed to be 0.",
        "A-DEMO-PLANS": "Payroll, rent, tax and other planned flows are illustrative demo plans, not real obligations.",
        "A-RECEIPT-HISTORY": "Estimated receipt date = due date + the buyer's positive historical payment delay rounded up (180-day history); an estimate, not a customer commitment.",
        "A-FALLBACK-ON-TIME": "Buyers with fewer than 5 invoices in history are assumed to pay on the due date; this is an assumption, not an observation.",
        "A-OVERDUE-ROLL": "Items whose expected date has already passed are placed on the first forecast day; this is an assumption, not a promise.",
        "A-CASE-LATE": f"Scenario: estimated receipt dates are {extra_days} days later (a sensitivity test, not a probability).",
        "A-NO-NEW-SALES": "Only open invoices and declared plans are forecast; no future sales, purchases, stock sales or new borrowing.",
        "A-EOD-BALANCES": "Balances are end-of-day; a shortfall inside a day is not visible.",
    }
    ids = (["A-DEMO-CASH"] if synthetic else []) + sorted(used_ids) + ["A-NO-NEW-SALES", "A-EOD-BALANCES"]
    assumptions = [Assumption(id=i, text=texts[i]) for i in dict.fromkeys(ids)]
    inputs = ForecastInputs(
        cash_at_cutoff_vnd=cash_at_cutoff, restricted_vnd=restricted, cash0_vnd=cash0, buffer_vnd=buffer, lookback_days=LOOKBACK_DAYS,
        min_count=MIN_COUNT, fallback_days=FALLBACK_DAYS, extra_days=extra_days if case_id == CASE_LATE else 0,
        yellow_upper=float(yellow), orange_upper=float(orange), alert_config=alert_config(yellow, orange), assumptions=assumptions,
        source_refs=["D_financials.opening_cash_vnd (demo proxy for cash at the cut-off)", "D_firms.min_cash_buffer_vnd",
                     "D_sales (open invoices)", "D_purchases (open invoices)", f"plans: {plans_status}",
                     "UC01 late_positive_wavg_days per buyer"])
    dq = DataQuality(coverage_status="incomplete" if (missing or invalid or any(unscheduled.values())) else "complete",
                     unscheduled_amounts=unscheduled, beyond_horizon_amounts=beyond, plans_status=plans_status, issues=issues,
                     omitted_activity=([] if plans else ["No planned cash flows (payroll, tax, rent...) are declared for this firm."]))
    pending = [i.message for i in issues if i.severity in ("error", "warning")]
    audit_ref = AuditRef(run_id=run_id)

    def capabilities() -> Capabilities:
        return Capabilities(coverage_status=dq.coverage_status, omitted_activity=dq.omitted_activity,
                            unscheduled_amounts=unscheduled, beyond_horizon_amounts=beyond,
                            daily_schedule=not blocked, weekly_schedule=not blocked, drill_down=not blocked)

    if blocked:                                                     # no full forecast is shown as if it were valid
        summary = CashForecastSummary(firm_id=firm_id, as_of=as_of_d, cash0_vnd=cash0, buffer_vnd=buffer, horizon_weeks=weeks,
                                      status=status, start_date=start, end_date=end, case_id=case_id, overall_level="unknown")
        why = "; ".join(pending) or "required inputs are missing"
        return CashForecastResult(meta=meta, inputs=inputs, summary=summary, cash_events=events, data_quality=dq,
                                  reconciliation=ForecastReconciliation(status="not_run"), warnings=pending,
                                  issues=dq.issues, capabilities=capabilities(), audit_ref=audit_ref,
                                  narrative=Narrative(overview=build_summary_text(summary), generation_status="engine_summary",
                                                      validation_outcome="not_run", locale="en"),
                                  metrics=_metrics_blocked(cash0, status),
                                  explanation=f"The {weeks}-week cash forecast was not produced for {firm_id} ({status}): {why}")

    # ---- 5. ledger, weekly, gaps, alerts, episodes -------------------------------------------------------------
    days = _ledger(cash0, events, start, horizon_days, buffer, yellow, orange)
    weekly = _weekly(days, buffer, yellow, orange)
    total_in, total_out = sum((d.in_vnd for d in days), ZERO), sum((d.out_vnd for d in days), ZERO)
    closing_end = days[-1].closing_vnd
    initial_color, _, init_gap_b, _ = classify_cash(cash0, buffer, yellow, orange)
    first_buffer = next((d for d in days if d.gap_buffer_vnd > 0), None)       # T2-14 (daily grain)
    first_neg = next((d for d in days if d.closing_vnd < 0), None)
    low = min(days, key=lambda x: (x.closing_vnd, x.date))                     # T2-13/15: earliest day on ties
    peak_b, peak_z = max(d.gap_buffer_vnd for d in days), max(d.gap_zero_vnd for d in days)  # T2-15: MAX, never SUM
    peak_b_day = min((d for d in days if d.gap_buffer_vnd == peak_b), key=lambda x: x.date) if peak_b > 0 else None
    peak_z_day = min((d for d in days if d.gap_zero_vnd == peak_z), key=lambda x: x.date) if peak_z > 0 else None
    top_sev = max([SEVERITY[initial_color]] + [d.severity for d in days])
    first_high = None
    if top_sev > 0:
        first_high = as_of_d if SEVERITY[initial_color] == top_sev else next(d.date for d in days if d.severity == top_sev)
    partial = missing and not invalid                                           # computed but coverage incomplete
    breach = "breach" if (first_buffer or first_neg) else "no_breach"
    summary = CashForecastSummary(
        firm_id=firm_id, as_of=as_of_d, cash0_vnd=cash0, buffer_vnd=buffer, horizon_weeks=weeks,
        first_gap_week=None if first_buffer is None else first_buffer.week_number,
        max_gap_vnd=peak_b, first_buffer_date=None if first_buffer is None else first_buffer.date,
        first_negative_date=None if first_neg is None else first_neg.date, status=status, start_date=start, end_date=end,
        case_id=case_id, max_gap_date=None if peak_b_day is None else peak_b_day.date, first_highest_date=first_high,
        min_balance_vnd=low.closing_vnd, min_balance_date=low.date, peak_buffer_gap_vnd=peak_b,
        peak_buffer_gap_date=None if peak_b_day is None else peak_b_day.date, peak_zero_gap_vnd=peak_z,
        peak_zero_gap_date=None if peak_z_day is None else peak_z_day.date, total_in_vnd=total_in, total_out_vnd=total_out,
        closing_end_vnd=closing_end, initial_alert_color=initial_color, initial_below_buffer=init_gap_b > 0,
        overall_level="unknown" if partial else COLOR_OF[top_sev], observed_level=COLOR_OF[top_sev],
        breach_status="unknown" if partial else breach,
        first_buffer_week_closing=next((w.week_number for w in weekly if w.gap_buffer_vnd > 0), None),      # T2-14, weekly grain
        first_negative_week_closing=next((w.week_number for w in weekly if w.closing_vnd < 0), None))
    episodes = _episodes(days, buffer, "buffer", cash0) + (_episodes(days, ZERO, "zero", cash0))
    episodes.sort(key=lambda e: (e.start_date, e.basis))

    # ---- 6. drivers (T2-16, T2-17, T2-04) ----------------------------------------------------------------------------
    kinds: dict[date, list[str]] = defaultdict(list)
    for kind, d in (("first_below_buffer", first_buffer), ("first_negative", first_neg), ("lowest_balance", low)):
        if d is not None:
            kinds[d.date].append(kind)
    if first_high is not None and first_high != as_of_d:
        kinds[first_high].append("first_highest_alert")
    by_date = {d.date: d for d in days}
    in_ev = [e for e in events if e.scope == "in_horizon" and e.direction == "IN"]
    out_ev = [e for e in events if e.scope == "in_horizon" and e.direction == "OUT"]
    crit, outs, ins_on, ins_after, decomp = [], [], [], [], ZERO
    for d in sorted(kinds):
        row = by_date[d]
        cum_in = sum((x.in_vnd for x in days if x.date <= d), ZERO)
        cum_out = sum((x.out_vnd for x in days if x.date <= d), ZERO)
        decomp = max(decomp, abs(cash0 + cum_in - cum_out - row.closing_vnd))      # T2-16 must reproduce the balance
        crit.append(CriticalDate(kinds=kinds[d], date=d, week_number=row.week_number, opening_vnd=row.opening_vnd,
                                 in_on_date_vnd=row.in_vnd, out_on_date_vnd=row.out_vnd, cumulative_in_vnd=cum_in,
                                 cumulative_out_vnd=cum_out, closing_vnd=row.closing_vnd, week_closing_vnd=weekly[row.week_number - 1].closing_vnd,
                                 gap_buffer_vnd=row.gap_buffer_vnd, gap_zero_vnd=row.gap_zero_vnd, gap_ratio=row.gap_ratio,
                                 alert_color=row.alert_color))
        outs.append(DatedEvents(date=d, items=_top3(e for e in out_ev if e.cash_date == d)))
        ins_on.append(DatedEvents(date=d, items=_top3(e for e in in_ev if e.cash_date == d)))
        ins_after.append(DatedEvents(date=d, items=_top3(e for e in in_ev if e.cash_date > d)))
    receipts_by_buyer: dict[str, Decimal] = defaultdict(Decimal)
    names: dict[str, str] = {}
    for e in in_ev:
        if e.source_type == "sales_invoice":
            receipts_by_buyer[e.counterparty_id] += e.amount_vnd
            names[e.counterparty_id] = e.counterparty_name or e.counterparty_id
    shares = [BuyerReceiptShare(buyer_id=b, buyer_name=names[b], receipts_vnd=v, share=float(v / total_in) if total_in > 0 else None)
              for b, v in sorted(receipts_by_buyer.items(), key=lambda kv: (-kv[1], kv[0]))]          # T2-17
    buyer_delays_out = [BuyerDelay(buyer_id=b, buyer_name=d.name, history_invoice_count=d.count,
                                   delay_raw_days=None if d.raw is None else float(d.raw), delay_used_days=float(d.used),
                                   delay_ceil_days=d.ceil, method=d.method) for b, d in sorted(delays.items())]
    drivers = ForecastDrivers(critical_dates=crit, dated_outflows=outs, receipts_on_date=ins_on, receipts_after=ins_after,
                              buyer_receipt_shares=shares, buyer_delays=buyer_delays_out)

    # ---- 7. reconciliation against INDEPENDENT control totals from the raw rows -----------------------------------------
    ctl_ar = sum((max(ZERO, _dec(r.get("invoice_amount")) - _dec(r.get("paid_amount") or 0) - _dec(r.get("credit_amount") or 0))
                  for r in (snapshot.get("sales") or [])), ZERO)
    ctl_ap = sum((max(ZERO, _dec(r.get("amount_vnd")) - _dec(r.get("paid_amount_vnd") or 0) - _dec(r.get("credit_amount_vnd") or 0))
                  for r in (snapshot.get("purchases") or [])), ZERO)
    valid_plans = [p for p in plans if str(p.get("event_id") or "") in {e.event_id for e in plan_ev}]
    ctl_plan = {d: sum((_dec(p["amount_vnd"]) for p in valid_plans if str(p["direction"]).strip().upper() == d), ZERO) for d in ("IN", "OUT")}
    src_delta = {
        "IN_sales_invoices": ctl_ar - sum((e.amount_vnd for e in sales_ev), ZERO),
        "OUT_purchase_invoices": ctl_ap - sum((e.amount_vnd for e in purch_ev), ZERO),
        "IN_plans": ctl_plan["IN"] - sum((e.amount_vnd for e in plan_ev if e.direction == "IN"), ZERO),
        "OUT_plans": ctl_plan["OUT"] - sum((e.amount_vnd for e in plan_ev if e.direction == "OUT"), ZERO)}
    parts = {d: sum((e.amount_vnd for e in events if e.direction == d), ZERO) for d in ("IN", "OUT")}
    src_delta["scope_split_IN"] = parts["IN"] - (total_in + beyond["IN"] + unscheduled["IN"])     # in + beyond + unscheduled = source
    src_delta["scope_split_OUT"] = parts["OUT"] - (total_out + beyond["OUT"] + unscheduled["OUT"])
    cash_delta = (closing_end - cash0) - (total_in - total_out)
    wd_delta = abs(sum((w.in_vnd for w in weekly), ZERO) - total_in) + abs(sum((w.out_vnd for w in weekly), ZERO) - total_out)
    mismatches = sum(1 for w, i in zip(weekly, range(0, horizon_days, 7)) if w.closing_vnd != days[i + 6].closing_vnd)
    checks = [abs(cash_delta), wd_delta, decomp] + [abs(v) for v in src_delta.values()]
    recon = ForecastReconciliation(
        cash_delta_vnd=cash_delta, weekly_daily_delta_vnd=wd_delta, closing_mismatches=mismatches, decomposition_delta_vnd=decomp,
        source_delta_vnd=src_delta, tolerance_vnd=TOLERANCE_VND, evidence_refs=["EV-RECON"],
        status="ok" if (max(checks) <= TOLERANCE_VND and mismatches == 0) else "failed",
        details={"note": "Arithmetic consistency only; it does not prove the forecast will come true."})
    warnings_out = list(pending)
    if recon.status == "failed":  # SRS: a result is released only after reconciliation; never show it as a valid forecast
        status = summary.status = "invalid_data"
        dq.issues.append(ForecastIssue(code="RECONCILIATION_FAILED", severity="error",
                                       message="Internal reconciliation failed (cash, weekly/daily or source totals differ by more than 1 VND)."))
        warnings_out.append("Reconciliation failed: do not rely on this forecast.")

    metrics = _metrics(cash0, buffer, events, delays, total_in, total_out, closing_end, weekly, low, first_buffer, first_neg,
                       peak_b, peak_z, decomp, shares, case_id, extra_days, status, days, [c.date for c in crit])
    evidence = build_evidence(run_id=run_id, snapshot_id=meta_in.get("snapshot_id"), firm_id=firm_id, inputs=inputs, events=events, days=days,
                              crit=crit, delays=delays, total_in=total_in, total_out=total_out, plans_status=plans_status)
    facts = build_fact_registry(summary=summary, inputs=inputs, days=days, weekly=weekly, episodes=episodes, drivers=drivers, events=events,
                                case_id=case_id, extra_days=extra_days, weeks=weeks, status=status, dq_beyond=beyond, synthetic=synthetic)
    insights = build_insights(summary=summary, drivers=drivers, assumptions=[a.id for a in assumptions],
                              buyer_share=shares[0].share if shares else None)
    explanation = (
        f"{weeks}-week cash forecast for {firm_id} ({format_dmy(start)} to {format_dmy(end)}, case {case_id}): cash0 {format_vnd(cash0)}, "
        f"buffer {format_vnd(buffer)}. First day below buffer: {format_dmy(first_buffer.date) if first_buffer else 'none'}; first negative day: "
        f"{format_dmy(first_neg.date) if first_neg else 'none'}; lowest end-of-day balance {format_vnd(low.closing_vnd)} on {format_dmy(low.date)}; "
        f"peak gap to zero {format_vnd(peak_z)}; peak gap to buffer {format_vnd(peak_b)} (alternative measures, not additive). "
        f"Status {status}; reconciliation {recon.status}.")
    narrative = Narrative(overview=build_summary_text(summary, extra_days if case_id == CASE_LATE else 0), generation_status="engine_summary",
                          validation_outcome="not_run", locale="en",
                          fact_refs=[k for k in ("cash0", "first_buffer_date", "first_negative_date", "min_balance", "min_date", "zero_gap_peak",
                                                 "buffer_gap_peak") if k in facts])
    result = CashForecastResult(meta=meta, inputs=inputs, summary=summary, weekly_schedule=weekly, daily_schedule=days, episodes=episodes,
                                cash_events=events, drivers=drivers, data_quality=dq, reconciliation=recon, metrics=metrics,
                                issues=dq.issues, capabilities=capabilities(), insights=insights, evidence=evidence, fact_registry=facts,
                                narrative=narrative, audit_ref=audit_ref, warnings=warnings_out, explanation=explanation)
    return _weekly_only_view(result) if weekly_only else result


def _weekly_only_view(r: CashForecastResult) -> CashForecastResult:
    """Payload mode: keep the summary and the 13-week schedule; drop the heavy day-level parts (nothing is recalculated)."""
    gone = lambda ids: [i for i in ids if not i.startswith("EV-CRIT-")]  # noqa: E731 - evidence of the removed per-date drivers
    issue = ForecastIssue(code="WEEKLY_ONLY_PAYLOAD", severity="info",
                          message="Weekly-only payload: the daily schedule, cash events, episodes and per-date drivers are omitted from this response; "
                                  "the summary was calculated from the full daily ledger.")
    issues = list(r.issues) + [issue]
    return r.model_copy(update={
        "daily_schedule": None, "cash_events": [], "episodes": [],
        "drivers": ForecastDrivers(buyer_receipt_shares=r.drivers.buyer_receipt_shares, buyer_delays=r.drivers.buyer_delays),
        "fact_registry": {k: v for k, v in r.fact_registry.items() if not k.startswith("drv_")},
        "evidence": [e.model_copy(update={"source_record_ids": []}) for e in r.evidence if not e.evidence_id.startswith("EV-CRIT-")],
        "metrics": [m.model_copy(update={"evidence_ids": gone(m.evidence_ids)}) for m in r.metrics],
        "insights": [i.model_copy(update={"evidence_refs": gone(i.evidence_refs)}) for i in r.insights],
        "capabilities": r.capabilities.model_copy(update={"daily_schedule": False, "drill_down": False, "weekly_only": True}),
        "data_quality": r.data_quality.model_copy(update={"issues": issues}), "issues": issues})


# ------------------------------------------------------------------------------------------------
# Metric records (one per formula id T2-01 .. T2-18)
# ------------------------------------------------------------------------------------------------
def _display(raw: Any, unit: str) -> Optional[str]:
    """Neutral display string (never used for maths): the reader-facing formatting happens in the narrative layer."""
    if raw is None:
        return None
    if unit == "VND":
        return f"VND {int(raw):,}" if isinstance(raw, int) else f"VND {raw}"
    if unit == "ratio":
        return f"{float(raw) * 100:.1f}%"
    if unit == "date":
        return format_dmy(raw)
    return str(raw)


def _m(mid: str, fid: str, name: str, raw: Any, unit: str, status: str, reason: Optional[str] = None,
       method: Optional[str] = None, assumptions: Optional[list[str]] = None, evidence: Optional[list[str]] = None,
       basis: str = "end_of_day") -> ForecastMetric:
    if isinstance(raw, Decimal):
        raw = _json_num(raw)
    elif isinstance(raw, date):
        raw = raw.isoformat()  # raw stays ISO; display_value is dd/mm/yyyy
    raw_type = {"VND": "decimal" if isinstance(raw, str) else "integer", "ratio": "ratio", "date": "date"}.get(unit, "count")
    return ForecastMetric(id=mid, formula_id=fid, name=name, raw_value=raw, raw_type=raw_type, display_value=_display(raw, unit), unit=unit,
                          status=status if raw is not None else (status if status in ("missing_data", "not_applicable", "invalid_data") else "not_applicable"),
                          reason_code=reason if raw is None else None, method=method, source_basis=basis, evidence_ids=evidence or [],
                          assumption_ids=assumptions or [])


def _metrics_blocked(cash0: Optional[Decimal], status: str) -> list[ForecastMetric]:
    return [_m("cash0", "T2-01", "Cash available at the start of the forecast", cash0, "VND", status if cash0 is None else "provisional",
               "missing_cash_snapshot", evidence=["EV-CASH0"], basis="cutoff")]


def _metrics(cash0: Decimal, buffer: Decimal, events: list[CashEvent], delays: dict[str, _Delay], total_in: Decimal,
             total_out: Decimal, closing_end: Decimal, weekly: list[WeeklyForecast], low: DailyForecast,
             first_buffer: Optional[DailyForecast], first_neg: Optional[DailyForecast], peak_b: Decimal, peak_z: Decimal,
             decomp: Decimal, shares: list[BuyerReceiptShare], case_id: str, extra_days: int, status: str,
             days: list[DailyForecast], crit_dates: list[date]) -> list[ForecastMetric]:
    ok = "provisional" if status == "provisional" else status
    sales = [e for e in events if e.source_type == "sales_invoice"]
    purch = [e for e in events if e.source_type == "purchase_invoice"]
    _, end_ratio, end_gap_b, end_gap_z = classify_cash(closing_end, buffer)
    top = shares[0] if shares else None
    led, crit_ev = ["EV-LEDGER"], [f"EV-CRIT-{d.isoformat()}" for d in crit_dates]
    delay_ev = [f"EV-DELAY-{i}" for i in range(1, len(delays) + 1)]
    return [
        _m("cash0", "T2-01", "Cash available at the start of the forecast", cash0, "VND", ok, method="cash_at_cutoff - restricted", evidence=["EV-CASH0"], basis="cutoff"),
        _m("open_receivables", "T2-02", "Open receivables used for the cash schedule", sum((e.amount_vnd for e in sales), ZERO), "VND", ok, evidence=["EV-AR"], basis="cutoff"),
        _m("open_payables", "T2-03", "Open payables used for the cash schedule", sum((e.amount_vnd for e in purch), ZERO), "VND", ok, evidence=["EV-AP"], basis="cutoff"),
        _m("buyers_with_history_delay", "T2-04", "Buyers whose receipt delay comes from payment history",
           sum(1 for d in delays.values() if d.method == "history_late_positive"), "count", ok, method="UC01 late_positive_wavg", evidence=delay_ev, basis="history_180d"),
        _m("receipt_dates_assigned", "T2-05", "Receipt dates assigned (in horizon or beyond)",
           sum(1 for e in sales if e.scope != "unscheduled"), "count", ok, assumptions=["A-RECEIPT-HISTORY"], evidence=["EV-AR"] + delay_ev, basis="schedule"),
        _m("payment_dates_assigned", "T2-06", "Payment dates assigned (in horizon or beyond)",
           sum(1 for e in purch if e.scope != "unscheduled"), "count", ok, evidence=["EV-AP"], basis="schedule"),
        _m("total_in", "T2-07", "Cash in over the forecast", total_in, "VND", ok, evidence=["EV-IN"]),
        _m("total_out", "T2-08", "Cash out over the forecast", total_out, "VND", ok, evidence=["EV-OUT", "EV-PLANS"]),
        _m("closing_end", "T2-09", "End-of-day cash on the last forecast day", closing_end, "VND", ok, evidence=led),
        _m("gap_buffer_end", "T2-10", "Gap to the buffer on the last forecast day", end_gap_b, "VND", ok, evidence=led + ["EV-BUFFER"], basis="buffer"),
        _m("gap_zero_end", "T2-11", "Gap to zero on the last forecast day", end_gap_z, "VND", ok, evidence=led, basis="zero"),
        _m("gap_ratio_end", "T2-12", "Gap ratio (buffer gap / buffer) on the last forecast day",
           None if end_ratio is None else float(end_ratio), "ratio", ok, "buffer_zero", evidence=led + ["EV-BUFFER"], basis="buffer"),
        _m("min_daily_balance", "T2-13", "Lowest end-of-day balance", low.closing_vnd, "VND", ok, method=f"first day on ties: {low.date}", evidence=led),
        _m("first_below_buffer_date", "T2-14", "First day below the buffer", None if first_buffer is None else first_buffer.date, "date", ok, "no_breach", evidence=led, basis="buffer"),
        _m("first_negative_date", "T2-14", "First day with negative cash", None if first_neg is None else first_neg.date, "date", ok, "no_breach", evidence=led, basis="zero"),
        _m("peak_buffer_gap", "T2-15", "Largest gap to the buffer (MAX, not summed)", peak_b, "VND", ok, evidence=led, basis="buffer"),
        _m("peak_zero_gap", "T2-15", "Largest gap to zero (MAX, not summed)", peak_z, "VND", ok, evidence=led, basis="zero"),
        _m("critical_date_decomposition_delta", "T2-16", "Max difference between cumulative in/out and the balance at notable dates", decomp, "VND", ok, evidence=crit_ev),
        _m("top_buyer_receipt_share", "T2-17", "Largest buyer's share of expected receipts",
           None if top is None or top.share is None else top.share, "ratio", ok, "no_receipts", evidence=["EV-IN"], basis="receipts"),
        _m("receipt_shift_days", "T2-18", "Days by which estimated receipts are delayed in this case",
           extra_days if case_id == CASE_LATE else None, "days", ok, "case_not_active", assumptions=["A-CASE-LATE"] if case_id == CASE_LATE else [],
           evidence=["EV-AR"], basis="assumption"),
    ]
