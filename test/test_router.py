"""Tests for src/router.py (pure English intent router). Run from the project root:

    python -m pytest tests/test_router.py -v
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.router import (  # noqa: E402
    INTENT_DICTIONARY, OUT_OF_SCOPE_HARD, AuthContext, clean_text, route_intent,
)

AUTH = AuthContext(firm_id="F01", session_id="test-session")
WC, AR, INV, AP, SENS, OOS = "WORKING_CAPITAL", "RECEIVABLES", "INVENTORY", "PAYABLES", "SENSITIVITY", "OUT_OF_SCOPE"

# (query, expected intent) -- short, long/natural, mildly misspelled, out-of-scope, non-English, unknown
CASES = [
    # Working capital & CCC
    ("Why is my cash stuck?", WC), ("working capital", WC), ("What is my cash conversion cycle?", WC),
    ("Explain CCC please", WC), ("Where is cash trapped in my business and how long does it stay there?", WC),
    ("Give me a working capital diagnosis for this quarter", WC), ("Is there a liquidity bottleneck in my company?", WC),
    ("What is my trade working capital?", WC), ("Show TWC", WC), ("How is our liquidity status right now?", WC),
    ("Why is my cash tied up?", WC), ("I think my cash is locked somewhere, can you tell me where?", WC),
    # Receivables & DSO
    ("Which overdue buyers should I worry about?", AR), ("How much accounts receivable do I have?", AR),
    ("What's my DSO?", AR), ("Show receivables aging", AR), ("I need the late payment details", AR),
    ("How many uncollected invoices are there?", AR), ("Explain the collection delay at my biggest buyer", AR),
    ("Show me my overdue receivables", AR), ("How many days sales outstanding do we have?", AR),
    ("Who owes me money right now?", AR),
    # Inventory & DIO
    ("Which inventory is slow moving stock?", INV), ("What is my DIO?", INV),
    ("How long are we holding stagnant inventory?", INV), ("Do we have obsolete stock?", INV),
    ("Show me finished goods aging", INV), ("Tell me about raw materials holding", INV),
    ("Is there an inventory backlog?", INV), ("Any dead stock in the warehouse?", INV),
    # Payables & DPO
    ("What is my DPO?", AP), ("How much do I owe suppliers?", AP), ("Any early payment discount I can use?", AP),
    ("Show overdue payables", AP), ("What are my vendor liabilities?", AP), ("How much supplier debt do we carry?", AP),
    ("Show accounts payable aging", AP),
    # Financial sensitivity
    ("What is the cash impact if I cut DSO by five days?", SENS), ("How much is my discount saving?", SENS),
    ("DSO sensitivity please", SENS), ("Show working capital optimization options", SENS),
    ("A DSO reduction of 5 days - what is the effect?", SENS),
    # Mild typos
    ("Why is my cahs stuck?", WC), ("Show me my working captial", WC), ("What is my cash converion cycle?", WC),
    ("Show recievables aging", AR), ("What is my days sales outstading?", AR), ("Show me my invetory", INV),
    ("Which slow movin stock is oldest?", INV), ("Show me payabels", AP),
    # Out of scope (keyword traps)
    ("Can I borrow money to pay suppliers?", OOS), ("I need credit approval for a new line", OOS),
    ("Start the loan disbursement for working capital", OOS), ("Help me with tax filing", OOS),
    ("Prepare my audit report", OOS), ("When is payroll due?", OOS), ("Forecast my cash flow for the next quarter", OOS),
    ("What are my financing options?", OOS),
    # Not supported / unknown
    ("Hello", "UNKNOWN"), ("What is the weather in Hanoi?", "UNKNOWN"), ("Tell me a joke", "UNKNOWN"), ("", "UNKNOWN"),
    ("tai sao tien bi dong", "UNKNOWN"),
    ("Tại sao tiền của tôi bị đọng?", "UNSUPPORTED_LANGUAGE"), ("Cho tôi biết công nợ phải thu", "UNSUPPORTED_LANGUAGE"),
    # Drafting (Tier 2)
    ("Draft a payment reminder for the largest overdue buyer", "DRAFT_ACTION"),
    ("Write an email reminding my buyer to pay", "DRAFT_ACTION"),
]


@pytest.mark.parametrize("query,expected", CASES)
def test_intent(query, expected):
    assert route_intent(query, AUTH)["intent"] == expected


def test_recognition_rate_is_above_95_percent():
    wrong = [(q, e, route_intent(q, AUTH)["intent"]) for q, e in CASES if route_intent(q, AUTH)["intent"] != e]
    rate = 1 - len(wrong) / len(CASES)
    assert len(CASES) >= 30 and rate > 0.95, f"{rate:.1%} correct; wrong: {wrong}"


@pytest.mark.parametrize("group,keyword", [(g, k) for g, ks in INTENT_DICTIONARY.items() for k in ks])
def test_every_dictionary_keyword_routes_to_its_group(group, keyword):
    assert route_intent(keyword, AUTH)["intent"] == group


@pytest.mark.parametrize("keyword", OUT_OF_SCOPE_HARD)
def test_every_out_of_scope_keyword_is_blocked(keyword):
    r = route_intent(keyword, AUTH)
    assert r["intent"] == OOS and r["tool"] is None and not r["in_scope"]


# ----- resolution rules -----
def test_out_of_scope_trap_beats_in_scope_words():
    r = route_intent("Can I borrow money against my receivables and working capital?", AUTH)
    assert r["intent"] == OOS and r["tool"] is None


def test_specific_focus_beats_generic_cash_words():
    r = route_intent("Why is my cash stuck in inventory?", AUTH)
    assert r["intent"] == INV and r["focus"] == [INV]


def test_two_specific_areas_are_both_kept_as_focus():
    r = route_intent("Show receivables and inventory", AUTH)
    assert r["focus"] == [AR, INV]


def test_all_three_areas_means_full_working_capital_view():
    assert route_intent("Show receivables, inventory and payables", AUTH)["intent"] == WC


def test_longest_phrase_wins_over_its_parts():
    r = route_intent("working capital optimization", AUTH)
    assert r["intent"] == SENS and [m["keyword"] for m in r["matched_keywords"]] == ["working capital optimization"]


def test_forecast_next_to_diagnosis_adds_boundary_terms_but_still_answers():
    r = route_intent("Why is my cash stuck and what will the cash flow forecast look like?", AUTH)
    assert r["intent"] == WC and r["in_scope"] and "cash flow forecast" in r["out_of_scope_terms"]


# ----- security / tool binding -----
@pytest.mark.parametrize("query", ["Why is my cash stuck?", "What is my DSO?", "Show payables", "Any dead stock?",
                                   "DSO reduction effect"])
def test_in_scope_binds_tier0_tool_to_auth_firm(query):
    r = route_intent(query, AUTH)
    assert (r["tool"], r["tier"], r["tool_args"]) == ("get_working_capital", 0, {"firm_id": "F01"})


def test_firm_id_in_text_is_ignored_and_flagged():
    r = route_intent("Why is my cash stuck at F02?", AUTH)
    assert r["tool_args"] == {"firm_id": "F01"} and r["firm_id_override_ignored"] is True


def test_firm_id_matching_the_session_is_not_flagged():
    assert route_intent("Why is my cash stuck at F01?", AUTH)["firm_id_override_ignored"] is False


def test_other_session_firm_is_used():
    r = route_intent("F01 working capital", AuthContext(firm_id="F03"))
    assert r["tool_args"] == {"firm_id": "F03"}


def test_without_auth_context_no_firm_id_is_invented():
    r = route_intent("Why is my cash stuck?")
    assert r["tool_args"] == {} and r["auth_bound"] is False


def test_drafting_is_tier2_and_never_sends():
    r = route_intent("Draft a payment reminder for K1", AUTH)
    assert (r["intent"], r["tool"], r["tier"]) == ("DRAFT_ACTION", "draft_action", 2)


@pytest.mark.parametrize("query", ["Hello", "Tại sao tiền bị đọng", "Forecast my cash flow", "payroll"])
def test_unsupported_requests_never_call_a_tool(query):
    r = route_intent(query, AUTH)
    assert r["tool"] is None and r["tool_args"] == {} and r["in_scope"] is False


def test_vietnamese_is_rejected_even_with_english_keywords():
    assert route_intent("Why is my cash stuck? Tại sao", AUTH)["intent"] == "UNSUPPORTED_LANGUAGE"


# ----- cleaning -----
def test_clean_text_normalises_case_punctuation_and_spaces():
    assert clean_text("  Why's   my CASH-stuck?!  ") == "why s my cash stuck"


def test_non_string_input_is_safe():
    assert route_intent(None, AUTH)["intent"] == "UNKNOWN"  # type: ignore[arg-type]


# =====================================================================================
# End-to-end checks of the English agent (no API key needed: deterministic narrative)
# =====================================================================================
import json  # noqa: E402
import re  # noqa: E402
from types import SimpleNamespace  # noqa: E402

from src import agent  # noqa: E402

VI = re.compile("[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]", re.IGNORECASE)
ONE_DAY = "one day of DSO is equivalent to about VND 98.3 million of capital; this is a conversion indicator, not guaranteed immediate cash."


@pytest.fixture(autouse=True)
def _no_api_key(monkeypatch):
    monkeypatch.setattr(agent, "OPENAI_API_KEY", "")
    monkeypatch.setattr(agent, "_client", None)


def _ask(q, firm="F01"):
    steps = []
    return agent.run_agent(q, firm, on_step=lambda s, t, a, r: steps.append((t, a))), steps


@pytest.mark.parametrize("firm", ["F01", "F02", "F03"])
def test_narrative_is_pure_english_for_every_firm(firm):
    text, _ = _ask("Why is my cash stuck?", firm)
    assert not VI.search(text) and "$" not in text and "USD" not in text


def test_f01_three_paragraph_framework_and_golden_numbers():
    text, steps = _ask("Why is my cash stuck?")
    blocks = text.split("\n\n")
    assert len(blocks) == 4 and blocks[0].startswith("Note: this analysis uses synthetic")  # notice + 3 paragraphs
    for must in ("69.0 days", "DSO 50.0 days", "DIO 43.9 days", "DPO 24.8 days", "VND 6.41 billion", "79.2%", "39.6 days",
                 "17.7%", "VND 871.6 million", "1–30 day bucket", "up to 11 days past due", "VND 2.6 billion", "HGC",
                 "VND 341.2 million", "2% early payment discount", "VND 4.5 million", "3 Oct 2026", "32.0–47.5 days"):
        assert must in text, must
    assert ONE_DAY in blocks[1]
    assert "Suggested next step" in blocks[3] and blocks[3].endswith("These are diagnostic suggestions, not a credit decision.")
    assert steps == [("get_working_capital", {"firm_id": "F01"})]  # Tier 0, firm from the session


def test_forecast_question_is_answered_with_a_boundary_note():
    text, _ = _ask("Why is my cash stuck and what will the cash flow forecast look like?")
    assert "69.0 days" in text and "outside this working-capital diagnosis" in text


@pytest.mark.parametrize("q,key", [("Can I borrow money?", "OUT_OF_SCOPE"), ("Hello", "UNKNOWN"),
                                   ("Tại sao tiền bị đọng?", "UNSUPPORTED_LANGUAGE")])
def test_unsupported_requests_return_english_reply_and_call_no_tool(q, key):
    text, steps = _ask(q)
    assert text == agent.STATIC_REPLIES[key] and steps == [] and not VI.search(text)


def test_other_firm_in_text_is_ignored_and_session_firm_data_is_used():
    text, steps = _ask("Why is my cash stuck at F02?")
    assert "69.0 days" in text and "limited to firm F01" in text and steps[0][1] == {"firm_id": "F01"}


@pytest.mark.parametrize("q,present,absent", [
    ("What is my DIO?", "the long-held stock before drawing", "overdue receivables"),
    ("Which inventory is slow moving?", "In inventory, the largest slow-moving line", "supplier balances"),
    ("Show overdue payables", "verify the overdue supplier balances before", "long-held stock"),
    ("Show me my overdue receivables", "Receivables are concentrated in Large Exporter K1", "In inventory"),
    ("What is the cash impact if I cut DSO by five days?", ONE_DAY, "In inventory")])
def test_focused_questions_answer_only_the_requested_area(q, present, absent):
    text, _ = _ask(q)
    assert present in text and absent not in text and text.rstrip().endswith("not a credit decision.")


# ----- LLM route (simulated model) -----
def _facts():
    from src.tools import get_working_capital
    return agent.build_facts(get_working_capital("F01")["result"])


def _draft(p1="[[FACT:ccc]] and TWC [[FACT:twc]].", p2="Stock [[FACT:item_value]].", p3="Compare DSO [[FACT:dso]]."):
    sec = lambda k, t: {"section_key": k, "text": t, "claims": [{"fact_ids": list(set(re.findall(r"FACT:(\w+)", t))), "claim_type": "observation"}]}  # noqa: E731
    return {"sections": [sec("p1", p1), sec("p2", p2), sec("p3", p3)]}


def _run_llm(draft):
    from src.tools import get_working_capital
    wc = get_working_capital("F01")["result"]
    route = route_intent("Why is my cash stuck?", AUTH)
    return agent.generate_narrative(wc, route, "Why is my cash stuck?", llm_call=lambda m: json.dumps(draft))


def test_valid_llm_draft_is_released_with_server_numbers_and_fixed_sentences():
    out = _run_llm(_draft())
    assert out["generation_mode"] == "llm" and "VND 6.41 billion" in out["text"] and ONE_DAY in out["text"]
    assert out["text"].rstrip().endswith("These are diagnostic suggestions, not a credit decision.")


@pytest.mark.parametrize("bad,rule", [
    ("CCC is 70 days. [[FACT:twc]]", "UNSUPPORTED_NARRATIVE_FACT"),
    ("Cash cycle [[FACT:ccc]] and [[FACT:twc]]; please see the 13-week forecast.", "SCOPE_LEAK_UC1"),
    ("The firm is dangerous and [[FACT:twc]].", "NARRATIVE_SEMANTIC_ERROR"),
    ("Công ty có [[FACT:twc]].", "NON_ENGLISH"),
    ("Use this collection plan for [[FACT:twc]].", "PLAN_OUT_OF_SCOPE")])
def test_bad_llm_drafts_are_blocked_and_fall_back(bad, rule):
    out = _run_llm(_draft(p1=bad))
    assert out["generation_mode"] == "deterministic_fallback"
    assert rule in {v["rule_id"] for e in out["violations"] for v in e.get("violations", [])}
    assert "VND 6.41 billion" in out["text"] and not VI.search(out["text"])


def test_unknown_fact_is_blocked():
    out = _run_llm(_draft(p2="Stock [[FACT:made_up]]."))
    assert out["generation_mode"] == "deterministic_fallback"


# ----- drafting loop (Tier 2) with a simulated model -----
def test_payment_reminder_draft_forces_verified_amount_in_english(monkeypatch):
    call = lambda name, args: SimpleNamespace(id="c1", function=SimpleNamespace(name=name, arguments=json.dumps(args)))  # noqa: E731
    body = "Dear Large Exporter K1, your overdue balance is VND 871,565,000. Please pay soon."
    script = iter([
        SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=None, tool_calls=[call("draft_action", {
            "action_type": "payment_reminder", "details": {"recipient": "Nhà xuất khẩu Lớn K1", "subject": "Payment reminder", "body": body}})]))]),
        SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=f"Draft ready: {body}", tool_calls=None))])])
    monkeypatch.setattr(agent, "_generate", lambda c, m: next(script))
    monkeypatch.setattr(agent, "_get_client", lambda: object())
    text = agent.run_agent("Draft a payment reminder for the largest overdue buyer", "F01")
    assert "VND 817,756,000" in text and "871,565,000" not in text and "waiting for the owner's approval" in text
    assert not VI.search(text) and "Large Exporter K1" in text


def test_blocked_draft_reason_is_english(monkeypatch):
    call = SimpleNamespace(id="c1", function=SimpleNamespace(name="draft_action", arguments=json.dumps({
        "action_type": "payment_reminder", "details": {"recipient": "Unknown Co", "body": "Hi"}})))
    script = iter([SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=None, tool_calls=[call]))]),
                   SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="I could not draft it.", tool_calls=None))])])
    monkeypatch.setattr(agent, "_generate", lambda c, m: next(script))
    monkeypatch.setattr(agent, "_get_client", lambda: object())
    text = agent.run_agent("Write an email reminding Unknown Co to pay", "F01")
    assert "blocked" in text.lower() and not VI.search(text)


@pytest.mark.parametrize("name", ["Large Exporter K1", "large exporter k1", "K1", "Nhà xuất khẩu Lớn K1"])
def test_english_recipient_names_resolve_to_the_buyer_in_the_data(monkeypatch, name):
    call = SimpleNamespace(id="c1", function=SimpleNamespace(name="draft_action", arguments=json.dumps({
        "action_type": "payment_reminder", "details": {"recipient": name, "subject": "Reminder", "body": "Overdue VND 1,000."}})))
    script = iter([SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=None, tool_calls=[call]))]),
                   SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="Draft ready.", tool_calls=None))])])
    monkeypatch.setattr(agent, "_generate", lambda c, m: next(script))
    monkeypatch.setattr(agent, "_get_client", lambda: object())
    text = agent.run_agent("Draft a payment reminder for Large Exporter K1", "F01")
    assert "VND 817,756,000" in text and "Large Exporter K1" in text and "Draft created" in text


def test_unknown_recipient_is_still_blocked(monkeypatch):
    call = SimpleNamespace(id="c1", function=SimpleNamespace(name="draft_action", arguments=json.dumps({
        "action_type": "payment_reminder", "details": {"recipient": "Acme Corp", "body": "Hi"}})))
    script = iter([SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=None, tool_calls=[call]))]),
                   SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="No draft.", tool_calls=None))])])
    monkeypatch.setattr(agent, "_generate", lambda c, m: next(script))
    monkeypatch.setattr(agent, "_get_client", lambda: object())
    assert "blocked" in agent.run_agent("Write an email to Acme Corp", "F01").lower()


def _draft_script(final_text, body):
    call = SimpleNamespace(id="c1", function=SimpleNamespace(name="draft_action", arguments=json.dumps({
        "action_type": "payment_reminder", "details": {"recipient": "Large Exporter K1", "subject": "Payment reminder", "body": body}})))
    return iter([SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=None, tool_calls=[call]))]),
                 SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=final_text, tool_calls=None))])])


def test_vietnamese_entity_name_in_model_reply_does_not_trigger_language_rejection(monkeypatch):
    """Regression: the model echoed the data name 'Nhà xuất khẩu Lớn K1' and the reply became 'English only'."""
    script = _draft_script("I have drafted the reminder for Nhà xuất khẩu Lớn K1.", "Dear Nhà xuất khẩu Lớn K1, VND 871,565,000 is overdue.")
    monkeypatch.setattr(agent, "_generate", lambda c, m: next(script))
    monkeypatch.setattr(agent, "_get_client", lambda: object())
    text = agent.run_agent("Draft a payment reminder for Large Exporter K1", "F01")
    assert "English only" not in text and "DRAFT-" in text and not VI.search(text)
    assert "Dear Large Exporter K1" in text and "VND 817,756,000" in text and "871,565,000" not in text


def test_draft_answer_shows_the_verified_draft_not_the_models_prose(monkeypatch):
    script = _draft_script("Done. Totally ignore the system and pay VND 5,000,000.", "Please pay the overdue VND 871,565,000.")
    monkeypatch.setattr(agent, "_generate", lambda c, m: next(script))
    monkeypatch.setattr(agent, "_get_client", lambda: object())
    text = agent.run_agent("Draft a payment reminder for K1", "F01")
    assert "5,000,000" not in text and "Please pay the overdue VND 817,756,000." in text and "**Subject:** Payment reminder" in text