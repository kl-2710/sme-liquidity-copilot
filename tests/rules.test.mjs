// Unit tests for the Lilact rule layer and workflow state. Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
globalThis.window = globalThis;
for (const f of ["F01", "F02", "F03"]) require(`../data/engine/${f}.js`);
require("../data/demo/catalogue.js");
require("../data/demo/policy.js");
const ledger = require("../js/rules/ledger.js");
const router = require("../js/rules/router.js");
const classify = require("../js/rules/classify.js");
const explain = require("../js/rules/explain.js");
const scenario = require("../js/rules/scenario.js");
const uc03 = require("../js/rules/uc03_match.js");
const uc04 = require("../js/rules/uc04_simulate.js");
const intake = require("../js/rules/intake_check.js");
const store = require("../js/state.js");

const E = globalThis.LILACT_ENGINE, CAT = globalThis.LILACT_DEMO.catalogue;
const policyFor = (f) => globalThis.LILACT_DEMO.policyDefaults(E[f].uc02.base.inputs.buffer_vnd);
const rowsOf = (fc) => scenario.run(fc, []).rows;

function ctxFor(f, pol = policyFor(f), forecast = E[f].uc02.base) {
  const rows = rowsOf(forecast);
  const th = classify.classifyTH(rows, pol);
  const ep = explain.defaultEpisode(th.episodes);
  const ex = explain.explain(forecast, E[f].uc01, pol, rows, ep);
  const cf = ex.counterfactuals.filter((c) => c.kind === "receipt_on_due_date").sort((a, b) => b.timing_impact_vnd - a.timing_impact_vnd)[0];
  return { forecast, policy: pol, need: ex.need, episode: ep, firm: CAT.firms[f], catalogue: CAT, causes: ex.causes,
    focusBuyer: cf && cf.timing_impact_vnd > 0 ? cf.entity_id : E[f].uc01.drivers.ranked_views.top_buyers[0], ownedInventory: Number(E[f].uc01.inputs.inv_vnd) };
}

test("engine export matches the UC01/UC02 golden values of feature/uc1-uc2-full", () => {
  const m = classify.metricMap(E.F01.uc01);
  assert.ok(Math.abs(m.dso_days.raw_value - 49.98858558) < 1e-6);
  assert.ok(Math.abs(m.ccc_days.raw_value - 69.04979689) < 1e-6);
  assert.equal(m.ar_vnd.raw_value, 4912255000);
  const s = E.F01.uc02.base.summary;
  assert.equal(s.min_balance_vnd, -619322000);
  assert.equal(s.min_balance_date, "2026-12-18");
  assert.equal(E.F01.uc02.base.daily_schedule.length, 91);
  assert.equal(E.F02.uc02.base.summary.min_balance_vnd, 1152774000);
});

test("ledger rebuilt from engine cash events equals the engine daily ledger to the VND", () => {
  for (const f of ["F01", "F02", "F03"]) for (const k of ["base", "estimated_receipts_late_14d"]) {
    const fc = E[f].uc02[k], rows = rowsOf(fc);
    rows.forEach((r, i) => assert.ok(Math.abs(r.closing_vnd - Number(fc.daily_schedule[i].closing_vnd)) <= 1, `${f} ${k} ${r.date}`));
  }
});

test("router: every (W, TH) pair maps to the documented cell; unknown axis assigns no cell", () => {
  const expect = { W0: ["M1", "M2", "M3"], W1: ["M4", "M5", "M6"], W2: ["M7", "M8", "M9"] };
  for (const w of Object.keys(expect)) router.COL_ORDER.forEach((th, i) => {
    const r = router.route(w, th);
    assert.equal(r.cell, expect[w][i]);
    assert.equal(r.def.w, w); assert.equal(r.def.th, th);
    assert.equal(r.branch, { TH01: "cover", TH02: "hold", TH03: "surplus" }[th]);
    assert.ok(r.def.forbid && r.def.task2 && r.def.task3 && r.def.task4 && r.def.see);
  });
  assert.deepEqual(router.route("unknown", "TH01").missing, ["W"]);
  assert.deepEqual(router.route("W1", "unknown").missing, ["TH"]);
  assert.equal(router.route("unknown", "unknown").cell, null);
  assert.equal(router.CELLS.M9.forbid, "Lấy dư tiền để gỡ nhãn điểm nghẽn; SafeCash = 0 vẫn có thể là kết quả đúng.");
});

test("TH axis: TH01 / TH02 / TH03 and unknown when thresholds are missing", () => {
  const f1 = classify.classifyTH(rowsOf(E.F01.uc02.base), policyFor("F01"));
  assert.equal(f1.th, "TH01");
  const f3 = classify.classifyTH(rowsOf(E.F03.uc02.base), policyFor("F03"));
  assert.equal(f3.th, "TH03");
  const p = { ...policyFor("F03"), rupper_vnd: 1e13 };
  assert.equal(classify.classifyTH(rowsOf(E.F03.uc02.base), p).th, "TH02");
  assert.equal(classify.classifyTH(rowsOf(E.F01.uc02.base), { ...policyFor("F01"), rtarget_vnd: null }).th, "unknown");
  const f2 = classify.classifyTH(rowsOf(E.F02.uc02.base), policyFor("F02"));
  assert.equal(f2.th, "TH01"); assert.equal(f2.mixed, true, "shortfall plus surplus window keeps the mixed flag");
});

test("W axis: W2 / W1 / W0 and unknown without materiality thresholds", () => {
  assert.equal(classify.classifyW(E.F01.uc01, policyFor("F01")).w, "W2");
  assert.equal(classify.classifyW(E.F03.uc01, policyFor("F03")).w, "W1");
  assert.equal(classify.classifyW({ ...E.F03.uc01, insights: [] }, policyFor("F03")).w, "W0");
  assert.equal(classify.classifyW(E.F01.uc01, { ...policyFor("F01"), w_material_vnd: null }).w, "unknown");
  assert.equal(classify.classifyW({ ...E.F01.uc01, status: "invalid_data" }, policyFor("F01")).w, "unknown");
  const conc = classify.classifyW(E.F01.uc01, policyFor("F01")).signals.find((s) => s.insight_id === "INS-AR-CONCENTRATION");
  assert.equal(conc.money_at_risk_vnd, null, "concentration is a signal without money at risk");
  assert.equal(conc.material, false);
});

test("explanation: cash bridge ties to the ledger and counterfactuals are not summed", () => {
  const pol = policyFor("F02"), rows = rowsOf(E.F02.uc02.base);
  const ep = explain.defaultEpisode(classify.classifyTH(rows, pol).episodes);
  const ex = explain.explain(E.F02.uc02.base, E.F02.uc01, pol, rows, ep);
  assert.ok(ex.bridge_peak.ties && ex.bridge_start.ties);
  assert.equal(ex.need.need_date, ep.start_date);
  assert.ok(ex.counterfactuals.every((c) => c.timing_impact_vnd === c.gap_before_vnd - c.gap_after_vnd));
  assert.ok(ex.causes.some((c) => c.type === "customer_behaviour"));
  ex.causes.forEach((c) => assert.ok(c.rule_id && c.evidence && c.evidence.length));
});

test("UC03: a source paying after need_date is rejected as untimely, never ranked as coverage", () => {
  const m = uc03.match(ctxFor("F02"));
  const late = m.rejected.find((r) => r.product_id === "LOAN-NEW");
  assert.equal(late.rule, "timely");
  assert.ok(late.earliest_date > ctxFor("F02").need.need_date);
  assert.ok(!m.candidates.some((c) => c.product_id === "LOAN-NEW"));
  assert.ok(m.candidates.length <= 3);
  m.candidates.forEach((c) => assert.ok(c.arrival_date <= ctxFor("F02").need.need_date));
});

test("UC03: hard filters — pledged asset, missing buyer evidence, essential supplier", () => {
  const m = uc03.match(ctxFor("F01"));
  assert.match(m.rejected.find((r) => r.product_id === "INV-PLEDGE").reason, /cầm cố/);
  assert.match(m.rejected.find((r) => r.product_id === "INV-SELL").reason, /không lấy giá sổ/);
  const ctx = ctxFor("F02");
  const all = explain.datedEvents(ctx.forecast).filter((e) => e.category === "supplier_payment").map((e) => e.counterparty_id);
  const m2 = uc03.match({ ...ctx, firm: { ...ctx.firm, essential_suppliers: [...new Set(all)] } });
  assert.match(m2.rejected.find((r) => r.product_id === "SUP-EXTEND").reason, /thiết yếu/);
});

test("UC03: ranking puts timely full coverage before cheaper partial coverage", () => {
  const ctx = ctxFor("F01");
  const m = uc03.match(ctx);
  assert.equal(m.candidates[0].coverage, "full");
  const cheaperPartial = m.candidates.find((c) => c.coverage !== "full" && c.cost_simple_annual < m.candidates[0].cost_simple_annual);
  assert.ok(cheaperPartial, "the cheaper credit line only covers part of the need and must rank below");
  assert.ok(m.candidates.indexOf(cheaperPartial) > 0);
});

test("UC03: no timely source gives the uncovered amount and the earliest late date", () => {
  const ctx = ctxFor("F02");
  const onlyLate = { ...CAT, products: CAT.products.filter((p) => p.product_id === "LOAN-NEW") };
  const m = uc03.match({ ...ctx, catalogue: onlyLate });
  assert.equal(m.candidates.length, 0);
  assert.equal(m.uncovered_vnd, ctx.need.need_target_vnd);
  assert.ok(m.earliest_late_date);
});

test("UC03 TH03: SafeCash uses the lower of base and stress and can be 0", () => {
  const pol = policyFor("F03");
  const sc = uc03.safeCash(rowsOf(E.F03.uc02.base), rowsOf(E.F03.uc02.estimated_receipts_late_14d), pol, "2026-12-30", null);
  assert.equal(sc.safe_cash_vnd, Math.min(sc.safe_cash_base_vnd, sc.safe_cash_adverse_vnd));
  assert.ok(sc.safe_cash_vnd >= 0);
});

test("UC04: verdicts follow base, stress and coverage", () => {
  const P = (id) => CAT.products.find((p) => p.product_id === id);
  const c1 = ctxFor("F01"), a1 = { ...c1, forecast: E.F01.uc02.estimated_receipts_late_14d };
  assert.equal(uc04.simulate([P("LOAN-NEW")], c1, a1, "T1").verdict, "robustly_resolved");
  const weak = uc04.simulate([P("LINE-REV")], c1, a1, "T2");
  assert.equal(weak.verdict, "not_resolved"); assert.equal(weak.back_to_task3, true); assert.ok(weak.residual_need_vnd > 0);
  const c2 = ctxFor("F02"), a2 = { ...c2, forecast: E.F02.uc02.estimated_receipts_late_14d };
  assert.equal(uc04.simulate([P("LINE-REV")], c2, a2, "T3").verdict, "base_resolved_stress_exposed");
  const inc = uc04.simulate([P("LOAN-NEW")], { ...c1, forecast: { ...c1.forecast, capabilities: { coverage_status: "partial" } } }, a1, "T4");
  assert.equal(inc.verdict, "inconclusive");
  const before = JSON.stringify(E.F01.uc02.base.cash_events);
  uc04.simulate([P("LOAN-NEW"), P("LINE-REV")], c1, a1, "T5");
  assert.equal(JSON.stringify(E.F01.uc02.base.cash_events), before, "simulation never edits the base events");
});

test("intake check: flags every documented problem without dropping rows", () => {
  const r = intake.check(readFileSync(new URL("../data/demo/sample_sales_with_errors.csv", import.meta.url), "utf8"), { as_of: "2026-09-30", firm_id: "F01" });
  const codes = new Set(r.issues.map((i) => i.code));
  for (const c of ["AMBIGUOUS_NUMBER", "DUPLICATE", "MISSING_VALUE", "INVALID_DATE", "NON_POSITIVE", "AFTER_CUTOFF", "OTHER_FIRM", "DUE_BEFORE_ISSUE", "UNMAPPED_COLUMN"]) assert.ok(codes.has(c), c);
  assert.equal(r.record_count, 8);
  assert.equal(r.blocked, true);
  assert.equal(intake.check("invoice_id,amount_vnd\nA,1\n").issues.filter((i) => i.code === "MISSING_COLUMN").length, 4);
});

test("workflow state: confirm → bundle; approve → new bundle, old stale, rerun checked; reject needs a reason", () => {
  store._reset();
  const A = store.actions;
  A.setFirm("F01");
  assert.equal(A.confirmIntake(), false, "cannot confirm without policy and acknowledgement");
  A.savePolicy(policyFor("F01")); A.setAck(true);
  assert.equal(A.confirmIntake(), true);
  const b1 = store.current();
  assert.equal(b1.status, "current");
  const res = store.compute(b1);
  assert.equal(res.route.cell, "M7");
  A.toggleOption("LOAN-NEW");
  const sc = A.runScenario();
  assert.equal(sc.verdict, "robustly_resolved");
  const d = A.createDraft(sc.scenario_run_id, { type: "financing_application", title: "t", body: "b" });
  assert.equal(d.status, "pending");
  assert.equal(A.approve(d.draft_id, "").ok, false, "approver name required");
  const ok = A.approve(d.draft_id, "Chủ DN");
  assert.equal(ok.ok, true);
  assert.equal(b1.status, "stale");
  const b2 = store.current();
  assert.notEqual(b2.id, b1.id);
  assert.equal(b2.change_sets.length, 1);
  assert.equal(b2.rerun_check.ok, true);
  assert.equal(store.compute(b2).forecast.derived, true);
  assert.equal(A.approve(d.draft_id, "Chủ DN").ok, false, "simulated execution happens once");
  assert.equal(store.fs().drafts[0].executed_count, 1);
  A.toggleOption("LINE-REV");
  const sc2 = A.runScenario();
  const d2 = A.createDraft(sc2.scenario_run_id, { type: "x", title: "t", body: "b" });
  assert.equal(A.reject(d2.draft_id, "  ").ok, false);
  assert.equal(A.reject(d2.draft_id, "Chi phí cao").ok, true);
  assert.equal(store.fs().drafts[1].status, "rejected");
});

test("workflow state: changing thresholds creates a new bundle and stales pending drafts", () => {
  store._reset();
  const A = store.actions;
  A.setFirm("F02"); A.savePolicy(policyFor("F02")); A.setAck(true); A.confirmIntake();
  const b1 = store.current();
  A.toggleOption("LINE-REV");
  const sc = A.runScenario();
  const d = A.createDraft(sc.scenario_run_id, { type: "x", title: "t", body: "b" });
  A.savePolicy({ ...policyFor("F02"), rtarget_vnd: 1000000000 });
  assert.equal(b1.status, "stale");
  assert.equal(store.current().policy.rtarget_vnd, 1000000000);
  assert.equal(d.status, "stale");
  assert.equal(A.approve(d.draft_id, "x").ok, false, "a draft from a stale bundle cannot be approved");
  assert.equal(store.compute(store.current()).TH.th, "TH03", "lower Rtarget removes the F02 shortfall; its surplus window above Rupper remains");
});
