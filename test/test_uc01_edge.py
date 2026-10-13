"""P9 - Test biên UC-01: thiếu due_date, doanh thu = 0, as_of lệch, lịch sử < 5 hóa đơn.

Chạy: python -m unittest test_uc01_edge.py -v
Nếu tên workbook trong data/ bị lỗi mã hóa, đặt UC1_WORKBOOK_PATH trước khi chạy.
"""
import copy
import unittest
from datetime import timedelta

from src.data_loader import DataValidationError, get_snapshot
from src.working_capital import calculate_working_capital

BASE = get_snapshot("F01")


def _run(snapshot):
    return calculate_working_capital(snapshot)


def _metric(result, metric_id):
    return next(m for m in result.result_metrics if m.id == metric_id)


class MissingDueDateTests(unittest.TestCase):
    def setUp(self):
        self.snap = copy.deepcopy(BASE)
        # bỏ due_date của 1 hóa đơn còn mở
        self.target = next(s for s in self.snap["sales"] if s["paid_amount"] == 0)
        self.target["due_date"] = None
        self.result = _run(self.snap)
        self.aging = self.result.drivers.receivables_aging_vnd

    def test_warning_is_emitted(self):
        self.assertTrue(any("MISSING_DUE_DATE" in w for w in self.result.warnings))

    def test_classified_plus_missing_equals_ar(self):
        ar = _metric(self.result, "ar_vnd").raw_value
        self.assertAlmostEqual(self.aging["classified_ar_vnd"] + self.aging["missing_due_date_vnd"], ar, delta=1)

    def test_complete_overdue_share_is_null(self):
        self.assertIsNone(self.aging["overdue_share_complete"])
        self.assertIsNone(_metric(self.result, "ar_overdue_share").raw_value)
        self.assertIsNotNone(self.aging["known_overdue_share_of_total_ar"])  # cận dưới vẫn có


class LateBehaviourTests(unittest.TestCase):
    def test_missing_due_date_does_not_dilute_late_positive(self):
        snap = copy.deepcopy(BASE)
        paid = next(s for s in snap["sales"] if s["paid_date"])
        buyer_id, inv_id = paid["buyer_id"], paid["invoice_id"]
        # A: hóa đơn thiếu due_date.  B: bỏ hẳn lần thu của hóa đơn đó khỏi lịch sử.
        a = copy.deepcopy(snap)
        next(s for s in a["sales"] if s["invoice_id"] == inv_id)["due_date"] = None
        b = copy.deepcopy(snap)
        b["payment_events"] = [e for e in b["payment_events"] if e["invoice_id"] != inv_id]
        late_a = next(x for x in _run(a).drivers.buyers if x.buyer_id == buyer_id).late_positive_wavg_days
        late_b = next(x for x in _run(b).drivers.buyers if x.buyer_id == buyer_id).late_positive_wavg_days
        self.assertAlmostEqual(late_a, late_b, places=9)  # A phải bằng B, không bị kéo về 0

    def test_less_than_5_invoices_is_insufficient_history(self):
        snap = copy.deepcopy(BASE)
        buyer = _run(snap).drivers.buyers[-1].buyer_id
        id_to_buyer = {s["invoice_id"]: s["buyer_id"] for s in snap["sales"]}
        kept, n = [], 0
        for e in snap["payment_events"]:
            if id_to_buyer.get(e["invoice_id"]) == buyer:
                n += 1
                if n > 3:
                    continue
            kept.append(e)
        snap["payment_events"] = kept
        b = next(x for x in _run(snap).drivers.buyers if x.buyer_id == buyer)
        self.assertLess(b.history_invoice_count, 5)
        self.assertEqual(b.coverage_status, "insufficient_history")
        self.assertFalse(b.behaviour_late)

    def test_5_or_more_invoices_is_ok(self):
        for b in _run(BASE).drivers.buyers:  # F01: mỗi khách có 18–22 hóa đơn đã thu
            self.assertEqual(b.coverage_status, "ok")


class ZeroDenominatorTests(unittest.TestCase):
    def setUp(self):
        snap = copy.deepcopy(BASE)
        snap["financials"]["revenue_vnd"] = 0.0
        start = __import__("datetime").date.fromisoformat(snap["meta"]["period_start"])
        for s in snap["sales"]:  # không còn hóa đơn trong kỳ -> Rev khớp tổng hóa đơn = 0
            s["recognition_date"] = start - timedelta(days=1)
        self.result = _run(snap)

    def test_dso_not_applicable_and_twc_still_valid(self):
        self.assertEqual(_metric(self.result, "dso_days").status, "not_applicable")
        twc = _metric(self.result, "twc_vnd")
        self.assertEqual(twc.status, "provisional")
        self.assertEqual(twc.raw_value, 6_410_678_000)

    def test_ccc_is_null_with_dependency_reason(self):
        ccc = _metric(self.result, "ccc_days")
        self.assertIsNone(ccc.raw_value)
        self.assertEqual(ccc.status, "not_applicable")
        self.assertIn("DSO", ccc.reason or "")

    def test_run_is_not_invalid(self):
        self.assertNotEqual(self.result.status, "invalid_data")


class PeriodAlignmentTests(unittest.TestCase):
    def test_as_of_not_period_end_has_error_code(self):
        with self.assertRaises(DataValidationError) as ctx:
            get_snapshot("F01", "2026-09-29", 90)
        self.assertEqual(getattr(ctx.exception, "code", None), "INVALID_PERIOD_ALIGNMENT")

    def test_wrong_period_days_has_error_code(self):
        with self.assertRaises(DataValidationError) as ctx:
            get_snapshot("F01", "2026-09-30", 60)
        self.assertEqual(getattr(ctx.exception, "code", None), "INVALID_REQUEST")


if __name__ == "__main__":
    unittest.main()