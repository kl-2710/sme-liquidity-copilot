"""REST API tests (FastAPI TestClient): POST /forecasts, paginated evidence, authentication, tenant isolation, idempotency, audit, errors."""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

import src.api.tv2_routes as api  # noqa: E402
from src.uc02_cash_forecast.schemas import CashForecastResult  # noqa: E402

F01, F02 = {"X-API-Key": "key-f01"}, {"X-API-Key": "key-f02"}
BASE = "/api/v1/tv2"


@pytest.fixture(autouse=True)
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("TV2_API_KEYS", "key-f01:F01,key-f02:F02")
    monkeypatch.setattr(api, "AUDIT_LOG_PATH", tmp_path / "audit.jsonl")
    for store in (api._RUNS, api._LATEST, api._IDEMPOTENT):
        store.clear()
    return TestClient(api.app)


def _post(c, body=None, headers=None, **extra):
    payload = {"firm_id": "F01", "as_of": "2026-09-30", "weeks": 13, "buffer_vnd": 500000000, "weekly_only": False, **(body or {})}
    return c.post(f"{BASE}/forecasts", json=payload, headers={**F01, **(headers or {})}, **extra)


def _audit(tmp_path):
    return [json.loads(x) for x in (tmp_path / "audit.jsonl").read_text(encoding="utf-8").splitlines()]


# ----- POST /forecasts -----
def test_post_forecasts_returns_the_verified_result(client):
    r = _post(client)
    assert r.status_code == 200
    d = r.json()
    CashForecastResult.model_validate(d)  # the response is a valid CashForecastResult
    s = d["summary"]
    assert d["schema_version"] == "tv2.result.v1" and (s["first_buffer_date"], s["first_negative_date"], s["first_gap_week"]) == ("2026-10-04", "2026-10-23", 1)
    assert (s["cash0_vnd"], s["buffer_vnd"], s["max_gap_vnd"], s["min_balance_vnd"]) == (1_200_000_000, 500_000_000, 1_119_322_000, -619_322_000)
    assert len(d["weekly_schedule"]) == 13 and len(d["daily_schedule"]) == 91 and len(d["cash_events"]) == 51 and isinstance(s["cash0_vnd"], int)
    assert d["narrative"]["generation_status"] == "engine_summary" and "04/10/2026" in d["narrative"]["overview"]


def test_the_request_fields_are_applied(client):
    r = _post(client, {"weeks": 4, "buffer_vnd": 800000000})
    d = r.json()
    assert len(d["weekly_schedule"]) == 4 and d["summary"]["buffer_vnd"] == 800_000_000 and d["summary"]["horizon_weeks"] == 4
    late = _post(client, {"case_id": "estimated_receipts_late", "extra_days": 7}).json()
    assert late["summary"]["min_balance_vnd"] == -1_092_838_000 and late["summary"]["first_negative_date"] == "2026-10-14"


def test_weekly_only_trims_the_payload(client):
    full, trimmed = _post(client).json(), _post(client, {"weekly_only": True}).json()
    assert trimmed["cash_events"] == [] and trimmed["daily_schedule"] is None and len(trimmed["weekly_schedule"]) == 13
    assert trimmed["summary"] == full["summary"] and trimmed["meta"]["weekly_only"] is True
    assert len(json.dumps(trimmed)) < 0.5 * len(json.dumps(full))


@pytest.mark.parametrize("body,fragment", [({"weeks": 0}, "weeks"), ({"weeks": 14}, "weeks"), ({"buffer_vnd": -1}, "buffer_vnd"),
                                           ({"weekly_only": "maybe"}, "weekly_only"), ({"unknown_field": 1}, "unknown_field"),
                                           ({"case_id": "optimistic"}, "case_id"), ({"extra_days": 91}, "extra_days"), ({"firm_id": ""}, "firm_id")])
def test_invalid_requests_return_422_with_a_stable_code(client, body, fragment):
    r = _post(client, body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_REQUEST" and fragment in r.json()["error"]["message"]
    assert r.json()["request_id"] and r.json()["error"]["retryable"] is False


def test_a_cutoff_date_that_does_not_match_the_data_is_refused(client):
    r = _post(client, {"as_of": "2026-09-29"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_PERIOD_ALIGNMENT"
    assert _post(client, {"as_of": "30/09/2026"}).status_code == 422


# ----- authentication and tenant isolation -----
def test_requests_without_a_valid_key_are_refused(client):
    assert client.get(f"{BASE}/evidence/events").status_code == 401
    assert client.get(f"{BASE}/evidence/events", headers={"X-API-Key": "wrong"}).json()["error"]["code"] == "UNAUTHENTICATED"
    assert client.post(f"{BASE}/forecasts", json={"firm_id": "F01"}).status_code == 401


def test_the_api_is_disabled_until_keys_are_configured(client, monkeypatch):
    monkeypatch.delenv("TV2_API_KEYS")
    r = client.get(f"{BASE}/evidence/events", headers=F01)
    assert r.status_code == 503 and r.json()["error"]["code"] == "AUTH_NOT_CONFIGURED"


def test_a_caller_cannot_name_another_firm(client):
    r = _post(client, {"firm_id": "F02"})  # key-f01 asks for F02
    assert r.status_code == 403 and r.json()["error"]["code"] == "UNAUTHORIZED_FIRM"
    assert _post(client, {"firm_id": "F01"}, headers=F02).status_code == 403  # key-f02 naming F01
    ok = client.post(f"{BASE}/forecasts", json={"firm_id": "F02", "weeks": 13}, headers=F02)
    assert ok.status_code == 200 and ok.json()["meta"]["firm_id"] == "F02" and ok.json()["summary"]["buffer_vnd"] == 800_000_000


def test_a_run_of_another_firm_is_not_found(client):
    run = _post(client).json()["meta"]["run_id"]
    r = client.get(f"{BASE}/evidence/events", params={"run_id": run}, headers=F02)
    assert r.status_code == 404 and r.json()["error"]["code"] == "RUN_NOT_FOUND"
    assert client.get(f"{BASE}/evidence/events", params={"run_id": run}, headers=F01).status_code == 200


# ----- evidence: invoices -----
def test_invoice_evidence_is_paginated_and_complete(client):
    _post(client)
    p1 = client.get(f"{BASE}/evidence/invoices", headers=F01).json()
    assert (p1["page"], p1["page_size"], p1["total"], p1["total_pages"], len(p1["items"])) == (1, 20, 36, 2, 20)  # 17 receivable + 19 payable
    p2 = client.get(f"{BASE}/evidence/invoices", params={"page": 2}, headers=F01).json()
    assert len(p2["items"]) == 16 and not {i["invoice_id"] for i in p1["items"]} & {i["invoice_id"] for i in p2["items"]}
    kinds = [i["kind"] for i in p1["items"] + p2["items"]]
    assert kinds.count("receivable") == 17 and kinds.count("payable") == 19
    first = p1["items"][0]
    assert first["invoice_id"] == "P-F01-0074" and first["expected_date"] == "2026-10-01" and first["roll_applied"] is True and first["open_amount_vnd"] > 0
    k1 = next(i for i in p1["items"] + p2["items"] if i["invoice_id"] == "S-F01-0055")
    assert (k1["delay_days_applied"], k1["date_method"], k1["kind"]) == (21, "history_late_positive", "receivable")
    assert p1["run_id"] and p1["snapshot_id"]


def test_page_size_is_bounded_and_out_of_range_pages_are_empty(client):
    _post(client)
    assert client.get(f"{BASE}/evidence/invoices", params={"page_size": 101}, headers=F01).status_code == 422
    assert client.get(f"{BASE}/evidence/invoices", params={"page": 0}, headers=F01).status_code == 422
    big = client.get(f"{BASE}/evidence/invoices", params={"page_size": 100}, headers=F01).json()
    assert len(big["items"]) == 36 and big["total_pages"] == 1
    empty = client.get(f"{BASE}/evidence/invoices", params={"page": 9}, headers=F01).json()
    assert empty["items"] == [] and empty["total"] == 36


# ----- evidence: events -----
def test_event_evidence_lists_every_dated_event_in_date_order(client):
    _post(client)
    allrows = []
    for page in (1, 2, 3):
        d = client.get(f"{BASE}/evidence/events", params={"page": page, "page_size": 20}, headers=F01).json()
        allrows += d["items"]
    assert d["total"] == 51 and len(allrows) == 51 and d["total_pages"] == 3
    assert [r["cash_date"] for r in allrows] == sorted(r["cash_date"] for r in allrows)
    assert sum(r["amount_vnd"] for r in allrows if r["direction"] == "IN") == 4_912_255_000
    assert sum(r["amount_vnd"] for r in allrows if r["direction"] == "OUT") == 6_731_577_000
    assert all(r["source_ref"] and r["week_number"] and r["scope"] == "in_horizon" for r in allrows)


def test_event_filters_by_week_day_and_direction(client):
    _post(client)
    wk4 = client.get(f"{BASE}/evidence/events", params={"week": 4}, headers=F01).json()
    assert wk4["total"] == 6 and {r["week_number"] for r in wk4["items"]} == {4}
    day = client.get(f"{BASE}/evidence/events", params={"day": "2026-10-23"}, headers=F01).json()
    assert {(r["category"], r["amount_vnd"]) for r in day["items"] if r["direction"] == "OUT"} == {("payroll", 1_000_000_000), ("supplier_payment", 225_062_000)}
    outs = client.get(f"{BASE}/evidence/events", params={"direction": "OUT", "page_size": 100}, headers=F01).json()
    assert outs["total"] and all(r["direction"] == "OUT" for r in outs["items"])
    assert client.get(f"{BASE}/evidence/events", params={"week": 14}, headers=F01).status_code == 422


def test_beyond_horizon_events_are_listed_only_on_request(client):
    _post(client, {"weeks": 4})
    inside = client.get(f"{BASE}/evidence/events", params={"page_size": 100}, headers=F01).json()["total"]
    beyond = client.get(f"{BASE}/evidence/events", params={"page_size": 100, "include_beyond": True}, headers=F01).json()
    assert beyond["total"] > inside and any(r["scope"] == "beyond_horizon" for r in beyond["items"])


def test_evidence_reads_the_default_run_when_none_exists_yet(client):
    d = client.get(f"{BASE}/evidence/events", headers=F01).json()
    assert d["total"] == 51 and d["run_id"].startswith("run-")


def test_a_weekly_only_run_has_no_event_evidence(client):
    run = _post(client, {"weekly_only": True}).json()["meta"]["run_id"]
    r = client.get(f"{BASE}/evidence/events", params={"run_id": run}, headers=F01)
    assert r.status_code == 409 and r.json()["error"]["code"] == "EVIDENCE_NOT_AVAILABLE"


# ----- release gate -----
def test_every_release_is_audited_before_it_is_returned(client, tmp_path):
    d = _post(client).json()
    rec = _audit(tmp_path)[0]
    assert (rec["task"], rec["tool"], rec["tier"], rec["channel"], rec["firm_id"], rec["release_status"]) == ("UC02", "forecast_cash", 1, "api", "F01", "response_released")
    assert rec["run_id"] == d["meta"]["run_id"] and rec["versions"]["schema"] == "tv2.result.v1" and rec["outcome"]["reconciliation"] == "ok"
    assert "key-f01" not in json.dumps(rec) and rec["actor"].startswith("api:")  # the key itself is never logged


def test_a_failed_audit_write_blocks_the_release(client, monkeypatch):
    def boom(record):
        raise OSError("disk full")

    monkeypatch.setattr(api, "_audit", boom)
    r = _post(client)
    assert r.status_code == 500 and r.json()["error"]["code"] == "AUDIT_WRITE_FAILED" and r.json()["error"]["retryable"] is True
    assert api._RUNS == {} and "summary" not in r.json()


def test_a_changed_source_blocks_the_release(client, monkeypatch):
    monkeypatch.setattr(api, "verify_sources_unchanged", lambda meta: False)
    r = _post(client)
    assert r.status_code == 409 and r.json()["error"]["code"] == "STALE_SNAPSHOT"


def test_a_slow_run_returns_504(client, monkeypatch):
    from src.agent import tools
    import time
    monkeypatch.setattr(tools, "TOOL_TIMEOUT", 0.05)
    monkeypatch.setattr(tools, "calculate_cash_forecast", lambda *a, **k: time.sleep(0.5))
    r = _post(client)
    assert r.status_code == 504 and r.json()["error"]["code"] == "TOOL_TIMEOUT" and r.json()["error"]["retryable"] is True


def test_idempotency_key_replays_the_first_response_and_never_releases_twice(client, tmp_path):
    a = _post(client, headers={"Idempotency-Key": "k-1"})
    b = _post(client, headers={"Idempotency-Key": "k-1"})
    assert a.status_code == b.status_code == 200 and b.headers["Idempotent-Replay"] == "true"
    assert a.json()["meta"]["run_id"] == b.json()["meta"]["run_id"] and len(_audit(tmp_path)) == 1
    conflict = _post(client, {"weeks": 4}, headers={"Idempotency-Key": "k-1"})
    assert conflict.status_code == 409 and conflict.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    other = _post(client, headers={"Idempotency-Key": "k-2"})
    assert other.json()["meta"]["run_id"] != a.json()["meta"]["run_id"]


def test_openapi_documents_the_three_endpoints_in_english(client):
    spec = client.get("/openapi.json").json()
    paths = spec["paths"]
    assert {"/api/v1/tv2/forecasts", "/api/v1/tv2/evidence/invoices", "/api/v1/tv2/evidence/events"} <= set(paths)
    assert "post" in paths["/api/v1/tv2/forecasts"] and "get" in paths["/api/v1/tv2/evidence/events"]
    params = {p["name"] for p in paths["/api/v1/tv2/evidence/invoices"]["get"]["parameters"]}
    assert {"page", "page_size", "run_id"} <= params
    assert "Forecast horizon in weeks" in json.dumps(spec) and client.get(f"{BASE}/health").json()["status"] == "ok"
