/* Lilact · daily cash ledger helpers (pure functions, no DOM).
   The UC02 engine already produced the base ledger; these helpers only re-add the engine's own
   cash_events so that UC02 drill-downs, Task 2 counterfactuals and UC04 scenarios use exactly the
   same arithmetic: CashEnd[d] = CashEnd[d-1] + Σ IN[d] − Σ OUT[d], starting from cash0.
   A scenario never edits the engine events; it works on a clone (workflow: "Clone từ base"). */
(function (root) {
  "use strict";
  var L = root.Lilact = root.Lilact || {};
  L.rules = L.rules || {};

  var DAY = 86400000;
  function toDate(s) { var p = s.split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function iso(t) { return new Date(t).toISOString().slice(0, 10); }
  function addDays(s, n) { return iso(toDate(s) + n * DAY); }
  function diffDays(a, b) { return Math.round((toDate(b) - toDate(a)) / DAY); }
  function num(v) { return v == null ? null : Number(v); }

  /** Days of the horizon, from the engine's daily_schedule (falls back to start/end dates). */
  function horizonDays(forecast) {
    if (forecast.daily_schedule) return forecast.daily_schedule.map(function (d) { return d.date; });
    var out = [], d = forecast.meta.start_date;
    while (d <= forecast.meta.end_date) { out.push(d); d = addDays(d, 1); }
    return out;
  }

  /** Events that are scheduled inside the horizon (the only ones that move the daily balance). */
  function inHorizonEvents(forecast) {
    return (forecast.cash_events || []).filter(function (e) { return e.scope === "in_horizon" && e.cash_date; })
      .map(function (e) { return Object.assign({}, e, { amount_vnd: num(e.amount_vnd) }); });
  }

  /** Rebuild the daily ledger from cash0 and a list of events. Events dated outside the horizon are
      reported in `outside`, never silently dropped. */
  function buildLedger(days, cash0, events) {
    var idx = {}; days.forEach(function (d, i) { idx[d] = i; });
    var inn = days.map(function () { return 0; }), out = days.map(function () { return 0; }), outside = [];
    events.forEach(function (e) {
      var i = idx[e.cash_date];
      if (i == null) { outside.push(e); return; }
      if (e.direction === "IN") inn[i] += e.amount_vnd; else out[i] += e.amount_vnd;
    });
    var bal = num(cash0), rows = [];
    days.forEach(function (d, i) {
      var open = bal; bal = open + inn[i] - out[i];
      rows.push({ date: d, opening_vnd: open, in_vnd: inn[i], out_vnd: out[i], closing_vnd: bal });
    });
    return { rows: rows, outside: outside };
  }

  /** Contiguous runs of days where predicate(row) is true. */
  function runs(rows, pred) {
    var res = [], cur = null;
    rows.forEach(function (r, i) {
      if (pred(r)) { if (!cur) cur = { start: i, end: i }; else cur.end = i; }
      else if (cur) { res.push(cur); cur = null; }
    });
    if (cur) res.push(cur);
    return res;
  }

  /** Shortfall episodes against a threshold (e.g. Rtarget): first day, peak day, PeakGap. */
  function episodesBelow(rows, threshold) {
    return runs(rows, function (r) { return r.closing_vnd < threshold; }).map(function (run, k) {
      var peak = run.start;
      for (var i = run.start; i <= run.end; i++) if (rows[i].closing_vnd < rows[peak].closing_vnd) peak = i;
      return {
        id: "EP-" + (k + 1), start_date: rows[run.start].date, end_date: rows[run.end].date,
        duration_days: run.end - run.start + 1, peak_date: rows[peak].date,
        peak_gap_vnd: threshold - rows[peak].closing_vnd, min_vnd: rows[peak].closing_vnd,
        censored: run.end === rows.length - 1, start_index: run.start, end_index: run.end
      };
    });
  }

  /** Surplus windows: runs strictly above a threshold lasting at least minDays (workflow: Rupper ≥ 14 ngày). */
  function windowsAbove(rows, threshold, minDays) {
    return runs(rows, function (r) { return r.closing_vnd > threshold; })
      .filter(function (r) { return r.end - r.start + 1 >= minDays; })
      .map(function (r) { return { start_date: rows[r.start].date, end_date: rows[r.end].date, duration_days: r.end - r.start + 1 }; });
  }

  /** Largest gap below threshold inside [startDate, endDate]. */
  function maxGapIn(rows, threshold, startDate, endDate) {
    var g = 0;
    rows.forEach(function (r) { if (r.date >= startDate && r.date <= endDate) g = Math.max(g, threshold - r.closing_vnd); });
    return g;
  }

  function minRow(rows) { return rows.reduce(function (m, r) { return r.closing_vnd < m.closing_vnd ? r : m; }, rows[0]); }

  L.rules.ledger = { toDate: toDate, iso: iso, addDays: addDays, diffDays: diffDays, horizonDays: horizonDays,
    inHorizonEvents: inHorizonEvents, buildLedger: buildLedger, runs: runs, episodesBelow: episodesBelow,
    windowsAbove: windowsAbove, maxGapIn: maxGapIn, minRow: minRow };
  if (typeof module !== "undefined") module.exports = L.rules.ledger;
})(typeof window !== "undefined" ? window : globalThis);
