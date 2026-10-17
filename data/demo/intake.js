/* UC00 source contract: which sheet/file feeds which canonical field. This mirrors the engine's loader
   (src/core/data_loader.py on feature/uc1-uc2-full) and is documentation for the mapping screen, not data. */
window.LILACT_DEMO = window.LILACT_DEMO || {};
window.LILACT_DEMO.intake = {
  sources: [
    { id: "D_firms", file: "uc1_workbook.xlsx", kind: "Hồ sơ doanh nghiệp", evidence_table: null,
      fields: [["firm_id", "firm_id"], ["name", "Tên DN"], ["industry", "Ngành"], ["min_cash_buffer_vnd", "Mức dự phòng tối thiểu (dùng làm Rmin)"]] },
    { id: "D_financials", file: "uc1_workbook.xlsx", kind: "Số liệu kỳ", evidence_table: null,
      fields: [["period, period_days", "Kỳ báo cáo, N"], ["revenue_vnd", "Doanh thu (Rev)"], ["cogs_vnd", "Giá vốn (COGS)"], ["opening_cash_vnd", "Tiền tại ngày chốt (Cash0, proxy)"]] },
    { id: "D_sales", file: "uc1_workbook.xlsx", kind: "Hóa đơn bán", evidence_table: "D_sales",
      fields: [["invoice_id", "Mã hóa đơn"], ["buyer", "Khách hàng (entity_id)"], ["amount_vnd", "Số tiền chưa VAT"], ["issue_date / due_date / paid_date", "Ngày phát hành / hạn / ngày trả"]] },
    { id: "D_purchases", file: "uc1_workbook.xlsx", kind: "Hóa đơn mua", evidence_table: "D_purchases",
      fields: [["invoice_id", "Mã hóa đơn"], ["supplier", "Nhà cung cấp"], ["amount_vnd", "Số tiền chưa VAT"], ["early_discount_pct, discount_days", "Chiết khấu trả sớm"]] },
    { id: "D_inventory", file: "uc1_workbook.xlsx", kind: "Tồn kho theo lô", evidence_table: "D_inventory",
      fields: [["product_line, inventory_type", "Dòng hàng, loại"], ["days_in_stock", "Tuổi tồn"], ["value_vnd, value_own", "Giá trị, phần thuộc sở hữu"], ["excluded", "Hàng gia công bị loại"]] },
    { id: "cash_plans.csv", file: "cash_plans.csv", kind: "Kế hoạch thu chi", evidence_table: null,
      fields: [["event_id, date, direction", "Mã, ngày, chiều"], ["category", "Lương, thuế, vay, thuê, vật tư, đầu tư"], ["amount_vnd", "Số tiền"], ["known_at", "Ngày biết khoản này"]] }
  ]
};
