/* UC04 / Task 4 · Thử phương án và duyệt nháp. A simulation is never a real action: drafts are tier 2,
   only a person can approve them in this UI, the simulated execution runs exactly once, and approval
   creates a new bundle whose Task 2 re-run is checked for new shortfalls. */
(function (root) {
  "use strict";
  var L = root.Lilact, f = L.fmt, ui = L.ui, esc = f.esc;
  L.views = L.views || {};
  var STATUS = { pending: ["info", "Bản nháp · chờ duyệt"], approved: ["success", "Đã duyệt · thực thi giả lập"], rejected: ["neutral", "Đã từ chối"], stale: ["warning", "Đã cũ · cần tạo lại"] };

  /** Draft content is assembled from the scenario's own change set; amounts are never typed in by hand. */
  function draftContent(sim, prods, an, firm) {
    var p = prods[0], ops = sim.ops, n = an.explanation.need;
    var moved = ops.filter(function (o) { return o.op === "move"; }), added = ops.filter(function (o) { return o.op === "add"; });
    var events = L.rules.explain.datedEvents(an.ctx.forecast);
    function ev(id) { return events.filter(function (e) { return e.event_id === id; })[0] || {}; }
    if (p.type === "ar_commitment") {
      var lines = moved.map(function (o) { var e = ev(o.event_id); return "- Invoice " + e.source_id + ": " + f.vnd(e.amount_vnd).replace(" ₫", " VND") + ", contractual due date " + f.date(o.to); });
      return { type: "payment_reminder", title: "Thư đề nghị xác nhận ngày thanh toán gửi " + an.ctx.focusBuyer,
        body: "Dear " + an.ctx.focusBuyer + ",\n\nWe would like to reconcile the open invoices below and kindly ask you to confirm the payment date for each:\n" + lines.join("\n") +
          "\n\nPlease let us know if any document is missing so we can resend it.\n\nBest regards,\n" + firm + " (draft · not sent)" };
    }
    if (p.type === "supplier_extension") {
      var e = ev(moved[0].event_id);
      return { type: "extension_request", title: "Đề nghị giãn hạn thanh toán hóa đơn " + e.source_id,
        body: "Kính gửi " + e.counterparty_name + ",\n\nDoanh nghiệp đề nghị giãn hạn thanh toán hóa đơn " + e.source_id + " (" + f.vnd(e.amount_vnd) + ") từ ngày " + f.date(e.cash_date) + " sang ngày " + f.date(moved[0].to) +
          ", theo thỏa thuận giữa hai bên.\n\nTrân trọng,\n" + firm + " (bản nháp · chưa gửi)" };
    }
    var adds = added.filter(function (o) { return o.event.direction === "IN"; });
    var amt = adds.reduce(function (s, o) { return s + o.event.amount_vnd; }, 0);
    return { type: "financing_application", title: "Hồ sơ đề nghị tài trợ điền sẵn · " + p.name,
      body: "Bên đề nghị: " + firm + "\nSản phẩm: " + p.name + " (" + p.provider + ", danh mục giả lập)\nNhu cầu: " + f.vnd(n.need_target_vnd) + " trước ngày " + f.date(n.need_date) +
        "\nTiền ròng dự kiến nhận theo kịch bản: " + f.vnd(amt) + "\nMục đích: bù đợt thiếu tiền " + f.date(an.episode.start_date) + "–" + f.date(an.episode.end_date) + " (Task 2, " + an.episode.id + ")" +
        "\nKịch bản: " + sim.scenario_run_id + " · kết luận " + sim.verdict + "\n\n(Bản nháp · chưa nộp · không phải đề nghị hay phê duyệt của bên cho vay)" };
  }

  function compareTable(sim) {
    var b = sim.before, a = sim.after, ab = sim.adverse_before, aa = sim.adverse_after;
    function row(label, fn, fmt) { return { k: label, b: fmt(fn(b)), a: fmt(fn(a)), ab: ab ? fmt(fn(ab)) : "—", aa: aa ? fmt(fn(aa)) : "—" }; }
    var d = function (x) { return x ? f.date(x) : "Không có"; };
    var rows = [
      row("Tiền thấp nhất", function (m) { return m.min_vnd; }, f.vnd), row("Ngày thấp nhất", function (m) { return m.min_date; }, d),
      row("Ngày đầu dưới Rtarget", function (m) { return m.first_violation_date; }, d), row("Gap của đợt đã chọn", function (m) { return m.episode_gap_vnd; }, f.vnd),
      row("Số ngày dưới Rtarget", function (m) { return m.days_below_rtarget; }, String), row("Số ngày dưới Rmin", function (m) { return m.days_below_rmin; }, String),
      row("Tiền cuối kỳ", function (m) { return m.closing_end_vnd; }, f.vnd)
    ];
    return ui.table([{ label: "Chỉ tiêu", key: "k" }, { label: "Base · trước", num: true, key: "b" }, { label: "Base · sau", num: true, key: "a" }, { label: "Xấu · trước", num: true, key: "ab" }, { label: "Xấu · sau", num: true, key: "aa" }], rows, { label: "So sánh trước và sau" });
  }

  function draftCard(d, isCurrent) {
    var st = STATUS[d.status];
    var h = '<article class="lc-card lc-approval" id="draft-' + esc(d.draft_id) + '"><div class="lc-headline">' + ui.chip(d.draft_id) + "<b>" + esc(d.title) + "</b>" + ui.badge(st[0], st[1]) + "</div>" +
      '<p class="la-caption">Tầng 2 · từ ' + esc(d.scenario_run_id) + " · bundle " + esc(d.bundle_id) + " · tạo " + f.datetime(d.created_at) + "</p>" + '<pre class="la-draft">' + esc(d.body) + "</pre>";
    if (d.status === "pending" && isCurrent) {
      h += '<div class="la-approve"><div class="lc-field"><label class="lc-label" for="approver-' + d.draft_id + '">Người duyệt</label><input class="lc-input" id="approver-' + d.draft_id + '" autocomplete="name" placeholder="Họ tên người có quyền duyệt"></div>' +
        '<div class="lc-approval__actions">' + ui.btn("Duyệt bản nháp", "primary", 'data-action="approve" data-id="' + d.draft_id + '"', "check") + "</div>" +
        '<div class="lc-field"><label class="lc-label" for="reason-' + d.draft_id + '">Lý do từ chối</label><textarea class="lc-input la-textarea" id="reason-' + d.draft_id + '" rows="2"></textarea></div>' +
        '<div class="lc-approval__actions">' + ui.btn("Từ chối", "secondary", 'data-action="reject" data-id="' + d.draft_id + '"', "x") +
        "<small>Lilact không tự gửi thư, nộp hồ sơ hay chuyển tiền. Duyệt chỉ thực thi giả lập một lần và ghi nhật ký; bạn tự thực hiện ngoài hệ thống.</small></div></div>";
    } else if (d.status === "approved") {
      h += '<p class="la-muted">Duyệt bởi ' + esc(d.approver) + " lúc " + f.datetime(d.decided_at) + ". Thực thi giả lập: " + d.executed_count + " lần; không có gì được gửi ra ngoài. Task 2 đã chạy lại trong bundle <code>" + esc(d.rerun_bundle_id) + "</code>.</p>" +
        '<div class="la-actions">' + ui.btn("Xem dự báo chạy lại", "secondary", 'data-nav="uc02"', "refresh") + "</div>";
    } else if (d.status === "rejected") {
      h += '<p class="la-muted">Từ chối lúc ' + f.datetime(d.decided_at) + ". Lý do: " + esc(d.reason) + ". Không có hành động nào được thực hiện. Có thể quay lại Task 3 để thử phương án khác.</p>";
    } else if (d.status === "stale") h += '<p class="la-muted">' + esc(d.note) + "</p>";
    return h + "</article>";
  }

  L.views.draftCard = draftCard;

  L.views.uc04 = function (ctx) {
    var res = ctx.res, F = ctx.fs, an = ctx.an, cat = root.LILACT_DEMO.catalogue;
    var h = '<div class="la-page-intro"><p>Làm thế này thì đường tiền ra sao, có bền ở kịch bản xấu không. Mỗi lần thử được clone từ base của bundle hiện tại; kịch bản xấu là case "khách trả chậm thêm 14 ngày" của engine.</p></div>';
    h += ui.note("scenario", "<b>Đây là mô phỏng.</b> Tạo hay sửa nháp không thực hiện thanh toán, không sửa sổ sách và không có nghĩa là việc đã xảy ra.");
    var prods = cat.products.filter(function (p) { return F.selected.indexOf(p.product_id) >= 0; });
    h += ui.section("Phương án đang chọn", "catalogue", (prods.length ? '<ul class="la-list">' + prods.map(function (p) { return "<li>" + ui.chip("O-" + p.product_id, "brand") + " " + esc(p.name) + "</li>"; }).join("") + "</ul>" : "<p>Chưa chọn phương án nào ở Task 3.</p>") +
      '<div class="la-actions">' + ui.btn("Chạy kịch bản", "primary", 'data-action="run-scenario"' + (prods.length ? "" : ' disabled aria-disabled="true"'), "flask") + ui.btn("Đổi lựa chọn ở Task 3", "tertiary", 'data-nav="uc03"') + "</div>", { id: "pick" });

    var mine = F.scenarios.filter(function (s) { return s.bundle_id === res.bundle.id; });
    var last = mine[mine.length - 1];
    if (last && an.ctx) {
      var lp = cat.products.filter(function (p) { return last.product_ids.indexOf(p.product_id) >= 0; });
      var sim = L.rules.uc04.simulate(lp, an.ctx, an.ctxAdverse, last.scenario_run_id.replace(/^SC-/, ""));
      var pol = res.policy;
      h += ui.section("Kết quả " + last.scenario_run_id + " · " + last.option_ids.join(" + "), "scenario",
        '<div class="la-headline">' + ui.badge(sim.tone, sim.verdict_label) + "<code>" + esc(sim.verdict) + "</code></div>" +
        (sim.problems.length ? ui.alertBox("orange", "Một phần phương án không áp được", esc(sim.problems.join(" · "))) : "") +
        (!sim.back_to_task3 && sim.after.days_below_rtarget > 0 ? ui.alertBox("orange", "Kết luận chỉ cho đợt " + an.episode.id,
          "Sau phương án vẫn còn " + sim.after.days_below_rtarget + " ngày dưới Rtarget ở các đợt khác (thấp nhất " + f.vnd(sim.after.min_vnd) + " ngày " + f.date(sim.after.min_date) + "). Các đợt đó chưa được xử lý; chọn đợt khác ở Task 2 để tìm nguồn tiếp.") : "") +
        (sim.back_to_task3 ? ui.alertBox("orange", "Chưa giải quyết đủ", "Còn thiếu " + f.vnd(sim.residual_need_vnd) + " trong đợt " + esc(an.episode.id) + ". Quay lại Task 3 để thử ứng viên hoặc tổ hợp tiếp theo; không gắn nhãn \"đã giải quyết\".") : "") +
        L.chart.cash([{ rows: sim.rows_before, label: "Base trước", kind: "base" }, { rows: sim.rows_after, label: "Base sau phương án", kind: "compare" }].concat(sim.adverse_rows_after ? [{ rows: sim.adverse_rows_after, label: "Kịch bản xấu sau phương án", kind: "adverse" }] : []),
          { rmin: pol.rmin_vnd, rtarget: pol.rtarget_vnd, rupper: pol.rupper_vnd }, { episode: an.episode, label: "So sánh đường tiền trước và sau " + last.scenario_run_id }) +
        compareTable(sim) + ui.dl([
          ["Đợt khác xấu đi (LQ18)", sim.worsened_episodes.length ? sim.worsened_episodes.map(function (w) { return esc(w.episode.id) + " " + f.vnd(w.gap_before_vnd) + " → " + f.vnd(w.gap_after_vnd); }).join("; ") : "Không"],
          ["Ngày thiếu mới", sim.new_shortfall_days.length ? sim.new_shortfall_days.length + " ngày, từ " + f.date(sim.new_shortfall_days[0]) : "Không"],
          ["Nghĩa vụ trả sau kỳ dự báo", f.vnd(sim.obligations_beyond_horizon_vnd)], ["Chi phí ròng của phương án", f.vnd(sim.net_cost_vnd)],
          ["DSO / DIO / DPO thực tế", "Giữ nguyên: mô phỏng chỉ dời dòng tiền, không đổi số liệu đã xảy ra."]
        ]) + (!sim.back_to_task3 ? '<div class="la-actions">' + ui.btn("Soạn nháp hành động", "primary", 'data-action="create-draft" data-id="' + last.scenario_run_id + '"') + '<span class="la-muted">Nháp tầng 2: chờ người có quyền duyệt.</span></div>' : ""),
        { id: "result" });
      ctx.lastSim = { sim: sim, prods: lp, content: draftContent(sim, lp, an, (res.engine.firm && res.engine.firm.firm_name) || res.uc01.meta.firm_id) };
    }

    var drafts = F.drafts.slice().reverse();
    h += ui.section("Nháp chờ duyệt và lịch sử", null, drafts.length ? drafts.map(function (d) { return draftCard(d, d.bundle_id === res.bundle.id); }).join("") : '<p class="la-muted">Chưa có bản nháp nào.</p>', { id: "drafts" });
    return h;
  };
  L.views.draftContent = draftContent;
})(window);
