/* DEMO policy defaults (demo_assumption). No available spec gives the values of Rtarget, Rupper or the
   W materiality thresholds; the workflow says "chính sách chủ DN đứng trước". These numbers are only
   PROPOSALS shown in UC00 step "Chính sách ngưỡng"; nothing is classified until the owner confirms them.
   Rmin is the engine's own D_firms.min_cash_buffer_vnd (mapping buffer → Rmin is itself an assumption,
   see docs/CONFLICTS.md #3). */
(function (root) {
  "use strict";
  var DEMO = root.LILACT_DEMO = root.LILACT_DEMO || {};
  DEMO.policyDefaults = function (bufferVnd) {
    return {
      source: "demo_assumption",
      rmin_vnd: bufferVnd,
      rtarget_vnd: Math.round(bufferVnd * 1.5),
      rupper_vnd: Math.round(bufferVnd * 3),
      surplus_min_days: 14,
      w_material_vnd: 500000000,
      w_material_pct_twc: 0.05,
      assumption_text: "Rtarget = 1,5 × Rmin; Rupper = 3 × Rmin; trọng yếu W2 khi số tiền ≥ 500 triệu VND và ≥ 5% TWC. Đề xuất demo, chưa phải chính sách đã duyệt."
    };
  };
})(typeof window !== "undefined" ? window : globalThis);
