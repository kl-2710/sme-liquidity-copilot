/* UC03 / Task 3 · So khớp giải pháp. Branch follows the matrix column (TH01 tìm nguồn bù · TH02 giữ thanh khoản ·
   TH03 dùng tiền có kỷ luật). Catalogue is simulated; nothing here is a credit decision or a lender offer. */
(function (root) {
  "use strict";
  var L = root.Lilact, f = L.fmt, ui = L.ui, esc = f.esc, RT = L.rules.router, EX = L.rules.explain;
  L.views = L.views || {};
  var CERT = { high: "cao", medium: "trung bình", low: "thấp" };
  var COV = { full: "Kịp và đủ về Rtarget", floor: "Kịp, đủ tránh dưới Rmin", partial: "Kịp một phần" };

  function candidate(c, selected) {
    var on = selected.indexOf(c.product_id) >= 0;
    return '<article class="lc-card la-option' + (on ? " is-selected" : "") + '"><header class="la-headline">' + ui.chip("#" + c.rank + " · " + c.option_id, "brand") + "<b>" + esc(c.name) + "</b></header>" +
      '<p class="la-muted">' + esc(c.provider) + " · nhóm " + c.group + " " + esc(c.group_label) + "</p>" +
      ui.dl([["Mức phủ", ui.badge(c.coverage === "full" ? "success" : "warning", COV[c.coverage])],
        ["Tiền vào sớm nhất", f.date(c.arrival_date)], ["Tiền ròng", f.vnd(c.gross_vnd)], ["Phần thiếu đã bù", f.vnd(c.covered_vnd)], ["Còn thiếu (residual)", f.vnd(c.residual_need_vnd)],
        ["Chi phí", c.cost_vnd ? f.vnd(c.cost_vnd) + " · lãi đơn quy năm " + f.pct(c.cost_simple_annual) : "Không phát sinh phí"], ["Độ chắc chắn", esc(CERT[c.certainty])],
        ["Gánh nặng quan hệ", c.relationship_burden + "/3 (điểm demo, chủ DN chấm)"], ["Nợ mới", c.new_debt_vnd ? f.vnd(c.new_debt_vnd) + (c.repayment_beyond_horizon ? " · trả sau kỳ dự báo" : "") : "—"],
        ["Đúng nguyên nhân", c.addresses.length ? c.addresses.map(function (t) { return ui.chip(EX.CAUSES[t], ""); }).join(" ") : '<span class="la-muted">không gắn nguyên nhân cụ thể</span>']]) +
      '<label class="la-check"><input type="checkbox" data-action="toggle-option" value="' + esc(c.product_id) + '"' + (on ? " checked" : "") + "> Chọn để thử ở Task 4</label></article>";
  }

  L.views.uc03 = function (ctx) {
    var res = ctx.res, r = res.route, an = ctx.an, F = ctx.fs;
    var h = '<div class="la-page-intro"><p>Nguồn nào đúng nguyên nhân, kịp ngày, rẻ, giữ được quan hệ. Xếp hạng theo: kịp và đủ trước, rồi độ chắc chắn, rồi chi phí trên phần bù, rồi gánh nặng quan hệ. Lãi suất thấp nhất không tự động đứng đầu.</p></div>';
    h += ui.alertBox("info", "Không phải quyết định tín dụng", "Danh mục là <b>giả lập</b> với tên tổ chức hư cấu. Lilact chỉ gợi ý; bên cho vay quyết định. Không có phê duyệt tín dụng hay cam kết giải ngân nào ở đây.");
    h += '<div class="la-headline">' + ui.chip(r.cell, "brand") + "<b>" + esc(r.def.title) + '</b><span class="la-muted">Nhánh: ' + esc(RT.COLS[r.def.th].task3) + " · Task 3 ưu tiên: " + esc(r.def.task3) + "</span></div>";
    h += '<p class="la-forbid-line"><span class="la-forbid">Không được:</span> ' + esc(r.def.forbid) + "</p>";

    if (r.branch === "surplus") {
      var sc = L.rules.uc03.safeCash(res.rows, res.adverseRows, res.policy, res.forecast.meta.end_date, null);
      h += ui.section("Dùng tiền có kỷ luật · SafeCash", "rule", '<div class="lc-metrics">' +
        ui.metric("SafeCash (base)", f.vndShort(sc.safe_cash_base_vnd), "", "min(Cash − Rtarget) đến " + f.date(sc.until_date)) +
        ui.metric("SafeCash (kịch bản xấu)", f.vndShort(sc.safe_cash_adverse_vnd), "", "khách trả chậm thêm 14 ngày (engine)") +
        ui.metric("SafeCash dùng được", f.vndShort(sc.safe_cash_vnd), "", "lấy mức thấp hơn của hai kịch bản") +
        ui.metric("Cửa sổ dư", res.TH.windows.length + " cửa sổ", "", res.TH.windows.map(function (w) { return f.dateShort(w.start_date) + "–" + f.dateShort(w.end_date); }).join(", ")) + "</div>" +
        (sc.safe_cash_vnd === 0 ? ui.note("info", "SafeCash = 0 là kết quả hợp lệ: số dư cao ở một số ngày nhưng có ngày khác (ở base hoặc kịch bản xấu) chỉ vừa đủ Rtarget, nên không có khoản nào dùng được mà vẫn giữ dự trữ đến cuối kỳ.") : "") +
        '<p class="la-muted">Thứ tự xét sau khi giữ dự trữ và nghĩa vụ trong stress: giữ tiền · trả nợ đắt · chiết khấu trả sớm NCC · công cụ ngắn hạn. Dư tạm thời không có nghĩa là doanh nghiệp khỏe. Engine demo chưa có danh mục công cụ đầu tư; Task 4 cho nhánh này chưa được hỗ trợ.</p>', { id: "safecash" });
      return h;
    }
    if (!an.mode) {
      h += ui.section("Giữ thanh khoản", "rule", ui.empty("Giữ nguyên là kết quả hợp lệ", "Base không thiếu và kịch bản xấu cũng không xuống dưới Rtarget, nên không tạo nhu cầu vay hoặc đầu tư chỉ để có phương án. Có đơn hàng mới thì cần thêm lịch mua, lương, thu, thuế của đơn đó — chưa có trong dữ liệu demo."), { id: "hold" });
      return h;
    }
    var n = an.explanation.need, m = an.match;
    if (an.mode === "adverse") h += ui.note("scenario", "Nhánh <b>dự phòng</b>: base không thiếu; nhu cầu dưới đây lấy từ kịch bản xấu của engine. Chỉ chuẩn bị, không ép vay.");
    h += ui.section("① Nhu cầu", "rule", '<div class="lc-metrics">' +
      ui.metric("Cần tiền trước", f.date(n.need_date), "", "đợt " + esc(an.episode.id) + ", đỉnh " + f.date(n.peak_date)) + ui.metric("need_target", f.vndShort(n.need_target_vnd), "", "về Rtarget") +
      ui.metric("floor_need", f.vndShort(n.floor_need_vnd), "", "tránh dưới Rmin") + ui.metric("Dự trữ trên Rmin hấp thụ", f.vndShort(n.reserve_absorbable_vnd), "", "không phải nguồn mới") + "</div>" +
      '<p class="la-muted">Nguyên nhân từ Task 2: ' + (an.explanation.causes.length ? an.explanation.causes.map(function (c) { return ui.chip(EX.CAUSES[c.type], "brand"); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(" ") : "chưa rõ") +
      '. <a href="#/uc02" data-nav="uc02">Đổi đợt ở Task 2</a>.</p>', { id: "need" });

    h += ui.section("⑤ Ứng viên (tối đa 3)", "catalogue", m.candidates.length ? '<div class="la-cards la-cards--3">' + m.candidates.map(function (c) { return candidate(c, F.selected); }).join("") + "</div>"
      : ui.alertBox("red", "Không có nguồn nào kịp need_date", "Phần chưa bù: " + f.vnd(m.uncovered_vnd) + (m.earliest_late_date ? ". Nguồn sớm nhất có tiền vào " + f.date(m.earliest_late_date) + ", sau ngày cần tiền." : ".") + " Không gắn nhãn \"đã giải quyết\"."), { id: "cands" });
    if (m.candidates.length && m.uncovered_vnd > 0) h += ui.note("info", "Ứng viên tốt nhất vẫn còn thiếu " + f.vnd(m.uncovered_vnd) + "; có thể chọn nhiều ứng viên để thử tổ hợp ở Task 4.");

    h += ui.section("④ Nguồn bị loại và lý do", "catalogue", ui.table([
      { label: "Nguồn", render: function (x) { return esc(x.name) + '<div class="la-caption">' + esc(x.option_id) + " · nhóm " + x.group + "</div>"; } },
      { label: "Bộ lọc", render: function (x) { return esc({ hard_filter: "Lọc cứng", timely: "Kịp need_date", coverage: "Phủ tiền ròng", top3: "Ngoài top 3" }[x.rule] || x.rule); } },
      { label: "Lý do", render: function (x) { return esc(f.text(x.reason)); } }
    ], m.rejected, { label: "Nguồn bị loại", empty: "Không có nguồn nào bị loại." }), { id: "rejected" });

    h += '<div class="la-actions la-sticky-actions">' + ui.btn("Thử " + (F.selected.length || "") + " phương án ở Task 4", "primary", 'data-nav="uc04"' + (F.selected.length ? "" : ' disabled aria-disabled="true"')) +
      '<span class="la-muted">' + (F.selected.length ? "Đã chọn: " + F.selected.map(function (p) { return "O-" + p; }).join(", ") : "Chọn ít nhất một ứng viên.") + "</span></div>";
    return h;
  };
})(window);
