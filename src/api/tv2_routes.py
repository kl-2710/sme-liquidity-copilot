"""TV2 REST API: cash forecast and paginated evidence (SRS 3.10.2, 3.5.1, 3.6.1).

Run:  uvicorn src.api.tv2_routes:app --reload      Docs: http://127.0.0.1:8000/docs

Security: every route binds the firm from the authenticated caller (X-API-Key -> firm, from the TV2_API_KEYS environment variable,
e.g. TV2_API_KEYS="key-f01:F01,key-f02:F02"). A request that names another firm is refused (403). Nothing here can send a message,
pay or approve a loan. A forecast is released only after the audit record is written (a failed audit write returns 500 AUDIT_WRITE_FAILED).
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import uuid
from collections import OrderedDict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from src.agent.router import AuthContext
from src.agent.tools import ToolTimeoutError, run_forecast
from src.core.config import AUDIT_LOG_PATH
from src.uc02_cash_forecast.cash_forecast import CashForecastError, verify_sources_unchanged
from src.uc02_cash_forecast.schemas import CashEvent, CashForecastResult

API_VERSION = "tv2.api.v1"
MAX_PAGE_SIZE = 100
MAX_STORED_RUNS = 50
_HTTP_STATUS = {"INVALID_REQUEST": 422, "INVALID_DATE_ALIGNMENT": 422, "UNAUTHORIZED_FIRM": 403, "UNAUTHENTICATED": 401,
                "AUTH_NOT_CONFIGURED": 503, "MISSING_CORE_SOURCE": 503, "SNAPSHOT_NOT_FOUND": 404, "RUN_NOT_FOUND": 404,
                "EVIDENCE_NOT_AVAILABLE": 409, "IDEMPOTENCY_CONFLICT": 409, "STALE_SNAPSHOT": 409, "TOOL_TIMEOUT": 504,
                "AUDIT_WRITE_FAILED": 500, "INVALID_PERIOD_ALIGNMENT": 422, "INTERNAL_ERROR": 500}


class ApiError(Exception):
    """Error with a stable code (SRS 3.3.1.3), mapped to an HTTP status and a JSON body."""

    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(f"{code}: {message}")
        self.code, self.message, self.retryable = code, message, retryable


# ------------------------------------------------------------------------------------------------
# Request / response models
# ------------------------------------------------------------------------------------------------
class ForecastRequest(BaseModel):
    """Body of POST /forecasts. The firm must be the authenticated firm."""
    model_config = ConfigDict(extra="forbid")
    firm_id: str = Field(..., min_length=1, description="Firm to forecast; must equal the firm bound to the API key.")
    as_of: str = Field("2026-09-30", description="Cut-off date (ISO YYYY-MM-DD). Forecast days start the next day.")
    weeks: int = Field(13, ge=1, le=13, description="Forecast horizon in weeks (1-13).")
    buffer_vnd: Optional[Decimal] = Field(None, ge=0, description="Optional override of the firm's cash buffer, in VND.")
    weekly_only: bool = Field(False, description="Return only the summary and the weekly schedule (no daily rows, events or episodes).")
    case_id: Literal["base", "estimated_receipts_late"] = Field("base", description="Scenario case (T2-18).")
    extra_days: int = Field(7, ge=0, le=90, description="Days added to estimated receipt dates in the late-receipts case.")


class Page(BaseModel):
    run_id: str
    snapshot_id: Optional[str] = None
    page: int
    page_size: int
    total: int
    total_pages: int
    items: list[dict[str, Any]]


# ------------------------------------------------------------------------------------------------
# Authentication, run store, idempotency, audit
# ------------------------------------------------------------------------------------------------
def get_auth(x_api_key: Optional[str] = Header(None, alias="X-API-Key")) -> AuthContext:
    """Resolve the caller's firm from the API key. The firm is NEVER taken from the request body or the query string."""
    raw = os.getenv("TV2_API_KEYS", "")
    keys = dict(p.split(":", 1) for p in (x.strip() for x in raw.split(",")) if ":" in p)
    if not keys:
        raise ApiError("AUTH_NOT_CONFIGURED", "Set TV2_API_KEYS (for example key-f01:F01) to enable the API.")
    if not x_api_key or x_api_key not in keys:
        raise ApiError("UNAUTHENTICATED", "A valid X-API-Key header is required.")
    return AuthContext(firm_id=keys[x_api_key], session_id=f"api:{hashlib.sha256(x_api_key.encode()).hexdigest()[:8]}")


_LOCK = threading.Lock()
_RUNS: "OrderedDict[tuple[str, str], CashForecastResult]" = OrderedDict()  # (firm, run_id) -> result; evidence is read from the same run
_LATEST: dict[str, str] = {}
_IDEMPOTENT: dict[tuple[str, str], tuple[str, dict[str, Any]]] = {}        # (firm, key) -> (payload hash, response)


def _store(firm: str, result: CashForecastResult) -> None:
    with _LOCK:
        _RUNS[(firm, result.meta.run_id)] = result
        _LATEST[firm] = result.meta.run_id
        while len(_RUNS) > MAX_STORED_RUNS:
            _RUNS.popitem(last=False)


def _run_for(auth: AuthContext, run_id: Optional[str]) -> CashForecastResult:
    """The stored run of THIS firm (another firm's run id behaves as not found). No run yet -> create the default base forecast."""
    with _LOCK:
        rid = run_id or _LATEST.get(auth.firm_id)
        found = _RUNS.get((auth.firm_id, rid)) if rid else None
    if found is not None:
        return found
    if run_id:
        raise ApiError("RUN_NOT_FOUND", f"No run '{run_id}' for this firm. Create one with POST /api/v1/tv2/forecasts.")
    result = run_forecast(auth.firm_id)
    _store(auth.firm_id, result)
    return result


def _audit(record: dict[str, Any]) -> None:
    """Strict audit append (raises on failure: a forecast is released only after its audit record exists)."""
    AUDIT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with AUDIT_LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")


def _week_of(e: CashEvent, start: date) -> Optional[int]:
    return None if e.cash_date is None else (e.cash_date - start).days // 7 + 1


def _paginate(rows: list[dict[str, Any]], page: int, page_size: int, result: CashForecastResult) -> Page:
    total = len(rows)
    first = (page - 1) * page_size
    return Page(run_id=result.meta.run_id, snapshot_id=result.meta.snapshot_id, page=page, page_size=page_size, total=total,
                total_pages=max(1, -(-total // page_size)), items=rows[first:first + page_size])


def _evidence_source(result: CashForecastResult) -> list[CashEvent]:
    if result.meta.weekly_only or not result.cash_events:
        raise ApiError("EVIDENCE_NOT_AVAILABLE", "This run has no cash events (weekly_only or blocked). Create a full run to read evidence.")
    return result.cash_events


# ------------------------------------------------------------------------------------------------
# Routes
# ------------------------------------------------------------------------------------------------
router = APIRouter(prefix="/api/v1/tv2", tags=["TV2 cash forecast"])


@router.post("/forecasts", response_model=CashForecastResult, summary="Create a 13-week cash forecast")
def create_forecast(body: ForecastRequest, auth: AuthContext = Depends(get_auth),
                    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key")) -> Any:
    """Runs the verified engine for the authenticated firm and returns the full `CashForecastResult`.

    The same `Idempotency-Key` with the same body returns the first response (header `Idempotent-Replay: true`) and never releases twice;
    the same key with a different body is refused (409 IDEMPOTENCY_CONFLICT).
    """
    if body.firm_id != auth.firm_id:
        raise ApiError("UNAUTHORIZED_FIRM", "The request names a firm other than the one bound to the API key.")
    payload_hash = hashlib.sha256(body.model_dump_json().encode()).hexdigest()
    if idempotency_key:
        with _LOCK:
            prior = _IDEMPOTENT.get((auth.firm_id, idempotency_key))
        if prior:
            if prior[0] != payload_hash:
                raise ApiError("IDEMPOTENCY_CONFLICT", "This Idempotency-Key was already used with a different request body.")
            return JSONResponse(prior[1], headers={"Idempotent-Replay": "true"})
    t0 = time.perf_counter()
    try:
        result = run_forecast(auth.firm_id, body.as_of, body.weeks, body.case_id, body.extra_days, body.buffer_vnd, body.weekly_only)
    except (CashForecastError, ToolTimeoutError) as exc:
        raise ApiError(getattr(exc, "code", "INVALID_REQUEST"), str(exc).split(": ", 1)[-1], getattr(exc, "retryable", False)) from exc
    except Exception as exc:  # UC-01 loader errors (UC1Error) carry a code too
        raise ApiError(getattr(exc, "code", "INTERNAL_ERROR"), str(exc).split(": ", 1)[-1]) from exc
    if verify_sources_unchanged(result.meta) is False:
        raise ApiError("STALE_SNAPSHOT", "The source data changed while the forecast was running. Please run it again.", True)
    m = result.meta
    try:
        _audit({"timestamp": datetime.now(timezone.utc).isoformat(), "request_id": uuid.uuid4().hex[:12], "idempotency_key": idempotency_key,
                "actor": auth.session_id, "firm_id": auth.firm_id, "task": "UC02", "tool": "forecast_cash", "tier": 1, "channel": "api",
                "params": {"as_of": body.as_of, "weeks": body.weeks, "case_id": body.case_id, "weekly_only": body.weekly_only,
                           "buffer_override": body.buffer_vnd is not None},
                "run_id": m.run_id, "snapshot_id": m.snapshot_id, "source_checksum": m.source_checksum,
                "versions": {"schema": m.schema_version, "formula": m.formula_version, "config": m.config_version},
                "outcome": {"status": result.summary.status, "overall_level": result.summary.overall_level,
                            "reconciliation": result.reconciliation.status},
                "issue_codes": sorted({i.code for i in result.issues}), "generation_mode": "engine_summary",
                "timing_ms": {"read_and_compute": round((time.perf_counter() - t0) * 1000)}, "release_status": "response_released"})
    except Exception as exc:  # noqa: BLE001
        raise ApiError("AUDIT_WRITE_FAILED", "The forecast was not released because the audit record could not be written.", True) from exc
    _store(auth.firm_id, result)
    if idempotency_key:
        with _LOCK:
            _IDEMPOTENT[(auth.firm_id, idempotency_key)] = (payload_hash, result.model_dump(mode="json"))
    return result


@router.get("/evidence/invoices", response_model=Page, summary="Invoice evidence (paginated)")
def invoice_evidence(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=MAX_PAGE_SIZE),
                     run_id: Optional[str] = Query(None, description="Run to read; default is the latest run of the authenticated firm."),
                     auth: AuthContext = Depends(get_auth)) -> Page:
    """Open receivable and payable invoices behind the schedule: open amount, original and expected date, method, roll and delay."""
    result = _run_for(auth, run_id)
    rows = [{"invoice_id": e.source_id, "kind": "receivable" if e.source_type == "sales_invoice" else "payable", "direction": e.direction,
             "counterparty_id": e.counterparty_id, "counterparty_name": e.counterparty_name, "open_amount_vnd": int(e.amount_vnd),
             "original_date": e.original_date, "expected_date": e.cash_date, "date_method": e.date_method, "roll_applied": e.roll_applied,
             "delay_days_applied": e.delay_days_applied, "case_shift_days": e.case_shift_days, "scope": e.scope,
             "assumption_ids": e.assumption_ids, "formula_id": e.formula_id}
            for e in sorted(_evidence_source(result), key=lambda x: (x.cash_date is None, x.cash_date or date.max, x.event_id))
            if e.source_type in ("sales_invoice", "purchase_invoice")]
    return _paginate(jsonable(rows), page, page_size, result)


@router.get("/evidence/events", response_model=Page, summary="Daily cash event evidence (paginated)")
def event_evidence(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=MAX_PAGE_SIZE),
                   run_id: Optional[str] = Query(None, description="Run to read; default is the latest run of the authenticated firm."),
                   week: Optional[int] = Query(None, ge=1, le=13, description="Only events dated in this forecast week."),
                   day: Optional[date] = Query(None, description="Only events dated on this day (YYYY-MM-DD)."),
                   direction: Optional[Literal["IN", "OUT"]] = Query(None),
                   include_beyond: bool = Query(False, description="Also list events dated after the forecast end."),
                   auth: AuthContext = Depends(get_auth)) -> Page:
    """Every dated cash event (invoice portions and plans) that feeds the daily ledger, ordered by date, with its source reference."""
    result = _run_for(auth, run_id)
    start = result.meta.start_date
    rows = []
    for e in sorted(_evidence_source(result), key=lambda x: (x.cash_date is None, x.cash_date or date.max, x.direction, x.event_id)):
        if (e.scope == "beyond_horizon" and not include_beyond) or e.scope == "unscheduled":
            continue
        if (week and _week_of(e, start) != week) or (day and e.cash_date != day) or (direction and e.direction != direction):
            continue
        d = e.model_dump(mode="json")
        d.update(week_number=_week_of(e, start), source_ref=f"{e.source_type}:{e.source_id}", amount_vnd=int(e.amount_vnd))
        rows.append(d)
    return _paginate(rows, page, page_size, result)


def jsonable(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return json.loads(json.dumps(rows, default=str))


# ------------------------------------------------------------------------------------------------
# Application
# ------------------------------------------------------------------------------------------------
app = FastAPI(title="SME Liquidity Copilot - TV2 API", version=API_VERSION,
              description="13-week cash forecast and shortfall alert. All amounts are VND. Demo data is synthetic and every forecast is provisional.")
app.include_router(router)


def _error(request: Request, code: str, message: str, retryable: bool, status: int) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message, "retryable": retryable}, "request_id": uuid.uuid4().hex[:12]}, status_code=status)


@app.exception_handler(ApiError)
async def _api_error(request: Request, exc: ApiError) -> JSONResponse:
    return _error(request, exc.code, exc.message, exc.retryable, _HTTP_STATUS.get(exc.code, 500))


@app.exception_handler(RequestValidationError)
async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0]
    where = ".".join(str(p) for p in first["loc"] if p not in ("body", "query"))
    return _error(request, "INVALID_REQUEST", f"{where or 'request'}: {first['msg']}", False, 422)


@app.get("/api/v1/tv2/health", tags=["TV2 cash forecast"], summary="Liveness check")
def health() -> dict[str, str]:
    return {"status": "ok", "api_version": API_VERSION}
