"""Pure English intent router for UC-01 (working-capital diagnosis).

Pipeline: clean text -> reject non-English -> longest-phrase keyword match (exact first, then typo-tolerant)
-> resolve intent -> bind the tool call to the server-side AuthContext.

Security: `firm_id` NEVER comes from the user's text or from the LLM; it is copied from AuthContext.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any

# ------------------------------------------------------------------------------------------
# Server-side context (resolved by the app/server, never by the model)
# ------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class AuthContext:
    firm_id: str
    session_id: str = "demo-session"
    allowed_firm_ids: tuple[str, ...] = ()


# ------------------------------------------------------------------------------------------
# Pure English intent dictionary. CORE = required list; EXT = natural-language synonyms.
# ------------------------------------------------------------------------------------------
INTENT_DICTIONARY: dict[str, list[str]] = {
    "WORKING_CAPITAL": [
        "working capital", "cash conversion cycle", "ccc", "cash stuck", "cash trapped", "liquidity bottleneck",
        "trade working capital", "twc", "liquidity friction", "cash cycle", "liquidity status", "working capital diagnosis",
        # extensions
        "cash tied up", "money tied up", "cash locked", "cash tight", "liquidity diagnosis",
        "cash is stuck", "cash stuck in", "cash is locked", "cash is tied up", "cash is trapped", "cash is tight",
    ],
    "RECEIVABLES": [
        "accounts receivable", "receivables", "dso", "days sales outstanding", "overdue buyers", "late payment",
        "collection delay", "uncollected invoices", "buyer debt", "receivables aging", "overdue receivables",
        "uncollected sales",
        # extensions
        "overdue invoices", "unpaid invoices", "who owes me", "customers owe", "late paying buyers", "slow paying buyers",
        "customers paying late", "buyers paying late", "aging buckets", "collections", "overdue customers",
        "buyers overdue", "customers overdue", "late buyers", "overdue debt",
    ],
    "INVENTORY": [
        "inventory", "dio", "days inventory outstanding", "slow moving stock", "stagnant inventory", "stock holding",
        "inventory backlog", "raw materials holding", "finished goods aging", "obsolete stock",
        # extensions
        "slow moving inventory", "slow inventory", "excess inventory", "dead stock", "excess stock", "warehouse stock",
        "unsold stock", "stock aging",
    ],
    "PAYABLES": [
        "accounts payable", "payables", "dpo", "days payables outstanding", "supplier debt", "overdue payables",
        "vendor payment", "early payment discount", "payables aging", "vendor liabilities",
        # extensions
        "what do i owe", "owe suppliers", "supplier payments", "overdue suppliers", "vendor debt", "supplier invoices",
        "overdue supplier",
    ],
    "CASH_FORECAST": [
        "cash forecast", "cash projection", "13 week forecast", "cash deficit", "cash shortage", "run short of cash", "cash gap",
        "future liquidity", "cash flow warning", "weekly cash balance",
        # extensions
        "cash flow forecast", "forecast my cash", "forecast cash", "cash shortfall", "short of cash", "run out of cash",
        "projected cash", "cash flow projection", "weekly cash forecast", "13 week cash", "13 weeks", "negative cash",
        "below the buffer", "below my buffer", "cash buffer", "predict my cash", "will i have enough cash", "enough cash",
    ],
    "SENSITIVITY": [
        "dso reduction", "cash impact", "discount saving", "working capital optimization", "dso sensitivity",
        # extensions
        "reduce dso", "improve dso", "cut dso", "dso improvement", "one day of dso", "cash released", "cash freed",
        "what if dso", "discount savings", "working capital optimisation",
    ],
}

# Hard keyword traps: they always win, even when in-scope words are present ("loan disbursement for working capital").
OUT_OF_SCOPE_HARD: list[str] = [
    "borrow money", "credit approval", "loan disbursement", "tax filing", "audit report", "payroll",
    # extensions
    "loan approval", "get a loan", "apply for a loan", "tax return", "vat filing", "salaries", "financial audit",
    "approve my credit", "credit score",
]
# Soft out-of-scope: generic forecasting (not about cash), financing and scenarios. Alone -> OUT_OF_SCOPE; next to an in-scope question -> answer + boundary note.
# Cash forecasting itself is UC-02 (CASH_FORECAST group above).
OUT_OF_SCOPE_SOFT: list[str] = [
    "forecast", "financing options", "interest rate", "scenario", "predict", "loan",
]
DRAFT_KEYWORDS: list[str] = [
    "draft", "write an email", "write a reminder", "payment reminder", "reminder email", "reminder letter",
    "compose", "prepare a message", "write a letter",
]

_PRIORITY = ("CASH_FORECAST", "SENSITIVITY", "PAYABLES", "RECEIVABLES", "INVENTORY", "WORKING_CAPITAL")
_SPECIFIC = ("RECEIVABLES", "INVENTORY", "PAYABLES")
_VIETNAMESE = re.compile(
    "[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]", re.IGNORECASE)
_FIRM_ID = re.compile(r"\bF\d{2}\b", re.IGNORECASE)
_WEEKS = re.compile(r"\b(\d{1,3})\s*weeks?\b")  # "next 8 weeks", "13-week" (punctuation is removed before matching)
MAX_FORECAST_WEEKS = 13
# T2-18 sensitivity case: "... if receipts are 7 days late". Only applied when the question is already a cash-forecast question.
_LATE_RECEIPTS = re.compile(r"\b(?:receipts?|collections?|customers?|buyers?|clients?)\b[^.]{0,30}\b(?:late|later|delay\w*|slow\w*)\b"
                            r"|\b(?:late|delayed|slower)\s+(?:receipts?|collections?)\b")
_DAYS = re.compile(r"\b(\d{1,2})\s*days?\b")


# ------------------------------------------------------------------------------------------
# Text cleaning and typo-tolerant token matching
# ------------------------------------------------------------------------------------------
def clean_text(text: str) -> str:
    """Lowercase, NFKC-normalise, drop punctuation, collapse spaces."""
    t = unicodedata.normalize("NFKC", text or "").lower().replace("’", "'")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", " ", t)).strip()


def _stem(w: str) -> str:
    for suf in ("ing", "ed", "es", "s"):
        if w.endswith(suf) and len(w) >= len(suf) + 4:
            return w[: -len(suf)]
    return w


def _distance(a: str, b: str) -> int:
    """Damerau-Levenshtein (adjacent transposition costs 1)."""
    d = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1):
        d[i][0] = i
    for j in range(len(b) + 1):
        d[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    return d[-1][-1]


def _token_match(q: str, k: str, fuzzy: bool) -> bool:
    if q == k or _stem(q) == _stem(k):
        return True
    if not fuzzy:
        return False
    if len(k) == 4:  # 4-letter words: only a swapped-letter typo (cash -> cahs); acronyms of 3 letters stay exact
        return len(q) == 4 and sorted(q) == sorted(k) and _distance(q, k) == 1
    if len(k) < 4:
        return False
    limit = 1 if len(k) < 9 else 2
    return abs(len(q) - len(k)) <= limit and _distance(_stem(q), _stem(k)) <= limit


def _scan(tokens: list[str], keywords: list[tuple[str, str]], consumed: list[bool], fuzzy: bool,
          found: list[dict[str, Any]]) -> None:
    for group, kw in keywords:
        ktoks = kw.split()
        n = len(ktoks)
        for i in range(len(tokens) - n + 1):
            window = range(i, i + n)
            if any(consumed[j] for j in window):
                continue
            if all(_token_match(tokens[i + o], ktoks[o], fuzzy) for o in range(n)):
                for j in window:
                    consumed[j] = True
                found.append({"group": group, "keyword": kw, "exact": not fuzzy})
                break  # one hit per keyword is enough


def _all_keywords() -> list[tuple[str, str]]:
    kws = [(g, k) for g, ks in INTENT_DICTIONARY.items() for k in ks]
    kws += [("OUT_OF_SCOPE_HARD", k) for k in OUT_OF_SCOPE_HARD] + [("OUT_OF_SCOPE_SOFT", k) for k in OUT_OF_SCOPE_SOFT]
    kws += [("DRAFT_ACTION", k) for k in DRAFT_KEYWORDS]
    return sorted(kws, key=lambda x: (-len(x[1].split()), -len(x[1])))  # longest phrase first


_KEYWORDS = _all_keywords()


# ------------------------------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------------------------------
def route_intent(user_query: str, auth: AuthContext | None = None) -> dict[str, Any]:
    """Classify a user question and (when in scope) bind the Tier-0 tool call to the server AuthContext.

    Returns a dict with: intent, in_scope, tool, tier, tool_args, focus, matched_keywords, secondary_intents,
    out_of_scope_terms, confidence, firm_id_override_ignored, normalized_query, reason.
    Intents: WORKING_CAPITAL, RECEIVABLES, INVENTORY, PAYABLES, SENSITIVITY (UC-01, Tier 0), CASH_FORECAST (UC-02,
             Tier 1, tool forecast_cash), DRAFT_ACTION (Tier 2), OUT_OF_SCOPE, UNSUPPORTED_LANGUAGE, UNKNOWN.
    """
    raw = user_query if isinstance(user_query, str) else ""
    out: dict[str, Any] = {"intent": "UNKNOWN", "in_scope": False, "tool": None, "tier": None, "tool_args": {},
                           "focus": [], "matched_keywords": [], "secondary_intents": [], "out_of_scope_terms": [],
                           "confidence": 0.0, "firm_id_override_ignored": False, "normalized_query": clean_text(raw),
                           "reason": "No supported keyword found."}
    if _VIETNAMESE.search(raw):
        out.update(intent="UNSUPPORTED_LANGUAGE", reason="Only English is supported.")
        return out
    tokens = out["normalized_query"].split()
    if not tokens:
        out["reason"] = "Empty query."
        return out

    found: list[dict[str, Any]] = []
    consumed = [False] * len(tokens)
    _scan(tokens, _KEYWORDS, consumed, False, found)   # pass 1: exact phrases
    _scan(tokens, _KEYWORDS, consumed, True, found)    # pass 2: typo-tolerant on the remaining tokens
    out["matched_keywords"] = found
    groups: dict[str, int] = {}
    for f in found:
        groups[f["group"]] = groups.get(f["group"], 0) + len(f["keyword"].split()) * (1.0 if f["exact"] else 0.8)

    mentioned = {m.upper() for m in _FIRM_ID.findall(raw)}
    if auth is not None and mentioned and mentioned != {auth.firm_id.upper()}:
        out["firm_id_override_ignored"] = True  # the firm in the text is ignored; the session firm is used

    def bind(tool: str, tier: int) -> None:
        out.update(tool=tool, tier=tier, in_scope=True)
        out["tool_args"] = {"firm_id": auth.firm_id} if auth is not None else {}  # forced from AuthContext
        out["auth_bound"] = auth is not None

    hard, soft = groups.get("OUT_OF_SCOPE_HARD"), groups.get("OUT_OF_SCOPE_SOFT")
    in_scope = {g: s for g, s in groups.items() if g in INTENT_DICTIONARY}
    out["out_of_scope_terms"] = [f["keyword"] for f in found if f["group"].startswith("OUT_OF_SCOPE")]

    if hard:
        out.update(intent="OUT_OF_SCOPE", confidence=0.95, reason="Request matches an out-of-scope topic.")
        return out
    if "DRAFT_ACTION" in groups:
        out.update(intent="DRAFT_ACTION", confidence=0.9, reason="Drafting request (Tier 2, owner approval required).")
        bind("draft_action", 2)
        return out
    forecast_score = in_scope.get("CASH_FORECAST", 0)
    if forecast_score and forecast_score >= max([s for g, s in in_scope.items() if g != "CASH_FORECAST"], default=0):
        # UC-02 wins when its phrases are at least as specific as any UC-01 phrase; the other task stays a secondary intent.
        out.update(intent="CASH_FORECAST", secondary_intents=[g for g in in_scope if g != "CASH_FORECAST"],
                   confidence=round(min(1.0, 0.55 + 0.15 * forecast_score), 2), reason="Matched cash-forecast keywords.")
        bind("forecast_cash", 1)
        m = _WEEKS.search(out["normalized_query"])
        if m and int(m.group(1)) >= 1:
            out["requested_weeks"] = int(m.group(1))
            out["tool_args"]["weeks"] = min(int(m.group(1)), MAX_FORECAST_WEEKS)  # horizon is 1..13 weeks
        if _LATE_RECEIPTS.search(out["normalized_query"]):
            out["tool_args"]["case_id"] = "estimated_receipts_late"
            d = _DAYS.search(out["normalized_query"])
            if d and 1 <= int(d.group(1)) <= 90:
                out["tool_args"]["extra_days"] = int(d.group(1))  # otherwise the tool default (7 days) applies
        return out
    secondary_forecast = ["CASH_FORECAST"] if forecast_score else []
    in_scope = {g: s for g, s in in_scope.items() if g != "CASH_FORECAST"}
    if in_scope:
        specific = [g for g in _SPECIFIC if g in in_scope]
        if "SENSITIVITY" in in_scope:
            intent, focus = "SENSITIVITY", []
        elif specific and len(specific) < 3:
            intent = max(specific, key=lambda g: (in_scope[g], -_PRIORITY.index(g)))
            focus = sorted(specific, key=_SPECIFIC.index)
        else:
            intent, focus = "WORKING_CAPITAL", []
        out.update(intent=intent, focus=focus, secondary_intents=[g for g in in_scope if g != intent] + secondary_forecast,
                   confidence=round(min(1.0, 0.55 + 0.15 * in_scope.get(intent, 1)), 2),
                   reason="Matched in-scope keywords.")
        bind("get_working_capital", 0)
        return out
    if soft:
        out.update(intent="OUT_OF_SCOPE", confidence=0.8, reason="Financing, scenarios and generic forecasts are outside the supported tasks.")
    return out