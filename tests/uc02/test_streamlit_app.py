"""Streamlit UI tests (headless, no browser): metric cards, 13-week table with alert colours, week drill-down, English only, dd/mm/yyyy."""
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

pytest.importorskip("streamlit")
import streamlit as st  # noqa: E402
from streamlit.testing.v1 import AppTest  # noqa: E402

import app as ui  # noqa: E402
from src.agent.tools import run_forecast  # noqa: E402

VI = re.compile("[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]", re.IGNORECASE)
APP = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "app.py")


@pytest.fixture(scope="module")
def res():
    return run_forecast("F01").model_dump(mode="json")


@pytest.fixture(autouse=True)
def _isolated(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENAI_API_KEY", "")
    log = tmp_path / "audit.jsonl"
    monkeypatch.setattr("src.core.logger.AUDIT_LOG_PATH", log)


def _run() -> AppTest:
    at = AppTest.from_file(APP, default_timeout=90).run()
    assert not at.exception, [str(e.value)[:200] for e in at.exception]
    return at


def test_the_page_shows_the_four_metric_cards_with_dd_mm_yyyy_dates():
    at = _run()
    cards = {m.label: m for m in at.metric}
    assert cards["Opening Cash"].value == "VND 1.20 billion"
    assert cards["Min Cash Date"].value == "18/12/2026" and cards["Min Cash Date"].delta == "Lowest balance minus VND 619.322 million"
    assert cards["First Deficit Date"].value == "23/10/2026" and cards["First Deficit Date"].delta == "Below the buffer from 04/10/2026"
    assert cards["Max Deficit Amount"].value == "VND 1.119 billion" and cards["Max Deficit Amount"].delta == "Gap to zero VND 619.322 million"
    assert [t.label for t in at.tabs] == ["Cash Forecast", "Working Capital", "Ask the Copilot"]


def test_the_weekly_table_has_13_weeks_and_labelled_alert_colours(res):
    df = ui.weekly_frame(res)
    assert len(df) == 13 and list(df["Week"]) == list(range(1, 14))
    assert list(df["End-of-week alert"][:5]) == ["Orange", "Green", "Green", "Red", "Green"]
    assert list(df["Worst daily alert"][:5]) == ["Orange", "Orange", "Red", "Red", "Red"]  # week end and worst day are separate columns
    assert df.loc[3, "Dates"] == "22/10/2026–28/10/2026" and df.loc[3, "Lowest day"] == "23/10/2026" and df.loc[3, "Lowest day (VND m)"] == pytest.approx(-378.917)
    html = ui.styled_weekly(df).to_html()
    for colour in ("#ff9999", "#f8cbad", "#c6efce"):  # red, orange, green are painted; the text label is always in the cell too
        assert colour in html
    assert "Red" in html and "Green" in html


def test_drill_down_opens_on_the_first_week_with_an_alert_and_shows_its_days_and_events():
    at = _run()
    assert at.selectbox(key="week_pick").value == 0
    dfs = {i: d.value for i, d in enumerate(at.dataframe)}
    assert any("Gap to zero (VND m)" in d.columns and len(d) == 7 for d in dfs.values())


def test_selecting_week_4_shows_the_negative_day_and_the_payroll_event():
    at = _run()
    at.selectbox(key="week_pick").set_value(3).run()
    assert not at.exception
    cards = {m.label: m for m in at.metric}
    assert cards["End-of-week closing"].value == "VND 133.358 million" and cards["Lowest day"].value == "minus VND 378.917 million"
    assert cards["Lowest day"].delta == "23/10/2026" and cards["Worst daily alert"].value == "Red"
    daily = next(d.value for d in at.dataframe if "Gap to zero (VND m)" in d.value.columns)
    assert list(daily["Date"]) == [f"{d}/10/2026" for d in range(22, 29)]
    row = daily[daily["Date"] == "23/10/2026"].iloc[0]
    assert row["Closing (VND m)"] == pytest.approx(-378.917) and row["Alert"] == "Red" and row["Alert rule"] == "T2-ALERT-RED-NEGATIVE"
    events = next(d.value for d in at.dataframe if "Date type" in d.value.columns)
    payroll = events[(events["Date"] == "23/10/2026") & (events["Category"] == "Payroll")].iloc[0]
    assert payroll["Direction"] == "Out" and payroll["Amount (VND m)"] == pytest.approx(1000.0) and payroll["Date type"] == "Planned"
    supplier = events[events["Category"] == "Supplier payment"].iloc[0]
    assert supplier["Counterparty"].endswith("(F02)") and not VI.search(supplier["Counterparty"])


def test_events_are_traceable_and_estimated_dates_are_labelled(res):
    ev = ui.events_frame(res, 1)
    assert not ev.empty and set(ev["Source"].str.split(":").str[0]) <= {"purchase_invoice", "sales_invoice", "plan"}
    assert "Estimated" in " ".join(ui.events_frame(res, 4)["Date type"]) and "Yes" in set(ev["Moved to first day"])
    assert ui.events_frame(res, 1)["Date"].str.fullmatch(r"\d\d/\d\d/\d{4}").all()
    assert ui.daily_frame(res, 13)["Date"].tolist()[-1] == "30/12/2026"


def test_the_page_is_english_only_and_free_of_other_date_formats():
    at = _run()
    texts = [m.value for m in at.markdown] + [m.value for m in at.caption] + [i.value for i in at.info] + [m.label for m in at.metric] + [m.value for m in at.metric]
    blob = "\n".join(str(t) for t in texts)
    assert blob and not VI.search(blob)
    assert not re.search(r"\b20\d\d-\d\d-\d\d\b", blob) and not re.search(r"\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b", blob)
    assert "Explanation" in [s.value for s in at.subheader] and "not a loan recommendation or a credit decision" in blob


def test_the_scenario_and_the_firm_can_be_changed():
    at = _run()
    at.radio(key="scenario").set_value("Estimated receipts later than planned").run()
    assert not at.exception and {m.label: m for m in at.metric}["First Deficit Date"].value == "14/10/2026"
    at.radio(key="scenario").set_value("Base").run()
    at.selectbox(key="firm").set_value("F02").run()
    cards = {m.label: m for m in at.metric}
    assert cards["First Deficit Date"].value == "No deficit" and cards["Max Deficit Amount"].value == "VND 0" and cards["Min Cash Date"].value == "06/10/2026"


def test_the_buffer_override_and_the_horizon_are_applied():
    at = _run()
    at.checkbox(key="override").check().run()
    at.number_input(key="buffer").set_value(800_000_000).run()
    assert not at.exception and {m.label: m for m in at.metric}["Max Deficit Amount"].value == "VND 1.419 billion"
    at.slider(key="weeks").set_value(4).run()
    assert not at.exception and len(ui.weekly_frame(run_forecast("F01", weeks=4).model_dump(mode="json"))) == 4
    assert "4-week schedule" in [s.value for s in at.subheader]


def test_a_blocked_forecast_shows_what_is_missing_and_no_figures(monkeypatch, tmp_path):
    from src.uc02_cash_forecast import cash_forecast as cf
    monkeypatch.setattr(cf, "PLANS_PATH", tmp_path / "missing.csv")
    st.cache_data.clear()  # the page caches forecasts; drop earlier results so the blocked run is really calculated
    at = _run()
    assert any("could not be produced (missing data)" in e.value for e in at.error)
    assert all("Week" not in d.value.columns for d in at.dataframe)  # no schedule is drawn for a blocked run
    st.cache_data.clear()


def test_the_working_capital_tab_shows_the_uc01_cards():
    at = _run()
    cards = {m.label: m.value for m in at.metric}
    assert (cards["DSO"], cards["DIO"], cards["DPO"], cards["CCC"], cards["Net trade working capital"]) == ("50.0", "43.9", "24.8", "69.0", "6,410,678,000")


def test_the_chat_tab_answers_in_english():
    at = _run()
    at.text_input(key="question").set_value("Will I run short of cash in the next 13 weeks?").run()
    at.button(key="ask").click().run()
    assert not at.exception
    blob = "\n".join(m.value for m in at.markdown)
    assert "Tools used: forecast_cash" in blob and "01/10/2026 to 30/12/2026" in blob and not VI.search(blob)
