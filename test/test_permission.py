"""Permission tiers and Tier-2 drafts. Run from the project root: python test/test_permission.py (no API key needed)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.permissions import execute  # noqa: E402

# 1. Tier 3 must be rejected
r = execute("submit_action", {"draft_id": "X"}, "F01")
assert r["status"] == "rejected", r

# 2. Unknown tools must be rejected
r = execute("delete_database", {}, "F01")
assert r["status"] == "rejected", r

# 3. The LLM cannot switch firm: firm_id is forced to the session firm
r = execute("get_working_capital", {"firm_id": "HACKER"}, "F01")
assert r["inputs"]["firm_id"] == "F01", r["inputs"]

# 4. Tier 2: real buyer + wrong amount from the model -> draft is created and the amount is forced to the verified value
body = "Dear customer, your overdue amount is 871,565,000 VND. Regards"
r = execute("draft_action", {"action_type": "payment_reminder",
            "details": {"recipient": "Nhà xuất khẩu Lớn K1", "body": body}}, "F01")
assert r["status"] == "pending_approval", r
assert r["verified_amount_vnd"] == 817_756_000, r
assert "VND 817,756,000" in r["content"]["body"] and "871,565,000" not in r["content"]["body"], r

# 5. Tier 2: buyer not in this firm's receivables -> blocked
r = execute("draft_action", {"action_type": "payment_reminder", "details": {"recipient": "Exporter A", "body": body}}, "F01")
assert r["status"] == "blocked", r

# 6. Tier 2: real buyer without overdue amount (K2) -> blocked
r = execute("draft_action", {"action_type": "payment_reminder",
            "details": {"recipient": "Nhà xuất khẩu K2", "body": body}}, "F01")
assert r["status"] == "blocked", r

print("test_permission: all checks passed")