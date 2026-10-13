"""UC-02 evidence, fact registry and insights (SRS 3.1.5.2, 3.1.5.8, 3.10.3.5, 3.10.3.6).

Nothing here calculates a new number: every value is read from the engine's result objects. The facts are what the
narrative layer is allowed to quote (through [[FACT:id]] tokens); `display_forms["raw"]` is neutral (ISO dates, integer VND)
and the presentation layer adds the reader-facing "en" form.
"""
from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Optional, Union

from src.uc02_cash_forecast.schemas import (
    CashEvent, CriticalDate, DailyForecast, Episode, Evidence, Fact, ForecastDrivers, ForecastInputs, ForecastMetric,
    Insight, WeeklyForecast, FORMULA_VERSION, _money_out,
)

# claim types: a fact may only support a claim of the same meaning (SRS 3.10.3.6: equal numbers are not interchangeable)
OPEN, ALERT, BUF_T, NEG_T, LOW, BUF_GAP, ZERO_GAP, DRIVER, CONC, ASSUME, WEEK = (
    "opening_position", "alert_level", "buffer_timing", "negative_timing", "lowest_point", "buffer_gap", "zero_gap",
    "driver", "concentration", "assumption", "weekly_closing")
CLAIM_TYPES = (OPEN, ALERT, BUF_T, NEG_T, LOW, BUF_GAP, ZERO_GAP, DRIVER, CONC, ASSUME, WEEK)


def format_dmy(value: Union[date, str, None]) -> str:
    """Every displayed date is dd/mm/yyyy (SRS 3.2.1.3). Raw fields keep ISO dates; this is for readers only."""
    if value in (None, ""):
        return "n/a"
    d = value if isinstance(value, date) else date.fromisoformat(str(value)[:10])
    return f"{d.day:02d}/{d.month:02d}/{d.year}"


def format_vnd(x: Any) -> str:
    """VND with up to 3 decimals in millions/billions (VND 132.224 million, VND 1.119 billion); negatives read 'minus VND ...'."""
    d = Decimal(str(x))
    sign, v = ("minus " if d < 0 else ""), abs(d)
    if v >= Decimal(10) ** 9:
        q, unit = v / Decimal(10) ** 9, "billion"
    elif v >= Decimal(10) ** 6:
        q, unit = v / Decimal(10) ** 6, "million"
    else:
        return f"{sign}VND {int(v.quantize(Decimal(1), rounding=ROUND_HALF_UP)):,}"
    whole, frac = str(q.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)).split(".")
    frac = frac.rstrip("0")
    if frac and unit == "billion":
        frac = frac.ljust(2, "0")
    return f"{sign}VND {whole}{'.' + frac if frac else ''} {unit}"


def build_summary_text(summary: Any, extra_days: int = 0) -> str:
    """Deterministic English summary for `CashForecastResult.narrative.overview` (no model, no new maths: it only reads the summary)."""
    s = summary
    if s.status in ("missing_data", "invalid_data"):
        return (f"The {s.horizon_weeks}-week cash forecast for {s.firm_id} as of {format_dmy(s.as_of)} was not produced ({s.status.replace('_', ' ')}); "
                "no forecast figures are shown because they would not be reliable.")
    text = (f"As of {format_dmy(s.as_of)}, the {s.horizon_weeks}-week cash forecast ({format_dmy(s.start_date)} to {format_dmy(s.end_date)}) starts with "
            f"{format_vnd(s.cash0_vnd)} of available cash against a {format_vnd(s.buffer_vnd)} buffer.")
    if s.case_id != "base":
        text += f" Scenario: estimated receipt dates are {extra_days} days later (a sensitivity test, not a probability)."
    if s.first_buffer_date:
        text += f" Cash first falls below the buffer on {format_dmy(s.first_buffer_date)}"
        text += (f" and first turns negative on {format_dmy(s.first_negative_date)}." if s.first_negative_date
                 else " but never turns negative.")
        text += (f" The lowest end-of-day balance is {format_vnd(s.min_balance_vnd)} on {format_dmy(s.min_balance_date)}. "
                 f"The peak gap to zero is {format_vnd(s.peak_zero_gap_vnd)} and the peak gap to the buffer is {format_vnd(s.peak_buffer_gap_vnd)}; "
                 "they are alternative measures of the same point and are never added.")
    else:
        text += (f" Cash stays at or above the buffer on every forecast day; the lowest end-of-day balance is {format_vnd(s.min_balance_vnd)} "
                 f"on {format_dmy(s.min_balance_date)}.")
    return text + f" Status: {s.status}."


def _iso(d: Optional[date]) -> Optional[str]:
    return None if d is None else d.isoformat()


def _num(v: Optional[Decimal]) -> Optional[int | str]:
    return None if v is None else _money_out(v)


def _vnd_raw(v: Optional[Decimal]) -> str:
    return "n/a" if v is None else f"VND {int(v):,}" if v == v.to_integral_value() else f"VND {v}"


def build_evidence(*, run_id: str, snapshot_id: Optional[str], firm_id: str, inputs: ForecastInputs, events: list[CashEvent],
                   days: list[DailyForecast], crit: list[CriticalDate], delays: dict[str, Any], total_in: Decimal,
                   total_out: Decimal, plans_status: str) -> list[Evidence]:
    """One Evidence record per aggregate that a number or finding rests on (source rows, filter, expression, value)."""
    def ev(eid: str, table: str, ids: list[str], cols: list[str], flt: str, expr: str, value: Any) -> Evidence:
        return Evidence(evidence_id=eid, run_id=run_id, snapshot_id=snapshot_id, firm_id=firm_id, source_table=table,
                        source_record_ids=ids, source_columns=cols, filter_definition=flt, aggregate_expression=expr,
                        aggregate_value=value, calculation_version=FORMULA_VERSION)

    sales = [e for e in events if e.source_type == "sales_invoice"]
    purch = [e for e in events if e.source_type == "purchase_invoice"]
    plans = [e for e in events if e.source_type == "plan"]
    out = [
        ev("EV-CASH0", "D_financials", [firm_id], ["opening_cash_vnd"], f"firm_id = {firm_id}; demo proxy for cash at the cut-off",
           "cash_at_cutoff - restricted", _num(inputs.cash0_vnd)),
        ev("EV-BUFFER", "D_firms", [firm_id], ["min_cash_buffer_vnd"], f"firm_id = {firm_id}", "buffer_vnd", _num(inputs.buffer_vnd)),
        ev("EV-AR", "D_sales", [e.source_id for e in sales], ["invoice_amount", "paid_amount", "credit_amount", "due_date"],
           "open residual > 0 at the cut-off; payments and credits only up to the cut-off", "sum(invoice - paid - credit)",
           _num(sum((e.amount_vnd for e in sales), Decimal(0)))),
        ev("EV-AP", "D_purchases", [e.source_id for e in purch], ["amount_vnd", "paid_amount_vnd", "credit_amount_vnd", "due_date"],
           "open residual > 0 at the cut-off", "sum(amount - paid - credit)", _num(sum((e.amount_vnd for e in purch), Decimal(0)))),
        ev("EV-PLANS", plans_status, [e.event_id for e in plans], ["date", "direction", "category", "amount_vnd"],
           "known at the cut-off", "sum(amount_vnd) by direction", _num(sum((e.amount_vnd for e in plans), Decimal(0)))),
        ev("EV-IN", "cash_events", [e.event_id for e in events if e.scope == "in_horizon" and e.direction == "IN"],
           ["amount_vnd", "cash_date"], "direction = IN; scope = in_horizon", "sum(amount_vnd)", _num(total_in)),
        ev("EV-OUT", "cash_events", [e.event_id for e in events if e.scope == "in_horizon" and e.direction == "OUT"],
           ["amount_vnd", "cash_date"], "direction = OUT; scope = in_horizon", "sum(amount_vnd)", _num(total_out)),
        ev("EV-LEDGER", "daily_schedule", [d.date.isoformat() for d in days[:1] + days[-1:]], ["opening_vnd", "in_vnd", "out_vnd", "closing_vnd"],
           "all forecast days", "closing = opening + in - out", _num(days[-1].closing_vnd) if days else None),
        ev("EV-RECON", "reconciliation", [], ["cash_delta_vnd", "weekly_daily_delta_vnd", "source_delta_vnd"],
           "independent control totals from the raw rows", "|delta| <= 1 VND", "ok"),
    ]
    for i, (buyer, d) in enumerate(sorted(delays.items()), 1):
        out.append(ev(f"EV-DELAY-{i}", "UC01.drivers.buyers", [buyer], ["late_positive_wavg_days", "history_invoice_count"],
                      "180-day history to the cut-off; at least 5 invoices", "CEILING(late_positive_wavg_days)", d.ceil))
    for c in crit:
        on = [e.event_id for e in events if e.scope == "in_horizon" and e.cash_date == c.date]
        out.append(ev(f"EV-CRIT-{c.date.isoformat()}", "cash_events", on, ["amount_vnd", "direction", "cash_date"],
                      f"date = {c.date.isoformat()}; kinds = {', '.join(c.kinds)}", "cash0 + cumulative in - cumulative out",
                      _num(c.closing_vnd)))
    return out


def _fact(reg: dict[str, Fact], fid: str, label: str, path: str, value: Any, unit: str, claims: list[str], *, grain: str = "daily",
          basis: str = "end_of_day", entity: Optional[str] = None, on: Optional[str] = None, evidence: Optional[list[str]] = None,
          method: str = "engine", case: str = "base", attrs: Optional[dict[str, Any]] = None, status: str = "provisional") -> None:
    if isinstance(value, Decimal):
        raw = _vnd_raw(value) if unit == "VND" else str(value)
        value = _num(value)
    elif value is None:
        return                                    # unavailable facts are simply absent: the narrative must say "not determined"
    else:
        raw = str(value)
    reg[fid] = Fact(fact_id=fid, label=label, field_path=path, canonical_value=value, display_forms={"raw": raw}, unit=unit,
                    entity_id=entity, date=on, method=method, grain=grain, basis=basis, case=case, status=status,
                    evidence_ids=evidence or [], allowed_claim_types=claims, attributes=attrs or {})


def build_fact_registry(*, summary: Any, inputs: ForecastInputs, days: list[DailyForecast], weekly: list[WeeklyForecast],
                        episodes: list[Episode], drivers: ForecastDrivers, events: list[CashEvent], case_id: str, extra_days: int,
                        weeks: int, status: str, dq_beyond: dict[str, Decimal], synthetic: bool = True) -> dict[str, Fact]:
    """Facts for every figure, date and name the narrative may use. Absent data -> absent fact (never a placeholder number)."""
    s, reg, by_day = summary, {}, {d.date: d for d in days}
    f = lambda *a, **k: _fact(reg, *a, case=case_id, status=status, **k)  # noqa: E731
    f("demo_data", "The inputs are synthetic demo data", "meta.data_is_synthetic", "yes" if synthetic else "no", "text", [ASSUME], grain="period", basis="assumption")
    f("as_of", "Cut-off date", "summary.as_of", _iso(s.as_of), "date", [OPEN], basis="cutoff")
    f("start_date", "First forecast day", "summary.start_date", _iso(s.start_date), "date", [OPEN], basis="horizon")
    f("end_date", "Last forecast day", "summary.end_date", _iso(s.end_date), "date", [OPEN, NEG_T, BUF_T], basis="horizon")
    f("weeks", "Forecast horizon in weeks", "summary.horizon_weeks", weeks, "count", [OPEN], grain="period", basis="horizon")
    f("cash0", "Available cash at the start of the forecast", "summary.cash0_vnd", s.cash0_vnd, "VND", [OPEN], basis="cutoff", evidence=["EV-CASH0"])
    f("buffer", "Cash buffer", "summary.buffer_vnd", s.buffer_vnd, "VND", [OPEN, BUF_GAP], basis="buffer", evidence=["EV-BUFFER"])
    f("yellow_pct", "Yellow alert upper threshold (share of the buffer)", "inputs.yellow_upper", Decimal(str(inputs.yellow_upper)), "ratio", [ALERT],
      grain="period", basis="buffer_gap_ratio", method="config")
    f("orange_pct", "Orange alert upper threshold (share of the buffer)", "inputs.orange_upper", Decimal(str(inputs.orange_upper)), "ratio", [ALERT],
      grain="period", basis="buffer_gap_ratio", method="config")
    if case_id != "base":
        f("extra_days", "Days by which estimated receipts are delayed in this case", "inputs.extra_days", extra_days, "days", [ASSUME],
          grain="period", basis="assumption", method="config")
    f("observed_level", "Highest alert level reached", "summary.observed_level", s.observed_level, "text", [ALERT], basis="buffer_gap_ratio")
    f("initial_level", "Alert level at the cut-off date", "summary.initial_alert_color", s.initial_alert_color, "text", [ALERT], grain="period", basis="cutoff")
    f("first_buffer_date", "First day below the buffer", "summary.first_buffer_date", _iso(s.first_buffer_date), "date", [BUF_T], basis="buffer")
    f("first_buffer_week", "Week of the first day below the buffer", "summary.first_gap_week", s.first_gap_week, "count", [BUF_T], basis="buffer")
    hi = s.first_highest_date
    if hi is not None and hi in by_day:
        d = by_day[hi]
        ev = [f"EV-CRIT-{hi.isoformat()}"]
        f("first_highest_date", "Day the highest alert level is first reached", "summary.first_highest_date", _iso(hi), "date", [ALERT, BUF_GAP], basis="buffer_gap_ratio", evidence=ev)
        f("first_highest_level", "Alert level on that day", f"daily_schedule[{hi}].alert_color", d.alert_color, "text", [ALERT], basis="buffer_gap_ratio", on=_iso(hi))
        f("first_highest_closing", "End-of-day cash on that day", f"daily_schedule[{hi}].closing_vnd", d.closing_vnd, "VND", [ALERT, BUF_GAP], on=_iso(hi), evidence=ev)
        f("first_highest_gap", "Shortfall against the buffer on that day", f"daily_schedule[{hi}].gap_buffer_vnd", d.gap_buffer_vnd, "VND", [ALERT, BUF_GAP], basis="buffer", on=_iso(hi), evidence=ev)
        if d.gap_ratio is not None:
            f("first_highest_ratio", "Buffer shortfall as a share of the buffer on that day", f"daily_schedule[{hi}].gap_ratio", Decimal(str(d.gap_ratio)), "ratio", [ALERT, BUF_GAP], basis="buffer_gap_ratio", on=_iso(hi))
    neg = s.first_negative_date
    if neg is not None and neg in by_day:
        d, ev = by_day[neg], [f"EV-CRIT-{neg.isoformat()}"]
        wk = weekly[d.week_number - 1]
        f("first_negative_date", "First day with negative cash", "summary.first_negative_date", _iso(neg), "date", [NEG_T], basis="zero", evidence=ev)
        f("first_negative_closing", "End-of-day cash on the first negative day", f"daily_schedule[{neg}].closing_vnd", d.closing_vnd, "VND", [NEG_T], basis="zero", on=_iso(neg), evidence=ev)
        f("first_negative_week_no", "Week containing the first negative day", f"daily_schedule[{neg}].week_number", d.week_number, "count", [NEG_T, WEEK], grain="weekly", basis="end_of_week")
        f("first_negative_week_closing", "End-of-week cash of that week", f"weekly_schedule[{d.week_number}].closing_vnd", wk.closing_vnd, "VND", [WEEK], grain="weekly", basis="end_of_week")
    low = by_day.get(s.min_balance_date) if s.min_balance_date else None
    if low is not None:
        f("min_balance", "Lowest end-of-day balance", "summary.min_balance_vnd", s.min_balance_vnd, "VND", [LOW], evidence=[f"EV-CRIT-{low.date.isoformat()}"])
        f("min_date", "Day of the lowest end-of-day balance (first day on ties)", "summary.min_balance_date", _iso(s.min_balance_date), "date", [LOW])
        f("min_headroom", "Lowest end-of-day balance minus the buffer", "summary.min_balance_vnd - summary.buffer_vnd",
          (s.min_balance_vnd - s.buffer_vnd) if s.buffer_vnd is not None else None, "VND", [LOW], basis="buffer")
        lw = min(weekly, key=lambda w: (w.closing_vnd, w.week_number)) if weekly else None
        if lw is not None:
            f("min_week_closing", "Lowest end-of-week balance", f"weekly_schedule[{lw.week_number}].closing_vnd", lw.closing_vnd, "VND", [WEEK, LOW], grain="weekly", basis="end_of_week")
            f("min_week_no", "Week with the lowest end-of-week balance", f"weekly_schedule[{lw.week_number}].week_number", lw.week_number, "count", [WEEK, LOW], grain="weekly", basis="end_of_week")
    f("zero_gap_peak", "Largest gap to zero (alternative to the buffer gap; never added)", "summary.peak_zero_gap_vnd", s.peak_zero_gap_vnd, "VND", [ZERO_GAP], basis="zero")
    f("buffer_gap_peak", "Largest gap to the buffer (alternative to the zero gap; never added)", "summary.peak_buffer_gap_vnd", s.peak_buffer_gap_vnd, "VND", [BUF_GAP], basis="buffer")
    zero = [e for e in episodes if e.basis == "zero"]
    if zero:
        last = zero[-1]
        f("zero_episodes", "Number of separate periods with negative cash", "episodes[basis=zero]", len(zero), "count", [NEG_T], grain="period", basis="zero")
        f("last_zero_start", "Start of the last negative period", "episodes[-1].start_date", _iso(last.start_date), "date", [NEG_T], basis="zero")
        f("last_zero_end", "End of the last negative period", "episodes[-1].end_date", _iso(last.end_date), "date", [NEG_T], basis="zero")
        f("last_zero_duration", "Length of the last negative period in days", "episodes[-1].duration_days", last.duration_days, "count", [NEG_T], grain="period", basis="zero")
        f("last_zero_censored", "The last negative period has not recovered by the end of the forecast", "episodes[-1].censored", "yes" if last.censored else "no", "text", [NEG_T], grain="period", basis="zero")

    # drivers at the notable date that matters most (first negative > first highest alert > first below buffer > lowest balance)
    chosen = next((c for k in ("first_negative", "first_highest_alert", "first_below_buffer", "lowest_balance")
                   for c in drivers.critical_dates if k in c.kinds), None)
    if chosen is not None:
        i = drivers.critical_dates.index(chosen)
        ev = [f"EV-CRIT-{chosen.date.isoformat()}"]
        f("drv_date", "Notable date explained below", "drivers.critical_dates", _iso(chosen.date), "date", [DRIVER], on=_iso(chosen.date), evidence=ev)
        f("drv_out_total", "Total outflows scheduled on that date", "drivers.critical_dates[].out_on_date_vnd", chosen.out_on_date_vnd, "VND", [DRIVER], on=_iso(chosen.date), evidence=ev)
        f("drv_in_on_date", "Total receipts expected on that date", "drivers.critical_dates[].in_on_date_vnd", chosen.in_on_date_vnd, "VND", [DRIVER], on=_iso(chosen.date), evidence=ev)
        for tag, items in (("drv_out", drivers.dated_outflows[i].items), ("drv_in_on", drivers.receipts_on_date[i].items), ("drv_in_after", drivers.receipts_after[i].items)):
            for n, it in enumerate(items, 1):
                f(f"{tag}_{n}", f"{tag.replace('_', ' ')} item {n}", f"drivers.{tag}[{n}].amount_vnd", it.amount_vnd, "VND", [DRIVER], on=_iso(it.date),
                  entity=it.event_id, evidence=ev, attrs={"category": it.category, "counterparty_name": it.counterparty_name,
                                                          "date": _iso(it.date), "source_ref": it.source_ref, "date_method": it.date_method})
                if tag == "drv_in_after":
                    f(f"{tag}_{n}_date", f"Date of receipt {n} after the notable date", f"drivers.{tag}[{n}].date", _iso(it.date), "date", [DRIVER], on=_iso(it.date), entity=it.event_id, evidence=ev)
                if tag == "drv_in_on" and n == 1:
                    f("drv_in_on_1_entity", "Buyer of the largest receipt on the notable date", "drivers.receipts_on_date[1].counterparty_name",
                      it.counterparty_name, "entity", [DRIVER], on=_iso(it.date), entity=it.event_id, evidence=ev)
    if drivers.buyer_receipt_shares and drivers.buyer_receipt_shares[0].share is not None:
        b = drivers.buyer_receipt_shares[0]
        f("buyer_share_1_name", "Buyer with the largest share of expected receipts", "drivers.buyer_receipt_shares[0].buyer_name", b.buyer_name, "entity", [CONC],
          grain="period", basis="receipts", entity=b.buyer_id)
        f("buyer_share_1", "That buyer's share of all expected receipts in the forecast", "drivers.buyer_receipt_shares[0].share", Decimal(str(b.share)), "ratio", [CONC],
          grain="period", basis="receipts", entity=b.buyer_id)
    rolled = sum(1 for e in events if e.roll_applied)
    f("rolled_count", "Items already past due and placed on the first forecast day", "cash_events[roll_applied]", rolled, "count", [ASSUME], grain="period", basis="assumption")
    fb = sum(1 for b in drivers.buyer_delays if b.method == "fallback_on_time")
    f("fallback_buyers", "Buyers assumed to pay on the due date for lack of history", "drivers.buyer_delays[fallback]", fb, "count", [ASSUME], grain="period", basis="assumption")
    beyond = sum(dq_beyond.values(), Decimal(0))
    f("beyond_amount", "Amount dated after the forecast end (excluded)", "data_quality.beyond_horizon_amounts", beyond, "VND", [ASSUME], grain="period", basis="assumption")
    return reg


def build_insights(*, summary: Any, drivers: ForecastDrivers, assumptions: list[str], buyer_share: Optional[float]) -> list[Insight]:
    """3-5 findings in the SRS priority order: position at the cut-off, first shortfall, first negative day, highest-alert day, lowest day."""
    s, out = summary, []

    def add(theme: str, obs_type: str, obs: str, interp: str, metrics: list[str], ev: list[str]) -> None:
        out.append(Insight(insight_id=f"INS-{len(out) + 1:02d}", theme=theme, observation_type=obs_type, priority=len(out) + 1,
                           observation=obs, interpretation=interp, metric_refs=metrics, evidence_refs=ev,
                           assumption_ids=assumptions, limitation_ids=["A-EOD-BALANCES", "A-NO-NEW-SALES"]))

    if s.initial_below_buffer:
        add("initial_position", "state", f"Cash at the cut-off date ({format_vnd(s.cash0_vnd)}) is already below the buffer ({format_vnd(s.buffer_vnd)}).",
            "The forecast starts in breach; its first breach day is not the day the problem began.", ["cash0"], ["EV-CASH0", "EV-BUFFER"])
    if s.first_buffer_date:
        add("first_shortfall", "date", f"Cash first falls below the buffer on {format_dmy(s.first_buffer_date)} (week {s.first_gap_week}).",
            "This is a shortfall against the buffer, not negative cash.", ["first_below_buffer_date"], ["EV-LEDGER"])
    if s.first_negative_date:
        add("first_negative_day", "date", f"Cash first turns negative on {format_dmy(s.first_negative_date)}.",
            "A weekly closing balance can hide this day; the daily ledger shows it.", ["first_negative_date"], [f"EV-CRIT-{s.first_negative_date}"])
    if s.first_highest_date and s.first_highest_date != s.as_of and s.observed_level not in (None, "green"):
        add("highest_alert", "level", f"The alert first reaches {s.observed_level} on {format_dmy(s.first_highest_date)}.",
            "The level compares the shortfall with the buffer using project thresholds, not an industry standard.", ["gap_ratio_end"], [f"EV-CRIT-{s.first_highest_date}"])
    if s.min_balance_date:
        add("lowest_point", "amount", f"The lowest end-of-day balance is {format_vnd(s.min_balance_vnd)} on {format_dmy(s.min_balance_date)}; the gap to zero is "
            f"{format_vnd(s.peak_zero_gap_vnd)} and the gap to the buffer is {format_vnd(s.peak_buffer_gap_vnd)}.",
            "The two gaps measure the same point differently and are never added.", ["min_daily_balance", "peak_zero_gap", "peak_buffer_gap"], ["EV-LEDGER"])
    if buyer_share is not None and len(out) < 5:
        add("receipt_dependence", "share", f"One buyer accounts for {buyer_share * 100:.1f}% of all expected receipts.",
            "The forecast depends on that buyer's estimated payment dates; estimates are not commitments.", ["top_buyer_receipt_share"], ["EV-IN"])
    return out[:5]
