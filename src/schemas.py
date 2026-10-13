"""Pydantic schemas for UC-01. JSON payload keeps raw values and formula evidence."""
from __future__ import annotations
from typing import Any, Optional
from pydantic import BaseModel, Field
SCHEMA_VERSION = "tv1.result.v1"
FORMULA_VERSION = "tv1.formulas.v4"

class Meta(BaseModel):
    run_id: str
    firm_id: str
    as_of: str
    period_start: str
    period_end: str
    period_days: int
    formula_version: str = FORMULA_VERSION
    snapshot_id: str
    currency: str = "VND"
    lookback_start: str | None = None
    lookback_end: str | None = None
    generated_at: str | None = None
    data_source: str | None = None
    data_is_synthetic: bool = True
    config_version: str = "tv1.demo.v1"
    balance_method: str = "closing_snapshot"
    mode: str = "demo_v4"

class Inputs(BaseModel):
    revenue_vnd: float | None = None
    revenue_credit_vnd: float | None = None
    cogs_vnd: float | None = None
    ar_vnd: float | None = None
    inv_vnd: float | None = None
    ap_vnd: float | None = None
    pur_vnd: float | None = None
    pur_credit_vnd: float | None = None
    excluded_inventory_vnd: float = 0.0
    balance_method: str = "closing_snapshot"
    tax_basis: str = "net_of_VAT"
    credit_sales_assumption: str = "assume_all_revenue_credit_sales_for_sample"
    credit_purchases_assumption: str = "assume_all_purchases_are_credit_for_sample"

class MetricItem(BaseModel):
    id: str
    name: str
    raw_value: Optional[float] = None
    raw_type: str = "number"
    display_value: Optional[str] = None
    display_number: Optional[float] = None  # số đã làm tròn cho consumer cũ; không dùng để tính tiếp
    unit: str
    status: str = "provisional"
    reason: str | None = None
    reason_code: str | None = None
    source_basis: str = "closing_snapshot"
    dependency_ids: list[str] = Field(default_factory=list)
    assumption_ids: list[str] = Field(default_factory=list)
    limitation_ids: list[str] = Field(default_factory=list)
    numerator: float | None = None
    denominator: float | None = None
    period_days: int | None = None
    method: str = "closing_snapshot"
    formula_id: str
    evidence_ids: list[str] = Field(default_factory=list)

class MoneyMetrics(BaseModel):
    revenue_per_day_vnd: Optional[float] = None
    cogs_per_day_vnd: Optional[float] = None
    purchases_per_day_vnd: Optional[float] = None
    credit_purchases_per_day_vnd: Optional[float] = None
    trade_working_capital_vnd: float | None = None
    cash_per_1_day_dso_vnd: Optional[float] = None
    cash_per_1_day_dio_vnd: Optional[float] = None
    cash_per_1_day_dpo_vnd: Optional[float] = None
    interpretation: dict[str, Any] = Field(default_factory=dict)

class BuyerDriver(BaseModel):
    buyer_id: str
    buyer_name: str = ""
    ar_vnd: float
    share_of_ar: float
    dso_days: Optional[float] = None
    overdue_ar_vnd: float
    overdue_share: float
    aging_vnd: dict[str, float]
    overdue_share_of_total_ar: float = 0.0
    late_positive_wavg_days: Optional[float] = None
    late_signed_wavg_days: Optional[float] = None
    early_wavg_days: Optional[float] = None
    collection_days_wavg: Optional[float] = None
    avg_terms_days: Optional[float] = None
    max_days_past_due: int = 0
    open_invoice_count: int = 0
    overdue_invoice_count: int = 0
    history_invoice_count: int = 0
    paid_amount_vnd: float = 0.0
    coverage_status: str = "ok"
    behaviour_late: bool = False
    evidence_ids: list[str] = Field(default_factory=list)

class ProductDriver(BaseModel):
    product_id: str
    product_name: str = ""
    category: str = ""
    inv_vnd: float
    share_of_inv: float
    dio_days: Optional[float] = None
    slow_threshold_days: Optional[int] = None
    max_days_in_stock: int = 0
    slow_moving_value_vnd: float = 0.0
    slow_flag: bool = False
    age_value_wavg_days: float | None = None
    lot_count: int = 0
    committed_demand_qty: float | None = None
    weeks_cover: float | None = None
    cancelled_order_value_vnd: float | None = None
    valuation_status: str = "cost_only_nrv_missing"
    evidence_ids: list[str] = Field(default_factory=list)

class DiscountOpportunity(BaseModel):
    purchase_id: str
    base_vnd: float
    discount_rate: float
    days_early: int
    saving_vnd: float
    simple_annual_rate_pct: float
    early_payment_date: str | None = None
    normal_due_date: str | None = None
    cash_required_vnd: float | None = None
    ear_pct: float | None = None
    eligibility_status: str = "eligible_at_as_of"

class SupplierDriver(BaseModel):
    supplier_id: str
    supplier_name: str = ""
    ap_vnd: float
    share_of_ap: float
    dpo_days: Optional[float] = None
    overdue_ap_vnd: float
    overdue_share: float
    early_payment_saving_vnd: float = 0.0
    discount_opportunities: list[DiscountOpportunity] = Field(default_factory=list)
    purchases_in_period_vnd: float = 0.0
    purchase_share: float | None = None
    critical_supplier: bool | None = None
    avg_terms_days: float | None = None
    payment_late_wavg_days: float | None = None
    history_payment_count: int = 0
    open_invoice_count: int = 0
    overdue_invoice_count: int = 0
    max_days_past_due: int = 0
    due_today_vnd: float | None = None
    due_7d_vnd: float | None = None
    due_30d_vnd: float | None = None
    short_terms: bool = False
    due_basis: str = "net_of_VAT"
    evidence_ids: list[str] = Field(default_factory=list)

class Drivers(BaseModel):
    buyers: list[BuyerDriver] = Field(default_factory=list)
    products: list[ProductDriver] = Field(default_factory=list)
    suppliers: list[SupplierDriver] = Field(default_factory=list)
    receivables_aging_vnd: dict[str, Any] = Field(default_factory=dict)
    concentration: dict[str, Any] = Field(default_factory=dict)
    inventory_exclusions: list[dict[str, Any]] = Field(default_factory=list)
    early_payment_discounts: list[dict[str, Any]] = Field(default_factory=list)
    ranked_views: dict[str, Any] = Field(default_factory=dict)

class Reconciliation(BaseModel):
    matches_ar: bool
    matches_inv: bool
    matches_ap: bool
    matches_ccc: bool
    details: dict[str, float] = Field(default_factory=dict)
    tolerance_vnd: float = 1.0
    tolerance_days: float = 1e-8

class WorkingCapitalResult(BaseModel):
    schema_version: str = SCHEMA_VERSION
    status: str = "provisional"
    meta: Meta
    inputs: Inputs
    result_metrics: list[MetricItem]
    money: MoneyMetrics
    drivers: Drivers
    reconciliation: Reconciliation
    explanation: str
    warnings: list[str] = Field(default_factory=list)
    data_quality: list[dict[str, Any]] = Field(default_factory=list)
    unsupported_metrics: list[dict[str, Any]] = Field(default_factory=list)
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    compatibility: dict[str, Any] = Field(default_factory=dict)
    explanation_detail: dict[str, Any] = Field(default_factory=dict)
    analysis: dict[str, Any] = Field(default_factory=dict)
    insights: list[dict[str, Any]] = Field(default_factory=list)
    actions: list[dict[str, Any]] = Field(default_factory=list)
    narrative: dict[str, Any] = Field(default_factory=dict)
    benchmark: list[dict[str, Any]] = Field(default_factory=list)