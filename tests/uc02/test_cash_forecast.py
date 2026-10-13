"""UC-02 tests (SRS_UC02_TV2_v2: Appendix C golden fixture and scenarios Q01-Q21, Q28-Q29).

Run from the project root (no API key needed):   python -m pytest tests/uc02 -v
Handmade snapshots pass `buyer_delays={}` so the unit tests do not depend on UC-01 or on the workbook.
"""
import json
import os
import re
import sys
from datetime import date, timedelta
from decimal import Decimal

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from src.agent import agent, permissions  # noqa: E402
from src.agent.tools import forecast_cash  # noqa: E402
from src.core.data_loader import get_snapshot  # noqa: E402
from src.uc02_cash_forecast import cash_forecast as cf_module  # noqa: E402
from src.uc02_cash_forecast.cash_forecast import (  # noqa: E402
    CashForecastError, calculate_cash_forecast, classify_cash, load_cash_plans,
)

AS_OF = "2026-09-30"
M = 1_000_000  # one million VND
VI = re.compile("[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]", re.IGNORECASE)


# ----------------------------------------------------------------------------------------------
# Helpers for handmade scenarios
# ----------------------------------------------------------------------------------------------
def snap(cash=1_000 * M, buffer=500 * M, sales=(), purchases=(), firm="F01", synthetic=True):
    return {"meta": {"firm_id": firm, "as_of": AS_OF, "snapshot_id": "snap-test", "data_is_synthetic": synthetic},
            "firm": {"min_cash_buffer_vnd": buffer}, "financials": {"opening_cash_vnd": cash},
            "sales": list(sales), "purchases": list(purchases)}


def sale(inv, due, amount, paid=0, credit=0, buyer="B1", **extra):
    return {"invoice_id": inv, "buyer_id": buyer, "buyer_name": f"Buyer {buyer}", "due_date": due, "invoice_amount": amount,
            "paid_amount": paid, "credit_amount": credit, **extra}


def purchase(inv, due, amount, paid=0, credit=0, supplier="S1", **extra):
    return {"purchase_id": inv, "supplier_id": supplier, "supplier_name": f"Supplier {supplier}", "due_date": due,
            "amount_vnd": amount, "paid_amount_vnd": paid, "credit_amount_vnd": credit, **extra}


def plan(eid, day, direction, amount, category="other", source_id=None, known_at=AS_OF):
    return {"event_id": eid, "firm_id": "F01", "date": day, "direction": direction, "category": category,
            "amount_vnd": amount, "source_id": source_id or f"SRC-{eid}", "known_at": known_at}


def run(snapshot, plans=(), weeks=13, **kw):
    kw.setdefault("buyer_delays", {})
    return calculate_cash_forecast(snapshot, "F01", AS_OF, weeks, plans=list(plans), **kw)


def day(r, iso):
    return next(d for d in r.daily_schedule if str(d.date) == iso)


# ----------------------------------------------------------------------------------------------
# Golden fixture (Appendix C, Q29): F01 / F02 / F03 from the real snapshot + UC-01 delays + data/cash_plans.csv
# ----------------------------------------------------------------------------------------------
@pytest.fixture(scope="module")
def f01():
    return calculate_cash_forecast(get_snapshot("F01"), "F01")


@pytest.fixture(scope="module")
def f01_late():
    return calculate_cash_forecast(get_snapshot("F01"), "F01", case_id="estimated_receipts_late")


@pytest.fixture(scope="module", params=["F02", "F03"])
def no_breach(request):
    return request.param, calculate_cash_forecast(get_snapshot(request.param), request.param)


def test_f01_weekly_table_matches_the_golden_workbook(f01):
    closing = [362_538_000, 679_234_000, 687_251_000, 133_358_000, 750_686_000, 852_103_000, 1_055_628_000,
               599_533_000, 810_678_000, 630_678_000, 380_678_000, -619_322_000, -619_322_000]
    inflow = [0, 694_427_000, 617_709_000, 763_783_000, 801_451_000, 425_635_000, 554_200_000, 543_905_000,
              511_145_000, 0, 0, 0, 0]
    outflow = [837_462_000, 377_731_000, 609_692_000, 1_317_676_000, 184_123_000, 324_218_000, 350_675_000,
               1_000_000_000, 300_000_000, 180_000_000, 250_000_000, 1_000_000_000, 0]
    assert [int(w.closing_vnd) for w in f01.weekly_schedule] == closing
    assert [int(w.in_vnd) for w in f01.weekly_schedule] == inflow
    assert [int(w.out_vnd) for w in f01.weekly_schedule] == outflow
    assert int(f01.weekly_schedule[0].opening_vnd) == 1_200_000_000


def test_f01_summary_matches_appendix_c(f01):
    s = f01.summary
    assert (str(s.first_buffer_date), str(s.first_negative_date), str(s.first_highest_date)) == ("2026-10-04", "2026-10-23", "2026-10-18")
    assert (int(s.min_balance_vnd), str(s.min_balance_date)) == (-619_322_000, "2026-12-18")
    assert int(s.peak_buffer_gap_vnd) == 1_119_322_000 and int(s.peak_zero_gap_vnd) == 619_322_000
    assert (int(s.total_in_vnd), int(s.total_out_vnd)) == (4_912_255_000, 6_731_577_000)
    assert (int(s.cash0_vnd), int(s.buffer_vnd), s.overall_level, s.breach_status, s.status) == (1_200_000_000, 500_000_000, "red", "breach", "provisional")
    assert (s.first_gap_week, int(s.max_gap_vnd), s.max_gap_basis) == (1, 1_119_322_000, "buffer")  # handoff to UC-03


def test_f01_weekly_closing_can_hide_a_negative_day(f01):
    w4 = f01.weekly_schedule[3]
    assert int(w4.closing_vnd) == 133_358_000 and int(w4.min_daily_vnd) == -378_917_000 and str(w4.min_daily_date) == "2026-10-23"
    assert (w4.negative_days, w4.worst_daily_alert_color) == (1, "red")
    w3 = f01.weekly_schedule[2]  # ends green but a red day happened inside the week: two separate labels
    assert (w3.alert_color, w3.worst_daily_alert_color) == ("green", "red") and str(w3.min_daily_date) == "2026-10-18"


def test_f01_alert_on_18_october_is_red_while_cash_is_still_positive(f01):
    d = day(f01, "2026-10-18")
    assert int(d.closing_vnd) == 132_224_000 and int(d.gap_buffer_vnd) == 367_776_000 and d.alert_color == "red"
    assert d.gap_ratio == pytest.approx(0.735552) and int(d.gap_zero_vnd) == 0


def test_f01_episodes_are_separate_and_the_last_ones_are_censored(f01):
    zero = [e for e in f01.episodes if e.basis == "zero"]
    assert [(str(e.start_date), str(e.end_date), e.censored) for e in zero] == [("2026-10-23", "2026-10-23", False), ("2026-12-18", "2026-12-30", True)]
    assert int(zero[0].peak_gap_vnd) == 378_917_000 and str(zero[0].recovery_date) == "2026-10-24" and zero[1].recovery_date is None
    buf = [e for e in f01.episodes if e.basis == "buffer"]
    assert str(buf[-1].start_date) == "2026-12-13" and buf[-1].censored and int(buf[-1].peak_gap_vnd) == 1_119_322_000
    assert all(not e.started_before_horizon for e in f01.episodes)


def test_f01_drivers_explain_the_first_negative_day(f01):
    crit = {str(c.date): c for c in f01.drivers.critical_dates}
    assert crit["2026-10-23"].kinds == ["first_negative"] and crit["2026-10-04"].kinds == ["first_below_buffer"]
    assert crit["2026-12-18"].kinds == ["lowest_balance"] and crit["2026-10-18"].kinds == ["first_highest_alert"]
    i = [str(c.date) for c in f01.drivers.critical_dates].index("2026-10-23")
    outs = f01.drivers.dated_outflows[i].items
    assert [(o.category, int(o.amount_vnd)) for o in outs[:2]] == [("payroll", 1_000_000_000), ("supplier_payment", 225_062_000)]
    assert [int(r.amount_vnd) for r in f01.drivers.receipts_on_date[i].items] == [158_894_000]
    assert [int(r.amount_vnd) for r in f01.drivers.receipts_after[i].items] == [554_200_000, 543_905_000, 529_231_000]
    assert all(x.source_ref for x in outs)
    assert int(f01.reconciliation.decomposition_delta_vnd) == 0


def test_f01_receipt_shares_use_forecast_receipts_not_tv1_receivable_share(f01):
    shares = f01.drivers.buyer_receipt_shares
    assert shares[0].buyer_name == "Nhà xuất khẩu Lớn K1" and shares[0].share == pytest.approx(0.7916, abs=1e-4)
    assert sum(s.share for s in shares) == pytest.approx(1.0)


def test_f01_receipt_dates_use_the_uc01_late_positive_delay_rounded_up(f01):
    k1 = next(d for d in f01.drivers.buyer_delays if "K1" in d.buyer_name)
    assert k1.method == "history_late_positive" and k1.delay_raw_days == pytest.approx(20.520664189) and k1.delay_ceil_days == 21
    ev = next(e for e in f01.cash_events if e.event_id == "S-F01-0055")
    assert ev.cash_date == ev.original_date and ev.delay_days_applied == 21 and ev.date_method == "history_late_positive"
    assert "UC01" in f01.meta.source_run_ids and f01.meta.source_run_ids["UC01"].startswith("run-")


def test_f01_overdue_payables_are_rolled_to_the_first_forecast_day_with_a_label(f01):
    rolled = [e for e in f01.cash_events if e.roll_applied]
    assert {e.event_id for e in rolled} == {"P-F01-0074", "P-F01-0078", "P-F01-0085"}
    assert all(e.cash_date == date(2026, 10, 1) and "A-OVERDUE-ROLL" in e.assumption_ids for e in rolled)
    assert any(a.id == "A-OVERDUE-ROLL" for a in f01.inputs.assumptions)


def test_f01_reconciliation_passes_against_independent_control_totals(f01):
    r = f01.reconciliation
    assert r.status == "ok" and r.closing_mismatches == 0 and int(r.cash_delta_vnd) == 0 and int(r.weekly_daily_delta_vnd) == 0
    assert all(abs(v) <= 1 for v in r.source_delta_vnd.values()) and set(r.source_delta_vnd) >= {"IN_sales_invoices", "OUT_plans"}
    assert (int(f01.summary.closing_end_vnd) - int(f01.summary.cash0_vnd)) == int(f01.summary.total_in_vnd) - int(f01.summary.total_out_vnd)


def test_f01_late_receipts_case_matches_appendix_c(f01_late, f01):
    s = f01_late.summary
    assert (int(s.min_balance_vnd), str(s.min_balance_date), str(s.first_negative_date)) == (-1_092_838_000, "2026-10-23", "2026-10-14")
    assert s.case_id == "estimated_receipts_late" and f01_late.reconciliation.status == "ok"
    assert int(s.total_out_vnd) == int(f01.summary.total_out_vnd)  # payments are never shifted
    assert all(e.case_shift_days == 7 for e in f01_late.cash_events if e.direction == "IN")
    assert any(a.id == "A-CASE-LATE" for a in f01_late.inputs.assumptions)


def test_f02_f03_stay_above_the_buffer(no_breach):
    firm, r = no_breach
    s = r.summary
    expected = {"F02": (1_152_774_000, "2026-10-06"), "F03": (602_634_000, "2026-10-06")}[firm]
    assert (int(s.min_balance_vnd), str(s.min_balance_date)) == expected
    assert s.breach_status == "no_breach" and s.overall_level == "green" and s.first_buffer_date is None and s.first_negative_date is None
    assert (int(s.peak_buffer_gap_vnd), int(s.peak_zero_gap_vnd), s.first_gap_week, s.first_highest_date) == (0, 0, None, None)
    assert r.episodes == [] and r.reconciliation.status == "ok"


# ----------------------------------------------------------------------------------------------
# Structure of the result (Q01, Q21, schema contract)
# ----------------------------------------------------------------------------------------------
def test_q01_horizon_is_91_days_from_the_day_after_the_cutoff(f01):
    assert (str(f01.meta.start_date), str(f01.meta.end_date)) == ("2026-10-01", "2026-12-30")
    assert len(f01.weekly_schedule) == 13 and len(f01.daily_schedule) == 91  # a row for every day, quiet days included
    assert (str(f01.weekly_schedule[0].start_date), str(f01.weekly_schedule[0].end_date)) == ("2026-10-01", "2026-10-07")
    assert str(f01.daily_schedule[-1].date) == "2026-12-30" and all(str(d.date) != "2026-12-31" for d in f01.daily_schedule)


def test_each_day_opens_with_the_previous_close_and_balances_are_never_clamped(f01):
    for prev, cur in zip(f01.daily_schedule, f01.daily_schedule[1:]):
        assert cur.opening_vnd == prev.closing_vnd
    assert all(d.closing_vnd == d.opening_vnd + d.in_vnd - d.out_vnd for d in f01.daily_schedule)
    assert min(d.closing_vnd for d in f01.daily_schedule) < 0  # negative cash is kept as negative


def test_q21_changing_the_horizon_recomputes_everything():
    r = calculate_cash_forecast(get_snapshot("F01"), "F01", weeks=4)
    assert len(r.weekly_schedule) == 4 and len(r.daily_schedule) == 28 and str(r.meta.end_date) == "2026-10-28"
    assert int(r.summary.min_balance_vnd) == -378_917_000 and r.reconciliation.status == "ok"
    assert r.summary.horizon_weeks == 4 and r.summary.first_negative_date == date(2026, 10, 23)
    assert any(e.scope == "beyond_horizon" for e in r.cash_events)  # later items are kept outside the horizon, not pulled in


def test_result_is_json_safe_with_integer_money_and_versions(f01):
    dumped = f01.model_dump(mode="json")
    json.dumps(dumped)
    assert (dumped["schema_version"], dumped["formula_version"], dumped["config_version"]) == ("tv2.result.v1", "tv2.formulas.v1", "tv2.demo.v1")
    assert isinstance(dumped["summary"]["cash0_vnd"], int) and isinstance(dumped["weekly_schedule"][0]["closing_vnd"], int)
    assert isinstance(f01.summary.cash0_vnd, Decimal) and isinstance(f01.daily_schedule[0].closing_vnd, Decimal)
    assert not isinstance(dumped["summary"]["max_gap_vnd"], float)


def test_every_formula_id_t2_01_to_t2_18_is_represented(f01):
    assert {m.formula_id for m in f01.metrics} == {f"T2-{i:02d}" for i in range(1, 19)}
    by_id = {m.id: m for m in f01.metrics}
    assert by_id["cash0"].raw_value == 1_200_000_000 and by_id["first_negative_date"].raw_value == "2026-10-23"
    assert by_id["peak_buffer_gap"].raw_value == 1_119_322_000 and by_id["peak_zero_gap"].raw_value == 619_322_000
    assert by_id["receipt_shift_days"].raw_value is None and by_id["receipt_shift_days"].reason_code == "case_not_active"


def test_same_input_gives_the_same_numbers():
    a = calculate_cash_forecast(get_snapshot("F01"), "F01").model_dump(mode="json")
    b = calculate_cash_forecast(get_snapshot("F01"), "F01").model_dump(mode="json")
    for x in (a, b):
        x["meta"].pop("run_id"), x["meta"].pop("generated_at"), x["meta"]["source_run_ids"].clear()
        x.pop("audit_ref")
        for e in x["evidence"]:
            e.pop("run_id")
    assert a == b


# ----------------------------------------------------------------------------------------------
# Alert classification (Q12-Q15)
# ----------------------------------------------------------------------------------------------
@pytest.mark.parametrize("cash,buffer,color,ratio", [
    (500 * M, 500 * M, "green", 0.0), (600 * M, 500 * M, "green", 0.0),
    (400 * M, 500 * M, "yellow", 0.2),   # exactly 20% is yellow
    (399 * M, 500 * M, "orange", 0.202),  # just above 20% is orange
    (250 * M, 500 * M, "orange", 0.5),   # exactly 50% is orange
    (249 * M, 500 * M, "red", 0.502),    # just above 50% is red
    (350 * M, 500 * M, "orange", 0.3),   # Q12
    (-10 * M, 500 * M, "red", 1.02),     # negative is always red; the ratio may exceed 100%
])
def test_q12_q14_alert_thresholds_use_the_raw_ratio(cash, buffer, color, ratio):
    c, r, gap_b, gap_z = classify_cash(Decimal(cash), Decimal(buffer))
    assert c == color and float(r) == pytest.approx(ratio)
    assert gap_b == max(0, buffer - cash) and gap_z == max(0, -cash)


def test_q12_the_two_gaps_are_separate_measures():
    _, _, gap_buffer, gap_zero = classify_cash(Decimal(350 * M), Decimal(500 * M))
    assert (gap_buffer, gap_zero) == (150 * M, 0)
    _, _, gap_buffer, gap_zero = classify_cash(Decimal(-50 * M), Decimal(500 * M))
    assert (gap_buffer, gap_zero) == (550 * M, 50 * M)  # never added together


@pytest.mark.parametrize("cash,color", [(0, "green"), (1, "green"), (-1, "red")])
def test_q15_zero_buffer_has_no_ratio(cash, color):
    c, ratio, _, _ = classify_cash(Decimal(cash), Decimal(0))
    assert c == color and ratio is None


def test_custom_thresholds_are_honoured():
    assert classify_cash(Decimal(300 * M), Decimal(500 * M), Decimal("0.5"), Decimal("0.9"))[0] == "yellow"


# ----------------------------------------------------------------------------------------------
# Open invoices, dates and delays (Q02-Q10)
# ----------------------------------------------------------------------------------------------
def test_q02_only_the_open_residual_is_scheduled_and_credits_are_deducted():
    r = run(snap(sales=[sale("S1", date(2026, 10, 20), 100 * M, paid=40 * M, credit=10 * M)]))
    ev = next(e for e in r.cash_events if e.event_id == "S1")
    assert ev.amount_vnd == 50 * M and ev.formula_id == "T2-05"


def test_closed_invoices_create_no_event():
    r = run(snap(sales=[sale("S1", date(2026, 10, 20), 100 * M, paid=100 * M)]))
    assert r.cash_events == []


def test_overpaid_invoice_is_kept_apart_and_never_netted():
    r = run(snap(sales=[sale("S1", date(2026, 10, 20), 100 * M, paid=120 * M), sale("S2", date(2026, 10, 20), 50 * M)]))
    assert [e.event_id for e in r.cash_events] == ["S2"]
    assert any(i.code == "ADVANCE_OR_OVERPAYMENT" and i.source_ids == ["S1"] for i in r.data_quality.issues)


@pytest.mark.parametrize("delay,expected_days", [(20.520664189056813, 21), (5.0, 5), (5.000000000000001, 5), (0.0, 0), (0.2, 1)])
def test_t2_05_delay_is_rounded_up_after_removing_float_noise(delay, expected_days):
    table = {"B1": {"late_positive_wavg_days": delay, "coverage_status": "ok", "history_invoice_count": 12}}
    r = run(snap(sales=[sale("S1", date(2026, 10, 20), 10 * M)]), buyer_delays=table)
    ev = r.cash_events[0]
    assert ev.cash_date == date(2026, 10, 20) + timedelta(days=expected_days) and ev.delay_days_applied == expected_days
    assert ev.date_method == "history_late_positive"


def test_q05_buyers_with_too_little_history_use_a_labelled_fallback():
    table = {"B1": {"late_positive_wavg_days": 12.0, "coverage_status": "insufficient_history", "history_invoice_count": 4}}
    r = run(snap(sales=[sale("S1", date(2026, 10, 20), 10 * M)]), buyer_delays=table)
    ev = r.cash_events[0]
    assert ev.cash_date == date(2026, 10, 20) and ev.date_method == "fallback_on_time" and "A-FALLBACK-ON-TIME" in ev.assumption_ids
    assert r.drivers.buyer_delays[0].delay_raw_days is None and r.drivers.buyer_delays[0].history_invoice_count == 4
    assert any(i.code == "FALLBACK_DELAY" for i in r.data_quality.issues)
    unknown = run(snap(sales=[sale("S2", date(2026, 10, 20), 10 * M, buyer="NEW")]))  # a buyer UC-01 has never seen
    assert unknown.cash_events[0].date_method == "fallback_on_time"


def test_q06_confirmed_and_approved_schedules_win_and_the_case_does_not_move_them():
    sales = [sale("S1", date(2026, 10, 1), 10 * M, confirmed_date=date(2026, 11, 5))]
    purchases = [purchase("P1", date(2026, 10, 10), 20 * M, approved_date=date(2026, 11, 15))]
    table = {"B1": {"late_positive_wavg_days": 9.0, "coverage_status": "ok", "history_invoice_count": 8}}
    for case in ("base", "estimated_receipts_late"):
        r = run(snap(sales=sales, purchases=purchases), buyer_delays=table, case_id=case)
        s, p = r.cash_events
        assert (s.cash_date, s.date_method, s.case_shift_days) == (date(2026, 11, 5), "confirmed_schedule", 0)
        assert (p.cash_date, p.date_method) == (date(2026, 11, 15), "approved_schedule")


def test_t2_18_only_estimated_receipts_move_and_payments_never_do():
    sales = [sale("S1", date(2026, 10, 20), 10 * M)]
    purchases = [purchase("P1", date(2026, 10, 20), 20 * M)]
    base, late = run(snap(sales=sales, purchases=purchases)), run(snap(sales=sales, purchases=purchases), case_id="estimated_receipts_late", extra_days=10)
    assert late.cash_events[0].cash_date == base.cash_events[0].cash_date + timedelta(days=10)
    assert late.cash_events[1].cash_date == base.cash_events[1].cash_date and late.inputs.extra_days == 10


def test_q10_past_dates_roll_to_the_first_day_with_a_label_and_far_dates_stay_outside():
    r = run(snap(sales=[sale("S1", date(2026, 9, 1), 10 * M)], purchases=[purchase("P1", date(2026, 9, 5), 20 * M),
                                                                          purchase("P2", date(2027, 3, 1), 30 * M)]))
    s1, p1, p2 = r.cash_events
    assert s1.cash_date == p1.cash_date == date(2026, 10, 1) and s1.roll_applied and p1.roll_applied
    assert s1.original_date == date(2026, 9, 1) and "A-OVERDUE-ROLL" in p1.assumption_ids
    assert p2.scope == "beyond_horizon" and p2.cash_date == date(2027, 3, 1)  # not pulled into week 13
    assert int(r.data_quality.beyond_horizon_amounts["OUT"]) == 30 * M
    assert int(r.summary.total_out_vnd) == 20 * M and r.reconciliation.status == "ok"
    assert int(r.reconciliation.source_delta_vnd["scope_split_OUT"]) == 0  # in + beyond + unscheduled = source


def test_item_on_the_last_day_is_in_the_horizon_and_the_day_after_is_not():
    r = run(snap(purchases=[purchase("P1", date(2026, 12, 30), 10 * M), purchase("P2", date(2026, 12, 31), 20 * M)]))
    assert [e.scope for e in r.cash_events] == ["in_horizon", "beyond_horizon"]


# ----------------------------------------------------------------------------------------------
# Data quality and statuses (Q07-Q09, Q16, Q19, E1-E3)
# ----------------------------------------------------------------------------------------------
def test_q07_a_missing_due_date_is_unscheduled_not_dropped_and_blocks_the_full_forecast():
    r = run(snap(sales=[sale("S1", None, 70 * M), sale("S2", date(2026, 10, 20), 30 * M)]))
    assert r.summary.status == "missing_data" and r.summary.overall_level == "unknown" and r.weekly_schedule == [] and r.daily_schedule is None
    assert int(r.data_quality.unscheduled_amounts["IN"]) == 70 * M and r.data_quality.coverage_status == "incomplete"
    assert any(i.code == "UNSCHEDULED_AMOUNT" and i.source_ids == ["S1"] for i in r.data_quality.issues)
    assert "not produced" in r.explanation


def test_q19_partial_mode_keeps_the_overall_level_unknown_but_shows_the_observed_level():
    r = run(snap(cash=100 * M, sales=[sale("S1", None, 70 * M)]), allow_partial=True)
    assert r.summary.status == "missing_data" and r.summary.overall_level == "unknown" and r.summary.breach_status == "unknown"
    assert r.summary.observed_level == "red" and len(r.weekly_schedule) == 13  # computed, but never called safe
    assert int(r.data_quality.unscheduled_amounts["IN"]) == 70 * M


def test_q08_a_missing_plans_source_is_not_the_same_as_no_plans(monkeypatch, tmp_path):
    monkeypatch.setattr(cf_module, "PLANS_PATH", tmp_path / "does_not_exist.csv")
    r = calculate_cash_forecast(snap(), "F01", AS_OF, 13, buyer_delays={})  # plans=None -> read the file -> missing
    assert r.summary.status == "missing_data" and any(i.code == "PLANS_SOURCE_MISSING" for i in r.data_quality.issues)
    assert r.data_quality.plans_status == "missing"
    empty = run(snap(), plans=[])  # a confirmed empty list is allowed, but the gap is disclosed
    assert empty.summary.status == "provisional" and empty.data_quality.omitted_activity


def test_q09_a_plan_that_duplicates_an_invoice_is_invalid_data_with_source_ids():
    r = run(snap(sales=[sale("S1", date(2026, 10, 20), 10 * M)]), plans=[plan("PL-1", "2026-10-25", "IN", 10 * M, source_id="S1")])
    assert r.summary.status == "invalid_data" and r.weekly_schedule == []
    assert any(i.code == "PLAN_DUPLICATES_INVOICE" and "S1" in i.source_ids for i in r.data_quality.issues)
    same_id = run(snap(sales=[sale("S1", date(2026, 10, 20), 10 * M)]), plans=[plan("S1", "2026-10-25", "OUT", 5 * M)])
    assert same_id.summary.status == "invalid_data"


@pytest.mark.parametrize("bad", [plan("PL-1", "not-a-date", "OUT", 1 * M), plan("PL-1", "2026-10-25", "OUT", 0),
                                 plan("PL-1", "2026-10-25", "SIDEWAYS", 1 * M), plan("PL-1", "2026-09-15", "OUT", 1 * M)])
def test_invalid_plan_rows_block_the_forecast(bad):
    assert run(snap(), plans=[bad]).summary.status == "invalid_data"


def test_plans_known_only_after_the_cutoff_are_ignored():
    r = run(snap(), plans=[plan("PL-1", "2026-10-25", "OUT", 900 * M, known_at="2026-10-05")])
    assert r.cash_events == [] and int(r.summary.min_balance_vnd) == 1_000 * M


def test_q16_missing_negative_or_invalid_inputs_never_produce_a_normal_colour():
    assert run(snap(buffer=None)).summary.status == "missing_data"
    assert run(snap(cash=None)).summary.status == "missing_data"
    assert run(snap(buffer=-1)).summary.status == "invalid_data"
    assert run(snap(), restricted_vnd=-5).summary.status == "invalid_data"
    blocked = run(snap(buffer=None))
    assert blocked.summary.overall_level == "unknown" and blocked.weekly_schedule == [] and blocked.summary.first_buffer_date is None
    assert run(snap(buffer=0)).summary.status == "provisional"  # a buffer of 0 is valid and different from a missing buffer


@pytest.mark.parametrize("yellow,orange", [(0.5, 0.2), (0.2, 0.2), (0, 0.5), (0.2, 1.5), (-0.1, 0.5)])
def test_q16_invalid_thresholds_are_rejected_before_running(yellow, orange):
    with pytest.raises(CashForecastError) as exc:
        run(snap(), yellow_upper=yellow, orange_upper=orange)
    assert exc.value.code == "INVALID_REQUEST"


def test_restricted_cash_is_deducted_from_cash0():
    r = run(snap(cash=1_000 * M), restricted_vnd=300 * M)
    assert int(r.summary.cash0_vnd) == 700 * M and int(r.inputs.cash_at_cutoff_vnd) == 1_000 * M and int(r.inputs.restricted_vnd) == 300 * M


def test_negative_opening_cash_is_kept():
    r = run(snap(cash=-20 * M))
    assert int(r.summary.cash0_vnd) == -20 * M and r.summary.initial_alert_color == "red" and r.summary.first_negative_date == date(2026, 10, 1)


# ----------------------------------------------------------------------------------------------
# Gaps, episodes, ties (Q11, Q17, Q18, Q20)
# ----------------------------------------------------------------------------------------------
def test_q11_a_day_can_be_negative_even_when_the_week_ends_positive():
    plans = [plan("O1", "2026-10-01", "OUT", 150 * M), plan("I1", "2026-10-07", "IN", 100 * M)]
    r = run(snap(cash=100 * M, buffer=50 * M), plans=plans)
    w1 = r.weekly_schedule[0]
    assert (int(w1.min_daily_vnd), str(w1.min_daily_date), int(w1.closing_vnd)) == (-50 * M, "2026-10-01", 50 * M)
    assert (w1.alert_color, w1.worst_daily_alert_color, w1.negative_days) == ("green", "red", 6)
    assert int(w1.max_daily_gap_zero_vnd) == 50 * M and int(w1.gap_zero_vnd) == 0


def test_q17_consecutive_weeks_short_by_the_same_amount_report_the_maximum_not_the_sum():
    r = run(snap(cash=400 * M, buffer=500 * M))  # 100M below the buffer on every one of the 91 days
    assert int(r.summary.peak_buffer_gap_vnd) == 100 * M and int(r.summary.max_gap_vnd) == 100 * M
    assert len(r.episodes) == 1 and r.episodes[0].duration_days == 91 and r.episodes[0].censored
    assert r.episodes[0].started_before_horizon and r.summary.initial_below_buffer is True


def test_q18_ties_choose_the_first_date_and_separate_episodes_stay_separate():
    plans = [plan("O1", "2026-10-03", "OUT", 700 * M), plan("I1", "2026-10-05", "IN", 700 * M),
             plan("O2", "2026-10-10", "OUT", 700 * M), plan("I2", "2026-10-12", "IN", 700 * M)]
    r = run(snap(cash=1_000 * M, buffer=500 * M), plans=plans)
    assert str(r.summary.min_balance_date) == "2026-10-03" and int(r.summary.min_balance_vnd) == 300 * M  # equal on 3-4 Oct and 10-11 Oct
    eps = [e for e in r.episodes if e.basis == "buffer"]
    assert [(str(e.start_date), str(e.end_date), e.duration_days, str(e.recovery_date), e.censored) for e in eps] == [
        ("2026-10-03", "2026-10-04", 2, "2026-10-05", False), ("2026-10-10", "2026-10-11", 2, "2026-10-12", False)]
    assert [e for e in r.episodes if e.basis == "zero"] == []


def test_q20_already_below_the_buffer_at_the_cutoff_is_reported_as_initial():
    r = run(snap(cash=300 * M, buffer=500 * M))
    s = r.summary
    assert s.initial_below_buffer is True and s.initial_alert_color == "orange"
    assert s.first_highest_date == date(2026, 9, 30)  # the highest level is the initial state itself
    assert s.first_buffer_date == date(2026, 10, 1)  # the first FORECAST day below the buffer is not "when the problem began"


def test_no_breach_returns_null_dates_and_never_zero_or_a_fake_date():
    r = run(snap(cash=2_000 * M, buffer=500 * M))
    s = r.summary
    assert (s.first_buffer_date, s.first_negative_date, s.first_gap_week, s.first_highest_date) == (None, None, None, None)
    assert (s.breach_status, s.overall_level, int(s.max_gap_vnd)) == ("no_breach", "green", 0) and r.episodes == []
    by = {m.id: m for m in r.metrics}
    assert by["first_negative_date"].raw_value is None and by["first_negative_date"].reason_code == "no_breach"


def test_zero_buffer_has_no_ratio_but_negative_cash_is_still_red():
    r = run(snap(cash=10 * M, buffer=0), plans=[plan("O1", "2026-10-02", "OUT", 20 * M)])
    assert day(r, "2026-10-01").alert_color == "green" and day(r, "2026-10-02").alert_color == "red"
    assert all(d.gap_ratio is None for d in r.daily_schedule)
    assert {m.id: m for m in r.metrics}["gap_ratio_end"].status == "not_applicable"


def test_buyer_receipt_share_is_not_applicable_without_receipts():
    r = run(snap())
    assert r.drivers.buyer_receipt_shares == []


# ----------------------------------------------------------------------------------------------
# Request validation and security
# ----------------------------------------------------------------------------------------------
@pytest.mark.parametrize("weeks", [0, 14, -1, True, "13", 4.5, None])
def test_invalid_horizon_is_rejected(weeks):
    with pytest.raises(CashForecastError) as exc:
        calculate_cash_forecast(snap(), "F01", AS_OF, weeks, buyer_delays={}, plans=[])
    assert exc.value.code == "INVALID_REQUEST"


@pytest.mark.parametrize("weeks", [1, 7, 13])
def test_valid_horizons_give_7h_daily_rows(weeks):
    r = run(snap(), weeks=weeks)
    assert len(r.daily_schedule) == 7 * weeks and len(r.weekly_schedule) == weeks


def test_cutoff_date_must_match_the_snapshot():
    with pytest.raises(CashForecastError) as exc:
        calculate_cash_forecast(snap(), "F01", "2026-09-29", 13, buyer_delays={}, plans=[])
    assert exc.value.code == "INVALID_DATE_ALIGNMENT"
    with pytest.raises(CashForecastError) as exc:
        calculate_cash_forecast(snap(), "F01", "30/09/2026", 13, buyer_delays={}, plans=[])
    assert exc.value.code == "INVALID_REQUEST"


def test_a_snapshot_of_another_firm_is_refused():
    with pytest.raises(CashForecastError) as exc:
        calculate_cash_forecast(snap(firm="F02"), "F01", AS_OF, 13, buyer_delays={}, plans=[])
    assert exc.value.code == "UNAUTHORIZED_FIRM"


@pytest.mark.parametrize("kw", [{"case_id": "optimistic"}, {"extra_days": -1}, {"extra_days": 91}, {"extra_days": True}])
def test_invalid_case_parameters_are_rejected(kw):
    with pytest.raises(CashForecastError) as exc:
        run(snap(), **kw)
    assert exc.value.code == "INVALID_REQUEST"


def test_the_input_snapshot_is_not_modified():
    s = get_snapshot("F01")
    before = json.dumps(s, default=str, sort_keys=True)
    calculate_cash_forecast(s, "F01", case_id="estimated_receipts_late")
    assert json.dumps(s, default=str, sort_keys=True) == before


def test_a_failed_reconciliation_blocks_the_release(monkeypatch):
    real = cf_module._weekly

    def corrupt(days, buffer, yellow, orange):  # simulate a bug: week 1 reports a closing balance that is 5 VND off
        weeks = real(days, buffer, yellow, orange)
        weeks[0] = weeks[0].model_copy(update={"closing_vnd": weeks[0].closing_vnd + 5})
        return weeks

    monkeypatch.setattr(cf_module, "_weekly", corrupt)
    r = run(snap(), plans=[])
    assert r.reconciliation.status == "failed" and r.reconciliation.closing_mismatches == 1
    assert r.summary.status == "invalid_data" and any(i.code == "RECONCILIATION_FAILED" for i in r.data_quality.issues)
    assert any("do not rely" in w for w in r.warnings)
    text = agent.render_forecast(r.model_dump(mode="json"))
    assert "could not produce a valid cash forecast (invalid data)" in text and "No forecast figures are shown" in text


def test_money_math_is_exact_decimal_not_float():
    r = run(snap(cash=Decimal("100.10")), plans=[plan("O1", "2026-10-02", "OUT", "0.30")])
    assert r.summary.closing_end_vnd == Decimal("99.80") and r.reconciliation.status == "ok"
    assert r.model_dump(mode="json")["summary"]["closing_end_vnd"] == "99.80"  # decimal string, never a float


# ----------------------------------------------------------------------------------------------
# Plans file
# ----------------------------------------------------------------------------------------------
def test_plans_file_holds_the_45_demo_plans_and_is_filtered_by_firm():
    assert {f: len(load_cash_plans(f)) for f in ("F01", "F02", "F03")} == {"F01": 15, "F02": 15, "F03": 15}
    assert load_cash_plans("NOPE") == []
    first = load_cash_plans("F01")[0]
    assert first["event_id"] == "PL-F01-001" and first["category"] == "payroll" and first["amount_vnd"] == "1000000000"


def test_missing_plans_file_raises_a_coded_error(tmp_path):
    with pytest.raises(CashForecastError) as exc:
        load_cash_plans("F01", tmp_path / "nope.csv")
    assert exc.value.code == "MISSING_CORE_SOURCE"


# ----------------------------------------------------------------------------------------------
# Tool, permissions and agent (English narrative)
# ----------------------------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _no_api_key(monkeypatch, tmp_path):
    monkeypatch.setattr(agent, "OPENAI_API_KEY", "")
    monkeypatch.setattr(agent, "_client", None)
    log = tmp_path / "audit.jsonl"  # the tests never write to the project's logs/ folder
    monkeypatch.setattr(agent, "AUDIT_LOG_PATH", log)
    monkeypatch.setattr("src.core.logger.AUDIT_LOG_PATH", log)
    agent._RELEASED.clear()


def test_forecast_cash_tool_keeps_the_envelope_and_the_legacy_keys():
    out = forecast_cash("F01")
    assert set(out) == {"inputs", "result", "explanation"} and out["inputs"]["weeks"] == 13
    res = out["result"]
    assert res["schema_version"] == "tv2.result.v1" and res["summary"]["status"] == "provisional"
    assert (res["first_gap_week"], res["max_gap_vnd"], res["status"]) == (1, 1_119_322_000.0, "provisional")
    assert forecast_cash("F02")["result"]["max_gap_vnd"] == 0.0
    json.dumps(out)


def test_permission_layer_forces_the_session_firm_and_validates_arguments():
    out = permissions.execute("forecast_cash", {"firm_id": "HACKER", "weeks": 4}, "F01")
    assert out["inputs"]["firm_id"] == "F01" and len(out["result"]["weekly_schedule"]) == 4
    bad = permissions.execute("forecast_cash", {"weeks": 99}, "F01")
    assert bad["status"] == "error" and "INVALID_REQUEST" in bad["reason"]
    assert permissions.TOOL_TIERS["forecast_cash"] == 1


def _ask(q, firm="F01"):
    steps = []
    return agent.run_agent(q, firm, on_step=lambda s, t, a, r: steps.append((t, a))), steps


def test_agent_answers_the_forecast_question_in_english_with_the_srs_sample_figures():
    text, steps = _ask("Will I run short of cash in the next 13 weeks?")
    assert steps == [("forecast_cash", {"firm_id": "F01", "weeks": 13})]
    for must in ("VND 1.20 billion", "VND 500 million", "04/10/2026", "18/10/2026", "VND 132.224 million", "VND 367.776 million",
                 "73.6% of the buffer", "This is a buffer breach, not yet negative cash", "23/10/2026", "minus VND 378.917 million",
                 "VND 1 billion of payroll", "VND 225.062 million in payments to Fabric Distributor Beta (F02)", "VND 158.894 million",
                 "Week 4 ends at VND 133.358 million", "would hide this negative day", "minus VND 619.322 million on 18/12/2026",
                 "VND 619.322 million; keeping the buffer would need VND 1.119 billion", "not amounts to add together",
                 "not proof of a root cause", "Large Exporter K1 accounts for 79.2%"):
        assert must in text, must
    blocks = text.split("\n\n")
    # notice, four sections, table header, table, "Tools used" (SRS 3.2.1.3: four explanation sections and the tool line)
    assert len(blocks) == 8 and blocks[0].startswith("Note: this forecast uses synthetic demo data")
    assert blocks[4].endswith("it is not a loan recommendation or a credit decision.") and blocks[-1] == "Tools used: forecast_cash"
    assert blocks[5].startswith("Weekly forecast for F01 (VND million) | cut-off 30/09/2026 | 01/10/2026 to 30/12/2026 | scenario: base | status: provisional")
    assert not VI.search(text) and "USD" not in text and "$" not in text


def test_agent_does_not_invent_a_breach_when_there_is_none():
    text, _ = _ask("Show my cash forecast", firm="F02")
    assert "stays at or above the buffer on every forecast day" in text and "VND 1.152774 billion" not in text
    assert "1.153 billion" in text and "06/10/2026" in text
    assert "first negative day" not in text and "buffer breach" not in text and "does not guarantee" in text


def test_agent_horizon_and_the_13_week_cap():
    text, steps = _ask("Show my cash forecast for the next 4 weeks")
    assert steps[0][1] == {"firm_id": "F01", "weeks": 4} and "The 4-week cash forecast covers 01/10/2026 to 28/10/2026" in text
    assert "minus VND 378.917 million" in text and "18/12/2026" not in text and text.count("\n| ") == 5  # header row + 4 weeks
    capped, _ = _ask("Show my 26 week cash forecast")
    assert "limited to 13 weeks, so 26 weeks was reduced to 13" in capped


def test_agent_points_to_the_other_task_for_a_combined_question():
    text, steps = _ask("Why is my cash stuck and will I run short of cash in the next 3 months?")
    assert steps[0][0] == "forecast_cash" and "Ask \"Why is my cash stuck?\" for the working-capital diagnosis." in text


def test_agent_ignores_another_firm_named_in_the_question():
    text, steps = _ask("Show my cash forecast for F02")
    assert steps[0][1]["firm_id"] == "F01" and "limited to firm F01" in text and "minus VND 619.322 million" in text


def test_agent_scenario_label_is_not_shown_for_the_base_case():
    text, _ = _ask("Show my cash forecast")
    assert "Scenario:" not in text


def test_agent_explains_what_is_missing_instead_of_showing_a_forecast(monkeypatch, tmp_path):
    monkeypatch.setattr(cf_module, "PLANS_PATH", tmp_path / "does_not_exist.csv")
    text, _ = _ask("Show my cash forecast")
    assert "could not produce a valid cash forecast (missing data)" in text and "No forecast figures are shown" in text
    assert "VND 1.20 billion" not in text and not VI.search(text)


def test_agent_reports_a_tool_error_in_english(monkeypatch):
    monkeypatch.setattr(permissions, "execute", lambda *a, **k: {"status": "error", "reason": "Tool failed: x"})
    text, _ = _ask("Show my cash forecast")
    assert text.startswith("[Error] The cash forecast could not be produced (status: error)") and not VI.search(text)


def test_financing_words_next_to_a_forecast_get_a_boundary_note_not_a_lender_answer():
    text, _ = _ask("Show my cash forecast and my financing options")
    assert "Financing options and loan decisions are not part of this forecast" in text
    assert "lender" not in text.lower() and "interest" not in text.lower()


def test_blocked_borrowing_request_is_still_refused():
    text, steps = _ask("Can I borrow money to cover my cash gap?")
    assert steps == [] and text == agent.STATIC_REPLIES["OUT_OF_SCOPE"] and "13 weeks" in text


# ==============================================================================================
# Result envelope, evidence, alert trace (SRS 2.1.4, 3.1.4, 3.10.3.3 - 3.10.3.6)
# ==============================================================================================
def test_envelope_has_every_group_the_srs_requires(f01):
    d = f01.model_dump(mode="json")
    for key in ("meta", "inputs", "summary", "weekly_schedule", "daily_schedule", "episodes", "drivers", "insights", "capabilities",
                "data_quality", "reconciliation", "evidence", "fact_registry", "narrative", "issues", "audit_ref", "metrics", "cash_events"):
        assert key in d, key
    assert d["narrative"]["generation_status"] == "engine_summary" and d["narrative"]["overview"] and d["audit_ref"] == {"run_id": f01.meta.run_id, "audit_log": "logs/audit.jsonl", "release_status": "pending_release"}
    assert d["issues"] == d["data_quality"]["issues"]
    assert f01.capabilities.grain == "daily" and f01.capabilities.daily_schedule and f01.capabilities.coverage_status == "complete"


def test_insights_follow_the_srs_priority_and_point_to_evidence(f01):
    assert [i.theme for i in f01.insights] == ["first_shortfall", "first_negative_day", "highest_alert", "lowest_point", "receipt_dependence"]
    assert [i.priority for i in f01.insights] == [1, 2, 3, 4, 5] and 3 <= len(f01.insights) <= 5
    ids = {e.evidence_id for e in f01.evidence}
    assert all(r in ids for i in f01.insights for r in i.evidence_refs)
    assert all(i.limitation_ids and i.assumption_ids for i in f01.insights)
    assert "never added" in f01.insights[3].interpretation


def test_every_evidence_reference_resolves_and_belongs_to_this_run(f01):
    ids = {e.evidence_id for e in f01.evidence}
    assert all(e.run_id == f01.meta.run_id and e.firm_id == "F01" and e.snapshot_id == f01.meta.snapshot_id for e in f01.evidence)
    assert all(r in ids for m in f01.metrics for r in m.evidence_ids) and all(r in ids for f in f01.fact_registry.values() for r in f.evidence_ids)
    assert {"EV-CASH0", "EV-BUFFER", "EV-AR", "EV-AP", "EV-PLANS", "EV-IN", "EV-OUT", "EV-LEDGER", "EV-RECON", "EV-CRIT-2026-10-23"} <= ids
    assert f01.reconciliation.evidence_refs == ["EV-RECON"]
    ar = next(e for e in f01.evidence if e.evidence_id == "EV-AR")
    assert ar.aggregate_value == 4_912_255_000 and len(ar.source_record_ids) == 17 and ar.calculation_version == "tv2.formulas.v1"


def test_metric_records_carry_the_full_contract_and_nulls_have_a_reason(f01):
    for m in f01.metrics:
        assert m.raw_type in {"integer", "decimal", "ratio", "date", "count"} and m.source_basis and m.formula_id.startswith("T2-")
        if m.raw_value is None:
            assert m.reason_code and m.status in {"not_applicable", "missing_data", "invalid_data"}
        else:
            assert m.display_value and m.evidence_ids
    by = {m.id: m for m in f01.metrics}
    assert (by["cash0"].raw_type, by["cash0"].display_value) == ("integer", "VND 1,200,000,000")
    assert (by["top_buyer_receipt_share"].raw_type, by["top_buyer_receipt_share"].display_value) == ("ratio", "79.2%")


def test_every_colour_records_its_rule_threshold_and_raw_ratio(f01):
    rules = {r.rule_id: r for r in f01.inputs.alert_config.rules}
    assert f01.inputs.alert_config.config_version == "tv2.demo.v1" and f01.inputs.alert_config.basis == "buffer_gap_ratio"
    assert all(d.alert_rule_id in rules for d in f01.daily_schedule) and all(w.alert_rule_id in rules for w in f01.weekly_schedule)
    d18, d23, d04, d01 = day(f01, "2026-10-18"), day(f01, "2026-10-23"), day(f01, "2026-10-04"), day(f01, "2026-10-01")
    assert (d18.alert_rule_id, d18.alert_threshold) == ("T2-ALERT-RED-RATIO", 0.5) and d18.gap_ratio == pytest.approx(0.735552)
    assert (d23.alert_rule_id, d23.alert_threshold) == ("T2-ALERT-RED-NEGATIVE", 0.0) and d23.alert_color == "red"
    assert (d04.alert_rule_id, d04.alert_threshold) == ("T2-ALERT-YELLOW", 0.2) and (d01.alert_rule_id, d01.alert_color) == ("T2-ALERT-GREEN", "green")
    assert f01.weekly_schedule[3].alert_rule_id == "T2-ALERT-RED-RATIO" and f01.weekly_schedule[3].gap_ratio == pytest.approx(0.733284)


def test_zero_buffer_alerts_use_their_own_rules():
    r = run(snap(cash=10 * M, buffer=0), plans=[plan("O1", "2026-10-02", "OUT", 20 * M)])
    assert day(r, "2026-10-01").alert_rule_id == "T2-ALERT-GREEN-ZERO-BUFFER" and day(r, "2026-10-02").alert_rule_id == "T2-ALERT-RED-NEGATIVE"


def test_first_dates_are_also_reported_at_weekly_grain(f01):
    assert (f01.summary.first_buffer_week_closing, f01.summary.first_negative_week_closing) == (1, 12)  # T2-14: each grain on its own


def test_fact_registry_is_typed_scoped_and_json_safe(f01):
    reg = f01.fact_registry
    assert len(reg) >= 40 and all(f.display_forms.get("raw") and f.allowed_claim_types and f.case == "base" for f in reg.values())
    assert reg["zero_gap_peak"].allowed_claim_types == ["zero_gap"] and reg["buffer_gap_peak"].allowed_claim_types == ["buffer_gap"]
    assert reg["first_negative_week_closing"].grain == "weekly" and reg["first_negative_date"].grain == "daily"
    assert reg["drv_out_1"].attributes["category"] == "payroll" and reg["drv_in_after_1_date"].canonical_value == "2026-11-16"
    json.dumps({k: v.model_dump(mode="json") for k, v in reg.items()})


def test_unavailable_data_means_no_fact_never_a_placeholder_number(no_breach):
    _, r = no_breach
    assert not {"first_buffer_date", "first_negative_date", "first_highest_date", "zero_episodes"} & set(r.fact_registry)
    assert "min_week_closing" in r.fact_registry and r.fact_registry["min_headroom"].canonical_value > 0


def test_source_checksum_detects_a_change_before_release(monkeypatch, tmp_path):
    plans = tmp_path / "cash_plans.csv"
    plans.write_bytes(cf_module.PLANS_PATH.read_bytes())
    monkeypatch.setattr(cf_module, "PLANS_PATH", plans)
    r = calculate_cash_forecast(get_snapshot("F01"), "F01")
    assert len(r.meta.source_checksum) == 64 and r.meta.source_files[0] == "data/uc1_workbook.xlsx"
    assert cf_module.verify_sources_unchanged(r.meta) is True
    plans.write_text(plans.read_text(encoding="utf-8").replace("1000000000", "900000000", 1), encoding="utf-8")
    assert cf_module.verify_sources_unchanged(r.meta) is False
    assert cf_module.verify_sources_unchanged(run(snap()).meta) is None  # a handmade snapshot has no files to compare


# ==============================================================================================
# English narrative: structured generation, claim validation, rewrite, template fallback (SRS 3.1.5.4 - 3.1.5.12)
# ==============================================================================================
import copy  # noqa: E402


def _template_draft(res_json):
    reg = res_json["fact_registry"]
    secs, claims = agent.build_forecast_template(reg)
    return {"sections": [{"section_key": k, "text": secs[k], "claims": [{kk: vv for kk, vv in c.items() if kk != "section_key"} for c in claims
                                                                        if c["section_key"] == k]} for k in agent.FORECAST_SECTIONS if secs[k]]}


def _sec(d, key):
    return next(s for s in d["sections"] if s["section_key"] == key)


@pytest.fixture(scope="module")
def f01_json(f01):
    return f01.model_dump(mode="json")


SCENARIOS = {
    "F01": lambda: calculate_cash_forecast(get_snapshot("F01"), "F01"),
    "F02": lambda: calculate_cash_forecast(get_snapshot("F02"), "F02"),
    "F03": lambda: calculate_cash_forecast(get_snapshot("F03"), "F03"),
    "F01_late": lambda: calculate_cash_forecast(get_snapshot("F01"), "F01", case_id="estimated_receipts_late"),
    "F01_4weeks": lambda: calculate_cash_forecast(get_snapshot("F01"), "F01", weeks=4),
    "initial_below_buffer": lambda: run(snap(cash=300 * M, buffer=500 * M)),
    "yellow_only": lambda: run(snap(cash=450 * M, buffer=500 * M)),
    "zero_buffer": lambda: run(snap(cash=10 * M, buffer=0), plans=[plan("O1", "2026-10-02", "OUT", 20 * M)]),
    "no_breach": lambda: run(snap(cash=2_000 * M)),
}


@pytest.mark.parametrize("name", list(SCENARIOS))
def test_the_deterministic_template_passes_its_own_validator_in_every_scenario(name):
    res = SCENARIOS[name]().model_dump(mode="json")
    assert agent.check_forecast_answer(_template_draft(res), res["fact_registry"], res["meta"]["case_id"]) == []
    out = agent.render_forecast(res)
    assert "[[FACT" not in out and not VI.search(out) and "Tools used: forecast_cash" in out


def test_system_prompt_is_the_srs_text_plus_the_hard_rules():
    p = agent.FORECAST_SYSTEM_PROMPT
    assert p.startswith("You explain only the verified TV2 facts from the current run.")
    assert "Do not calculate, change assumptions, promise receipts, select a lender, or make a credit decision." in p
    for must in ("overview, critical_periods, drivers, assumptions_and_limits", "[[FACT:id]]", "never added together", "English only"):
        assert must in p


def test_the_model_only_receives_server_formatted_facts(f01_json):
    reg = f01_json["fact_registry"]
    msgs = agent.build_forecast_messages(reg, agent.forecast_display_forms(reg), "Will I run short of cash?")
    payload = json.loads(msgs[1]["content"])
    by = {f["id"]: f for f in payload["facts"]}
    assert by["cash0"]["display"] == "VND 1.20 billion" and by["first_negative_date"]["display"] == "23/10/2026"
    assert by["drv_out_2"]["display"] == "VND 225.062 million in payments to Fabric Distributor Beta (F02)"
    assert payload["case"] == "base" and payload["section_plan"] == list(agent.FORECAST_SECTIONS) and msgs[0]["role"] == "system"
    assert not VI.search(msgs[1]["content"])  # entity names are English display forms


def test_a_valid_model_draft_is_released_with_server_formatted_numbers(f01_json):
    out = agent.generate_forecast_narrative(f01_json, "q", llm_call=lambda m: json.dumps(_template_draft(f01_json)))
    assert (out["generation_status"], out["validation_outcome"], out["violations"]) == ("llm_validated", "passed", [])
    assert "VND 132.224 million" in out["sections"]["critical_periods"] and "[[FACT" not in "".join(out["sections"].values())
    assert "cash0" in out["fact_refs"] and "drv_out_1" in out["fact_refs"] and out["timing_ms"]["generation"] >= 0


def _text_mutations():
    """Errors in the model's wording: caught after the server has built the claims from the tokens, so the reader never sees the draft."""
    def digit(d): _sec(d, "overview")["text"] += " The cash cycle is 70 days."
    def unknown(d): _sec(d, "overview")["text"] = _sec(d, "overview")["text"].replace("[[FACT:cash0]]", "[[FACT:cash99]]")
    def additive(d): _sec(d, "critical_periods")["text"] += " The total of the gaps is [[FACT:zero_gap_peak]]."
    def certain(d): _sec(d, "drivers")["text"] += " The receipts will definitely arrive."
    def no_risk(d): _sec(d, "critical_periods")["text"] += " So there is no risk."
    def borrow(d): _sec(d, "critical_periods")["text"] += " You should borrow [[FACT:buffer_gap_peak]]."
    def vietnamese(d): _sec(d, "overview")["text"] += " Tiền đầu kỳ."
    def dropped_fact(d): _sec(d, "overview")["text"] = _sec(d, "overview")["text"].replace("[[FACT:cash0]]", "the cash")
    def not_additive(d): _sec(d, "critical_periods")["text"] = _sec(d, "critical_periods")["text"].replace("These are two measures of the same point, not amounts to add together.", "")
    def negative(d): _sec(d, "critical_periods")["text"] += " The shortfall of [[FACT:first_highest_gap]] means cash is negative."
    def repeated(d): _sec(d, "overview")["text"] += " It starts with [[FACT:cash0]] billion."
    def extra_fact(d): _sec(d, "overview")["text"] += " The cushion is [[FACT:min_headroom]]."
    def missing_section(d): d["sections"] = [s for s in d["sections"] if s["section_key"] != "assumptions_and_limits"]
    return [(digit, "UNSUPPORTED_NARRATIVE_FACT"), (unknown, "UNKNOWN_FACT"), (additive, "ADDITIVE_GAPS"), (certain, "CERTAINTY_CLAIM"),
            (no_risk, "NO_RISK_CLAIM"), (borrow, "SCOPE_LEAK"), (vietnamese, "NON_ENGLISH"), (dropped_fact, "NARRATIVE_INCOMPLETE"),
            (not_additive, "BOTH_GAPS_NOT_ADDITIVE"), (negative, "NEGATIVE_WITHOUT_ZERO_BASIS"), (repeated, "REPEATED_WORD"),
            (extra_fact, "UNEXPECTED_FACT"), (missing_section, "NARRATIVE_INCOMPLETE")]


@pytest.mark.parametrize("mutate,rule", _text_mutations(), ids=[f"{m.__name__}->{r}" for m, r in _text_mutations()])
def test_srs_blocked_statements_are_caught_and_replaced_by_the_template(f01_json, mutate, rule):
    bad = copy.deepcopy(_template_draft(f01_json))
    mutate(bad)
    out = agent.generate_forecast_narrative(f01_json, "q", llm_call=lambda m: json.dumps(bad))
    assert (out["generation_status"], out["validation_outcome"]) == ("template_fallback_blocked", "blocked_twice")
    assert rule in {v["rule_id"] for e in out["violations"] for v in e["violations"]} and len(out["violations"]) == 2  # one rewrite, then template
    template = agent.generate_forecast_narrative(f01_json, "q")
    assert out["sections"] == template["sections"]  # a blocked draft never reaches the reader


def _claim_mutations():
    """Errors in claim metadata: the validator still rejects them (the generation path builds correct claims itself)."""
    def no_claim(d): _sec(d, "overview")["claims"] = []
    def wrong_type(d): _sec(d, "critical_periods")["claims"][0]["claim_type"] = "negative_timing"
    def weekly_as_daily(d): _sec(d, "critical_periods")["claims"].append({"fact_ids": ["first_negative_week_closing"], "claim_type": "negative_timing", "entity_id": None, "basis": "end_of_week", "grain": "weekly", "case": "base"})
    def case(d): _sec(d, "overview")["claims"][0]["case"] = "estimated_receipts_late"
    def grain(d): _sec(d, "overview")["claims"][0]["grain"] = "weekly"
    def basis(d): _sec(d, "overview")["claims"][0]["basis"] = "zero"
    def entity(d): _sec(d, "drivers")["claims"][-1]["entity_id"] = "someone else"
    def extra_key(d): d["extra"] = 1
    return [(no_claim, "CLAIM_MISSING"), (wrong_type, "CLAIM_TYPE_MISMATCH"), (weekly_as_daily, "WEEKLY_AS_DAILY"), (case, "CASE_MISMATCH"),
            (grain, "GRAIN_MISMATCH"), (basis, "BASIS_MISMATCH"), (entity, "ENTITY_MISMATCH"), (extra_key, "SCHEMA_INVALID")]


@pytest.mark.parametrize("mutate,rule", _claim_mutations(), ids=[f"{m.__name__}->{r}" for m, r in _claim_mutations()])
def test_the_validator_rejects_bad_claim_metadata(f01_json, mutate, rule):
    bad = copy.deepcopy(_template_draft(f01_json))
    mutate(bad)
    assert rule in {v["rule_id"] for v in agent.check_forecast_answer(bad, f01_json["fact_registry"], "base")}


# ---- the model rewrites a reference draft; claims are built by the server ----
def test_the_model_receives_the_reference_draft_with_only_the_facts_it_uses(f01_json):
    reg = f01_json["fact_registry"]
    payload = json.loads(agent.build_forecast_messages(reg, agent.forecast_display_forms(reg), "q")[1]["content"])
    ref, _ = agent.build_forecast_template(reg)
    assert payload["reference_draft"] == ref and set(payload["reference_draft"]) == set(agent.FORECAST_SECTIONS)
    used = {m for text in ref.values() for m in re.findall(r"FACT:(\w+)", text)}
    assert {f["id"] for f in payload["facts"]} == used and "min_headroom" not in used
    assert "FACT:first_negative_date" in payload["reference_draft"]["critical_periods"] and not VI.search(json.dumps(payload))


def test_a_paraphrase_with_no_claims_is_released_and_claims_are_built_from_the_tokens(f01_json):
    draft = copy.deepcopy(_template_draft(f01_json))
    for s in draft["sections"]:
        s.pop("claims")  # the model does not have to write claims
    crit = _sec(draft, "critical_periods")
    crit["text"] = crit["text"].replace("Cash is first expected to fall below the buffer on", "The first day below the buffer is expected to be")
    draft["sections"] = [{**s, "title": "ignored"} for s in draft["sections"]]  # extra keys are dropped, not fatal
    out = agent.generate_forecast_narrative(f01_json, "q", llm_call=lambda m: json.dumps({**draft, "note": "ignored"}))
    assert (out["generation_status"], out["validation_outcome"]) == ("llm_validated", "passed")
    assert "The first day below the buffer is expected to be 04/10/2026 (week 1)." in out["sections"]["critical_periods"]
    kinds = {c["claim_type"] for c in out["claims"]}
    assert {"opening_position", "buffer_timing", "negative_timing", "lowest_point", "zero_gap", "buffer_gap", "weekly_closing", "driver", "concentration"} <= kinds


def test_claims_written_by_the_model_are_ignored_and_replaced(f01_json):
    draft = copy.deepcopy(_template_draft(f01_json))
    _sec(draft, "critical_periods")["claims"] = [{"fact_ids": ["zero_gap_peak"], "claim_type": "nonsense", "basis": "x", "grain": "y", "case": "z"}]
    out = agent.generate_forecast_narrative(f01_json, "q", llm_call=lambda m: json.dumps(draft))
    assert out["generation_status"] == "llm_validated" and "nonsense" not in {c["claim_type"] for c in out["claims"]}


def test_a_model_that_returns_the_sections_as_plain_keys_is_accepted(f01_json):
    draft = {s["section_key"]: s["text"] for s in _template_draft(f01_json)["sections"]}
    out = agent.generate_forecast_narrative(f01_json, "q", llm_call=lambda m: json.dumps(draft))
    assert out["generation_status"] == "llm_validated" and out["sections"]["overview"].startswith("The 13-week cash forecast covers 01/10/2026")


def test_the_disclaimer_is_always_added_by_the_system_exactly_once(f01_json):
    for llm in (None, lambda m: json.dumps(_template_draft(f01_json))):
        out = agent.generate_forecast_narrative(f01_json, "q", llm_call=llm)
        assert out["sections"]["assumptions_and_limits"].endswith(agent.FORECAST_DISCLAIMER)
        assert sum(x["assumptions_and_limits"].count("not a loan recommendation") for x in [out["sections"]]) == 1
    assert "closing disclaimer" in agent.FORECAST_SYSTEM_PROMPT and "reference_draft" in agent.FORECAST_SYSTEM_PROMPT


def test_a_buffer_shortfall_sentence_may_say_not_yet_negative_but_not_that_cash_is_negative(f01_json):
    ok = agent.check_forecast_answer(_template_draft(f01_json), f01_json["fact_registry"], "base")
    assert ok == []  # "This is a buffer breach, not yet negative cash." is allowed
    for wording in (" The gaps are two measures of the same point.", " The two gaps must not be added together.", " Never sum them."):
        d = copy.deepcopy(_template_draft(f01_json))
        _sec(d, "critical_periods")["text"] = _sec(d, "critical_periods")["text"].replace(" These are two measures of the same point, not amounts to add together.", wording)
        assert "BOTH_GAPS_NOT_ADDITIVE" not in {v["rule_id"] for v in agent.check_forecast_answer(d, f01_json["fact_registry"], "base")}, wording


def test_one_rewrite_is_allowed_and_the_model_sees_the_violations(f01_json):
    good, calls = _template_draft(f01_json), []

    def llm(messages):
        calls.append(messages)
        bad = copy.deepcopy(good)
        if len(calls) == 1:
            _sec(bad, "overview")["text"] += " It is certain that cash will recover."
            return json.dumps(bad)
        return json.dumps(good)

    out = agent.generate_forecast_narrative(f01_json, "q", llm_call=llm)
    assert (out["generation_status"], out["validation_outcome"], len(calls)) == ("llm_validated", "passed_after_rewrite", 2)
    assert "CERTAINTY_CLAIM" in calls[1][-1]["content"] and "blocked" in calls[1][-1]["content"]


@pytest.mark.parametrize("llm", [lambda m: (_ for _ in ()).throw(TimeoutError("timeout")), lambda m: "not json", lambda m: "[]"])
def test_model_timeout_or_garbage_falls_back_to_the_four_section_template(f01_json, llm):
    out = agent.generate_forecast_narrative(f01_json, "q", llm_call=llm)
    assert out["generation_status"] in {"template_fallback_llm_error", "template_fallback_blocked"}
    assert all(out["sections"][k] for k in agent.FORECAST_SECTIONS) and "VND 132.224 million" in out["sections"]["critical_periods"]


def test_agent_uses_the_model_when_a_key_is_available_and_validates_it(monkeypatch, f01_json):
    monkeypatch.setattr(agent, "_narrative_llm_call", lambda: (lambda m: json.dumps(_template_draft(f01_json))))
    text, _ = _ask("Will I run short of cash in the next 13 weeks?")
    assert "VND 132.224 million" in text and text.endswith("Tools used: forecast_cash")


def test_weekly_table_has_text_labels_and_separates_week_end_from_the_worst_day(f01_json):
    table = agent.render_weekly_table(f01_json).split("\n")
    assert table[0].startswith("Weekly forecast for F01 (VND million)") and "scenario: base" in table[0] and "status: provisional" in table[0]
    assert table[2].startswith("| Week | Dates | Opening | In | Out | Closing | Lowest day | End-of-week alert | Worst daily alert |")
    rows = [r for r in table if r.startswith("| ") and r[2].isdigit()]
    assert len(rows) == 13
    assert rows[3] == "| 4 | 22/10/2026–28/10/2026 | 687.251 | 763.783 | 1,317.676 | 133.358 | -378.917 (23/10/2026) | Red | Red |"
    assert rows[2].endswith("| Green | Red |")  # week 3 ends green but contains a red day


# ==============================================================================================
# Release gate: audit, stale snapshot, idempotency (SRS 3.6.1.1, E6, 3.3.1.3)
# ==============================================================================================
def _audit_lines(tmp_path):
    return [json.loads(x) for x in (tmp_path / "audit.jsonl").read_text(encoding="utf-8").splitlines()]


def test_release_writes_one_complete_audit_record(tmp_path):
    text, _ = _ask("Will I run short of cash in the next 13 weeks?")
    rec = [r for r in _audit_lines(tmp_path) if r.get("release_status") == "response_released"]
    assert len(rec) == 1 and text
    r = rec[0]
    for key in ("request_id", "idempotency_key", "actor", "firm_id", "task", "tool", "tier", "step_id", "params", "snapshot_id", "versions",
                "outcome", "issue_codes", "generation_mode", "validation_outcome", "timing_ms", "release_status", "run_id", "source_checksum"):
        assert key in r, key
    assert (r["task"], r["tool"], r["tier"], r["firm_id"], r["actor"]) == ("UC02", "forecast_cash", 1, "F01", "session:demo-session")
    assert r["versions"] == {"schema": "tv2.result.v1", "formula": "tv2.formulas.v1", "config": "tv2.demo.v1"}
    assert r["outcome"] == {"status": "provisional", "overall_level": "red", "reconciliation": "ok"} and r["generation_mode"] == "template"
    assert set(r["timing_ms"]) >= {"read_and_compute", "generation", "validation"} and "OVERDUE_ROLL" in r["issue_codes"]
    assert "sk-" not in json.dumps(r) and "OPENAI" not in json.dumps(r)  # no secrets in audit


def test_a_failed_audit_write_blocks_the_release(monkeypatch):
    def boom(record):
        raise OSError("disk full")

    monkeypatch.setattr(agent, "_audit_strict", boom)
    text, _ = _ask("Will I run short of cash in the next 13 weeks?")
    assert text.startswith("[Error] AUDIT_WRITE_FAILED") and "VND 1.20 billion" not in text and agent._RELEASED == {}


def test_a_changed_source_blocks_the_release_and_is_audited(monkeypatch, tmp_path):
    monkeypatch.setattr(agent, "verify_sources_unchanged", lambda meta: False)
    text, _ = _ask("Will I run short of cash in the next 13 weeks?")
    assert text.startswith("[Error] STALE_SNAPSHOT") and "VND 1.20 billion" not in text
    assert [r["release_status"] for r in _audit_lines(tmp_path) if "release_status" in r] == ["blocked_stale_snapshot"]


def test_a_retry_with_the_same_idempotency_key_never_releases_twice(tmp_path):
    first = agent.run_agent("Will I run short of cash in the next 13 weeks?", "F01", idempotency_key="req-1")
    again = agent.run_agent("Will I run short of cash in the next 13 weeks?", "F01", idempotency_key="req-1")
    assert first == again
    assert [r["release_status"] for r in _audit_lines(tmp_path) if "release_status" in r] == ["response_released", "idempotent_replay"]


def test_blocked_data_is_audited_but_never_shown_as_a_forecast(monkeypatch, tmp_path):
    monkeypatch.setattr(cf_module, "PLANS_PATH", tmp_path / "missing.csv")
    text, _ = _ask("Show my cash forecast")
    rec = [r for r in _audit_lines(tmp_path) if r.get("release_status") == "response_released"][0]
    assert rec["outcome"]["status"] == "missing_data" and rec["generation_mode"] == "not_generated" and "PLANS_SOURCE_MISSING" in rec["issue_codes"]
    assert "Weekly forecast" not in text and "Tools used" not in text


# ==============================================================================================
# Late-receipts case through the agent (T2-18, Q21)
# ==============================================================================================
def test_agent_runs_the_late_receipts_case_with_the_requested_days():
    text, steps = _ask("Will I run short of cash if receipts are 14 days late?")
    assert steps[0][1] == {"firm_id": "F01", "case_id": "estimated_receipts_late", "extra_days": 14}
    assert "Scenario: estimated receipt dates are 14 days later than in the base case (a sensitivity test, not a probability)." in text
    assert "scenario: estimated receipts 14 days later" in text and "Tools used: forecast_cash" in text


def test_agent_late_receipts_case_matches_appendix_c():
    text, steps = _ask("Will I run short of cash if customers pay late?")
    assert steps[0][1] == {"firm_id": "F01", "case_id": "estimated_receipts_late"}  # the tool default of 7 days applies
    assert "7 days later than in the base case" in text and "The first negative day is 14/10/2026" in text
    assert "minus VND 1.093 billion on 23/10/2026" in text


def test_tool_accepts_case_and_extra_days_and_rejects_nonsense():
    out = forecast_cash("F01", case_id="estimated_receipts_late", extra_days=7)
    assert out["result"]["summary"]["case_id"] == "estimated_receipts_late" and out["inputs"]["extra_days"] == 7
    bad = permissions.execute("forecast_cash", {"case_id": "optimistic"}, "F01")
    assert bad["status"] == "error" and "INVALID_REQUEST" in bad["reason"]


# ==============================================================================================
# dd/mm/yyyy display (SRS 3.2.1.3), populated narrative, weekly_only payload, TOOL_TIMEOUT
# ==============================================================================================
import time  # noqa: E402

_DAY_MONTH = re.compile(r"\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b")
_ISO = re.compile(r"\b20\d\d-\d\d-\d\d\b")


def test_every_displayed_date_is_dd_mm_yyyy_and_raw_dates_stay_iso(f01):
    shown = [f01.explanation, f01.narrative.overview, *[i.observation for i in f01.insights], *[m.display_value or "" for m in f01.metrics],
             agent.render_forecast(f01.model_dump(mode="json")), *[i.message for i in f01.issues]]
    for text in shown:
        assert not _DAY_MONTH.search(text) and not _ISO.search(text), text[:120]
    assert str(f01.summary.first_negative_date) == "2026-10-23" and {m.id: m for m in f01.metrics}["first_negative_date"].raw_value == "2026-10-23"
    assert {m.id: m for m in f01.metrics}["first_negative_date"].display_value == "23/10/2026"
    assert "Plan date 15/09/2026 is before the first forecast day 01/10/2026." in run(snap(), plans=[plan("PL-1", "2026-09-15", "OUT", M)]).issues[0].message


def test_the_narrative_field_is_a_deterministic_english_summary(f01):
    n = f01.narrative
    assert (n.generation_status, n.validation_outcome, n.locale) == ("engine_summary", "not_run", "en")
    assert n.overview == ("As of 30/09/2026, the 13-week cash forecast (01/10/2026 to 30/12/2026) starts with VND 1.20 billion of available cash against a "
                          "VND 500 million buffer. Cash first falls below the buffer on 04/10/2026 and first turns negative on 23/10/2026. The lowest "
                          "end-of-day balance is minus VND 619.322 million on 18/12/2026. The peak gap to zero is VND 619.322 million and the peak gap to "
                          "the buffer is VND 1.119 billion; they are alternative measures of the same point and are never added. Status: provisional.")
    assert set(n.fact_refs) <= set(f01.fact_registry) and {"cash0", "first_buffer_date", "first_negative_date", "zero_gap_peak", "buffer_gap_peak"} <= set(n.fact_refs)
    assert not VI.search(n.overview) and (n.claims, n.critical_periods, n.drivers) == ([], "", "")
    again = calculate_cash_forecast(get_snapshot("F01"), "F01").narrative
    assert again == n


def test_narrative_summary_covers_no_breach_scenario_and_blocked_runs(no_breach, f01_late):
    firm, r = no_breach
    assert "Cash stays at or above the buffer on every forecast day" in r.narrative.overview and "06/10/2026" in r.narrative.overview
    assert "turns negative" not in r.narrative.overview and "peak gap" not in r.narrative.overview
    assert "Scenario: estimated receipt dates are 7 days later" in f01_late.narrative.overview and "14/10/2026" in f01_late.narrative.overview
    blocked = run(snap(buffer=None))
    assert blocked.summary.status == "missing_data" and "was not produced (missing data)" in blocked.narrative.overview
    assert blocked.narrative.generation_status == "engine_summary"
    assert "never turns negative" in run(snap(cash=450 * M, buffer=500 * M)).narrative.overview


def test_weekly_only_returns_the_weekly_schedule_and_no_events(f01):
    wk = calculate_cash_forecast(get_snapshot("F01"), "F01", weekly_only=True)
    assert wk.cash_events == [] and wk.daily_schedule is None and wk.episodes == [] and len(wk.weekly_schedule) == 13
    assert wk.weekly_schedule == f01.weekly_schedule and wk.summary == f01.summary and wk.reconciliation.status == "ok"  # nothing is recalculated
    assert wk.meta.weekly_only and wk.capabilities.weekly_only and not wk.capabilities.daily_schedule and not wk.capabilities.drill_down
    assert wk.issues[-1].code == "WEEKLY_ONLY_PAYLOAD" and wk.data_quality.issues == wk.issues and wk.narrative == f01.narrative
    assert wk.drivers.critical_dates == [] and wk.drivers.dated_outflows == [] and wk.drivers.buyer_receipt_shares
    assert not [k for k in wk.fact_registry if k.startswith("drv_")]
    ids = {e.evidence_id for e in wk.evidence}
    assert not [i for i in ids if i.startswith("EV-CRIT-")] and all(not e.source_record_ids for e in wk.evidence)
    assert all(r in ids for m in wk.metrics for r in m.evidence_ids) and all(r in ids for i in wk.insights for r in i.evidence_refs)
    assert len(json.dumps(wk.model_dump(mode="json"))) < 0.5 * len(json.dumps(f01.model_dump(mode="json")))  # smaller payload


def test_weekly_only_is_off_by_default_and_must_be_boolean(f01):
    assert f01.meta.weekly_only is False and f01.cash_events and f01.daily_schedule
    with pytest.raises(CashForecastError) as exc:
        run(snap(), weekly_only="yes")
    assert exc.value.code == "INVALID_REQUEST"


def test_the_tool_accepts_weekly_only_and_a_buffer_override():
    out = forecast_cash("F01", weekly_only=True, buffer_vnd=800 * M)
    assert out["inputs"]["weekly_only"] is True and out["result"]["cash_events"] == [] and out["result"]["summary"]["buffer_vnd"] == 800 * M
    assert out["result"]["summary"]["max_gap_vnd"] > 1_119_322_000  # a bigger buffer means a bigger gap to it
    bad = permissions.execute("forecast_cash", {"buffer_vnd": -5}, "F01")
    assert bad["result"]["summary"]["status"] == "invalid_data" and bad["result"]["weekly_schedule"] == []  # never a normal colour


def test_the_default_tool_timeout_is_30_seconds():
    from src.core import config
    assert config.TOOL_TIMEOUT == int(os.getenv("TOOL_TIMEOUT", "30"))
    assert config.TOOL_TIMEOUT == 30 or os.getenv("TOOL_TIMEOUT")


def test_a_run_over_the_timeout_is_abandoned_and_reported(monkeypatch):
    from src.agent import tools
    monkeypatch.setattr(tools, "TOOL_TIMEOUT", 0.05)
    monkeypatch.setattr(tools, "calculate_cash_forecast", lambda *a, **k: time.sleep(0.6))
    t0 = time.perf_counter()
    with pytest.raises(tools.ToolTimeoutError) as exc:
        tools.forecast_cash("F01")
    assert time.perf_counter() - t0 < 0.4 and exc.value.code == "TOOL_TIMEOUT" and "exceeded 0.05 seconds" in str(exc.value)
    out = permissions.execute("forecast_cash", {}, "F01")
    assert out["status"] == "error" and "TOOL_TIMEOUT" in out["reason"]
    text, _ = _ask("Will I run short of cash in the next 13 weeks?")
    assert text.startswith("[Error] TOOL_TIMEOUT") and "VND 1.20 billion" not in text and agent._RELEASED == {}


def test_errors_raised_inside_the_guard_keep_their_type(monkeypatch):
    from src.agent import tools

    def boom(*a, **k):
        raise CashForecastError("INVALID_DATE_ALIGNMENT", "x")

    monkeypatch.setattr(tools, "calculate_cash_forecast", boom)
    with pytest.raises(CashForecastError) as exc:
        tools.run_forecast("F01")
    assert exc.value.code == "INVALID_DATE_ALIGNMENT"


def test_run_with_timeout_returns_the_value_of_a_fast_job():
    from src.agent.tools import run_with_timeout
    assert run_with_timeout(lambda a, b=0: a + b, 5, 2, b=3) == 5