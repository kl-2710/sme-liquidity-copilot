"""CLI smoke test of the English agent (needs OPENAI_API_KEY for the draft test only).

Run from the project root:   python test/test_agent.py
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from src.agent import run_agent  # noqa: E402

FIRM_ID = "F01"

TEST_CASES: list[tuple[str, str]] = [
    ("Test 1 - Diagnosis, Tier 0 (financing part is out of scope)",
     "Why is my cash stuck and what are my financing options?"),
    ("Test 2 - Focused question, Tier 0", "Which inventory is slow moving?"),
    ("Test 3 - Draft, Tier 2 (needs API key)", "Draft a payment reminder for Large Exporter K1 based on the overdue receivables."),
    ("Test 3b - Cash forecast, Tier 1 (UC-02)", "Will I run short of cash in the next 13 weeks?"),
    ("Test 4 - Out of scope", "Can I borrow money to pay my suppliers?"),
    ("Test 5 - Non-English input is rejected", "Tại sao tiền của tôi bị đọng?"),
]


def print_step(step: int, tool: str, args: dict[str, Any], result: dict[str, Any]) -> None:
    """Print every tool call the agent makes."""
    print(f"  [Step {step}] tool = {tool}")
    print(f"    args   : {json.dumps(args, ensure_ascii=False)}")
    text = json.dumps(result, ensure_ascii=False, default=str)
    print(f"    result : {text[:400]}{'...' if len(text) > 400 else ''}")


def main() -> None:
    """Run the test questions one after another."""
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # avoid Unicode errors on Windows consoles

    for title, question in TEST_CASES:
        print("=" * 80)
        print(f"{title}\nUser: {question}\n")
        try:
            answer = run_agent(question, firm_id=FIRM_ID, session_id="test-session", on_step=print_step)
        except Exception as exc:  # noqa: BLE001
            answer = f"[Unhandled error] {exc}"
        print("\n  >>> Final answer:\n")
        print(answer)
        print()
    print("Audit log: logs/audit.jsonl")


if __name__ == "__main__":
    main()