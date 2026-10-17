/* Lilact · the two matrix axes (DEMO rules, labelled as such in the UI).
   - W (Task 1): W0 chưa thấy dấu hiệu · W1 cần theo dõi · W2 điểm nghẽn trọng yếu · unknown nếu thiếu dữ liệu.
     The workflow says signals come from UC01 rules and materiality is "VND và % (đã duyệt)" by the owner.
     No spec defines the threshold values, so they come from the policy object (demo_assumption until the
     owner confirms them in UC00). A missing threshold makes the axis unknown instead of guessing.
   - TH (Task 2): TH01 thiếu (có ngày dưới Rtarget) · TH02 cân bằng · TH03 dư (trên Rupper ≥ 14 ngày).
     "dư đầu kỳ nhưng thiếu cuối kỳ → cột TH01"; "đợt hỗn hợp dư + thiếu → TH01, giữ cờ mixed". */
(function (root) {
  "use strict";
  var L = root.Lilact = root.Lilact || {};
  L.rules = L.rules || {};
  var ledger = L.rules.ledger || (typeof require !== "undefined" && require("./ledger.js"));

  // Which UC01 metric is the money behind each UC01 insight. Concentration is a signal without a
  // money_at_risk ("không tự chứng minh khách hàng trả chậm"), so it can raise W1 but never W2 alone.
  var SIGNAL_MONEY = {
    "INS-AR-OVERDUE": "ar_overdue_vnd",
    "INS-INVENTORY-SLOW": "slow_inventory_vnd",
    "INS-AP-OVERDUE": "ap_overdue_vnd",
    "INS-AR-CONCENTRATION": null
  };

  function metricMap(uc01) {
    var m = {};
    (uc01.result_metrics || []).forEach(function (x) { m[x.id] = x; });
    return m;
  }

  function classifyW(uc01, policy) {
    if (!uc01 || uc01.status === "invalid_data" || uc01.status === "missing_data")
      return { w: "unknown", reason: "UC01 không có kết quả hợp lệ (trạng thái " + (uc01 && uc01.status) + ").", signals: [], rule_id: "W-DEMO-01" };
    var m = metricMap(uc01);
    var twc = Number(uc01.money && uc01.money.trade_working_capital_vnd);
    var signals = (uc01.insights || []).map(function (ins) {
      var key = SIGNAL_MONEY[ins.insight_id];
      var metric = key ? m[key] : null;
      var money = metric && metric.raw_value != null ? Number(metric.raw_value) : null;
      return { insight_id: ins.insight_id, observation: ins.observation, metric_id: key, money_at_risk_vnd: money,
        share_of_twc: money != null && twc ? money / twc : null, formula_ids: ins.formula_ids || [], evidence_refs: ins.evidence_refs || [] };
    });
    if (!signals.length) return { w: "W0", reason: "Không có quy tắc UC01 nào kích hoạt.", signals: signals, rule_id: "W-DEMO-01" };
    var vnd = policy.w_material_vnd, pct = policy.w_material_pct_twc;
    if (vnd == null || pct == null)
      return { w: "unknown", reason: "Có tín hiệu nhưng chưa có ngưỡng trọng yếu (VND và % TWC) được duyệt, nên chưa phân được W1 hay W2.", signals: signals, rule_id: "W-DEMO-01" };
    signals.forEach(function (s) { s.material = s.money_at_risk_vnd != null && s.money_at_risk_vnd >= vnd && s.share_of_twc >= pct; });
    var material = signals.filter(function (s) { return s.material; });
    if (material.length) return { w: "W2", reason: material.length + " tín hiệu vượt cả ngưỡng VND và ngưỡng % TWC.", signals: signals, rule_id: "W-DEMO-01" };
    return { w: "W1", reason: "Có " + signals.length + " tín hiệu, chưa tín hiệu nào vượt ngưỡng trọng yếu.", signals: signals, rule_id: "W-DEMO-01" };
  }

  function classifyTH(rows, policy) {
    var rt = policy.rtarget_vnd, ru = policy.rupper_vnd;
    if (rt == null || ru == null || !rows || !rows.length)
      return { th: "unknown", reason: "Thiếu Rtarget hoặc Rupper đã duyệt, hoặc thiếu đường tiền theo ngày.", episodes: [], windows: [], rule_id: "TH-DEMO-01" };
    var eps = ledger.episodesBelow(rows, rt);
    var wins = ledger.windowsAbove(rows, ru, policy.surplus_min_days || 14);
    var belowRmin = policy.rmin_vnd != null && rows.some(function (r) { return r.closing_vnd < policy.rmin_vnd; });
    if (eps.length) return { th: "TH01", mixed: wins.length > 0, below_rmin: belowRmin, episodes: eps, windows: wins, rule_id: "TH-DEMO-01",
      reason: "Có " + eps.length + " đợt tiền dưới Rtarget" + (wins.length ? "; cũng có cửa sổ dư, giữ cờ mixed." : ".") };
    if (wins.length) return { th: "TH03", mixed: false, below_rmin: false, episodes: [], windows: wins, rule_id: "TH-DEMO-01",
      reason: "Không ngày nào dưới Rtarget; có " + wins.length + " cửa sổ trên Rupper từ " + (policy.surplus_min_days || 14) + " ngày trở lên." };
    return { th: "TH02", mixed: false, below_rmin: false, episodes: [], windows: [], rule_id: "TH-DEMO-01",
      reason: "Không ngày nào dưới Rtarget và không có cửa sổ trên Rupper đủ dài." };
  }

  L.rules.classify = { SIGNAL_MONEY: SIGNAL_MONEY, classifyW: classifyW, classifyTH: classifyTH, metricMap: metricMap };
  if (typeof module !== "undefined") module.exports = L.rules.classify;
})(typeof window !== "undefined" ? window : globalThis);
