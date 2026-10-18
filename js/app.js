/* Lilact · app shell: hash router, task locks with reasons, evidence drawer, toasts, event wiring. */
(function (root) {
  "use strict";
  var L = root.Lilact, f = L.fmt, ui = L.ui, esc = f.esc, S = L.store, A = S.actions;
  var view = { tab01: null, scenario02: "base", draftPolicy: null, policyErrors: null, lastSim: null };

  var NAV = [
    { id: "uc00", code: "UC00", title: "Data", long: "Data intake & confirmation", icon: "upload" },
    { id: "uc01", code: "Task 1", title: "Diagnosis", long: "Working capital diagnosis", icon: "grid" },
    { id: "uc02", code: "Task 2", title: "Forecast", long: "Cash forecast & routing", icon: "chart" },
    { id: "uc03", code: "Task 3", title: "Solutions", long: "Solution matching", icon: "steps" },
    { id: "uc04", code: "Task 4", title: "Test & approve", long: "Scenario testing & draft approval", icon: "flask" },
    { id: "log", code: "", title: "Activity", long: "Bundles, scenarios & audit log", icon: "clock" }
  ];

  /** Lock rules mirror the workflow prerequisites; every lock carries the reason and the step that unlocks it. */
  function locks(ctx) {
    var F = ctx.fs, res = ctx.res, l = {};
    if (!F.intake.confirmed) {
      ["uc01", "uc02", "uc03", "uc04"].forEach(function (k) { l[k] = { reason: "Cần xác nhận dữ liệu và chính sách ngưỡng ở UC00 trước khi tính.", go: "uc00" }; });
      return l;
    }
    if (!res.route.cell) l.uc03 = { reason: "Chưa gán ô ma trận vì thiếu trục " + res.route.missing.join(" và ") + " (" + (res.route.missing.indexOf("W") >= 0 ? res.W.reason : res.TH.reason) + "). Theo tài liệu luồng, Task 3 chỉ chạy khi đã có ô.", go: "uc00" };
    if (l.uc03) l.uc04 = { reason: "Task 4 cần ứng viên từ Task 3, mà Task 3 đang khóa.", go: "uc03" };
    else if (res.route.branch === "surplus") l.uc04 = { reason: "Ô " + res.route.cell + " thuộc nhánh dư tiền. Kiểm SafeCash đã hiển thị ở Task 3; bộ thử phương án demo chỉ hỗ trợ bù thiếu (TH01) và dự phòng khi stress thiếu.", go: "uc03" };
    else if (!ctx.an.mode) l.uc04 = { reason: "Không có nhu cầu tiền ở base hay kịch bản xấu, nên không có phương án để thử (giữ nguyên là kết quả hợp lệ).", go: "uc03" };
    else if (!F.selected.length && !F.drafts.length && !F.scenarios.some(function (s) { return s.bundle_id === res.bundle.id; })) l.uc04 = { reason: "Chọn ít nhất một ứng viên ở Task 3 để thử.", go: "uc03" };
    return l;
  }

  function context() {
    var F = S.fs(), b = S.current(), eng = S.engine();
    var ctx = Object.assign({ fs: F, engine: eng, bundle: b }, view);
    if (b) { ctx.res = S.compute(b); ctx.an = S.analysis(ctx.res, F); }
    return ctx;
  }

  function route() { var h = (location.hash || "#/uc00").replace(/^#\/?/, ""); return NAV.some(function (n) { return n.id === h; }) ? h : "uc00"; }

  function syncSidebarControls() {
    var mobile = window.matchMedia("(max-width: 900px)").matches;
    var expanded = mobile ? document.body.classList.contains("la-nav-open") : !document.body.classList.contains("la-sidebar-collapsed");
    var label = mobile ? (expanded ? "Close navigation" : "Open navigation") : (expanded ? "Collapse sidebar" : "Expand sidebar");
    document.querySelectorAll('[data-action="sidebar-toggle"]').forEach(function (button) {
      button.setAttribute("aria-expanded", String(expanded));
      button.setAttribute("aria-label", label);
      button.title = label;
    });
  }

  function renderNav(ctx, lk, cur) {
    var F = ctx.fs;
    document.getElementById("nav").innerHTML = NAV.map(function (n) {
      var locked = lk[n.id], done = n.id === "uc00" ? F.intake.confirmed : false;
      var badge = locked ? '<span class="la-nav__state" title="' + esc(locked.reason) + '">' + ui.icon("lock", 14) + '<span class="lc-visually-hidden">Đang khóa: ' + esc(locked.reason) + "</span></span>" :
        done ? '<span class="la-nav__state la-nav__state--done">' + ui.icon("check", 14) + '<span class="lc-visually-hidden">Đã xong</span></span>' : "";
      if (n.id === "uc04") { var p = F.drafts.filter(function (d) { return d.status === "pending"; }).length; if (p) badge = '<span class="lc-chip la-count" title="Nháp chờ duyệt">' + p + "</span>" + badge; }
      return '<a class="lc-nav-item' + (locked ? " is-locked" : "") + '" href="#/' + n.id + '" title="' + esc(n.long) + '"' + (cur === n.id ? ' aria-current="page"' : "") + ">" + ui.icon(n.icon) +
        '<span class="la-nav__text">' + (n.code ? '<small>' + n.code + "</small>" : "") + esc(n.title) + "</span>" + badge + "</a>";
    }).join("");
  }

  function render() {
    var ctx = context(), lk = locks(ctx), cur = route(), nav = NAV.filter(function (n) { return n.id === cur; })[0];
    renderNav(ctx, lk, cur);
    var st = S.state();
    document.getElementById("firm").value = st.firm;
    document.getElementById("page-title").textContent = (nav.code ? nav.code + " · " : "") + nav.long;
    var firmInfo = ctx.engine.firm || {};
    document.getElementById("page-meta").innerHTML = '<span class="la-muted">' + esc(firmInfo.firm_name || st.firm) + "</span>" +
      (ctx.res && ctx.res.route.cell ? ui.chip(ctx.res.route.cell + " · " + ctx.res.route.def.title, "brand") : "") +
      (ctx.bundle ? ui.chip(ctx.bundle.id, "", ' title="Current analysis bundle"') : ui.badge("neutral", "Not confirmed")) +
      '<span class="la-context-meta">Snapshot: ' + esc(ctx.bundle ? ctx.bundle.snapshot_id : "Pending") + ' · As of ' + esc(f.date(ctx.engine.uc01.meta.as_of)) + ' · Demo engine ' + esc(ctx.engine.provenance.engine_commit) + '</span>';
    var main = document.getElementById("workspace"), html;
    try {
      if (lk[cur]) {
        var go = NAV.filter(function (n) { return n.id === lk[cur].go; })[0];
        html = ui.locked(nav.long + " đang khóa", esc(lk[cur].reason), ui.btn("Đến " + (go.code ? go.code + " · " : "") + go.title, "primary", 'data-nav="' + go.id + '"'));
      } else html = L.views[cur](ctx);
    } catch (e) {
      // Calculation or rendering failure: say so plainly, never show a partial result as success.
      if (root.console) console.error(e);
      html = ui.alertBox("red", "Không hiển thị được kết quả", "Đã xảy ra lỗi khi tính hoặc hiển thị màn hình này: " + esc(e.message) + ". Không có số liệu nào bị thay thế; hãy tải lại trang hoặc xóa trạng thái demo ở Nhật ký.");
    }
    if (ctx.bundle && ctx.bundle.status !== "current") html = ui.note("stale", "Kết quả này thuộc bundle đã cũ.") + html;
    main.innerHTML = html;
    view.lastSim = ctx.lastSim || null;
    document.body.classList.remove("la-nav-open");
    syncSidebarControls();
  }

  /* ---------- toast & drawer ---------- */
  function toast(msg, kind) {
    var t = document.getElementById("toast");
    var el = document.createElement("div");
    el.className = "la-toast la-toast--" + (kind || "info");
    el.innerHTML = ui.icon(kind === "error" ? "x" : kind === "success" ? "check" : "info") + "<span>" + esc(msg) + "</span>";
    t.appendChild(el);
    while (t.children.length > 3) t.removeChild(t.firstChild);
    setTimeout(function () { el.remove(); }, 6000);
  }
  var lastFocus = null;
  function openDrawer(title, html) {
    lastFocus = document.activeElement;
    var d = document.getElementById("drawer");
    d.querySelector("#drawer-title").textContent = title;
    d.querySelector(".la-drawer__body").innerHTML = html;
    d.hidden = false;
    d.querySelector("#drawer-title").focus();
  }
  function closeDrawer() { var d = document.getElementById("drawer"); if (d.hidden) return; d.hidden = true; if (lastFocus) lastFocus.focus(); }

  function evidenceContent(key) {
    var ctx = context(), parts = key.split(":"), kind = parts[0];
    if (kind === "metric") {
      var m = ctx.engine.uc01.result_metrics.filter(function (x) { return x.id === parts[1]; })[0];
      return [m.name + " · " + m.formula_id, ui.dl([["Giá trị thô", "<code>" + esc(m.raw_value) + "</code>"], ["Hiển thị", esc(m.display_value) + " " + esc(m.unit)], ["Trạng thái", esc(m.status) + (m.reason_code ? " · " + esc(m.reason_code) : "")],
        ["Tử số / mẫu số", esc(m.numerator == null ? "—" : f.vnd(m.numerator)) + " / " + esc(m.denominator == null ? "—" : f.vnd(m.denominator))], ["Kỳ", m.period_days + " ngày · " + esc(m.method)],
        ["Phụ thuộc", esc((m.dependency_ids || []).join(", ") || "—")], ["Giả định", esc((m.assumption_ids || []).join(", ") || "—")], ["Bằng chứng", (m.evidence_ids || []).map(function (e) { return "<code>" + esc(e) + "</code>"; }).join("<br>")],
        ["Nguồn", ui.SOURCE.engine + " run <code>" + esc(ctx.engine.uc01.meta.run_id) + "</code>"]])];
    }
    if (kind === "uc01ev") {
      var id = parts.slice(1).join(":"), ev = ctx.engine.uc01.evidence.filter(function (e) { return e.evidence_id === id; })[0];
      if (!ev) return [id, "<p>Không tìm thấy bằng chứng này trong kết quả UC01.</p>"];
      return [id, ui.dl(Object.keys(ev).filter(function (k) { return k !== "source_row_ids"; }).map(function (k) { return [k, esc(JSON.stringify(ev[k]))]; })) +
        "<h3>Bản ghi nguồn (" + (ev.source_row_ids || []).length + ")</h3><p class=\"la-codes\">" + (ev.source_row_ids || []).map(function (r) { return "<code>" + esc(r) + "</code>"; }).join(" ") + "</p>"];
    }
    if (kind === "uc02ev") {
      var e2 = ctx.res.forecast.evidence.filter(function (e) { return e.evidence_id === parts[1]; })[0];
      return [parts[1], e2 ? ui.dl(Object.keys(e2).map(function (k) { return [k, esc(typeof e2[k] === "object" ? JSON.stringify(e2[k]) : e2[k])]; })) : "<p>Không tìm thấy.</p>"];
    }
    if (kind === "day" || kind === "event") {
      var adverse = parts[1] === "adv" || parts[1] === "adverse", fc = adverse ? ctx.res.adverse : ctx.res.forecast;
      var evs = L.rules.ledger.inHorizonEvents(fc);
      var list = kind === "day" ? evs.filter(function (e) { return e.cash_date === parts[parts.length - 1]; }) : evs.filter(function (e) { return e.event_id === parts.slice(2).join(":"); });
      var title = kind === "day" ? "Thu chi ngày " + f.date(parts[parts.length - 1]) + (adverse ? " (kịch bản xấu)" : "") : "Sự kiện " + parts.slice(2).join(":");
      return [title, list.length ? list.map(function (e) {
        return '<div class="lc-card la-event">' + ui.dl([["Mã", "<code>" + esc(e.event_id) + "</code> · nguồn <code>" + esc(e.source_id) + "</code> (" + esc(e.source_type) + ")"],
          ["Chiều", e.direction === "IN" ? "Thu" : "Chi"], ["Đối tác / loại", esc(e.counterparty_name || L.rules.explain.CATEGORY_LABEL[e.category] || e.category)], ["Số tiền", f.vnd(e.amount_vnd)],
          ["Ngày tiền", f.date(e.cash_date) + (e.original_date && e.original_date !== e.cash_date ? " (gốc " + f.date(e.original_date) + ")" : "")],
          ["Cách xác định ngày", esc(e.date_method || "phương án") + (e.delay_days_applied ? " · trễ " + e.delay_days_applied + " ngày theo lịch sử" : "") + (e.case_shift_days ? " · dời thêm " + e.case_shift_days + " ngày (kịch bản)" : "") + (e.roll_applied ? " · đã quá hạn, dời về ngày đầu dự báo" : "")],
          ["Công thức · giả định", esc(e.formula_id || "—") + " · " + esc((e.assumption_ids || []).join(", ") || "—")]]) + "</div>";
      }).join("") : "<p>Không có khoản thu chi nào.</p>"];
    }
    return [key, "<p>Không có chi tiết.</p>"];
  }

  /* ---------- policy form ---------- */
  function parseMoney(s) { s = String(s || "").trim(); if (!s) return null; var c = s.replace(/[.\s]/g, ""); return /^\d+$/.test(c) ? Number(c) : NaN; }
  function readPolicy(form) {
    var g = function (n) { return form.elements[n].value; }, errs = {}, eng = S.engine();
    var p = { source: "demo_assumption", rmin_vnd: parseMoney(g("rmin_vnd")), rtarget_vnd: parseMoney(g("rtarget_vnd")), rupper_vnd: parseMoney(g("rupper_vnd")),
      surplus_min_days: g("surplus_min_days").trim() ? Number(g("surplus_min_days")) : null, w_material_vnd: parseMoney(g("w_material_vnd")),
      w_material_pct_twc: g("w_material_pct_twc").trim() ? Number(g("w_material_pct_twc").replace(",", ".")) / 100 : null };
    ["rmin_vnd", "rtarget_vnd", "rupper_vnd", "w_material_vnd"].forEach(function (k) { if (isNaN(p[k]) || (p[k] != null && p[k] < 0)) errs[k] = "Nhập số nguyên VND không âm (có thể dùng dấu chấm phân cách nghìn)."; });
    if (p.rmin_vnd == null) errs.rmin_vnd = "Rmin là bắt buộc.";
    if (!errs.rtarget_vnd && p.rtarget_vnd != null && p.rmin_vnd != null && p.rtarget_vnd < p.rmin_vnd) errs.rtarget_vnd = "Rtarget phải lớn hơn hoặc bằng Rmin.";
    if (!errs.rupper_vnd && p.rupper_vnd != null && p.rtarget_vnd != null && p.rupper_vnd <= p.rtarget_vnd) errs.rupper_vnd = "Rupper phải lớn hơn Rtarget.";
    if (p.surplus_min_days == null || !(p.surplus_min_days >= 1) || p.surplus_min_days % 1) errs.surplus_min_days = "Nhập số ngày nguyên từ 1.";
    if (p.w_material_pct_twc != null && (isNaN(p.w_material_pct_twc) || p.w_material_pct_twc < 0 || p.w_material_pct_twc > 1)) errs.w_material_pct_twc = "Nhập phần trăm từ 0 đến 100.";
    p.assumption_text = "Giá trị do người dùng lưu trong UC00 cho " + eng.uc01.meta.firm_id + ".";
    return { policy: p, errors: errs };
  }

  /* ---------- events ---------- */
  function onClick(e) {
    var t = e.target.closest("[data-action],[data-nav],[data-evidence],[data-close]");
    if (!t || t.disabled) return;
    if (t.hasAttribute("data-close")) return closeDrawer();
    if (t.hasAttribute("data-nav")) { e.preventDefault(); location.hash = "#/" + t.getAttribute("data-nav"); return; }
    if (t.hasAttribute("data-evidence")) { var c = evidenceContent(t.getAttribute("data-evidence")); return openDrawer(c[0], c[1]); }
    var a = t.getAttribute("data-action"), id = t.getAttribute("data-id");
    if (a === "toggle-option" || a === "episode") return; // handled on change
    if (a === "policy-defaults") { view.draftPolicy = root.LILACT_DEMO.policyDefaults(Number(S.engine().uc02.base.inputs.buffer_vnd)); view.policyErrors = null; render(); toast("Đã điền đề xuất demo. Kiểm tra rồi bấm Lưu.", "info"); return; }
    if (a === "confirm-intake") { if (A.confirmIntake()) { toast("Đã xác nhận dữ liệu. Task 1–4 đã mở theo điều kiện của từng tác vụ.", "success"); location.hash = "#/uc01"; } else toast("Chưa thể xác nhận: cần lưu chính sách và đánh dấu ô xác nhận.", "error"); return; }
    if (a === "tab01") { view.tab01 = t.getAttribute("data-tab"); render(); var nt = document.getElementById("tab-" + view.tab01); if (nt) nt.focus(); return; }
    if (a === "scenario02") { view.scenario02 = t.getAttribute("data-v"); render(); return; }
    if (a === "run-scenario") { var r = A.runScenario(); toast(r ? "Đã chạy " + r.scenario_run_id + "." : "Không chạy được kịch bản.", r ? "success" : "error"); return; }
    if (a === "create-draft") {
      if (!view.lastSim) return toast("Cần chạy kịch bản trước.", "error");
      var d = A.createDraft(id, view.lastSim.content);
      toast(d ? "Đã tạo " + d.draft_id + ": bản nháp chờ duyệt, chưa gửi đi đâu." : "Không tạo được nháp (kịch bản thuộc bundle cũ?).", d ? "success" : "error"); return;
    }
    if (a === "approve") {
      var who = (document.getElementById("approver-" + id) || {}).value;
      var res = A.approve(id, who && who.trim());
      toast(res.ok ? "Đã duyệt " + id + " (thực thi giả lập 1 lần). Task 2 đã chạy lại trong " + res.bundle.id + "; kết quả cũ đã đánh dấu là cũ." : res.msg, res.ok ? "success" : "error");
      if (res.ok) location.hash = "#/uc02"; return;
    }
    if (a === "reject") { var why = (document.getElementById("reason-" + id) || {}).value; var rr = A.reject(id, why); toast(rr.ok ? "Đã từ chối " + id + ". Không có hành động nào được thực hiện." : rr.msg, rr.ok ? "info" : "error"); return; }
    if (a === "reset") { if (root.confirm("Xóa toàn bộ trạng thái demo của doanh nghiệp này?")) { A.resetFirm(); location.hash = "#/uc00"; } return; }
    if (a === "sidebar-toggle") {
      if (window.matchMedia("(max-width: 900px)").matches) {
        document.body.classList.toggle("la-nav-open");
      } else {
        document.body.classList.toggle("la-sidebar-collapsed");
      }
      syncSidebarControls();
      return;
    }
    if (a === "menu") { document.body.classList.remove("la-nav-open"); syncSidebarControls(); return; }
  }
  function onChange(e) {
    var t = e.target;
    if (t.id === "firm") { view = { tab01: null, scenario02: "base", draftPolicy: null, policyErrors: null, lastSim: null }; A.setFirm(t.value); return; }
    if (t.id === "ack") return A.setAck(t.checked);
    if (t.getAttribute("data-action") === "toggle-option") return A.toggleOption(t.value);
    if (t.getAttribute("data-action") === "episode") { A.selectEpisode(S.current().id, t.value); toast("Đã đổi đợt cần giải thích; Task 3 sẽ dùng đợt này.", "info"); return; }
    if (t.id === "upload" && t.files && t.files[0]) {
      var file = t.files[0], rd = new FileReader();
      rd.onload = function () {
        try {
          var r = L.rules.intake.check(String(rd.result), { as_of: S.engine().uc01.meta.as_of, firm_id: S.state().firm });
          A.setUpload({ file_name: file.name, record_count: r.record_count, rows_with_errors: r.rows_with_errors, blocked: r.blocked, issues: r.issues });
          toast(r.blocked ? "Tệp có " + r.issues.length + " vấn đề; chưa dùng được." : "Cấu trúc tệp hợp lệ (chỉ kiểm tra, không lưu).", r.blocked ? "error" : "success");
        } catch (err) { toast("Không đọc được tệp: " + err.message, "error"); }
      };
      rd.onerror = function () { toast("Không đọc được tệp.", "error"); };
      rd.readAsText(file);
    }
  }
  function onSubmit(e) {
    if (e.target.id !== "policy-form") return;
    e.preventDefault();
    var r = readPolicy(e.target);
    if (Object.keys(r.errors).length) { view.draftPolicy = r.policy; view.policyErrors = r.errors; render(); toast("Chính sách chưa hợp lệ; xem các ô được đánh dấu.", "error"); var first = document.querySelector('[aria-invalid="true"]'); if (first) first.focus(); return; }
    var was = S.fs().intake.confirmed;
    view.draftPolicy = null; view.policyErrors = null;
    A.savePolicy(r.policy);
    toast(was ? "Đã lưu ngưỡng mới: tạo bundle mới, kết quả cũ đã đánh dấu là cũ." : "Đã lưu chính sách ngưỡng.", "success");
  }

  function boot() {
    if (!root.LILACT_ENGINE || !root.LILACT_DEMO || !root.LILACT_DEMO.catalogue) {
      document.getElementById("workspace").innerHTML = ui.alertBox("red", "Thiếu dữ liệu", "Không tải được data/engine/*.js hoặc data/demo/*.js.");
      return;
    }
    S.load();
    var sel = document.getElementById("firm");
    sel.innerHTML = Object.keys(root.LILACT_ENGINE).sort().map(function (k) { var fm = root.LILACT_ENGINE[k].firm || {}; return '<option value="' + k + '">' + k + " · " + esc(fm.firm_name || "") + "</option>"; }).join("");
    S.on(render);
    document.addEventListener("click", onClick);
    document.addEventListener("change", onChange);
    document.addEventListener("submit", onSubmit);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawer(); });
    window.addEventListener("hashchange", function () { render(); window.scrollTo(0, 0); var m = document.getElementById("page-title"); if (m) m.focus({ preventScroll: true }); });
    render();
  }
  L.app = { render: render, toast: toast };
  document.addEventListener("DOMContentLoaded", boot);
})(window);
