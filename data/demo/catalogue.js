/* DEMO financing & action catalogue for UC03 — FICTIONAL.
   Spec BR-03.1/BR-03.5: rates, fees and conditions only come from this catalogue; provider names are fictional
   and every figure is simulated. Nothing here is a lender offer, a credit approval or a funding commitment.
   Firm-level constraints (essential suppliers, pledged lots, debt headroom LQ17, approved credit line) are
   demo assumptions that the owner would confirm; they are not read from the engine. */
window.LILACT_DEMO = window.LILACT_DEMO || {};
window.LILACT_DEMO.catalogue = {
  version: "catalogue.demo.v1",
  source: "simulated",
  products: [
    { product_id: "AR-COMMIT", type: "ar_commitment", group: 2, group_label: "Thu hồi, điều chỉnh thương mại",
      name: "Đối chiếu chứng từ và xin ngày cam kết thanh toán", provider: "Nội bộ doanh nghiệp",
      lead_days: 0, annual_rate: 0, fee_pct: 0, certainty: "low", relationship_burden: 2,
      note: "Chỉ có tác dụng khi khách xác nhận ngày trả; không sửa due_date của hóa đơn đang có." },
    { product_id: "SUP-EXTEND", type: "supplier_extension", group: 2, group_label: "Thu hồi, điều chỉnh thương mại",
      name: "Giãn một hóa đơn NCC không thiết yếu có thỏa thuận", provider: "Nội bộ doanh nghiệp",
      lead_days: 0, extend_days: 30, annual_rate: 0, fee_pct: 0, certainty: "medium", relationship_burden: 2,
      note: "Không giãn NCC thiết yếu hoặc NCC do buyer chỉ định; không chậm lương, thuế." },
    { product_id: "INV-PLEDGE", type: "inventory_pledge", group: 3, group_label: "Hàng, chứng từ đang có",
      name: "Vay cầm cố hàng tồn của chính doanh nghiệp", provider: "Ngân hàng Hoa Tử Đinh (hư cấu)",
      lead_days: 5, annual_rate: 0.10, fee_pct: 0.003, advance_rate: 0.5, tenor_days: 90, certainty: "medium", relationship_burden: 1 },
    { product_id: "INV-SELL", type: "inventory_sale", group: 3, group_label: "Hàng, chứng từ đang có",
      name: "Bán phần tồn kho đã có người mua", provider: "Nội bộ doanh nghiệp",
      lead_days: 7, annual_rate: 0, fee_pct: 0, certainty: "low", relationship_burden: 1 },
    { product_id: "LINE-REV", type: "credit_line", group: 4, group_label: "Hạn mức còn trống",
      name: "Rút hạn mức tín dụng đã duyệt", provider: "Ngân hàng Hoa Tử Đinh (hư cấu)",
      lead_days: 1, annual_rate: 0.09, fee_pct: 0, tenor_days: 90, certainty: "high", relationship_burden: 1 },
    { product_id: "FACT-AR", type: "factoring", group: 5, group_label: "Tài trợ mới (danh mục)",
      name: "Bao thanh toán đúng hóa đơn của khách", provider: "Công ty Tài chính Mầm Xanh (hư cấu)",
      lead_days: 3, annual_rate: 0.11, fee_pct: 0.005, advance_rate: 0.8, certainty: "high", relationship_burden: 1 },
    { product_id: "LOAN-NEW", type: "new_loan", group: 5, group_label: "Tài trợ mới (danh mục)",
      name: "Khoản vay ngắn hạn mới", provider: "Ngân hàng Sương Sớm (hư cấu)",
      lead_days: 10, annual_rate: 0.12, fee_pct: 0.01, tenor_days: 90, certainty: "medium", relationship_burden: 1 }
  ],
  firms: {
    F01: { credit_line_headroom_vnd: 300000000, debt_headroom_vnd: 1500000000,
      essential_suppliers: ["Nhà phân phối vải Beta (F02)"], pledged_lot_ids: ["ALL-OWNED-LOTS"],
      inventory_buyer_evidence: false, note: "Toàn bộ lô tồn thuộc sở hữu đã cầm cố cho khoản vay hiện hữu (giả định demo)." },
    F02: { credit_line_headroom_vnd: 600000000, debt_headroom_vnd: 2000000000,
      essential_suppliers: [], pledged_lot_ids: [], inventory_buyer_evidence: false, note: "" },
    F03: { credit_line_headroom_vnd: 200000000, debt_headroom_vnd: 800000000,
      essential_suppliers: [], pledged_lot_ids: [], inventory_buyer_evidence: false, note: "" }
  }
};
