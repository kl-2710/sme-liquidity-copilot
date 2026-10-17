/* UC00 · Tiếp nhận và xác nhận dữ liệu. Unconfirmed and confirmed data are visibly separate; tasks stay
   locked until the owner confirms both the data and the threshold policy. */
(function (root) {
  "use strict";
  var L = root.Lilact, f = L.fmt, ui = L.ui, esc = f.esc;
  L.views = L.views || {};

  function dqRows(eng) {
    var u1 = eng.uc01, u2 = eng.uc02.base, rows = [];
    (u1.data_quality || []).forEach(function (d) { rows.push({ id: d.id, check: d.check, scope: d.scope, value: d.value, status: d.status, reason: d.reason, src: "UC01" }); });
    var rc = u1.reconciliation;
    [["matches_ar", "Đối soát AR: tổng theo khách = tổng hóa đơn"], ["matches_inv", "Đối soát tồn kho sở hữu"], ["matches_ap", "Đối soát AP"], ["matches_ccc", "CCC = DSO + DIO − DPO"]].forEach(function (k) {
      rows.push({ id: "T1-J01-" + k[0], check: k[1], scope: "reconciliation", value: rc[k[0]] ? "khớp" : "lệch", status: rc[k[0]] ? "ok" : "fail", reason: "Dung sai " + rc.tolerance_vnd + " VND / " + rc.tolerance_days + " ngày", src: "UC01" });
    });
    rows.push({ id: "T2-RECON", check: "Sổ tiền theo ngày khớp tổng nguồn", scope: "UC02", value: u2.reconciliation.status, status: u2.reconciliation.status, reason: u2.reconciliation.details && u2.reconciliation.details.note, src: "UC02" });
    (u2.data_quality.issues || []).forEach(function (i) { rows.push({ id: i.code, check: i.message, scope: "UC02", value: i.source_ids.join(", "), status: i.severity === "info" ? "info" : i.severity, reason: "Giả định, không phải lỗi", src: "UC02" }); });
    rows.push({ id: "T2-COVERAGE", check: "Độ phủ lịch tiền", scope: "UC02", value: u2.capabilities.coverage_status, status: u2.capabilities.coverage_status === "complete" ? "ok" : "warning", reason: "Khoản chưa có ngày: thu " + f.vnd(u2.capabilities.unscheduled_amounts.IN) + ", chi " + f.vnd(u2.capabilities.unscheduled_amounts.OUT), src: "UC02" });
    return rows;
  }
  function statusChip(s) {
    if (s === "ok" || s === "pass") return ui.badge("success", "Đạt");
    if (s === "info") return ui.badge("info", "Thông tin");
    if (s === "warning") return ui.badge("warning", "Cảnh báo");
    if (s === "not_tested") return ui.badge("neutral", "Chưa kiểm được");
    return ui.badge("error", "Không đạt");
  }
  function policyField(id, label, value, help, err) {
    return '<div class="lc-field' + (err ? " lc-field--error" : "") + '"><label class="lc-label" for="pol-' + id + '">' + esc(label) + "</label>" +
      '<input class="lc-input lc-num" id="pol-' + id + '" name="' + id + '" inputmode="decimal" value="' + esc(value == null ? "" : typeof value === "number" && /_vnd$/.test(id) ? f.group(value) : value) + '"' + (err ? ' aria-invalid="true"' : "") + ' aria-describedby="pol-' + id + '-help">' +
      '<div class="lc-help" id="pol-' + id + '-help">' + (err ? ui.icon("x", 14) + esc(err) : help) + "</div></div>";
  }

  L.views.uc00 = function (ctx) {
    var eng = ctx.engine, F = ctx.fs, u1 = eng.uc01, u2 = eng.uc02.base, it = F.intake;
    var pol = ctx.draftPolicy || it.policy || null;
    var rows = dqRows(eng), blocking = rows.filter(function (r) { return r.status === "fail" || r.status === "error" || r.status === "invalid_data"; });
    var counts = {};
    (u1.evidence || []).forEach(function (e) { if (e.source_table) counts[e.source_table] = (e.source_row_ids || []).length; });
    counts["cash_plans.csv"] = u2.cash_events.filter(function (e) { return e.source_type === "plan"; }).length;
    var errs = ctx.policyErrors || {};

    var h = '<div class="la-page-intro"><p>Lilact chỉ tính trên dữ liệu đã được chủ doanh nghiệp xác nhận. Màn hình này cho thấy dữ liệu đọc được gì, kiểm tra ra sao và ngưỡng nào sẽ dùng; chưa xác nhận thì Task 1–4 còn khóa.</p></div>';
    h += it.confirmed
      ? ui.alertBox("info", "Đã xác nhận · " + ctx.bundle.snapshot_id, "Xác nhận lúc " + f.datetime(it.confirmed_at) + ". Kết quả hiện dùng bundle " + esc(ctx.bundle.id) + " với " + esc(ctx.bundle.policy_version) + ". Đổi ngưỡng sẽ tạo bundle mới và đánh dấu kết quả cũ là đã cũ.")
      : ui.note("stale", "<b>Chưa xác nhận.</b> Dữ liệu dưới đây mới được đọc và kiểm tra, chưa được dùng cho tính toán của Task 1–4.");
    h += ui.note("demo", "Dữ liệu là <b>hư cấu</b> (workbook thử nghiệm của nhóm). Số liệu được xuất từ engine UC01/UC02 thật tại commit " + esc(eng.provenance.engine_commit) + "; trang này không gửi dữ liệu đi đâu.");

    h += ui.section("① Nguồn dữ liệu", "observed", ui.table([
      { label: "Nguồn", render: function (r) { return "<code>" + esc(r.id) + "</code>"; } }, { label: "Tệp", key: "file" }, { label: "Nội dung", key: "kind" },
      { label: "Số bản ghi", num: true, render: function (r) { return counts[r.id] != null ? f.group(counts[r.id]) : "—"; } }
    ], root.LILACT_DEMO.intake.sources, { label: "Nguồn dữ liệu" }) +
      '<p class="la-muted">Snapshot <code>' + esc(u2.meta.snapshot_id) + "</code> · ngày chốt " + f.date(u1.meta.as_of) + " · kỳ " + f.date(u1.meta.period_start) + "–" + f.date(u1.meta.period_end) +
      " (N = " + u1.meta.period_days + ") · checksum nguồn <code>" + esc(String(u2.meta.source_checksum).slice(0, 12)) + "…</code></p>", { id: "src" });

    h += ui.section("② Ánh xạ trường", "observed", '<div class="la-grid-2">' + root.LILACT_DEMO.intake.sources.map(function (s) {
      return '<div class="lc-card la-map"><h3>' + esc(s.id) + "</h3>" + ui.dl(s.fields.map(function (p) { return ["" + p[0], esc(p[1])]; })) + "</div>";
    }).join("") + "</div>", { id: "map" });

    h += ui.section("③ Kiểm tra và đối soát", "engine", ui.table([
      { label: "Mã", render: function (r) { return "<code>" + esc(r.id) + "</code>"; } }, { label: "Kiểm tra", key: "check" }, { label: "Phạm vi", key: "scope" },
      { label: "Giá trị", render: function (r) { return esc(f.text(r.value)); } }, { label: "Trạng thái", render: function (r) { return statusChip(r.status); } },
      { label: "Ghi chú", render: function (r) { return esc(f.text(r.reason || "")); } }
    ], rows, { label: "Kết quả kiểm tra dữ liệu" }) + (blocking.length
      ? ui.alertBox("red", "Có " + blocking.length + " kiểm tra không đạt", "Không thể xác nhận cho đến khi bổ sung. Lilact gom câu hỏi bổ sung một lần thay vì hỏi từng chỗ.")
      : '<p class="la-muted">Không có kiểm tra chặn. ' + u1.unsupported_metrics.length + " chỉ tiêu nâng cao không tính được do thiếu dữ liệu (ví dụ NRV, hạn mức tín dụng) và được ghi là missing_data, không bị coi là 0.</p>"), { id: "dq" });

    var pv = pol || {};
    h += ui.section("④ Chính sách ngưỡng", "assumption",
      '<p class="la-muted">Các tài liệu đặc tả hiện có <b>không</b> quy định giá trị Rtarget, Rupper hay ngưỡng trọng yếu W. Ô dưới đây là đề xuất demo; chỉ khi bạn lưu thì các giá trị mới được dùng để phân loại. Bỏ trống một ngưỡng thì trục tương ứng là "chưa xác định".</p>' +
      '<form id="policy-form" class="la-form" novalidate><div class="la-grid-3">' +
      policyField("rmin_vnd", "Rmin · mức tối thiểu (VND)", pv.rmin_vnd, "Từ D_firms.min_cash_buffer_vnd: " + f.vnd(u2.inputs.buffer_vnd), errs.rmin_vnd) +
      policyField("rtarget_vnd", "Rtarget · mức mục tiêu (VND)", pv.rtarget_vnd, "Dưới mức này là thiếu (TH01).", errs.rtarget_vnd) +
      policyField("rupper_vnd", "Rupper · mức trần (VND)", pv.rupper_vnd, "Trên mức này đủ lâu là dư (TH03).", errs.rupper_vnd) +
      policyField("surplus_min_days", "Số ngày tối thiểu của cửa sổ dư", pv.surplus_min_days, "Theo tài liệu luồng: 14 ngày.", errs.surplus_min_days) +
      policyField("w_material_vnd", "Trọng yếu W2 · số tiền (VND)", pv.w_material_vnd, "Tín hiệu từ mức này trở lên…", errs.w_material_vnd) +
      policyField("w_material_pct_twc", "Trọng yếu W2 · % TWC", pv.w_material_pct_twc != null ? String(+(pv.w_material_pct_twc * 100).toFixed(2)).replace(".", ",") : "", "…và chiếm từ tỷ lệ này của TWC (nhập %, ví dụ 5).", errs.w_material_pct_twc) +
      '</div><div class="la-actions">' + ui.btn("Điền đề xuất demo", "secondary", 'data-action="policy-defaults"') + ui.btn(it.confirmed ? "Lưu và tạo bundle mới" : "Lưu chính sách", "primary", 'type="submit"') +
      (it.policy ? '<span class="la-muted">Đang dùng phiên bản ' + it.policy_version + " · nguồn: " + esc(it.policy.source === "demo_assumption" ? "đề xuất demo, đã lưu bởi người dùng" : it.policy.source) + "</span>" : '<span class="la-muted">Chưa lưu chính sách nào.</span>') +
      "</div></form>", { id: "policy" });

    var canConfirm = !blocking.length && it.policy && !it.confirmed;
    h += ui.section("⑤ Xác nhận", null, it.confirmed
      ? '<p>' + ui.badge("success", "Đã xác nhận") + " Snapshot <code>" + esc(ctx.bundle.snapshot_id) + "</code> · bundle <code>" + esc(ctx.bundle.id) + '</code>.</p><div class="la-actions">' + ui.btn("Sang Task 1 · Chẩn đoán", "primary", 'data-nav="uc01"') + "</div>"
      : '<label class="la-check"><input type="checkbox" id="ack" ' + (it.ack ? "checked" : "") + (it.policy && !blocking.length ? "" : " disabled") + '> Tôi đã xem các trường trọng yếu và ngưỡng ở trên, và đồng ý dùng snapshot này cho Task 1–4.</label>' +
        '<div class="la-actions">' + ui.btn("Xác nhận dữ liệu", "primary", 'data-action="confirm-intake"' + (canConfirm && it.ack ? "" : ' disabled aria-disabled="true"')) +
        '<span class="la-muted">' + (blocking.length ? "Còn kiểm tra không đạt." : !it.policy ? "Cần lưu chính sách ngưỡng trước." : !it.ack ? "Cần đánh dấu ô xác nhận." : "Sẵn sàng.") + "</span></div>", { id: "confirm" });

    var up = it.upload;
    h += ui.section("Kiểm tra tệp của bạn (không lưu)", "rule",
      '<p class="la-muted">Tải một tệp CSV hóa đơn bán để kiểm tra cấu trúc trong trình duyệt: thiếu cột, thiếu giá trị, trùng mã, số tiền mơ hồ, ngày sai, lệch kỳ, khác doanh nghiệp. Tệp <b>không</b> được lưu và <b>không</b> thay snapshot của engine; không dòng nào bị bỏ đi âm thầm. Có thể thử với <a href="data/demo/sample_sales_with_errors.csv" download>tệp mẫu có lỗi</a>.</p>' +
      '<div class="la-actions"><label class="lc-btn lc-btn--secondary la-file">' + ui.icon("upload") + 'Chọn tệp CSV<input type="file" id="upload" accept=".csv,text/csv"></label></div>' +
      (up ? '<div class="la-upload-result" aria-live="polite"><p><b>' + esc(up.file_name) + "</b> · " + up.record_count + " dòng dữ liệu · " + up.rows_with_errors + " dòng có lỗi · " +
        (up.blocked ? ui.badge("error", "Chưa dùng được") : ui.badge("success", "Cấu trúc hợp lệ")) + "</p>" +
        ui.table([{ label: "Dòng", key: "row", num: true }, { label: "Trường", key: "field" }, { label: "Mã", render: function (r) { return "<code>" + esc(r.code) + "</code>"; } },
          { label: "Mức", render: function (r) { return statusChip(r.severity === "info" ? "info" : r.severity === "warning" ? "warning" : "fail"); } }, { label: "Diễn giải", key: "message" }],
          up.issues, { label: "Vấn đề trong tệp tải lên", empty: "Không phát hiện vấn đề." }) + "</div>" : ""), { id: "upload-sec" });
    return h;
  };
})(window);
