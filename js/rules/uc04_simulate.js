/* Lilact · UC04 / Task 4 what-if (DEMO rule layer).
   ① Clone từ base → ② áp hành động thành dòng tiền → ③ base + adverse → ④ trước / sau → ⑤ verdict.
   Adverse = the engine's own "estimated_receipts_late" run (same snapshot), so the stress is not invented here.
   Verdicts (workflow): robustly_resolved · base_resolved_stress_exposed · resolved_with_shifted_risk ·
   partial · not_resolved · inconclusive (thiếu coverage → chưa kết luận).
   Actual DSO/DIO/DPO are unchanged by a simulation — the UI says so. */
(function (root) {
  "use strict";
  var L = root.Lilact = root.Lilact || {};
  L.rules = L.rules || {};
  var ledger = L.rules.ledger || (typeof require !== "undefined" && require("./ledger.js"));
  var scenario = L.rules.scenario || (typeof require !== "undefined" && require("./scenario.js"));
  var uc03 = L.rules.uc03 || (typeof require !== "undefined" && require("./uc03_match.js"));

  var VERDICT = {
    robustly_resolved: { label: "Bền: đạt cả base và stress", tone: "success" },
    base_resolved_stress_exposed: { label: "Chỉ đạt base, hỏng ở kịch bản xấu", tone: "warning" },
    resolved_with_shifted_risk: { label: "Đạt, nhưng đợt khác xấu đi", tone: "warning" },
    partial: { label: "Một phần: mới tránh dưới Rmin, chưa về Rtarget", tone: "warning" },
    not_resolved: { label: "Không giải quyết", tone: "error" },
    inconclusive: { label: "Chưa kết luận: thiếu coverage dữ liệu", tone: "neutral" }
  };

  function opsFor(products, ctx) {
    var ops = [], problems = [];
    products.forEach(function (p) {
      var b = uc03.build(p, ctx);
      if (b.reject) problems.push(p.product_id + ": " + b.reject); else ops = ops.concat(b.ops);
    });
    return { ops: ops, problems: problems };
  }

  /** products: catalogue rows chosen in UC03. ctxBase/ctxAdverse: UC03 contexts on the base and adverse runs. */
  function simulate(products, ctxBase, ctxAdverse, runSeq) {
    var policy = ctxBase.policy, ep = ctxBase.episode;
    var bOps = opsFor(products, ctxBase), aOps = ctxAdverse ? opsFor(products, ctxAdverse) : { ops: [], problems: [] };
    var before = scenario.run(ctxBase.forecast, []), after = scenario.run(ctxBase.forecast, bOps.ops);
    var advBefore = ctxAdverse ? scenario.run(ctxAdverse.forecast, []) : null;
    var advAfter = ctxAdverse ? scenario.run(ctxAdverse.forecast, aOps.ops) : null;
    var mB = scenario.metrics(before.rows, policy, ep), mA = scenario.metrics(after.rows, policy, ep);
    var mAB = advBefore ? scenario.metrics(advBefore.rows, policy, ep) : null, mAA = advAfter ? scenario.metrics(advAfter.rows, policy, ep) : null;

    // LQ18: an existing episode gets deeper, or a day that was fine falls below Rtarget.
    var worsened = mB.episodes.filter(function (e) { return e.start_date !== ep.start_date; }).map(function (e) {
      return { episode: e, gap_before_vnd: e.peak_gap_vnd, gap_after_vnd: ledger.maxGapIn(after.rows, policy.rtarget_vnd, e.start_date, e.end_date) };
    }).filter(function (x) { return x.gap_after_vnd > x.gap_before_vnd; });
    var newDays = after.rows.filter(function (r, i) { return r.closing_vnd < policy.rtarget_vnd && before.rows[i].closing_vnd >= policy.rtarget_vnd; });

    var coverageOk = ctxBase.forecast.capabilities ? ctxBase.forecast.capabilities.coverage_status === "complete" : true;
    var baseOk = mA.episode_gap_vnd <= 0, baseFloor = mA.episode_floor_gap_vnd <= 0;
    var advOk = mAA ? mAA.episode_gap_vnd <= 0 : null;
    var verdict;
    if (!coverageOk) verdict = "inconclusive";
    else if (!baseOk && !(baseFloor && ctxBase.need.floor_need_vnd > 0)) verdict = "not_resolved";
    else if (!baseOk) verdict = "partial";
    else if (worsened.length || newDays.length) verdict = "resolved_with_shifted_risk";
    else if (advOk === false) verdict = "base_resolved_stress_exposed";
    else verdict = "robustly_resolved";

    var debtEnd = after.beyond.filter(function (e) { return e.category === "loan_repayment"; }).reduce(function (s, e) { return s + e.amount_vnd; }, 0);
    var cost = products.reduce(function (s, p) { var b = uc03.build(p, ctxBase); return s + (b.cost_vnd || 0); }, 0);
    return {
      scenario_run_id: "SC-" + runSeq, product_ids: products.map(function (p) { return p.product_id; }),
      option_ids: products.map(function (p) { return "O-" + p.product_id; }), ops: bOps.ops, adverse_ops: aOps.ops,
      problems: bOps.problems.concat(aOps.problems).concat(after.problems), verdict: verdict, verdict_label: VERDICT[verdict].label, tone: VERDICT[verdict].tone,
      before: mB, after: mA, adverse_before: mAB, adverse_after: mAA, rows_before: before.rows, rows_after: after.rows,
      adverse_rows_before: advBefore && advBefore.rows, adverse_rows_after: advAfter && advAfter.rows,
      residual_need_vnd: Math.max(mA.episode_gap_vnd, 0), worsened_episodes: worsened, new_shortfall_days: newDays.map(function (r) { return r.date; }),
      obligations_beyond_horizon_vnd: debtEnd, net_cost_vnd: cost, back_to_task3: verdict === "partial" || verdict === "not_resolved"
    };
  }

  L.rules.uc04 = { VERDICT: VERDICT, simulate: simulate };
  if (typeof module !== "undefined") module.exports = L.rules.uc04;
})(typeof window !== "undefined" ? window : globalThis);
