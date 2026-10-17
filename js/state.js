/* Lilact · workflow state (one per firm) and the derived results of each analysis bundle.
   Workflow sources: every result hangs off one analysis_bundle_id; changing data, thresholds or an approved
   action creates a NEW bundle and marks the previous one stale ("Đổi dữ liệu, ngưỡng hoặc lãi suất thì tạo
   bundle mới và đánh dấu kết quả cũ là đã cũ"). Approval happens only through the UI buttons. */
(function (root) {
  "use strict";
  var L = root.Lilact = root.Lilact || {};
  var R = L.rules, KEY = "lilact-demo-state-v1";

  function now() { return new Date().toISOString(); }
  function pad(n) { return String(n).padStart(3, "0"); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function emptyFirm(firm) {
    return { firm: firm, intake: { reviewed: false, policy: null, policy_version: 0, confirmed: false, confirmed_at: null, ack: false, upload: null },
      bundles: [], episode: {}, selected: [], scenarios: [], drafts: [], seq: { bundle: 0, scenario: 0, draft: 0 } };
  }
  var state = { firm: "F01", firms: {}, audit: [] };
  var listeners = [], cache = {};

  function load() {
    try { var s = JSON.parse(root.localStorage.getItem(KEY)); if (s && s.firms) state = s; } catch (e) { /* storage unavailable: start fresh */ }
  }
  function save() { try { root.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }
  function emit() { save(); listeners.forEach(function (fn) { fn(); }); }
  function on(fn) { listeners.push(fn); }

  function engine(firm) { return root.LILACT_ENGINE && root.LILACT_ENGINE[firm || state.firm]; }
  function fs(firm) { firm = firm || state.firm; return state.firms[firm] || (state.firms[firm] = emptyFirm(firm)); }
  function audit(event, detail) { state.audit.unshift({ ts: now(), firm: state.firm, event: event, detail: detail || "" }); state.audit = state.audit.slice(0, 200); }
  function current() { var b = fs().bundles; return b.length ? b[b.length - 1] : null; }
  function bundleById(id) { return fs().bundles.filter(function (b) { return b.id === id; })[0] || null; }

  /* ---------- derived forecast for a bundle (base + approved change sets) ---------- */
  function alertOf(closing, buffer, cfg) {
    // Same rule set the engine publishes in inputs.alert_config (T2-ALERT-*), reused for re-run ledgers.
    if (closing < 0) return "red";
    if (!(buffer > 0)) return "green";
    var ratio = Math.max(buffer - closing, 0) / buffer;
    if (ratio === 0) return "green";
    return ratio <= cfg.yellow_upper ? "yellow" : ratio <= cfg.orange_upper ? "orange" : "red";
  }
  function derive(fc, ops, runId) {
    if (!ops || !ops.length) return fc;
    var r = R.scenario.run(fc, ops), end = fc.meta.end_date, buf = Number(fc.inputs.buffer_vnd), cfg = fc.inputs.alert_config;
    var daily = r.rows.map(function (row, i) {
      return Object.assign({}, row, { week_number: Math.floor(i / 7) + 1, alert_color: alertOf(row.closing_vnd, buf, cfg), gap_buffer_vnd: Math.max(buf - row.closing_vnd, 0) });
    });
    var weekly = [];
    daily.forEach(function (d) {
      var w = weekly[d.week_number - 1] || (weekly[d.week_number - 1] = { week_number: d.week_number, start_date: d.date, opening_vnd: d.opening_vnd, in_vnd: 0, out_vnd: 0, min_daily_vnd: Infinity });
      w.end_date = d.date; w.in_vnd += d.in_vnd; w.out_vnd += d.out_vnd; w.closing_vnd = d.closing_vnd;
      if (d.closing_vnd < w.min_daily_vnd) { w.min_daily_vnd = d.closing_vnd; w.min_daily_date = d.date; }
    });
    weekly.forEach(function (w) { w.alert_color = alertOf(w.closing_vnd, buf, cfg); w.worst_daily_alert_color = alertOf(w.min_daily_vnd, buf, cfg); w.gap_buffer_vnd = Math.max(buf - w.closing_vnd, 0); });
    var min = R.ledger.minRow(daily);
    return Object.assign({}, fc, {
      derived: true, applied_ops: ops,
      meta: Object.assign({}, fc.meta, { run_id: runId, derived_from_run_id: fc.meta.run_id }),
      cash_events: r.events.map(function (e) { return Object.assign({}, e, { scope: e.cash_date > end ? "beyond_horizon" : "in_horizon" }); }),
      daily_schedule: daily, weekly_schedule: weekly,
      summary: Object.assign({}, fc.summary, { min_balance_vnd: min.closing_vnd, min_balance_date: min.date, closing_end_vnd: daily[daily.length - 1].closing_vnd,
        first_negative_date: (daily.filter(function (d) { return d.closing_vnd < 0; })[0] || {}).date || null,
        first_buffer_date: (daily.filter(function (d) { return d.closing_vnd < buf; })[0] || {}).date || null })
    });
  }

  /** All results for a bundle, memoised by bundle id (bundles are immutable once created). */
  function compute(b) {
    if (!b) return null;
    if (cache[b.id]) return cache[b.id];
    var eng = engine(b.firm), pol = b.policy;
    var baseOps = [], advOps = [];
    b.change_sets.forEach(function (c) { baseOps = baseOps.concat(c.ops); advOps = advOps.concat(c.adverse_ops); });
    var fc = derive(eng.uc02.base, baseOps, b.id + "-BASE");
    var adv = derive(eng.uc02.estimated_receipts_late_14d, advOps, b.id + "-ADV");
    var rows = fc.daily_schedule.map(function (d) { return { date: d.date, opening_vnd: Number(d.opening_vnd), in_vnd: Number(d.in_vnd), out_vnd: Number(d.out_vnd), closing_vnd: Number(d.closing_vnd) }; });
    var advRows = adv.daily_schedule.map(function (d) { return { date: d.date, closing_vnd: Number(d.closing_vnd) }; });
    var W = R.classify.classifyW(eng.uc01, pol), TH = R.classify.classifyTH(rows, pol), route = R.router.route(W.w, TH.th);
    var advTH = R.classify.classifyTH(advRows, pol);
    var res = { bundle: b, engine: eng, uc01: eng.uc01, forecast: fc, adverse: adv, rows: rows, adverseRows: advRows, policy: pol, W: W, TH: TH, route: route, adverseTH: advTH };
    cache[b.id] = res;
    return res;
  }

  /** Explanation + UC03 context for the selected episode (base, or adverse for the TH02 contingency branch). */
  function analysis(res, firmState) {
    var key = res.bundle.id, out = { mode: null };
    var cat = root.LILACT_DEMO.catalogue, firmCfg = cat.firms[res.bundle.firm];
    var source = res.TH.th === "TH01" ? "base" : res.TH.th === "TH02" && res.adverseTH.th === "TH01" ? "adverse" : null;
    if (!source) return out;
    var fc = source === "base" ? res.forecast : res.adverse;
    var rows = source === "base" ? res.rows : res.adverse.daily_schedule.map(function (d) { return { date: d.date, closing_vnd: Number(d.closing_vnd) }; });
    var eps = source === "base" ? res.TH.episodes : res.adverseTH.episodes;
    var sel = (firmState.episode[key] && eps.filter(function (e) { return e.start_date === firmState.episode[key]; })[0]) || R.explain.defaultEpisode(eps);
    var ex = R.explain.explain(fc, res.uc01, res.policy, rows, sel);
    var cf = ex.counterfactuals.filter(function (c) { return c.kind === "receipt_on_due_date"; }).sort(function (a, b) { return b.timing_impact_vnd - a.timing_impact_vnd; })[0];
    var focus = cf && cf.timing_impact_vnd > 0 ? cf.entity_id : (res.uc01.drivers.ranked_views.top_buyers || [])[0];
    var ctx = { forecast: fc, policy: res.policy, need: ex.need, episode: sel, firm: firmCfg, catalogue: cat, causes: ex.causes, focusBuyer: focus, ownedInventory: Number(res.uc01.inputs.inv_vnd) };
    var ctxAdv = source === "base" ? Object.assign({}, ctx, { forecast: res.adverse }) : null;
    out = { mode: source, episodes: eps, episode: sel, explanation: ex, ctx: ctx, ctxAdverse: ctxAdv, match: R.uc03.match(ctx) };
    return out;
  }

  /* ---------- actions ---------- */
  function newBundle(origin, policy, parent, changeSet) {
    var F = fs(), eng = engine();
    F.seq.bundle += 1;
    var prev = current();
    if (prev) { prev.status = "stale"; prev.stale_reason = origin.reason; prev.stale_at = now(); }
    var b = { id: "AB-" + state.firm + "-" + pad(F.seq.bundle), firm: state.firm, snapshot_id: eng.uc02.base.meta.snapshot_id,
      policy_version: "POL-" + state.firm + "-v" + F.intake.policy_version, policy: clone(policy), parent_id: parent ? parent.id : null,
      change_sets: (parent ? parent.change_sets : []).concat(changeSet ? [changeSet] : []), created_at: now(), origin: origin.kind, origin_label: origin.label, status: "current" };
    F.bundles.push(b);
    F.selected = [];
    F.drafts.forEach(function (d) { if (d.status === "pending" && prev && d.bundle_id === prev.id) { d.status = "stale"; d.note = "Bundle " + prev.id + " đã cũ: cần chạy lại kịch bản và tạo nháp mới."; } });
    audit("bundle.created", b.id + " (" + origin.label + ")" + (prev ? "; " + prev.id + " → đã cũ" : ""));
    return b;
  }

  var A = {
    setFirm: function (f) { state.firm = f; fs(); audit("session.firm", "Chọn doanh nghiệp " + f); emit(); },
    reviewIntake: function () { fs().intake.reviewed = true; audit("uc00.reviewed", "Đã xem kết quả kiểm tra dữ liệu"); emit(); },
    setUpload: function (u) { fs().intake.upload = u; audit("uc00.upload_checked", u.file_name + ": " + u.issues.length + " vấn đề"); emit(); },
    savePolicy: function (p) {
      var F = fs(); F.intake.policy = clone(p); F.intake.policy_version += 1;
      audit("policy.saved", "Chính sách ngưỡng phiên bản " + F.intake.policy_version);
      if (F.intake.confirmed) newBundle({ kind: "policy_change", label: "đổi ngưỡng", reason: "Ngưỡng đã đổi sang phiên bản " + F.intake.policy_version }, p, null, null);
      emit();
    },
    confirmIntake: function () {
      var F = fs();
      if (!F.intake.policy || !F.intake.ack) return false;
      F.intake.confirmed = true; F.intake.confirmed_at = now();
      audit("uc00.confirmed", "Chủ DN xác nhận dữ liệu và chính sách");
      newBundle({ kind: "uc00_confirm", label: "xác nhận dữ liệu", reason: "" }, F.intake.policy, null, null);
      emit(); return true;
    },
    setAck: function (v) { fs().intake.ack = !!v; emit(); },
    selectEpisode: function (bid, start) { fs().episode[bid] = start; fs().selected = []; audit("uc02.episode", "Chọn đợt bắt đầu " + start); emit(); },
    toggleOption: function (pid) {
      var s = fs().selected, i = s.indexOf(pid);
      if (i >= 0) s.splice(i, 1); else s.push(pid);
      emit();
    },
    runScenario: function () {
      var F = fs(), b = current(), res = compute(b), an = analysis(res, F);
      var prods = root.LILACT_DEMO.catalogue.products.filter(function (p) { return F.selected.indexOf(p.product_id) >= 0; });
      if (!prods.length || !an.ctx) return null;
      F.seq.scenario += 1;
      var sim = R.uc04.simulate(prods, an.ctx, an.ctxAdverse, state.firm + "-" + pad(F.seq.scenario));
      var rec = { scenario_run_id: sim.scenario_run_id, bundle_id: b.id, product_ids: sim.product_ids, option_ids: sim.option_ids, created_at: now(),
        episode_start: an.episode.start_date, verdict: sim.verdict, ops: sim.ops, adverse_ops: sim.adverse_ops };
      F.scenarios.push(rec);
      audit("uc04.scenario_run", rec.scenario_run_id + " · " + rec.option_ids.join(" + ") + " · " + sim.verdict);
      emit(); return rec;
    },
    createDraft: function (scenarioId, content) {
      var F = fs(), sc = F.scenarios.filter(function (s) { return s.scenario_run_id === scenarioId; })[0];
      if (!sc || sc.bundle_id !== current().id) return null;
      F.seq.draft += 1;
      var d = { draft_id: "D-" + state.firm + "-" + pad(F.seq.draft), scenario_run_id: sc.scenario_run_id, bundle_id: sc.bundle_id, option_ids: sc.option_ids,
        type: content.type, title: content.title, body: content.body, status: "pending", tier: 2, created_at: now(), executed_count: 0 };
      F.drafts.push(d);
      audit("draft.pending_approval", d.draft_id + " (tầng 2) từ " + sc.scenario_run_id);
      emit(); return d;
    },
    /** Human approval from the UI only. Simulated execution happens exactly once, then a new bundle re-runs Task 2. */
    approve: function (draftId, approver) {
      var F = fs(), d = F.drafts.filter(function (x) { return x.draft_id === draftId; })[0];
      if (!d || d.status !== "pending") return { ok: false, msg: "Bản nháp không còn ở trạng thái chờ duyệt." };
      if (d.bundle_id !== current().id) return { ok: false, msg: "Bản nháp dựa trên bundle đã cũ; hãy chạy lại kịch bản." };
      if (!approver) return { ok: false, msg: "Cần ghi tên người duyệt." };
      var sc = F.scenarios.filter(function (s) { return s.scenario_run_id === d.scenario_run_id; })[0];
      var parent = current(), before = compute(parent);
      d.status = "approved"; d.decided_at = now(); d.approver = approver; d.executed_count = 1;
      audit("draft.approved", d.draft_id + " duyệt bởi " + approver + "; thực thi giả lập 1 lần, không gửi gì ra ngoài");
      var nb = newBundle({ kind: "approved_draft", label: "duyệt " + d.draft_id, reason: "Phương án " + d.draft_id + " đã được duyệt" }, parent.policy, parent,
        { draft_id: d.draft_id, scenario_run_id: sc.scenario_run_id, ops: sc.ops, adverse_ops: sc.adverse_ops });
      var after = compute(nb);
      var newDays = after.rows.filter(function (r, i) { return r.closing_vnd < nb.policy.rtarget_vnd && before.rows[i].closing_vnd >= nb.policy.rtarget_vnd; }).map(function (r) { return r.date; });
      var worse = before.TH.episodes.filter(function (e) { return R.ledger.maxGapIn(after.rows, nb.policy.rtarget_vnd, e.start_date, e.end_date) > e.peak_gap_vnd; });
      nb.rerun_check = { from_bundle: parent.id, draft_id: d.draft_id, new_shortfall_days: newDays, worsened_episodes: worse.map(function (e) { return e.start_date; }), ok: !newDays.length && !worse.length };
      d.rerun_bundle_id = nb.id;
      audit("uc02.rerun", nb.id + ": " + (nb.rerun_check.ok ? "không sinh thiếu mới, không đợt nào xấu đi" : "CÓ thiếu mới hoặc đợt xấu đi"));
      emit(); return { ok: true, bundle: nb };
    },
    reject: function (draftId, reason) {
      var F = fs(), d = F.drafts.filter(function (x) { return x.draft_id === draftId; })[0];
      if (!d || d.status !== "pending") return { ok: false, msg: "Bản nháp không còn ở trạng thái chờ duyệt." };
      if (!reason || !reason.trim()) return { ok: false, msg: "Cần nhập lý do từ chối." };
      d.status = "rejected"; d.decided_at = now(); d.reason = reason.trim();
      audit("draft.rejected", d.draft_id + ": " + d.reason + ". Không có hành động nào được thực hiện.");
      emit(); return { ok: true };
    },
    resetFirm: function () { state.firms[state.firm] = emptyFirm(state.firm); cache = {}; audit("session.reset", "Xóa trạng thái demo của " + state.firm); emit(); }
  };

  L.store = { load: load, on: on, emit: emit, state: function () { return state; }, fs: fs, current: current, bundleById: bundleById,
    compute: compute, analysis: analysis, engine: engine, actions: A, derive: derive, alertOf: alertOf, _reset: function () { state = { firm: "F01", firms: {}, audit: [] }; cache = {}; } };
  if (typeof module !== "undefined") module.exports = L.store;
})(typeof window !== "undefined" ? window : globalThis);
