/* UC02 / Task 2 · Dự báo thiếu dư và giải thích + bộ định tuyến ma trận 9 ô.
   Daily ledger, weekly table, engine alerts and episodes vs buffer come from the UC02 engine (tv2.result.v1).
   TH classification vs Rtarget/Rupper, the explanation layer and the matrix cell are labelled demo rules. */
(function (root) {
  "use strict";
  var L = root.Lilact, f = L.fmt, ui = L.ui, esc = f.esc, RT = L.rules.router, EX = L.rules.explain;
  L.views = L.views || {};

  function matrix(res) {
    var active = res.route.cell;
    var h = '<div class="lc-matrix la-matrix" role="table" aria-label="Ma trận định tuyến 9 trường hợp"><div role="row" class="la-contents"><div role="columnheader" class="lc-matrix__col"><span class="lc-visually-hidden">W \\ TH</span></div>' +
      RT.COL_ORDER.map(function (c) { return '<div class="lc-matrix__col" role="columnheader">' + c + " · " + RT.COLS[c].label + "</div>"; }).join("") + "</div>";
    ["W0", "W1", "W2"].forEach(function (w) {
      h += '<div role="row" class="la-contents"><div class="lc-matrix__row" role="rowheader" title="' + esc(RT.ROWS[w]) + '">' + w + "</div>";
      RT.GRID[w].forEach(function (id) {
        var on = id === active;
        h += '<div class="lc-matrix__cell' + (on ? " is-active" : "") + '" role="cell"' + (on ? ' aria-current="true"' : "") + "><b>" + id + (on ? ' <span class="lc-visually-hidden">(ô đang áp dụng)</span>' : "") + "</b><span>" + esc(RT.CELLS[id].title) + "</span></div>";
      });
      h += "</div>";
    });
    return h + "</div>";
  }

  function routeCard(res) {
    var r = res.route, W = res.W, TH = res.TH;
    var why = ui.dl([["Trục dọc (Task 1)", (W.w === "unknown" ? ui.badge("neutral", "chưa xác định") : ui.chip(W.w, "")) + " " + esc(W.reason)],
      ["Trục ngang (Task 2)", (TH.th === "unknown" ? ui.badge("neutral", "chưa xác định") : ui.chip(TH.th, "")) + " " + esc(TH.reason) + (TH.mixed ? " " + ui.chip("mixed", "brand") : "")]]);
    if (!r.cell) return why + ui.alertBox("info", "Chưa gán ô", "Thiếu trục " + r.missing.join(" và ") + ". Theo tài liệu luồng, một trục chưa đủ dữ liệu thì không gán ô; phần đã tính vẫn hiển thị. Task 3 tạm khóa.");
    var c = r.def;
    return why + '<div class="lc-card la-route"><div class="la-headline">' + ui.chip(r.cell, "brand") + "<b>" + esc(c.title) + '</b><span class="la-muted">Task 3: ' + esc(RT.COLS[c.th].task3) + "</span></div>" +
      ui.dl([["Thấy gì", esc(c.see)], ["Task 2 làm rõ", esc(c.task2)], ["Task 3 ưu tiên", esc(c.task3)], ["Task 4 kiểm", esc(c.task4)], ['<span class="la-forbid">Không được</span>', '<span class="la-forbid">' + esc(c.forbid) + "</span>"]]) +
      '<p class="la-caption">Ô do luật cố định chọn từ hai trục; cấp cảnh báo tính riêng và không đi theo màu ô.</p></div>';
  }

  L.views.matrix = matrix;
  L.views.routeCard = routeCard;

  L.views.uc02 = function (ctx) {
    var res = ctx.res, fc = res.forecast, pol = res.policy, S = fc.summary, an = ctx.an, adverse = ctx.scenario02 === "adverse";
    var view = adverse ? res.adverse : fc;
    var rows = view.daily_schedule.map(function (d) { return { date: d.date, closing_vnd: Number(d.closing_vnd) }; });
    var h = '<div class="la-page-intro"><p>Khi nào thiếu, thiếu bao nhiêu, kẹt ở đâu, do ai. Dự báo theo <b>ngày</b> cho ' + fc.daily_schedule.length + " ngày (" + f.date(fc.meta.start_date) + "–" + f.date(fc.meta.end_date) +
      "), bắt đầu từ tiền tại ngày chốt; mỗi khoản thu chi có mã nguồn.</p></div>";
    if (fc.derived) {
      var rc = res.bundle.rerun_check;
      h += ui.alertBox(rc && rc.ok ? "info" : "orange", "Kết quả chạy lại sau khi duyệt " + (rc ? rc.draft_id : ""),
        "Bundle " + esc(res.bundle.id) + " = bundle " + esc(res.bundle.parent_id) + " + phương án đã duyệt. Sổ ngày được tính lại bằng bộ tính demo trên đúng các sự kiện tiền của engine (engine thật chưa nhận change_set). " +
        (rc ? (rc.ok ? "Kiểm tra: không sinh ngày thiếu mới và không đợt nào xấu đi." : "Kiểm tra: " + rc.new_shortfall_days.length + " ngày thiếu mới, " + rc.worsened_episodes.length + " đợt xấu đi.") : ""));
    }
    h += '<div class="la-toolbar" role="group" aria-label="Tùy chọn dự báo">' +
      '<div class="la-seg" role="radiogroup" aria-label="Kịch bản"><button type="button" role="radio" aria-checked="' + !adverse + '" data-action="scenario02" data-v="base">Cơ sở (base)</button>' +
      '<button type="button" role="radio" aria-checked="' + adverse + '" data-action="scenario02" data-v="adverse">Khách trả chậm thêm 14 ngày</button></div>' +
      '<div class="la-seg" role="radiogroup" aria-label="Tầm dự báo"><button type="button" role="radio" aria-checked="true">91 ngày</button>' +
      '<button type="button" role="radio" aria-checked="false" aria-disabled="true" disabled aria-describedby="h6m">6 tháng</button></div>' +
      '<span id="h6m" class="la-caption">6 tháng chưa mở: engine UC02 hiện tối đa 13 tuần, và theo tài liệu luồng tầm 6 tháng chỉ mở khi đủ dữ liệu (xem CONFLICTS.md #1).</span></div>';
    if (adverse) h += ui.note("scenario", "Đang xem kịch bản xấu do <b>engine</b> tính (case <code>estimated_receipts_late</code>, chỉ dời các khoản thu ước tính thêm 14 ngày). Không phải dự báo cơ sở.");

    var VS = view.summary;
    h += '<div class="lc-metrics">' +
      ui.metric("Tiền đầu kỳ (Cash0)", f.vndShort(view.inputs.cash0_vnd), "", ui.evidence("EV-CASH0", "uc02ev:EV-CASH0") + " " + ui.SOURCE.engine) +
      ui.metric("Tiền thấp nhất", f.vndShort(VS.min_balance_vnd), "", "ngày " + f.date(VS.min_balance_date) + " " + ui.SOURCE.engine) +
      ui.metric("Ngày đầu dưới Rmin (buffer)", VS.first_buffer_date ? f.date(VS.first_buffer_date) : "Không có", "", "âm tiền: " + (VS.first_negative_date ? f.date(VS.first_negative_date) : "không") + " " + ui.SOURCE.engine) +
      ui.metric("Trạng thái tiền (TH)", res.TH.th === "unknown" ? "—" : res.TH.th, res.TH.th === "unknown" ? "" : RT.COLS[res.TH.th].label, ui.SOURCE.rule) + "</div>";

    h += ui.section("Đường tiền theo ngày", adverse ? "scenario" : "engine", L.chart.cash(
      [{ rows: rows, label: adverse ? "Kịch bản khách trả chậm (engine)" : "Base (engine)", kind: adverse ? "adverse" : "base" }].concat(adverse ? [] : [{ rows: res.adverseRows, label: "Kịch bản xấu (engine)", kind: "adverse" }]),
      { rmin: pol.rmin_vnd, rtarget: pol.rtarget_vnd, rupper: pol.rupper_vnd }, { episode: !adverse && an.mode === "base" ? an.episode : null, level: "orange",
        label: "Số dư tiền theo ngày từ " + f.date(fc.meta.start_date) + " đến " + f.date(fc.meta.end_date) + "; thấp nhất " + f.vnd(VS.min_balance_vnd) + " ngày " + f.date(VS.min_balance_date) }) +
      '<p class="la-caption">Rmin, Rtarget, Rupper lấy từ ' + esc(res.bundle.policy_version) + ". Di chuột lên biểu đồ để xem số từng ngày; bảng đầy đủ ở dưới.</p>", { id: "chart" });

    // Episodes vs Rtarget (rule) — the user can switch the episode that Task 2 explains.
    var eps = res.TH.episodes;
    h += ui.section("Các đợt dưới Rtarget", "rule", eps.length ? '<fieldset class="la-episodes"><legend class="lc-visually-hidden">Chọn đợt cần giải thích</legend>' + ui.table([
      { label: "Đợt", render: function (e) { return '<label class="la-radio"><input type="radio" name="ep" value="' + e.start_date + '" data-action="episode"' + (an.episode && an.mode === "base" && an.episode.start_date === e.start_date ? " checked" : "") + "> " + e.id + "</label>"; } },
      { label: "Ngày đầu", render: function (e) { return f.date(e.start_date); } }, { label: "Ngày đỉnh", render: function (e) { return f.date(e.peak_date); } },
      { label: "Kết thúc", render: function (e) { return f.date(e.end_date) + (e.censored ? " (còn tiếp sau kỳ)" : ""); } },
      { label: "Số ngày", num: true, key: "duration_days" }, { label: "PeakGap so Rtarget", num: true, render: function (e) { return f.vnd(e.peak_gap_vnd); } },
      { label: "Dưới Rmin?", render: function (e) { return e.min_vnd < pol.rmin_vnd ? (e.min_vnd < 0 ? "Có, âm tiền" : "Có") : "Không"; } }
    ], eps, { label: "Đợt thiếu" }) + "</fieldset>" + '<p class="la-caption">Nhiều đợt: không cộng PeakGap. Mặc định chọn đợt trọng yếu nhất; đổi đợt sẽ làm mới Task 3.</p>'
      : ui.empty("Không có ngày nào dưới Rtarget", res.TH.th === "TH03" ? "Đường tiền cơ sở giữ trên Rtarget; có cửa sổ trên Rupper (xem Task 3 · dùng tiền có kỷ luật)." : res.TH.th === "unknown" ? "Chưa có Rtarget đã lưu nên chưa xác định." : "Base giữ được mục tiêu. Theo ô M2/M5/M8, vẫn phải xem kịch bản xấu trước khi nói \"đủ\"."), { id: "episodes" });
    if (res.TH.th !== "TH01" && res.TH.th !== "unknown") h += res.adverseTH.th === "TH01"
      ? ui.alertBox("orange", "Kịch bản xấu có thiếu", "Khi khách trả chậm thêm 14 ngày, tiền xuống dưới Rtarget trong " + res.adverseTH.episodes.length + " đợt (lớn nhất " + f.vnd(Math.max.apply(null, res.adverseTH.episodes.map(function (e) { return e.peak_gap_vnd; }))) + "). Task 3 mở nhánh dự phòng.")
      : ui.note("info", "Kịch bản xấu (khách trả chậm thêm 14 ngày) cũng không xuống dưới Rtarget.");

    if (an.mode) h += explainSection(an, pol);

    h += ui.section("Bộ định tuyến · ma trận 9 trường hợp", "rule", '<div class="la-grid-route">' + matrix(res) + "<div>" + routeCard(res) + "</div></div>", { id: "route" });

    h += ui.section("Bảng tuần và cảnh báo của engine", adverse ? "scenario" : "engine", ui.table([
      { label: "Tuần", render: function (w) { return "T" + w.week_number + ' <span class="la-muted">' + f.dateShort(w.start_date) + "–" + f.dateShort(w.end_date) + "</span>"; } },
      { label: "Đầu tuần", num: true, render: function (w) { return f.vnd(w.opening_vnd); } }, { label: "Thu", num: true, render: function (w) { return f.vnd(w.in_vnd); } },
      { label: "Chi", num: true, render: function (w) { return f.vnd(w.out_vnd); } }, { label: "Cuối tuần", num: true, render: function (w) { return f.vnd(w.closing_vnd); } },
      { label: "Thấp nhất trong tuần", num: true, render: function (w) { return f.vnd(w.min_daily_vnd) + ' <span class="la-muted">' + f.dateShort(w.min_daily_date) + "</span>"; } },
      { label: "Cảnh báo (ngày xấu nhất)", render: function (w) { return ui.alertBadge(w.worst_daily_alert_color); } }
    ], view.weekly_schedule, { label: "Bảng tuần" }) +
      '<p class="la-caption">Cảnh báo theo quy tắc engine <code>T2-ALERT-*</code>: so với buffer (dùng làm Rmin), vàng ≤ ' + f.pct(view.inputs.yellow_upper, 0) + ", cam ≤ " + f.pct(view.inputs.orange_upper, 0) +
      ", đỏ lớn hơn, âm tiền luôn đỏ. Không có cấp xanh: ngày đủ tiền ghi \"Không cảnh báo\". Bảng tuần là tóm tắt; ngày chi tiết ở dưới.</p>", { id: "weekly" });

    h += ui.section("Sổ tiền theo ngày", adverse ? "scenario" : "engine", '<details class="la-details"><summary>Xem ' + view.daily_schedule.length + " ngày (bấm một ngày để xem các khoản thu chi)</summary>" + ui.table([
      { label: "Ngày", render: function (d) { return '<button type="button" class="la-link" data-evidence="day:' + (adverse ? "adv:" : "") + d.date + '">' + f.date(d.date) + "</button>"; } },
      { label: "Đầu ngày", num: true, render: function (d) { return f.vnd(d.opening_vnd); } }, { label: "Thu", num: true, render: function (d) { return f.vnd(d.in_vnd); } },
      { label: "Chi", num: true, render: function (d) { return f.vnd(d.out_vnd); } }, { label: "Cuối ngày", num: true, render: function (d) { return f.vnd(d.closing_vnd); } },
      { label: "So Rtarget", render: function (d) { return Number(d.closing_vnd) < pol.rtarget_vnd ? "Dưới" : "—"; } },
      { label: "Cảnh báo engine", render: function (d) { return ui.alertBadge(d.alert_color); } }
    ], view.daily_schedule, { label: "Sổ tiền theo ngày" }) + "</details>", { id: "daily" });

    h += ui.section("Giả định và đối soát", "engine", ui.dl([
      ["Đối soát", ui.badge(view.reconciliation.status === "ok" ? "success" : "error", "Sổ ngày khớp nguồn đến " + view.reconciliation.tolerance_vnd + " VND") + ' <span class="la-caption">' + esc(view.reconciliation.details.note) + "</span>"],
      ["Giả định", '<ul class="la-list">' + view.inputs.assumptions.map(function (a) { return "<li><code>" + esc(a.id) + "</code> " + esc(a.text) + "</li>"; }).join("") + "</ul>"],
      ["Không hỗ trợ", esc(view.capabilities.not_supported.join("; "))],
      ["Run", "<code>" + esc(view.meta.run_id) + "</code> · " + esc(view.meta.formula_version) + " · snapshot <code>" + esc(view.meta.snapshot_id) + "</code>"]
    ]), { id: "assume" });
    return h;
  };

  function explainSection(an, pol) {
    var ex = an.explanation, n = ex.need, b = ex.bridge_peak;
    var h = (an.mode === "adverse" ? ui.note("scenario", "Nhánh dự phòng: đợt này nằm trên <b>kịch bản xấu</b>, base không thiếu.") : "") + '<div class="lc-metrics">' +
      ui.metric("need_date · ngày cần tiền", f.date(n.need_date), "", "đợt " + esc(an.episode.id) + " · đỉnh " + f.date(n.peak_date)) +
      ui.metric("need_target · về Rtarget", f.vndShort(n.need_target_vnd), "", "PeakGap so Rtarget") +
      ui.metric("floor_need · tránh dưới Rmin", f.vndShort(n.floor_need_vnd), "", n.floor_need_vnd ? "phải có nguồn" : "không xuống dưới Rmin") +
      ui.metric("Dự trữ trên Rmin hấp thụ", f.vndShort(n.reserve_absorbable_vnd), "", "không phải nguồn mới") + "</div>";
    var outs = Object.keys(b.out_by_category).sort(function (x, y) { return b.out_by_category[y] - b.out_by_category[x]; });
    var ins = Object.keys(b.in_by_counterparty).sort(function (x, y) { return b.in_by_counterparty[y] - b.in_by_counterparty[x]; });
    h += '<div class="la-stack"><div class="lc-card"><h3>Cầu tiền tại ngày đỉnh ' + f.date(b.date) + "</h3>" + ui.table([{ label: "Dòng", key: "k" }, { label: "Số tiền", num: true, render: function (r) { return r.v; } }],
      [{ k: "Cash0", v: f.vnd(b.cash0_vnd) }].concat(ins.map(function (k) { return { k: "+ Thu " + k, v: f.vnd(b.in_by_counterparty[k]) }; }))
        .concat(outs.map(function (k) { return { k: "− " + (EX.CATEGORY_LABEL[k] || k), v: f.vnd(-b.out_by_category[k]) }; }))
        .concat([{ k: "= CashEnd", v: "<b>" + f.vnd(b.cash_end_vnd) + "</b>" }]), { label: "Cầu tiền" }) +
      "<p>" + (b.ties ? ui.badge("success", "Khớp sổ ngày đến 1 VND") : ui.badge("error", "Không khớp sổ ngày")) + ' <span class="la-caption">' + b.event_ids.length + " sự kiện tiền có mã nguồn.</span></p></div>" +
      '<div class="lc-card"><h3>Phép thử counterfactual</h3>' + ui.table([
        { label: "Mã", render: function (c) { return "<code>" + esc(c.id) + "</code>"; } }, { label: "Phép thử", key: "label" },
        { label: "Gap gốc", num: true, render: function (c) { return f.vnd(c.gap_before_vnd); } }, { label: "Gap thử", num: true, render: function (c) { return f.vnd(c.gap_after_vnd); } },
        { label: "TimingImpact", num: true, render: function (c) { return f.vnd(c.timing_impact_vnd); } }
      ], ex.counterfactuals, { label: "Counterfactual", empty: "Không có khách trả trễ hay khoản chi tùy chọn nào để thử." }) +
      '<p class="la-caption">Mỗi phép thử chạy riêng trên base; các phép thử tương tác nhau nên không cộng thành "tổng nguyên nhân".</p></div></div>';
    h += '<div class="lc-card la-causes"><h3>Nguyên nhân có bằng chứng</h3>' + (ex.causes.length ? '<ul class="la-list">' + ex.causes.map(function (c) {
      return "<li>" + ui.chip(EX.CAUSES[c.type], "brand") + " " + esc(c.text) + ' <span class="la-caption"><code>' + esc(c.rule_id) + "</code></span> " +
        (c.evidence || []).slice(0, 6).map(function (e) { return ui.evidence(e, /^EV-/.test(e) ? "uc02ev:" + e : "event:" + an.mode + ":" + e); }).join(" ") + ((c.evidence || []).length > 6 ? ' <span class="la-caption">+' + (c.evidence.length - 6) + "</span>" : "") +
        (c.finding_ids && c.finding_ids.length ? ' <span class="la-caption">nối với ' + c.finding_ids.join(", ") + "</span>" : "") + "</li>";
    }).join("") + "</ul>" : "<p>Chưa rõ: không quy tắc nào khớp đủ bằng chứng.</p>") +
      '<p class="la-caption">Quy tắc demo đặt tên 5 loại nguyên nhân theo bảng "Từ nguyên nhân đến nguồn bù". Đóng góp số học trong cầu tiền khác với nguyên nhân có chứng từ.</p></div>';
    return ui.section("Lớp giải thích · đợt " + an.episode.id, "rule", h, { id: "explain" });
  }
})(window);
