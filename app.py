"""SME Liquidity Copilot - Streamlit UI (English only).

Run from the project folder:   streamlit run app.py
Tabs: Cash Forecast (UC-02: metric cards, 13-week table with alert colours, week drill-down), Working Capital (UC-01), Ask the Copilot.
The UI calls the same verified engine as the agent and the REST API; it never recalculates a number. Every date is dd/mm/yyyy.
"""
from __future__ import annotations

import os
import sys
from decimal import Decimal
from typing import Any, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # lets `streamlit run app.py` find the src package

import pandas as pd  # noqa: E402
import streamlit as st  # noqa: E402

from src.agent.agent import FORECAST_NOTICE, entity_label, generate_forecast_narrative, run_agent  # noqa: E402
from src.agent.tools import get_working_capital, run_forecast  # noqa: E402
from src.uc02_cash_forecast.insights import format_dmy, format_vnd  # noqa: E402

AS_OF = "2026-09-30"  # the only cut-off date supported by the demo workbook
FIRMS = ("F01", "F02", "F03")
ALERT_COLOURS = {"Green": "#c6efce", "Yellow": "#ffeb9c", "Orange": "#f8cbad", "Red": "#ff9999"}
CATEGORY_LABELS = {"payroll": "Payroll", "rent": "Rent", "utilities": "Utilities", "new_materials": "New-material purchases", "tax": "Tax",
                   "debt_service": "Debt service", "capex": "Capital expenditure", "supplier_payment": "Supplier payment",
                   "invoice_receipt": "Customer receipt"}
DATE_TYPE = {"confirmed_schedule": "Confirmed", "approved_schedule": "Confirmed", "plan": "Planned", "due_date": "Contractual due date",
             "history_late_positive": "Estimated (due date + historical delay)", "fallback_on_time": "Estimated (assumed on time)"}


# ------------------------------------------------------------------------------------------------
# Data access (cached) and table builders (pure functions, easy to test)
# ------------------------------------------------------------------------------------------------
@st.cache_data(show_spinner="Calculating the forecast...")
def load_forecast(firm: str, weeks: int, case_id: str, extra_days: int, buffer_vnd: Optional[int]) -> dict[str, Any]:
    """Runs the engine (under the TOOL_TIMEOUT guard) and returns the JSON-safe result."""
    return run_forecast(firm, AS_OF, weeks, case_id, extra_days, buffer_vnd).model_dump(mode="json")


def mn(x: Any) -> float:
    """VND -> VND million, for table display only."""
    return float(Decimal(str(x)) / Decimal(10) ** 6)


def label(colour: str) -> str:
    return colour.capitalize()


def weekly_frame(res: dict[str, Any]) -> pd.DataFrame:
    """The 13-week table. The end-of-week alert and the worst daily alert are separate columns, each with a text label."""
    rows = [{"Week": w["week_number"], "Dates": f"{format_dmy(w['start_date'])}–{format_dmy(w['end_date'])}", "Opening (VND m)": mn(w["opening_vnd"]),
             "In (VND m)": mn(w["in_vnd"]), "Out (VND m)": mn(w["out_vnd"]), "Closing (VND m)": mn(w["closing_vnd"]),
             "Lowest day (VND m)": mn(w["min_daily_vnd"]), "Lowest day": format_dmy(w["min_daily_date"]),
             "End-of-week alert": label(w["alert_color"]), "Worst daily alert": label(w["worst_daily_alert_color"])}
            for w in res["weekly_schedule"]]
    return pd.DataFrame(rows)


def styled_weekly(df: pd.DataFrame):
    """Colours the two alert columns (always with the text label as well, so colour is never the only signal)."""
    paint = lambda v: f"background-color: {ALERT_COLOURS.get(v, '')}; color: #000000; font-weight: 600"  # noqa: E731
    styler = df.style.format({c: "{:,.3f}" for c in df.columns if c.endswith("(VND m)")})
    apply = styler.map if hasattr(styler, "map") else styler.applymap
    return apply(paint, subset=["End-of-week alert", "Worst daily alert"])


def daily_frame(res: dict[str, Any], week: int) -> pd.DataFrame:
    rows = [{"Date": format_dmy(d["date"]), "Opening (VND m)": mn(d["opening_vnd"]), "In (VND m)": mn(d["in_vnd"]), "Out (VND m)": mn(d["out_vnd"]),
             "Closing (VND m)": mn(d["closing_vnd"]), "Gap to buffer (VND m)": mn(d["gap_buffer_vnd"]), "Gap to zero (VND m)": mn(d["gap_zero_vnd"]),
             "Alert": label(d["alert_color"]), "Alert rule": d["alert_rule_id"]}
            for d in (res.get("daily_schedule") or []) if d["week_number"] == week]
    return pd.DataFrame(rows)


def events_frame(res: dict[str, Any], week: int) -> pd.DataFrame:
    """Cash events dated in the selected week, each traceable to its source and marked as confirmed, planned or estimated."""
    start = pd.Timestamp(res["meta"]["start_date"])
    rows = []
    for e in res["cash_events"]:
        if e["scope"] != "in_horizon" or (pd.Timestamp(e["cash_date"]) - start).days // 7 + 1 != week:
            continue
        kind = "Buyer" if e["source_type"] == "sales_invoice" else "Supplier" if e["source_type"] == "purchase_invoice" else "Planned item"
        rows.append({"Date": format_dmy(e["cash_date"]), "Direction": "In" if e["direction"] == "IN" else "Out",
                     "Category": CATEGORY_LABELS.get(e["category"], e["category"].replace("_", " ").title()),
                     "Counterparty": entity_label(e["counterparty_name"], kind), "Amount (VND m)": mn(e["amount_vnd"]),
                     "Date type": DATE_TYPE.get(e["date_method"], e["date_method"]), "Moved to first day": "Yes" if e["roll_applied"] else "",
                     "Source": f"{e['source_type']}:{e['source_id']}", "_sort": (e["cash_date"], e["direction"], -float(e["amount_vnd"]))})
    df = pd.DataFrame(rows)
    return df if df.empty else df.sort_values("_sort").drop(columns="_sort").reset_index(drop=True)


def header_line(res: dict[str, Any]) -> str:
    s, m = res["summary"], res["meta"]
    case = "base" if m["case_id"] == "base" else f"estimated receipts {res['inputs']['extra_days']} days later"
    return (f"**Firm** {m['firm_id']} · **Cut-off** {format_dmy(s['as_of'])} · **Forecast** {format_dmy(s['start_date'])} to {format_dmy(s['end_date'])} · "
            f"**Scenario** {case} · **Status** {s['status']} · **Scope** open invoices and declared plans"
            + (" (synthetic demo data)" if m["data_is_synthetic"] else ""))


# ------------------------------------------------------------------------------------------------
# Cash Forecast tab
# ------------------------------------------------------------------------------------------------
def render_cards(res: dict[str, Any]) -> None:
    s = res["summary"]
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Opening Cash", format_vnd(s["cash0_vnd"]), help="Cash at the cut-off date minus restricted cash (T2-01).")
    c2.metric("Min Cash Date", format_dmy(s["min_balance_date"]), delta=f"Lowest balance {format_vnd(s['min_balance_vnd'])}", delta_color="off",
              help="Day of the lowest end-of-day balance (the earliest day when two days tie).")
    c3.metric("First Deficit Date", format_dmy(s["first_negative_date"]) if s["first_negative_date"] else "No deficit",
              delta=(f"Below the buffer from {format_dmy(s['first_buffer_date'])}" if s["first_buffer_date"] else "Never below the buffer"),
              delta_color="off", help="First day with negative end-of-day cash.")
    c4.metric("Max Deficit Amount", format_vnd(s["max_gap_vnd"]), delta=f"Gap to zero {format_vnd(s['peak_zero_gap_vnd'])}", delta_color="off",
              help="Largest shortfall against the cash buffer. The gap to zero measures the same point differently; the two are never added.")


def render_week_drilldown(res: dict[str, Any], table_selection: list[int]) -> None:
    weeks = res["weekly_schedule"]
    default = next((i for i, w in enumerate(weeks) if w["worst_daily_alert_color"] != "green"), 0)  # open on the first week with an alert
    options = [f"Week {w['week_number']}: {format_dmy(w['start_date'])}–{format_dmy(w['end_date'])} "
               f"(week end {label(w['alert_color'])}, worst day {label(w['worst_daily_alert_color'])})" for w in weeks]
    st.subheader("Week drill-down")
    st.caption("Click a row in the table above, or pick a week here, to see the daily balances and the cash events behind it.")
    picked = st.selectbox("Week to inspect", range(len(options)), index=default, format_func=lambda i: options[i], key="week_pick")
    idx = table_selection[0] if table_selection else picked
    if table_selection:
        st.caption("Showing the week selected in the table.")
    w = weeks[idx]
    a, b, c = st.columns(3)
    a.metric("End-of-week closing", format_vnd(w["closing_vnd"]), delta=f"Alert: {label(w['alert_color'])}", delta_color="off")
    b.metric("Lowest day", format_vnd(w["min_daily_vnd"]), delta=format_dmy(w["min_daily_date"]), delta_color="off")
    c.metric("Worst daily alert", label(w["worst_daily_alert_color"]), delta=f"{w['negative_days']} negative day(s)", delta_color="off")
    st.markdown(f"**Daily balances, week {w['week_number']}** (VND million)")
    daily = daily_frame(res, w["week_number"])
    if daily.empty:
        st.info("Daily rows are not available for this run (weekly-only payload).")
    else:
        apply = daily.style.format({c: "{:,.3f}" for c in daily.columns if c.endswith("(VND m)")})
        apply = (apply.map if hasattr(apply, "map") else apply.applymap)(
            lambda v: f"background-color: {ALERT_COLOURS.get(v, '')}; color: #000000; font-weight: 600", subset=["Alert"])
        st.dataframe(apply, hide_index=True, width="stretch")
    st.markdown(f"**Cash events dated in week {w['week_number']}** (VND million; every row traces to its source)")
    events = events_frame(res, w["week_number"])
    if events.empty:
        st.info("No dated cash events fall in this week." if res["cash_events"] else "Cash events are not included in this run (weekly-only payload).")
    else:
        st.dataframe(events.style.format({"Amount (VND m)": "{:,.3f}"}), hide_index=True, width="stretch")
        st.caption("Estimated dates are not customer commitments. 'Moved to first day' marks items already past due that are placed on the first forecast day (an assumption).")


def render_forecast_tab(res: dict[str, Any]) -> None:
    st.markdown(header_line(res))
    s = res["summary"]
    if s["status"] in ("missing_data", "invalid_data"):
        st.error(f"The forecast could not be produced ({s['status'].replace('_', ' ')}). No figures are shown because they would not be reliable.")
        for issue in res["data_quality"]["issues"]:
            if issue["severity"] in ("error", "warning"):
                st.write(f"- {issue['message']}")
        return
    if res["meta"]["data_is_synthetic"]:
        st.info(FORECAST_NOTICE)
    render_cards(res)
    st.subheader("13-week schedule" if res["summary"]["horizon_weeks"] == 13 else f"{res['summary']['horizon_weeks']}-week schedule")
    st.caption("Closing balance and lowest day are separate: a week can end healthy and still contain a day below zero. Amounts in VND million.")
    event = st.dataframe(styled_weekly(weekly_frame(res)), hide_index=True, width="stretch", on_select="rerun",
                         selection_mode="single-row", key="week_table")
    rows = list(getattr(getattr(event, "selection", None), "rows", []) or [])
    render_week_drilldown(res, rows)
    narrative = generate_forecast_narrative(res, "")  # deterministic template over the same facts (no model call in the UI)
    st.subheader("Explanation")
    for key in ("overview", "critical_periods", "drivers", "assumptions_and_limits"):
        if narrative["sections"].get(key):
            st.markdown(narrative["sections"][key])
    with st.expander("Assumptions, data quality and reconciliation"):
        for a in res["inputs"]["assumptions"]:
            st.write(f"- {a['text']}")
        rec = res["reconciliation"]
        st.write(f"**Reconciliation:** {rec['status']} (cash difference {rec['cash_delta_vnd']} VND, weekly vs daily difference {rec['weekly_daily_delta_vnd']} VND; tolerance 1 VND).")
        st.write(f"**Alert rules:** yellow up to {res['inputs']['yellow_upper']:.0%} of the buffer, orange up to {res['inputs']['orange_upper']:.0%}, "
                 "red above that or when cash is negative (project thresholds, not an industry standard).")
        for issue in res["data_quality"]["issues"]:
            st.write(f"- [{issue['severity']}] {issue['code']}: {issue['message']}")
        st.caption(f"Run {res['meta']['run_id']} · schema {res['schema_version']} · formulas {res['formula_version']} · sources {', '.join(res['meta']['source_files'])}")


# ------------------------------------------------------------------------------------------------
# Page
# ------------------------------------------------------------------------------------------------
def main() -> None:
    st.set_page_config(page_title="SME Liquidity Copilot", layout="wide")
    st.title("SME Liquidity Copilot")
    st.caption("Working-capital diagnosis and 13-week cash forecast. Diagnostic suggestions only; not a credit decision.")
    with st.sidebar:
        st.header("Forecast settings")
        firm = st.selectbox("Firm", FIRMS, key="firm")
        weeks = st.slider("Forecast weeks", 1, 13, 13, key="weeks")
        scenario = st.radio("Scenario", ("Base", "Estimated receipts later than planned"), key="scenario")
        extra = st.number_input("Days later", 1, 90, 7, key="extra_days", disabled=scenario == "Base")
        override = st.checkbox("Override the cash buffer", key="override")
        buffer = st.number_input("Cash buffer (VND)", 0, 10_000_000_000, 500_000_000, 50_000_000, key="buffer", disabled=not override)
    tab_cash, tab_wc, tab_chat = st.tabs(["Cash Forecast", "Working Capital", "Ask the Copilot"])
    with tab_cash:
        try:
            res = load_forecast(firm, int(weeks), "base" if scenario == "Base" else "estimated_receipts_late", int(extra), int(buffer) if override else None)
        except Exception as exc:  # noqa: BLE001 - show a clear English error instead of a stack trace
            st.error(f"The forecast could not be produced: {exc}")
        else:
            render_forecast_tab(res)
    with tab_wc:
        wc = get_working_capital(firm)["result"]
        metrics = {m["id"]: m for m in wc["result_metrics"]}
        cols = st.columns(5)
        for col, (key, name) in zip(cols, (("dso_days", "DSO"), ("dio_days", "DIO"), ("dpo_days", "DPO"), ("ccc_days", "CCC"), ("twc_vnd", "Net trade working capital"))):
            m = metrics.get(key)
            col.metric(name, "n/a" if m is None or m["display_value"] is None else m["display_value"])
        if st.button("Explain where cash is stuck", key="explain_wc"):
            st.markdown(run_agent("Why is my cash stuck?", firm))
    with tab_chat:
        question = st.text_input("Ask in English", placeholder="Will I run short of cash in the next 13 weeks?", key="question")
        if st.button("Ask", key="ask") and question.strip():
            st.markdown(run_agent(question.strip(), firm))


if __name__ == "__main__":  # `streamlit run` and AppTest execute the script as __main__; tests can import the helpers
    main()
