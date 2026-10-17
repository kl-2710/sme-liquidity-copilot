/* Lilact · change sets and scenario runs (DEMO rule layer).
   A change set is an ordered list of cash-event operations; it is always applied to a CLONE of the base
   events (workflow Task 4 ①: "Clone từ base … không dùng đường tiền đã cộng tài trợ (tránh tính hai lần)").
   Every added event carries the option_id and its assumption; every removed/moved event keeps its reason. */
(function (root) {
  "use strict";
  var L = root.Lilact = root.Lilact || {};
  L.rules = L.rules || {};
  var ledger = L.rules.ledger || (typeof require !== "undefined" && require("./ledger.js"));
  var explain = L.rules.explain || (typeof require !== "undefined" && require("./explain.js"));

  /** Apply ops to a deep-enough clone of the events. Unknown event ids are reported, not ignored. */
  function apply(events, ops) {
    var evs = events.map(function (e) { return Object.assign({}, e); });
    var problems = [];
    ops.forEach(function (op) {
      if (op.op === "add") { evs.push(Object.assign({ scope: "in_horizon", assumption_ids: [] }, op.event)); return; }
      var i = evs.findIndex(function (e) { return e.event_id === op.event_id; });
      if (i < 0) { problems.push("Không tìm thấy sự kiện " + op.event_id + " để " + op.op); return; }
      if (op.op === "remove") evs.splice(i, 1);
      else if (op.op === "move") evs[i] = Object.assign({}, evs[i], { cash_date: op.to, moved_by: op.option_id, move_reason: op.reason });
    });
    return { events: evs, problems: problems };
  }

  /** Run a forecast-shaped object (cash0, events, horizon) with a change set; returns the ledger rows and
      the events that fall outside the horizon (reported separately, e.g. loan repayments after the horizon). */
  function run(forecast, ops) {
    var days = ledger.horizonDays(forecast);
    var a = apply(explain.datedEvents(forecast), ops || []);
    var s = forecast.meta.start_date, t = forecast.meta.end_date;
    var inside = a.events.filter(function (e) { return e.cash_date >= s && e.cash_date <= t; });
    var beyond = a.events.filter(function (e) { return e.cash_date > t; });
    var lg = ledger.buildLedger(days, forecast.inputs.cash0_vnd, inside);
    return { rows: lg.rows, events: a.events, beyond: beyond, problems: a.problems };
  }

  /** Before/after metrics against the policy (workflow Task 4 ④). */
  function metrics(rows, policy, ep) {
    var min = ledger.minRow(rows);
    var below = rows.filter(function (r) { return r.closing_vnd < policy.rtarget_vnd; });
    return { min_vnd: min.closing_vnd, min_date: min.date,
      first_violation_date: below.length ? below[0].date : null,
      days_below_rtarget: below.length,
      days_below_rmin: rows.filter(function (r) { return r.closing_vnd < policy.rmin_vnd; }).length,
      episode_gap_vnd: ep ? ledger.maxGapIn(rows, policy.rtarget_vnd, ep.start_date, ep.end_date) : null,
      episode_floor_gap_vnd: ep ? ledger.maxGapIn(rows, policy.rmin_vnd, ep.start_date, ep.end_date) : null,
      episodes: ledger.episodesBelow(rows, policy.rtarget_vnd),
      closing_end_vnd: rows[rows.length - 1].closing_vnd };
  }

  L.rules.scenario = { apply: apply, run: run, metrics: metrics };
  if (typeof module !== "undefined") module.exports = L.rules.scenario;
})(typeof window !== "undefined" ? window : globalThis);
