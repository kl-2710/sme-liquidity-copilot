"""Tests for src/agent/router.py (pure English intent router) and the agent. Run from the project root:

    python -m pytest tests/agent/test_router.py -v
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from src.agent.router import (  # noqa: E402
    INTENT_DICTIONARY, OUT_OF_SCOPE_HARD, AuthContext, clean_text, route_intent,
)

AUTH = AuthContext(firm_id="F01", session_id="test-session")
WC, AR, INV, AP, SENS, OOS = "WORKING_CAPITAL", "RECEIVABLES", "INVENTORY", "PAYABLES", "SENSITIVITY", "OUT_OF_SCOPE"
CF = "CASH_FORECAST"

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
    ("Prepare my audit report", OOS), ("When is payroll due?", OOS), ("Forecast my revenue for next year", OOS),
    ("What are my financing options?", OOS),
    # Not supported / unknown
    ("Hello", "UNKNOWN"), ("What is the weather in Hanoi?", "UNKNOWN"), ("Tell me a joke", "UNKNOWN"), ("", "UNKNOWN"),
    ("tai sao tien bi dong", "UNKNOWN"),
    ("Tại sao tiền của tôi bị đọng?", "UNSUPPORTED_LANGUAGE"), ("Cho tôi biết công nợ phải thu", "UNSUPPORTED_LANGUAGE"),
    # UC-02 cash forecast (Tier 1)
    ("Will I run short of cash in the next 13 weeks?", CF), ("Show my cash forecast", CF), ("cash projection", CF),
    ("Is there a cash deficit coming up?", CF), ("What is my weekly cash balance?", CF), ("Any cash shortage ahead?", CF),
    ("Where is my cash gap?", CF), ("Give me a 13 week forecast", CF), ("Forecast my cash flow for the next quarter", CF),
    ("Will my cash fall below the buffer?", CF), ("Show me my future liquidity", CF), ("Any cash flow warning for me?", CF),
    ("Show my cash forecsat", CF), ("What is my cash projecton?", CF), ("Will I run out of cash?", CF),
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


def test_financing_next_to_diagnosis_adds_boundary_terms_but_still_answers():
    r = route_intent("Why is my cash stuck and what are my financing options?", AUTH)
    assert r["intent"] == WC and r["in_scope"] and "financing options" in r["out_of_scope_terms"]


def test_diagnosis_plus_forecast_question_goes_to_the_forecast_task_and_keeps_the_other_as_secondary():
    r = route_intent("Why is my cash stuck and will I run short of cash in the next 3 months?", AUTH)
    assert r["intent"] == CF and WC in r["secondary_intents"]
    assert (r["tool"], r["tier"], r["tool_args"]) == ("forecast_cash", 1, {"firm_id": "F01"})


def test_forecast_horizon_is_parsed_and_capped_at_13_weeks():
    assert route_intent("Show my cash forecast for the next 8 weeks", AUTH)["tool_args"] == {"firm_id": "F01", "weeks": 8}
    r = route_intent("Show my 26 week cash forecast", AUTH)
    assert r["tool_args"] == {"firm_id": "F01", "weeks": 13} and r["requested_weeks"] == 26
    assert route_intent("Show my cash forecast", AUTH)["tool_args"] == {"firm_id": "F01"}


def test_forecast_keywords_are_not_out_of_scope_but_other_forecasts_are():
    assert route_intent("Forecast my revenue", AUTH)["intent"] == OOS
    assert route_intent("Can I borrow money to cover my cash gap?", AUTH)["intent"] == OOS  # hard trap still wins


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


@pytest.mark.parametrize("query", ["Hello", "Tại sao tiền bị đọng", "Forecast my revenue", "What are my financing options?", "payroll"])
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

from src.agent import agent  # noqa: E402

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


def test_financing_question_is_answered_with_a_boundary_note():
    text, _ = _ask("Why is my cash stuck and what are my financing options?")
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
    from src.agent.tools import get_working_capital
    return agent.build_facts(get_working_capital("F01")["result"])


def _draft(p1="[[FACT:ccc]] and TWC [[FACT:twc]].", p2="Stock [[FACT:item_value]].", p3="Compare DSO [[FACT:dso]]."):
    sec = lambda k, t: {"section_key": k, "text": t, "claims": [{"fact_ids": list(set(re.findall(r"FACT:(\w+)", t))), "claim_type": "observation"}]}  # noqa: E731
    return {"sections": [sec("p1", p1), sec("p2", p2), sec("p3", p3)]}


def _run_llm(draft):
    from src.agent.tools import get_working_capital
    wc = get_working_capital("F01")["result"]
    route = route_intent("Why is my cash stuck?", AUTH)
    return agent.generate_narrative(wc, route, "Why is my cash stuck?", llm_call=lambda m: json.dumps(draft))


def _wc():
    from src.agent.tools import get_working_capital
    return get_working_capital("F01")["result"]


def _complete_draft(extra=None):
    """The reference draft itself, as a model would return it when it keeps every token; `extra` appends text to a paragraph."""
    ref = agent.wc_reference(agent.build_facts(_wc()))
    return {"sections": [{"section_key": k, "text": ref[k] + (extra or {}).get(k, ""), "claims": []} for k in ("p1", "p2", "p3")]}


def test_valid_llm_draft_is_released_with_server_numbers_and_fixed_sentences():
    out = _run_llm(_complete_draft())
    assert out["generation_mode"] == "llm" and "VND 6.41 billion" in out["text"]
    for fixed in ("A large balance alone does not prove slow payment", "Book value is not recoverable cash",
                  "customer-owned processing goods (HGC) is excluded from owned inventory; it is not trapped capital of the company",
                  "a DPO of 24.8 days should not be read as efficient use of supplier credit",
                  "one day of DSO is equivalent to about VND 98.3 million of capital"):
        assert fixed in out["text"], fixed
    assert out["text"].rstrip().endswith("These are diagnostic suggestions, not a credit decision.")


def test_required_tokens_cover_every_overdue_buyer_and_supplier_with_days_past_due():
    need = agent.required_tokens(agent.build_facts(_wc()))
    assert {"b1_overdue", "b1_dpd", "b2_overdue", "b2_dpd", "ar_max_dpd"} <= set(need["p1"])
    assert {"item_value", "item_age", "ap_overdue", "s1_overdue", "s1_dpd", "s2_overdue", "s2_dpd"} <= set(need["p2"])


def test_a_draft_that_omits_required_facts_is_replaced_by_the_complete_template():
    """Regression: a model draft without the HGC exclusion, per-supplier days late or the second buyer's (K3) lateness used to be released."""
    thin = {"sections": [{"section_key": k, "text": t, "claims": [{"fact_ids": re.findall(r"FACT:(\w+)", t), "claim_type": "observation"}]}
                         for k, t in (("p1", "[[FACT:ccc]] [[FACT:twc]]"), ("p2", "[[FACT:item_value]]"), ("p3", "[[FACT:dso]]"))]}
    out = _run_llm(thin)
    assert out["generation_mode"] == "deterministic_fallback"
    rules = {(v["rule_id"], v["detail"]) for e in out["violations"] for v in e["violations"]}
    assert ("NARRATIVE_INCOMPLETE", "missing s1_dpd") in rules and ("NARRATIVE_INCOMPLETE", "missing b2_dpd") in rules
    assert "customer-owned processing goods (HGC)" in out["text"] and "up to 11 days past due" in out["text"]


def test_a_doubled_unit_such_as_118_days_days_is_blocked():
    out = _run_llm(_complete_draft({"p2": " held [[FACT:item_age]] days"}))
    assert out["generation_mode"] == "deterministic_fallback"
    assert ("REPEATED_WORD", "days days") in {(v["rule_id"], v["detail"]) for e in out["violations"] for v in e["violations"]}
    assert "days days" not in out["text"] and agent.repeated_word("held for 118 days days.") == "days days" and agent.repeated_word("held 118 days.") is None


def test_stray_top_level_arguments_of_the_draft_tool_are_dropped(monkeypatch):
    """Regression: the model sent amount_vnd next to `details`, the tool failed once and the model had to retry."""
    call = SimpleNamespace(id="c1", function=SimpleNamespace(name="draft_action", arguments=json.dumps({
        "action_type": "payment_reminder", "amount_vnd": 871565000,
        "details": {"recipient": "Large Exporter K1", "subject": "Reminder", "body": "Please pay VND 871,565,000."}})))
    script = iter([SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=None, tool_calls=[call]))]),
                   SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="Done.", tool_calls=None))])])
    steps = []
    monkeypatch.setattr(agent, "_generate", lambda c, m: next(script))
    monkeypatch.setattr(agent, "_get_client", lambda: object())
    text = agent.run_agent("Draft a payment reminder for Large Exporter K1", "F01", on_step=lambda s, t, a, r: steps.append(r))
    assert len(steps) == 1 and steps[0].get("status") == "pending_approval" and "DRAFT-" in text and "[Error]" not in text
    assert "VND 817,756,000" in text and "871,565,000" not in text
    props = next(t for t in agent.TOOL_SCHEMAS if t["function"]["name"] == "draft_action")["function"]["parameters"]
    assert props["additionalProperties"] is False


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


def test_late_receipts_case_is_detected_only_inside_a_forecast_question():
    r = route_intent("Will I run short of cash if receipts are 7 days late?", AUTH)
    assert r["intent"] == CF and r["tool_args"] == {"firm_id": "F01", "case_id": "estimated_receipts_late", "extra_days": 7}
    r = route_intent("Will my cash fall below the buffer if customers pay later?", AUTH)
    assert r["tool_args"] == {"firm_id": "F01", "case_id": "estimated_receipts_late"}
    assert route_intent("Will I run short of cash in the next 13 weeks?", AUTH)["tool_args"] == {"firm_id": "F01", "weeks": 13}
    assert "case_id" not in route_intent("Which overdue buyers should I worry about?", AUTH)["tool_args"]
    assert route_intent("Cash forecast if receipts are 200 days late", AUTH)["tool_args"] == {"firm_id": "F01", "case_id": "estimated_receipts_late"}


def test_the_model_receives_the_reference_draft_without_the_sentences_the_system_adds():
    nb = agent.build_facts(_wc())
    payload = json.loads(agent.build_llm_messages(nb, "Why is my cash stuck?")[1]["content"])
    ref = payload["reference_draft"]
    assert set(ref) == {"p1", "p2", "p3"} and "[[FACT:ccc]]" in ref["p1"] and "[[FACT:s1_dpd]]" in ref["p2"] and "[[FACT:b2_dpd]]" in ref["p1"]
    blob = " ".join(ref.values())
    for fixed in ("does not prove slow payment", "Book value is not recoverable cash", "customer-owned processing goods", "efficient use of supplier credit",
                  "one day of DSO", "not a credit decision"):
        assert fixed not in blob, fixed
    used = set(re.findall(r"FACT:(\w+)", blob))
    assert {f["id"] for f in payload["facts"]} == used and "claims" not in json.dumps(payload["facts"])
    assert agent.check_answer(agent.normalize_wc_draft({"sections": [{"section_key": k, "text": v} for k, v in ref.items()]}), nb) == []  # the reference is itself valid


def test_a_paraphrase_without_claims_is_released_and_a_model_written_fixed_sentence_is_not_duplicated():
    ref = agent.wc_reference(agent.build_facts(_wc()))
    p3 = ref["p3"].replace("Suggested next step: verify", "A sensible next step is to verify")
    p2 = ref["p2"] + " Book value is not recoverable cash: recovery depends on reuse or resale demand."  # the model repeats a fixed sentence
    out = _run_llm({"p1": ref["p1"], "p2": p2, "p3": p3})  # plain p1/p2/p3 keys, no claims
    assert out["generation_mode"] == "llm" and "A sensible next step is to verify" in out["text"]
    assert out["text"].lower().count("book value is not recoverable cash") == 1
    assert out["text"].count("customer-owned processing goods (HGC) is excluded") == 1 and out["text"].count("not a credit decision") == 1
    assert "[[FACT" not in out["text"] and "Large Exporter K1" in out["text"]


def test_a_fact_that_is_not_in_the_reference_cannot_be_added():
    out = _run_llm(_complete_draft({"p3": " The cycle is [[FACT:dio_one_day]]."}))
    assert out["generation_mode"] == "deterministic_fallback"
    assert ("UNEXPECTED_FACT", "dio_one_day") in {(v["rule_id"], v["detail"]) for e in out["violations"] for v in e["violations"]}


def test_static_bucket_labels_are_not_mistaken_for_invented_numbers():
    ref = agent.wc_reference(agent.build_facts(_wc()))
    assert "1\u201330 day bucket" in ref["p1"] and "365-day" in ref["p3"]  # fixed wording with digits is part of the reference
    assert _run_llm(_complete_draft())["generation_mode"] == "llm"
    bad = _run_llm(_complete_draft({"p1": " It is 75 days."}))
    assert bad["generation_mode"] == "deterministic_fallback"