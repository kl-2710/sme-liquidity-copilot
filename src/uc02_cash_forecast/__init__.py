"""UC-02 13-week cash forecast and shortfall alert (formulas T2-01..T2-18, schema tv2.result.v1).

schemas.py       : versioned result models (Decimal money serialised as integer VND)
insights.py      : evidence, fact registry and insights (built only from the engine's results)
cash_forecast.py : calculate_cash_forecast(snapshot, firm_id, as_of, weeks) - pure calculation, reuses the UC-01 buyer payment delays
Data             : cash and buffer come from the UC-01 snapshot; planned flows (payroll, rent, tax...) come from data/cash_plans.csv
Wire-up          : tool `forecast_cash` in src/agent/tools.py (Tier 1), intent CASH_FORECAST in src/agent/router.py,
                   narrative in src/agent/agent.py. Tests: tests/uc02/.
Hand-off to UC-03: summary.first_gap_week and summary.max_gap_vnd (peak gap to the buffer; peak gap to zero is separate).
"""
