# UC-02 change notes: 13-week cash forecast and shortfall alert

## Update 3: API, UI, weekly_only, timeout, dd/mm/yyyy
- `src/api/tv2_routes.py` (new): `POST /api/v1/tv2/forecasts`, `GET /api/v1/tv2/evidence/invoices`, `GET /api/v1/tv2/evidence/events` with pagination; API-key authentication bound to the firm, idempotency key, strict audit write, stale-snapshot and timeout errors.
- `app.py` (new): Streamlit UI with the Cash Forecast tab (four metric cards, 13-week table with alert colours, week drill-down), Working Capital tab and a chat tab.
- `weekly_only` payload mode in the engine, the tool and the API; `TOOL_TIMEOUT` (30 s) guard around `forecast_cash`; `CashForecastResult.narrative` populated with a deterministic English summary.
- Every displayed date is dd/mm/yyyy (raw JSON dates stay ISO). The UC-01 narrative still prints dates such as 30 Sep 2026.

## Update 2: gaps closed against SRS_UC02_TV2_v2
- Result envelope now has `insights` (3-5, SRS priority order), `evidence`, `fact_registry`, `capabilities`, `issues`, `narrative` (null until the agent fills it) and `audit_ref`.
- Metric records carry `raw_type`, `display_value`, `source_basis`, `evidence_ids`; every daily/weekly alert carries `alert_rule_id`, `alert_threshold` and the raw ratio; `inputs.alert_config` lists the rules; weekly-grain first dates added (T2-14).
- `src/uc02_cash_forecast/insights.py` (new): evidence, fact registry and insights, built only from the engine's results.
- Agent narrative: SRS 3.1.5.9 system prompt, structured generation with `[[FACT:id]]` tokens, claim validation (type, basis, grain, case, entity, blocked statements, content contract), one rewrite, then the deterministic template over the same facts. Output adds the weekly table and the `Tools used: forecast_cash` line.
- Release gate: `STALE_SNAPSHOT` check (sha256 of the source files), strict audit write (`AUDIT_WRITE_FAILED` blocks release), `idempotency_key`, full audit record (request_id, snapshot, versions, outcome, issue codes, generation mode, timings, release status).
- Router and tool: the late-receipts case (`case_id`, `extra_days`) can be requested in chat ("... if receipts are 7 days late").

## Added
- `src/uc02_cash_forecast/schemas.py`: versioned result models (`tv2.result.v1`), Decimal money serialised as integer VND.
- `src/uc02_cash_forecast/cash_forecast.py`: formulas T2-01..T2-18, daily ledger (7 x weeks rows), weekly roll-up, alerts, episodes, drivers, reconciliation.
- `data/cash_plans.csv`: 45 demo plans (payroll, rent, utilities, tax, debt service, capex, new materials) for F01..F03.
- `tests/uc02/test_cash_forecast.py`: golden fixture (F01/F02/F03 and the late-receipts case), SRS scenarios Q01-Q21, tool and agent checks.

## Changed
- `src/agent/router.py`: new `CASH_FORECAST` intent group; generic "forecast" stays out of scope; horizon parsed from the question and capped at 13 weeks.
- `src/agent/tools.py`: `forecast_cash` is now the real UC-02 tool (Tier 1); the legacy keys `first_gap_week`, `max_gap_vnd`, `status` are kept for the UC-03/UC-04 placeholders.
- `src/agent/agent.py`: forecast route and a deterministic English narrative (overview, critical periods, drivers, assumptions and limits).
- `tests/agent/test_router.py`, `tests/agent/test_agent.py`: expectations updated because cash forecasts are now in scope.

## Hand-off to UC-03
`summary.first_gap_week` and `summary.max_gap_vnd` (peak gap to the buffer). The gap to zero is `summary.peak_zero_gap_vnd`; the two are never added.

## Not implemented yet
LLM-written narrative with guardrails, insights/evidence/fact_registry/audit_ref fields, weekly-only mode, HTTP API and UI.
