"""Pydantic schemas for UC-02 (13-week cash forecast and shortfall alert), schema_version = "tv2.result.v1".

Money is held as Decimal and serialises as an integer VND (or a decimal string when the value has a fractional part),
so `model_dump()` / `model_dump(mode="json")` never produce floats for money. Ratios are plain floats (0.30 = 30%).
"""
from __future__ import annotations

from datetime import date as Date
from decimal import Decimal
from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, Field, PlainSerializer

SCHEMA_VERSION = "tv2.result.v1"
FORMULA_VERSION = "tv2.formulas.v1"
CONFIG_VERSION = "tv2.demo.v1"


def _money_out(value: Decimal) -> Union[int, str]:
    """Integer VND when whole, otherwise a decimal string (never a float)."""
    return int(value) if value == value.to_integral_value() else format(value, "f")


Money = Annotated[Decimal, PlainSerializer(_money_out, return_type=Union[int, str])]

AlertColor = Literal["green", "yellow", "orange", "red", "unknown"]
ForecastStatus = Literal["ok", "provisional", "missing_data", "invalid_data"]
Direction = Literal["IN", "OUT"]


class ForecastIssue(BaseModel):
    code: str
    severity: Literal["error", "warning", "info"]
    message: str
    source_ids: list[str] = Field(default_factory=list)
    field: Optional[str] = None


class CashEvent(BaseModel):
    """One dated cash movement (an open invoice portion or a planned flow). Each portion appears once."""
    event_id: str
    source_type: Literal["sales_invoice", "purchase_invoice", "plan"]
    source_id: str
    portion_id: str = "P1"
    direction: Direction
    category: str
    counterparty_id: Optional[str] = None
    counterparty_name: Optional[str] = None
    amount_vnd: Money
    original_date: Optional[Date] = None  # due date (+ delay) before the overdue roll
    base_date: Optional[Date] = None      # date after the overdue roll (T2-05 / T2-06)
    cash_date: Optional[Date] = None      # active date after any case shift; None when unscheduled
    date_method: str                      # confirmed_schedule | history_late_positive | fallback_on_time | approved_schedule | due_date | plan | unscheduled
    roll_applied: bool = False
    case_shift_days: int = 0
    delay_days_applied: Optional[int] = None
    scope: Literal["in_horizon", "beyond_horizon", "unscheduled"]
    formula_id: str
    assumption_ids: list[str] = Field(default_factory=list)


class DailyForecast(BaseModel):
    date: Date
    week_number: int
    opening_vnd: Money
    in_vnd: Money
    out_vnd: Money
    closing_vnd: Money
    gap_buffer_vnd: Money
    gap_zero_vnd: Money
    gap_ratio: Optional[float] = None       # raw ratio, never rounded before classification
    alert_color: AlertColor
    severity: int = 0
    alert_rule_id: str = ""                 # which rule produced the colour (see inputs.alert_config.rules)
    alert_threshold: Optional[float] = None  # the threshold the raw ratio was compared with


class WeeklyForecast(BaseModel):
    week_number: int
    start_date: Date
    end_date: Date
    opening_vnd: Money
    in_vnd: Money
    out_vnd: Money
    closing_vnd: Money
    min_daily_vnd: Optional[Money] = None
    alert_color: AlertColor = Field(..., description="Alert on the END-OF-WEEK closing balance. The worst daily alert is a separate field.")
    gap_buffer_vnd: Money                   # gap to buffer at week end
    gap_zero_vnd: Money                     # gap to zero at week end
    min_daily_date: Optional[Date] = None
    worst_daily_alert_color: AlertColor = "unknown"  # worst alert on any day of the week (kept separate from alert_color)
    max_daily_gap_buffer_vnd: Optional[Money] = None
    max_daily_gap_zero_vnd: Optional[Money] = None
    negative_days: int = 0
    below_buffer_days: int = 0
    alert_rule_id: str = ""                 # rule behind the end-of-week alert
    alert_threshold: Optional[float] = None
    gap_ratio: Optional[float] = None       # raw end-of-week ratio (None when the buffer is 0)


class Episode(BaseModel):
    """A run of consecutive days below the buffer (basis="buffer") or below zero (basis="zero")."""
    basis: Literal["buffer", "zero"]
    grain: str = "daily"
    start_date: Date
    end_date: Date
    duration_days: int
    peak_date: Date
    peak_gap_vnd: Money
    recovery_date: Optional[Date] = None
    censored: bool = False                  # not recovered by the end of the horizon
    started_before_horizon: bool = False   # already below the threshold at the cut-off date


class CashForecastSummary(BaseModel):
    firm_id: str
    as_of: Date
    cash0_vnd: Optional[Money] = None
    buffer_vnd: Optional[Money] = None
    horizon_weeks: int = 13
    first_gap_week: Optional[int] = Field(None, description="Week number (1-indexed) of the first forecast day below the buffer. Hand-off to UC-03.")
    max_gap_vnd: Optional[Money] = Field(None, description="Peak gap to the cash buffer in VND (basis in max_gap_basis). The gap to zero is peak_zero_gap_vnd; the two are never added. Hand-off to UC-03.")
    first_buffer_date: Optional[Date] = None
    first_negative_date: Optional[Date] = None
    status: str = Field("provisional", description="ok | provisional (demo data or assumptions) | missing_data | invalid_data.")
    # --- additional fields from the SRS contract ---
    start_date: Optional[Date] = None
    end_date: Optional[Date] = None
    case_id: str = "base"
    grain: str = "daily"
    max_gap_basis: str = "buffer"
    max_gap_date: Optional[Date] = None
    first_highest_date: Optional[Date] = None
    min_balance_vnd: Optional[Money] = Field(None, description="Lowest end-of-day balance in the horizon (earliest day on ties).")
    min_balance_date: Optional[Date] = None
    peak_buffer_gap_vnd: Optional[Money] = None
    peak_buffer_gap_date: Optional[Date] = None
    peak_zero_gap_vnd: Optional[Money] = None  # alternative measure of the same point; never add to the buffer gap
    peak_zero_gap_date: Optional[Date] = None
    total_in_vnd: Optional[Money] = None
    total_out_vnd: Optional[Money] = None
    closing_end_vnd: Optional[Money] = None
    initial_alert_color: AlertColor = "unknown"
    initial_below_buffer: Optional[bool] = None
    overall_level: AlertColor = "unknown"   # unknown when data coverage is incomplete
    observed_level: Optional[AlertColor] = None
    breach_status: Literal["breach", "no_breach", "unknown"] = "unknown"
    first_buffer_week_closing: Optional[int] = None   # weekly grain: first week whose END-OF-WEEK cash is below the buffer
    first_negative_week_closing: Optional[int] = None  # weekly grain: first week whose end-of-week cash is negative


class BuyerDelay(BaseModel):
    """T2-04: positive late-payment delay per buyer, taken from the UC-01 result (180-day window, min 5 invoices)."""
    buyer_id: str
    buyer_name: str
    history_invoice_count: int = 0
    delay_raw_days: Optional[float] = None
    delay_used_days: float = 0.0
    delay_ceil_days: int = 0
    method: str
    formula_id: str = "T2-04"


class CriticalDate(BaseModel):
    """T2-16: cumulative decomposition of the balance at a notable date."""
    kinds: list[str]
    date: Date
    week_number: int
    opening_vnd: Money
    in_on_date_vnd: Money
    out_on_date_vnd: Money
    cumulative_in_vnd: Money
    cumulative_out_vnd: Money
    closing_vnd: Money
    week_closing_vnd: Money
    gap_buffer_vnd: Money
    gap_zero_vnd: Money
    gap_ratio: Optional[float] = None
    alert_color: AlertColor


class EventRef(BaseModel):
    event_id: str
    category: str
    counterparty_name: Optional[str] = None
    amount_vnd: Money
    date: Date
    source_ref: str
    date_method: str


class DatedEvents(BaseModel):
    date: Date
    items: list[EventRef] = Field(default_factory=list)


class BuyerReceiptShare(BaseModel):
    """T2-17: share of expected receipts (whole forecast) coming from one buyer; not the TV1 receivable share."""
    buyer_id: str
    buyer_name: str
    receipts_vnd: Money
    share: Optional[float] = None


class ForecastDrivers(BaseModel):
    critical_dates: list[CriticalDate] = Field(default_factory=list)
    dated_outflows: list[DatedEvents] = Field(default_factory=list)    # top 3 outflows ON each critical date
    receipts_on_date: list[DatedEvents] = Field(default_factory=list)  # top 3 receipts ON each critical date
    receipts_after: list[DatedEvents] = Field(default_factory=list)    # top 3 receipts AFTER each critical date, in horizon
    buyer_receipt_shares: list[BuyerReceiptShare] = Field(default_factory=list)
    buyer_delays: list[BuyerDelay] = Field(default_factory=list)


class ForecastReconciliation(BaseModel):
    cash_delta_vnd: Optional[Money] = None            # (closing_end - cash0) - (total_in - total_out)
    weekly_daily_delta_vnd: Optional[Money] = None    # |sum weekly - sum daily| for in and out
    closing_mismatches: int = 0                       # weeks whose closing differs from the last day's closing
    decomposition_delta_vnd: Optional[Money] = None   # T2-16 check at critical dates
    source_delta_vnd: dict[str, Money] = Field(default_factory=dict)  # raw control total - scheduled (all scopes), per source
    tolerance_vnd: Money = Decimal(1)
    status: Literal["ok", "failed", "not_run"] = "not_run"
    evidence_refs: list[str] = Field(default_factory=list)
    details: dict[str, Any] = Field(default_factory=dict)


class DataQuality(BaseModel):
    grain: str = "daily"
    coverage_status: Literal["complete", "incomplete"] = "complete"
    unscheduled_amounts: dict[str, Money] = Field(default_factory=dict)
    beyond_horizon_amounts: dict[str, Money] = Field(default_factory=dict)
    omitted_activity: list[str] = Field(default_factory=list)
    plans_status: str = "not_loaded"
    issues: list[ForecastIssue] = Field(default_factory=list)


class ForecastMetric(BaseModel):
    id: str
    formula_id: str
    name: str
    raw_value: Optional[Union[int, float, str]] = None  # money as int/str VND, dates as ISO strings; never used for further maths
    raw_type: str = "integer"                           # integer | decimal | ratio | date | count
    display_value: Optional[str] = None                 # neutral display only; the narrative layer formats for the reader
    unit: str
    status: str = "provisional"
    reason_code: Optional[str] = None
    method: Optional[str] = None
    source_basis: str = "end_of_day"
    evidence_ids: list[str] = Field(default_factory=list)
    assumption_ids: list[str] = Field(default_factory=list)


class Assumption(BaseModel):
    id: str
    text: str


class ForecastMeta(BaseModel):
    run_id: str
    firm_id: str
    snapshot_id: Optional[str] = None
    as_of: Date
    start_date: Date
    end_date: Date
    horizon_weeks: int
    case_id: str = "base"
    currency: str = "VND"
    generated_at: str
    schema_version: str = SCHEMA_VERSION
    formula_version: str = FORMULA_VERSION
    config_version: str = CONFIG_VERSION
    source_run_ids: dict[str, str] = Field(default_factory=dict)  # e.g. {"UC01": "run-ab12..."}
    data_is_synthetic: bool = True
    grain: str = "daily"
    source_files: list[str] = Field(default_factory=list)
    source_checksum: Optional[str] = None  # sha256 over the source files; re-checked before release (STALE_SNAPSHOT)
    weekly_only: bool = Field(False, description="True when the payload was trimmed to the weekly schedule: no daily rows, events, episodes or per-date drivers.")


class AlertRule(BaseModel):
    rule_id: str
    level: AlertColor
    condition: str
    threshold_value: Optional[float] = None


class AlertConfig(BaseModel):
    basis: str = "buffer_gap_ratio"
    grain: str = "daily and weekly"
    config_version: str = CONFIG_VERSION
    yellow_upper: float = 0.2
    orange_upper: float = 0.5
    rules: list[AlertRule] = Field(default_factory=list)


class ForecastInputs(BaseModel):
    cash_at_cutoff_vnd: Optional[Money] = None
    restricted_vnd: Optional[Money] = None
    cash0_vnd: Optional[Money] = None
    buffer_vnd: Optional[Money] = None
    lookback_days: int = 180
    min_count: int = 5
    fallback_days: int = 0
    extra_days: int = 0
    yellow_upper: float = 0.2
    orange_upper: float = 0.5
    alert_config: Optional[AlertConfig] = None
    source_refs: list[str] = Field(default_factory=list)
    assumptions: list[Assumption] = Field(default_factory=list)


class Evidence(BaseModel):
    """Source rows and the aggregate that support a number or a finding (SRS 3.10.3.6)."""
    evidence_id: str
    run_id: str
    snapshot_id: Optional[str] = None
    firm_id: str
    source_table: str
    source_record_ids: list[str] = Field(default_factory=list)
    source_columns: list[str] = Field(default_factory=list)
    filter_definition: str = ""
    aggregate_expression: str = ""
    aggregate_value: Optional[Union[int, float, str]] = None
    calculation_version: str = FORMULA_VERSION


class Fact(BaseModel):
    """One checkable fact. The narrative may only quote facts from the current run, through [[FACT:id]] tokens."""
    fact_id: str
    label: str
    field_path: str
    canonical_value: Optional[Union[int, float, str]] = None
    display_forms: dict[str, str] = Field(default_factory=dict)  # presentation layer fills "en"; "raw" is neutral
    unit: str                                                    # VND | date | ratio | count | days | text | entity
    entity_id: Optional[str] = None
    date: Optional[str] = None
    method: str = ""
    grain: str = "daily"          # daily | weekly | period
    basis: str = ""               # end_of_day | end_of_week | buffer | zero | receipts | assumption ...
    case: str = "base"
    status: str = "provisional"
    evidence_ids: list[str] = Field(default_factory=list)
    allowed_claim_types: list[str] = Field(default_factory=list)
    attributes: dict[str, Any] = Field(default_factory=dict)     # extras such as category / counterparty for flow facts


class Insight(BaseModel):
    insight_id: str
    theme: str
    observation_type: str
    priority: int
    observation: str
    interpretation: str
    metric_refs: list[str] = Field(default_factory=list)
    evidence_refs: list[str] = Field(default_factory=list)
    assumption_ids: list[str] = Field(default_factory=list)
    limitation_ids: list[str] = Field(default_factory=list)


class Capabilities(BaseModel):
    grain: str = "daily"
    daily_schedule: bool = True
    weekly_schedule: bool = True
    drill_down: bool = True
    weekly_only: bool = False
    scenario_cases: list[str] = Field(default_factory=lambda: ["base", "estimated_receipts_late"])
    coverage_status: str = "complete"
    omitted_activity: list[str] = Field(default_factory=list)
    unscheduled_amounts: dict[str, Money] = Field(default_factory=dict)
    beyond_horizon_amounts: dict[str, Money] = Field(default_factory=dict)
    not_supported: list[str] = Field(default_factory=lambda: ["weekly_only input (no day-level source needed)", "future sales", "new borrowing"])


class NarrativeClaim(BaseModel):
    section_key: str
    fact_ids: list[str]
    claim_type: str
    entity_id: Optional[str] = None
    basis: Optional[str] = None
    grain: Optional[str] = None
    case: Optional[str] = None


class Narrative(BaseModel):
    """Filled by the agent layer after validation; the engine only supplies facts."""
    overview: str = ""
    critical_periods: str = ""
    drivers: str = ""
    assumptions_and_limits: str = ""
    claims: list[NarrativeClaim] = Field(default_factory=list)
    generation_status: str = "not_generated"
    validation_outcome: str = "not_run"
    fact_refs: list[str] = Field(default_factory=list)
    locale: str = "en"


class AuditRef(BaseModel):
    run_id: str
    audit_log: str = "logs/audit.jsonl"
    release_status: str = "pending_release"  # the agent writes response_released only after validation and audit succeed


class CashForecastResult(BaseModel):
    schema_version: str = SCHEMA_VERSION
    formula_version: str = FORMULA_VERSION
    config_version: str = CONFIG_VERSION
    meta: ForecastMeta
    inputs: ForecastInputs
    summary: CashForecastSummary
    weekly_schedule: list[WeeklyForecast] = Field(default_factory=list)
    daily_schedule: Optional[list[DailyForecast]] = Field(None, description="One row per forecast day. Null (never inferred) when the payload is weekly_only or the run is blocked.")
    episodes: list[Episode] = Field(default_factory=list)
    cash_events: list[CashEvent] = Field(default_factory=list)
    drivers: ForecastDrivers = Field(default_factory=ForecastDrivers)
    data_quality: DataQuality = Field(default_factory=DataQuality)
    reconciliation: ForecastReconciliation = Field(default_factory=ForecastReconciliation)
    metrics: list[ForecastMetric] = Field(default_factory=list)
    issues: list[ForecastIssue] = Field(default_factory=list)          # same list as data_quality.issues (SRS envelope)
    capabilities: Capabilities = Field(default_factory=Capabilities)
    insights: list[Insight] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    fact_registry: dict[str, Fact] = Field(default_factory=dict)
    narrative: Optional[Narrative] = Field(None, description="Deterministic English engine summary in `overview`. The agent layer produces and validates the full four-section text separately.")
    audit_ref: Optional[AuditRef] = None
    warnings: list[str] = Field(default_factory=list)
    explanation: str = ""
