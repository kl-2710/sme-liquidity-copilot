/* Lilact · Task 2 explanation layer (DEMO rules on top of the engine's own cash events).
   Per selected episode: need_date / need_target / floor_need, a cash bridge that must tie to the ledger
   within 1 VND, counterfactuals with IDs (TimingImpact = Gap gốc − Gap thử, never summed), and the five
   cause types from the workflow table "Từ nguyên nhân đến nguồn bù". */
(function (root) {
  "use strict";
  var L = root.Lilact = root.Lilact || {};
  L.rules = L.rules || {};
  var ledger = L.rules.ledger || (typeof require !== "undefined" && require("./ledger.js"));

  var MANDATORY = { payroll: "Lương", tax: "Thuế", debt_service: "Gốc, lãi vay", rent: "Tiền thuê", supplier_payment: "Trả NCC", utilities: "Điện nước" };
  var OPTIONAL = { capex: "Đầu tư (tùy chọn)" };
  var CATEGORY_LABEL = Object.assign({ invoice_receipt: "Thu hóa đơn", new_materials: "Mua vật tư mới" }, MANDATORY, OPTIONAL);

  var CAUSES = {
    customer_behaviour: "Hành vi khách",
    contract_timing: "Lệch lịch hợp đồng",
    clustered_outflows: "Chi dồn",
    inventory_tied: "Vốn kẹt tồn kho",
    thin_buffer: "Đệm tiền mỏng"
  };

  /** All dated events (in and beyond horizon) as numbers; unscheduled ones are left out and counted separately. */
  function datedEvents(forecast) {
    return (forecast.cash_events || []).filter(function (e) { return e.cash_date; })
      .map(function (e) { return Object.assign({}, e, { amount_vnd: Number(e.amount_vnd) }); });
  }

  function needOf(rows, policy, ep) {
    var window = rows.slice(ep.start_index, ep.end_index + 1);
    var floor = 0;
    if (policy.rmin_vnd != null) window.forEach(function (r) { floor = Math.max(floor, policy.rmin_vnd - r.closing_vnd); });
    return { need_date: ep.start_date, peak_date: ep.peak_date, need_target_vnd: ep.peak_gap_vnd, floor_need_vnd: floor,
      reserve_absorbable_vnd: ep.peak_gap_vnd - floor, end_date: ep.end_date, censored: ep.censored };
  }

  /** Cash bridge at a date: Cash0 + Σ thu − Σ chi = CashEnd. */
  function bridge(forecast, rows, date) {
    var cash0 = Number(forecast.inputs.cash0_vnd);
    var ins = {}, outs = {}, ids = [];
    ledger.inHorizonEvents(forecast).forEach(function (e) {
      if (e.cash_date > date) return;
      ids.push(e.event_id);
      if (e.direction === "IN") { var k = e.counterparty_name || CATEGORY_LABEL[e.category] || e.category; ins[k] = (ins[k] || 0) + e.amount_vnd; }
      else { var c = e.category; outs[c] = (outs[c] || 0) + e.amount_vnd; }
    });
    var sumIn = Object.keys(ins).reduce(function (s, k) { return s + ins[k]; }, 0);
    var sumOut = Object.keys(outs).reduce(function (s, k) { return s + outs[k]; }, 0);
    var row = rows.filter(function (r) { return r.date === date; })[0];
    var end = cash0 + sumIn - sumOut;
    return { date: date, cash0_vnd: cash0, in_by_counterparty: ins, out_by_category: outs, sum_in_vnd: sumIn, sum_out_vnd: sumOut,
      cash_end_vnd: end, ledger_closing_vnd: row ? row.closing_vnd : null, ties: row ? Math.abs(end - row.closing_vnd) <= 1 : false, event_ids: ids };
  }

  function gapIn(forecast, events, policy, ep) {
    var days = ledger.horizonDays(forecast);
    var lg = ledger.buildLedger(days, forecast.inputs.cash0_vnd, events);
    return ledger.maxGapIn(lg.rows, policy.rtarget_vnd, ep.start_date, ep.end_date);
  }

  /** Counterfactuals: (a) each late-paying customer pays on the contract due date; (b) each optional outflow
      in or before the episode is deferred to the day after it. Each one is run separately on the base. */
  function counterfactuals(forecast, policy, ep) {
    var base = datedEvents(forecast);
    var gap0 = gapIn(forecast, base.filter(inH(forecast)), policy, ep);
    var start = forecast.meta.start_date, out = [];
    var buyers = {};
    base.forEach(function (e) { if (e.direction === "IN" && e.delay_days_applied > 0 && e.original_date) (buyers[e.counterparty_id] = buyers[e.counterparty_id] || []).push(e); });
    Object.keys(buyers).forEach(function (b) {
      var moved = buyers[b].map(function (e) { return e.event_id; });
      var evs = base.map(function (e) {
        if (moved.indexOf(e.event_id) < 0) return e;
        var due = ledger.addDays(e.original_date, -e.delay_days_applied);
        return Object.assign({}, e, { cash_date: due < start ? start : due });
      });
      var g = gapIn(forecast, evs.filter(inH(forecast)), policy, ep);
      out.push({ id: "CF-ONTIME-" + slug(b), kind: "receipt_on_due_date", label: "Khách " + b + " trả đúng hạn hợp đồng",
        entity_id: b, event_ids: moved, gap_before_vnd: gap0, gap_after_vnd: g, timing_impact_vnd: gap0 - g });
    });
    base.forEach(function (e) {
      if (e.direction !== "OUT" || !OPTIONAL[e.category] || e.cash_date > ep.end_date) return;
      var after = ledger.addDays(ep.end_date, 1);
      var evs = base.map(function (x) { return x.event_id === e.event_id ? Object.assign({}, x, { cash_date: after }) : x; });
      var g = gapIn(forecast, evs.filter(inH(forecast)), policy, ep);
      out.push({ id: "CF-DEFER-" + slug(e.event_id), kind: "defer_optional_outflow", label: "Dời khoản " + (CATEGORY_LABEL[e.category] || e.category) + " " + e.source_id + " sang sau đợt",
        entity_id: e.source_id, event_ids: [e.event_id], gap_before_vnd: gap0, gap_after_vnd: g, timing_impact_vnd: gap0 - g });
    });
    return out;
  }

  function inH(forecast) {
    var s = forecast.meta.start_date, t = forecast.meta.end_date;
    return function (e) { return e.cash_date >= s && e.cash_date <= t; };
  }
  function slug(s) { return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase(); }

  /** Name the causes of one episode; every cause carries a rule id and evidence (event ids or finding ids). */
  function causes(forecast, uc01, policy, ep, cfs) {
    var evs = ledger.inHorizonEvents(forecast), res = [];
    cfs.filter(function (c) { return c.kind === "receipt_on_due_date" && c.timing_impact_vnd > 0; }).forEach(function (c) {
      var finding = (uc01.insights || []).filter(function (i) { return /AR-/.test(i.insight_id); }).map(function (i) { return i.insight_id; });
      res.push({ type: "customer_behaviour", rule_id: "CAUSE-DEMO-01", entity_id: c.entity_id, counterfactual_id: c.id, impact_vnd: c.timing_impact_vnd,
        text: "Khoản thu của " + c.entity_id + " dự kiến về muộn theo thói quen trả trễ; nếu trả đúng hạn, phần thiếu giảm theo " + c.id + ".",
        evidence: c.event_ids, finding_ids: finding });
    });
    var horizonAfter = ledger.addDays(ep.peak_date, 14);
    var dueSoon = evs.filter(function (e) { return e.direction === "IN" && !(e.delay_days_applied > 0) && e.cash_date > ep.peak_date && e.cash_date <= horizonAfter; });
    if (dueSoon.length) res.push({ type: "contract_timing", rule_id: "CAUSE-DEMO-02",
      text: dueSoon.length + " khoản thu đúng hạn hợp đồng rơi trong 14 ngày sau ngày đỉnh; khách không trả trễ.", evidence: dueSoon.map(function (e) { return e.event_id; }),
      amount_vnd: dueSoon.reduce(function (s, e) { return s + e.amount_vnd; }, 0) });
    var from = ledger.addDays(ep.peak_date, -6);
    var cluster = evs.filter(function (e) { return e.direction === "OUT" && MANDATORY[e.category] && e.cash_date >= from && e.cash_date <= ep.peak_date; });
    var cats = {}; cluster.forEach(function (e) { cats[e.category] = 1; });
    if (Object.keys(cats).length >= 2) res.push({ type: "clustered_outflows", rule_id: "CAUSE-DEMO-03",
      text: "Trong 7 ngày đến ngày đỉnh có " + Object.keys(cats).map(function (c) { return MANDATORY[c].toLowerCase(); }).join(", ") + " cùng phải chi.",
      evidence: cluster.map(function (e) { return e.event_id; }), amount_vnd: cluster.reduce(function (s, e) { return s + e.amount_vnd; }, 0) });
    var mats = evs.filter(function (e) { return e.direction === "OUT" && e.category === "new_materials" && e.cash_date >= ledger.addDays(ep.start_date, -14) && e.cash_date <= ep.peak_date; });
    if (mats.length) {
      var inv = (uc01.insights || []).filter(function (i) { return i.insight_id === "INS-INVENTORY-SLOW"; }).map(function (i) { return i.insight_id; });
      res.push({ type: "inventory_tied", rule_id: "CAUSE-DEMO-04", text: "Tiền chi mua vật tư rơi ngay trước hoặc trong đợt" + (inv.length ? "; UC01 cũng ghi nhận tồn kho chậm luân chuyển." : "."),
        evidence: mats.map(function (e) { return e.event_id; }), finding_ids: inv, amount_vnd: mats.reduce(function (s, e) { return s + e.amount_vnd; }, 0) });
    }
    var first14 = ledger.addDays(forecast.meta.start_date, 13);
    var mand14 = evs.filter(function (e) { return e.direction === "OUT" && MANDATORY[e.category] && e.cash_date <= first14; })
      .reduce(function (s, e) { return s + e.amount_vnd; }, 0);
    var cash0 = Number(forecast.inputs.cash0_vnd);
    if (cash0 - mand14 < policy.rtarget_vnd) res.push({ type: "thin_buffer", rule_id: "CAUSE-DEMO-05",
      text: "Cash0 trừ chi bắt buộc 14 ngày đầu thấp hơn Rtarget: đệm tiền mỏng ngay từ đầu kỳ.", evidence: ["EV-CASH0"], amount_vnd: cash0 - mand14 });
    return res;
  }

  /** Full explanation bundle for one episode. */
  function explain(forecast, uc01, policy, rows, ep) {
    var need = needOf(rows, policy, ep);
    var cfs = counterfactuals(forecast, policy, ep);
    return { episode: ep, need: need, bridge_start: bridge(forecast, rows, ep.start_date), bridge_peak: bridge(forecast, rows, ep.peak_date),
      counterfactuals: cfs, causes: causes(forecast, uc01, policy, ep, cfs) };
  }

  /** Default episode: the most material one (largest PeakGap), ties broken by the earliest date. The user can switch. */
  function defaultEpisode(eps) {
    return eps.slice().sort(function (a, b) { return b.peak_gap_vnd - a.peak_gap_vnd || (a.start_date < b.start_date ? -1 : 1); })[0] || null;
  }

  L.rules.explain = { MANDATORY: MANDATORY, OPTIONAL: OPTIONAL, CATEGORY_LABEL: CATEGORY_LABEL, CAUSES: CAUSES, datedEvents: datedEvents,
    needOf: needOf, bridge: bridge, counterfactuals: counterfactuals, causes: causes, explain: explain, defaultEpisode: defaultEpisode, slug: slug };
  if (typeof module !== "undefined") module.exports = L.rules.explain;
})(typeof window !== "undefined" ? window : globalThis);
