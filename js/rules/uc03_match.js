/* Lilact · UC03 / Task 3 matching (DEMO rules from the workflow documents).
   ① Nhu cầu (need_date, floor_need, need_target) → ② nguyên nhân → nhóm nguồn → ③ thang 5 nhóm nguồn →
   ④ lọc cứng (kịp need_date? phủ tiền ròng? NCC thiết yếu, tài sản đã cầm cố, headroom nợ LQ17) →
   ⑤ xếp hạng (kịp + đủ > kịp một phần; rồi chắc chắn → chi phí trên phần bù → gánh nặng quan hệ), tối đa 3.
   A source that brings cash after need_date is REJECTED as untimely, with the earliest date it could pay;
   it is never shown as timely coverage. Cost alone never decides the rank.
   Known conflict: system spec v2.0 BR-03.3 ranks by cost first — see docs/CONFLICTS.md. */
(function (root) {
  "use strict";
  var L = root.Lilact = root.Lilact || {};
  L.rules = L.rules || {};
  var ledger = L.rules.ledger || (typeof require !== "undefined" && require("./ledger.js"));
  var explain = L.rules.explain || (typeof require !== "undefined" && require("./explain.js"));
  var scenario = L.rules.scenario || (typeof require !== "undefined" && require("./scenario.js"));

  var CERTAINTY_RANK = { high: 0, medium: 1, low: 2 };
  var COVERAGE_RANK = { full: 0, floor: 1, partial: 2, none: 3 };
  // Which cause types each product type addresses (workflow table "Từ nguyên nhân đến nguồn bù").
  var ADDRESSES = {
    ar_commitment: ["customer_behaviour"], factoring: ["customer_behaviour", "contract_timing"],
    supplier_extension: ["contract_timing", "clustered_outflows"], inventory_sale: ["inventory_tied"],
    inventory_pledge: ["inventory_tied"], credit_line: ["thin_buffer"], new_loan: []
  };

  function asOf(forecast) { return forecast.meta.as_of; }

  /** Build the change set for a product, or return {reject} when a precondition fails. */
  function build(p, ctx) {
    var fc = ctx.forecast, need = ctx.need, firm = ctx.firm, evs = explain.datedEvents(fc);
    var arrival = ledger.addDays(asOf(fc), Math.max(p.lead_days, 1));
    var ops = [], gross = 0, cost = 0, newDebt = 0, days = 0, target = null;
    if (p.type === "ar_commitment") {
      var buyer = ctx.focusBuyer;
      var late = evs.filter(function (e) { return e.direction === "IN" && e.counterparty_id === buyer && e.delay_days_applied > 0; });
      if (!buyer || !late.length) return { reject: "Không có khách nào đang trả trễ theo lịch sử để xin ngày cam kết." };
      late.forEach(function (e) {
        var due = ledger.addDays(e.original_date, -e.delay_days_applied);
        if (due < fc.meta.start_date) due = fc.meta.start_date;
        ops.push({ op: "move", event_id: e.event_id, to: due, option_id: p.product_id, reason: "Khách xác nhận trả đúng hạn hợp đồng" });
      });
      arrival = ops.map(function (o) { return o.to; }).sort()[0];
      target = buyer; gross = late.reduce(function (s, e) { return s + e.amount_vnd; }, 0);
    } else if (p.type === "supplier_extension") {
      var cands = evs.filter(function (e) { return e.direction === "OUT" && e.category === "supplier_payment" && e.cash_date >= fc.meta.start_date && e.cash_date <= need.peak_date; });
      var allowed = cands.filter(function (e) { return firm.essential_suppliers.indexOf(e.counterparty_id) < 0; });
      if (!cands.length) return { reject: "Không có hóa đơn NCC nào đến hạn trước ngày đỉnh." };
      if (!allowed.length) return { reject: "Chỉ còn hóa đơn của NCC thiết yếu (" + cands.map(function (e) { return e.counterparty_name; }).filter(uniq).join(", ") + "); không được giãn." };
      var e = allowed.sort(function (a, b) { return b.amount_vnd - a.amount_vnd; })[0];
      ops.push({ op: "move", event_id: e.event_id, to: ledger.addDays(e.cash_date, p.extend_days), option_id: p.product_id, reason: "Giãn " + p.extend_days + " ngày có thỏa thuận" });
      arrival = e.cash_date; target = e.counterparty_name + " · " + e.source_id; gross = e.amount_vnd;
    } else if (p.type === "factoring") {
      var fb = ctx.focusBuyer;
      var inv = evs.filter(function (x) { return x.direction === "IN" && x.counterparty_id === fb && x.cash_date > need.need_date; });
      if (!fb || !inv.length) return { reject: "Không có hóa đơn của khách liên quan còn chưa thu sau need_date để bao thanh toán." };
      var base = inv.reduce(function (s, x) { return s + x.amount_vnd; }, 0);
      var fee = Math.round(base * p.fee_pct);
      var adv = 0, interest = 0;
      inv.forEach(function (x) {
        var a = Math.round(x.amount_vnd * p.advance_rate);
        var i = Math.round(a * p.annual_rate * Math.max(ledger.diffDays(arrival, x.cash_date), 0) / 365);
        adv += a; interest += i;
        ops.push({ op: "remove", event_id: x.event_id, option_id: p.product_id, reason: "Hóa đơn đã bao thanh toán" });
        ops.push({ op: "add", event: { event_id: p.product_id + "-REM-" + x.event_id, source_type: "option", source_id: x.source_id, direction: "IN",
          category: "factoring_remainder", counterparty_name: fb, amount_vnd: x.amount_vnd - a - i, cash_date: x.cash_date, option_id: p.product_id,
          assumption_ids: ["A-DEMO-FACTORING"] } });
      });
      ops.push({ op: "add", event: { event_id: p.product_id + "-ADV", source_type: "option", source_id: p.product_id, direction: "IN", category: "factoring_advance",
        counterparty_name: p.provider, amount_vnd: adv - fee, cash_date: arrival, option_id: p.product_id, assumption_ids: ["A-DEMO-FACTORING"] } });
      gross = adv - fee; cost = fee + interest; days = ledger.diffDays(arrival, inv.map(function (x) { return x.cash_date; }).sort().slice(-1)[0]); target = fb;
    } else if (p.type === "credit_line" || p.type === "new_loan" || p.type === "inventory_pledge") {
      var limit = p.type === "credit_line" ? firm.credit_line_headroom_vnd : Infinity;
      if (p.type === "inventory_pledge") {
        if (firm.pledged_lot_ids.length) return { reject: "Tài sản đã cầm cố: " + (firm.note || "lô tồn đã được dùng làm bảo đảm") + " Một tài sản không dùng cho hai nguồn." };
        limit = Math.round(ctx.ownedInventory * p.advance_rate);
      }
      // Borrow just enough to reach need_target after the upfront fee, drawn on need_date (not earlier) when the lead time allows.
      var principal = Math.min(limit, Math.ceil(need.need_target_vnd / (1 - p.fee_pct) / 1e6) * 1e6);
      var draw = arrival < need.need_date ? need.need_date : arrival;
      if (!(principal > 0)) return { reject: "Hạn mức còn trống bằng 0." };
      if (principal > firm.debt_headroom_vnd) return { reject: "Vượt headroom nợ (LQ17): cần " + principal + " nhưng còn " + firm.debt_headroom_vnd + "." };
      var feeL = Math.round(principal * p.fee_pct);
      var intL = Math.round(principal * p.annual_rate * p.tenor_days / 365);
      var due = ledger.addDays(draw, p.tenor_days);
      ops.push({ op: "add", event: { event_id: p.product_id + "-IN", source_type: "option", source_id: p.product_id, direction: "IN", category: "loan_drawdown",
        counterparty_name: p.provider, amount_vnd: principal - feeL, cash_date: draw, option_id: p.product_id, assumption_ids: ["A-DEMO-LOAN"] } });
      ops.push({ op: "add", event: { event_id: p.product_id + "-OUT", source_type: "option", source_id: p.product_id, direction: "OUT", category: "loan_repayment",
        counterparty_name: p.provider, amount_vnd: principal + intL, cash_date: due, option_id: p.product_id, assumption_ids: ["A-DEMO-LOAN"] } });
      gross = principal - feeL; cost = feeL + intL; newDebt = principal; days = p.tenor_days; target = p.provider;
    } else if (p.type === "inventory_sale") {
      if (!firm.inventory_buyer_evidence) return { reject: "Chưa có người mua và ngày thu có chứng cứ; không lấy giá sổ làm tiền bán tồn." };
    }
    return { ops: ops, arrival: arrival, gross_vnd: gross, cost_vnd: cost, new_debt_vnd: newDebt, days: days, target: target };
  }

  function uniq(v, i, a) { return a.indexOf(v) === i; }

  /** Match options for one need. ctx: {forecast, policy, need, episode, firm, catalogue, causes, focusBuyer, ownedInventory}. */
  function match(ctx) {
    var candidates = [], rejected = [];
    var causeTypes = (ctx.causes || []).map(function (c) { return c.type; });
    ctx.catalogue.products.forEach(function (p) {
      var b = build(p, ctx);
      var base = { option_id: "O-" + p.product_id, product_id: p.product_id, name: p.name, group: p.group, group_label: p.group_label,
        provider: p.provider, certainty: p.certainty, relationship_burden: p.relationship_burden, simulated: true,
        addresses: (ADDRESSES[p.type] || []).filter(function (t) { return causeTypes.indexOf(t) >= 0; }) };
      if (b.reject) { rejected.push(Object.assign(base, { reason: b.reject, rule: "hard_filter" })); return; }
      if (b.arrival > ctx.need.need_date) {
        rejected.push(Object.assign(base, { reason: "Tiền về ngày " + b.arrival + ", sau need_date " + ctx.need.need_date + ": không kịp, không được tính là phần bù đúng hạn.",
          rule: "timely", earliest_date: b.arrival, gross_vnd: b.gross_vnd }));
        return;
      }
      var after = scenario.run(ctx.forecast, b.ops);
      var gapAfter = ledger.maxGapIn(after.rows, ctx.policy.rtarget_vnd, ctx.episode.start_date, ctx.episode.end_date);
      var floorAfter = ledger.maxGapIn(after.rows, ctx.policy.rmin_vnd, ctx.episode.start_date, ctx.episode.end_date);
      var covered = ctx.need.need_target_vnd - gapAfter;
      var coverage = gapAfter <= 0 ? "full" : floorAfter <= 0 && ctx.need.floor_need_vnd > 0 ? "floor" : covered > 0 ? "partial" : "none";
      if (coverage === "none") { rejected.push(Object.assign(base, { reason: "Không làm giảm phần thiếu của đợt đã chọn.", rule: "coverage" })); return; }
      var costPct = b.cost_vnd > 0 && covered > 0 && b.days > 0 ? (b.cost_vnd / Math.min(covered, b.gross_vnd || covered)) * 365 / b.days : 0;
      candidates.push(Object.assign(base, { ops: b.ops, arrival_date: b.arrival, gross_vnd: b.gross_vnd, cost_vnd: b.cost_vnd, new_debt_vnd: b.new_debt_vnd,
        cost_simple_annual: costPct, covered_vnd: covered, residual_need_vnd: Math.max(gapAfter, 0), coverage: coverage, target: b.target,
        repayment_beyond_horizon: after.beyond.filter(function (e) { return e.option_id === p.product_id && e.direction === "OUT"; }).length > 0 }));
    });
    candidates.sort(function (a, b) {
      return COVERAGE_RANK[a.coverage] - COVERAGE_RANK[b.coverage] || CERTAINTY_RANK[a.certainty] - CERTAINTY_RANK[b.certainty] ||
        a.cost_simple_annual - b.cost_simple_annual || a.relationship_burden - b.relationship_burden;
    });
    candidates.forEach(function (c, i) { c.rank = i + 1; });
    var shown = candidates.slice(0, 3), extra = candidates.slice(3);
    extra.forEach(function (c) { rejected.push(Object.assign({}, c, { reason: "Đủ điều kiện nhưng xếp sau 3 ứng viên đầu.", rule: "top3" })); });
    var late = rejected.filter(function (r) { return r.rule === "timely"; }).map(function (r) { return r.earliest_date; }).sort();
    return { candidates: shown, rejected: rejected,
      uncovered_vnd: shown.length ? Math.min.apply(null, shown.map(function (c) { return c.residual_need_vnd; })) : ctx.need.need_target_vnd,
      earliest_late_date: late[0] || null };
  }

  /** TH03: SafeCash = min(Cash − Rtarget) until the recovery date, base and stress; cap = min(SafeCash, limit). */
  function safeCash(baseRows, adverseRows, policy, untilDate, limit) {
    function m(rows) { return rows.filter(function (r) { return r.date <= untilDate; }).reduce(function (s, r) { return Math.min(s, r.closing_vnd - policy.rtarget_vnd); }, Infinity); }
    var b = Math.max(m(baseRows), 0), a = adverseRows ? Math.max(m(adverseRows), 0) : null;
    var sc = a == null ? b : Math.min(a, b);
    return { safe_cash_base_vnd: b, safe_cash_adverse_vnd: a, safe_cash_vnd: sc, cap_vnd: limit == null ? sc : Math.min(sc, limit), until_date: untilDate };
  }

  L.rules.uc03 = { match: match, build: build, safeCash: safeCash, ADDRESSES: ADDRESSES };
  if (typeof module !== "undefined") module.exports = L.rules.uc03;
})(typeof window !== "undefined" ? window : globalThis);
