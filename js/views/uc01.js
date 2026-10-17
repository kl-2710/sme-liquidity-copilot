/* UC01 / Task 1 · Chẩn đoán vốn lưu động. All numbers come from the UC01 engine result (tv1.result.v1);
   only the W classification is a labelled demo rule. A diagnostic is never shown as guaranteed cash. */
(function (root) {
  "use strict";
  var L = root.Lilact, f = L.fmt, ui = L.ui, esc = f.esc;
  L.views = L.views || {};

  function metricCard(m, label, extra) {
    if (!m) return ui.metric(label, "—", "", "Không có trong kết quả");
    var val = m.raw_value == null ? "—" : m.unit === "day" ? f.days(m.raw_value) : m.unit === "ratio" ? f.pct(m.raw_value) : f.vndShort(m.raw_value);
    return ui.metric(label, val, m.unit === "day" ? "ngày" : "", ui.evidence(m.formula_id, "metric:" + m.id) + " " + (m.status === "provisional" ? '<span class="la-muted">tạm tính</span>' : esc(m.status)), extra);
  }

  L.views.uc01 = function (ctx) {
    var res = ctx.res, u = res.uc01, M = L.rules.classify.metricMap(u), meta = u.meta, W = res.W;
    var twc = Number(u.money.trade_working_capital_vnd);
    var h = '<div class="la-page-intro"><p>Tiền đang bị giữ ở đâu, do ai, đã đáng lo chưa. Kỳ ' + f.date(meta.period_start) + "–" + f.date(meta.period_end) +
      " (N = " + meta.period_days + " ngày, số dư cuối kỳ); hành vi thanh toán đo trên cửa sổ " + f.date(meta.lookback_start) + "–" + f.date(meta.lookback_end) + " (180 ngày).</p></div>";
    h += ui.note("info", "Kết quả UC01 ở trạng thái <b>" + esc(u.status) + "</b> vì dữ liệu mẫu dùng giả định (ví dụ toàn bộ doanh thu là bán chịu). Run <code>" + esc(meta.run_id) + "</code> · " + esc(meta.formula_version) + ".");

    h += ui.section("Chỉ số chu kỳ tiền", "engine", '<div class="lc-metrics">' +
      metricCard(M.dso_days, "DSO · ngày thu tiền") + metricCard(M.dio_days, "DIO · ngày tồn kho") + metricCard(M.dpo_days, "DPO · ngày trả NCC (trên COGS)") + metricCard(M.ccc_days, "CCC = DSO + DIO − DPO") +
      "</div>" + '<p class="la-muted">1 ngày DSO ≈ ' + f.vnd(u.money.cash_per_1_day_dso_vnd) + "; 1 ngày DIO hoặc DPO ≈ " + f.vnd(u.money.cash_per_1_day_dio_vnd) +
      ". Đây là vốn tương đương ước tính, <b>không</b> phải tiền chắc chắn thu về khi chỉ số giảm.</p>", { id: "ccc" });

    var pockets = [["Phải thu (AR)", Number(M.ar_vnd.raw_value), "receivables", M.ar_vnd], ["Tồn kho sở hữu (INV)", Number(M.inv_vnd.raw_value), "inventory", M.inv_vnd], ["Phải trả (AP)", -Number(M.ap_vnd.raw_value), "payables", M.ap_vnd]];
    var maxAbs = Math.max.apply(null, pockets.map(function (p) { return Math.abs(p[1]); }));
    h += ui.section("Ba túi vốn · TWC = AR + INV − AP = " + f.vnd(twc), "engine", '<div class="la-pockets" role="list">' + pockets.map(function (p) {
      return '<div class="la-pocket" role="listitem"><div class="la-pocket__label">' + esc(p[0]) + " " + ui.evidence(p[3].formula_id, "metric:" + p[3].id) + '</div><div class="la-bar"><span class="la-bar__fill la-bar__fill--' + p[2] + '" style="width:' + (Math.abs(p[1]) / maxAbs * 100).toFixed(1) + '%"></span></div>' +
        '<div class="la-pocket__val lc-num">' + f.vnd(p[1]) + ' <span class="la-muted">· ' + f.pct(p[1] / twc) + " TWC</span></div></div>";
    }).join("") + "</div>" + '<p class="la-muted">Đã loại ' + f.vnd(u.inputs.excluded_inventory_vnd) + " hàng nhận gia công khỏi tồn kho (không phải vốn của doanh nghiệp). " +
      "Điểm nghẽn lớn nhất theo đóng góp vào CCC: <b>" + esc(u.analysis.ccc_decomposition.largest_positive_component) + "</b>.</p>", { id: "pockets" });

    var wBadge = W.w === "unknown" ? ui.badge("neutral", "W chưa xác định") : ui.chip(W.w + " · " + L.rules.router.ROWS[W.w], "brand");
    h += ui.section("Phân lớp vốn lưu động (trục dọc ma trận)", "rule",
      '<div class="la-headline">' + wBadge + '<span class="la-muted">' + esc(W.reason) + " · quy tắc <code>" + esc(W.rule_id) + "</code> · " + esc(res.bundle.policy_version) + "</span></div>" +
      ui.table([
        { label: "Tín hiệu (rule UC01)", render: function (s) { return "<code>" + esc(s.insight_id) + "</code>"; } },
        { label: "Quan sát", render: function (s) { return esc(f.text(s.observation)); } },
        { label: "Số tiền liên quan", num: true, render: function (s) { return s.money_at_risk_vnd == null ? '<span class="la-muted">không có (chỉ là tín hiệu)</span>' : f.vnd(s.money_at_risk_vnd); } },
        { label: "% TWC", num: true, render: function (s) { return s.share_of_twc == null ? "—" : f.pct(s.share_of_twc); } },
        { label: "Trọng yếu?", render: function (s) { return s.material == null ? "—" : s.material ? "Có" : "Chưa"; } }
      ], W.signals, { label: "Tín hiệu UC01", empty: "Không có tín hiệu nào." }) +
      '<p class="la-muted">Ngưỡng trọng yếu: ' + (res.policy.w_material_vnd == null ? "chưa đặt" : f.vnd(res.policy.w_material_vnd) + " và " + f.pct(res.policy.w_material_pct_twc)) +
      " TWC. Phân lớp này là định tuyến nghiệp vụ, không phải xếp hạng tín dụng hay kết luận doanh nghiệp yếu.</p>", { id: "w" });

    h += ui.section("Phát hiện và lý do", "engine", '<div class="la-cards">' + u.insights.map(function (i) {
      return '<article class="lc-card la-insight"><header><code>' + esc(i.insight_id) + "</code> " + i.formula_ids.map(function (id) { return ui.chip(id); }).join(" ") + "</header>" +
        "<p><b>" + esc(f.text(i.observation)) + "</b></p><p>" + esc(i.interpretation) + '</p><p class="la-muted">' + esc(i.business_implication) + "</p>" +
        '<p class="la-ev-row">' + i.evidence_refs.map(function (e) { return ui.evidence(e.split(":").pop(), "uc01ev:" + e); }).join(" ") + "</p>" +
        (i.limitations && i.limitations.length ? '<p class="la-caption">Giới hạn: ' + esc(i.limitations.join(" ")) + "</p>" : "") + "</article>";
    }).join("") + "</div>", { id: "insights" });

    var d = u.drivers;
    h += ui.section("Kẹt do ai", "engine",
      '<div class="la-tabs" role="tablist" aria-label="Nhóm đối tượng">' + [["buyers", "Khách hàng"], ["products", "Tồn kho"], ["suppliers", "Nhà cung cấp"], ["excluded", "Hàng bị loại"]].map(function (t, i) {
        return '<button role="tab" type="button" id="tab-' + t[0] + '" aria-controls="panel-' + t[0] + '" aria-selected="' + (ctx.tab01 === t[0] || (!ctx.tab01 && i === 0)) + '" data-action="tab01" data-tab="' + t[0] + '">' + t[1] + "</button>";
      }).join("") + "</div>" +
      panel("buyers", ctx, ui.table([
        { label: "Khách hàng", render: function (b) { return esc(b.buyer_name) + (b.behaviour_late ? " " + ui.chip("trả trễ", "brand") : ""); } },
        { label: "AR", num: true, render: function (b) { return f.vnd(b.ar_vnd); } }, { label: "% AR", num: true, render: function (b) { return f.pct(b.share_of_ar); } },
        { label: "Đóng góp DSO (ngày)", num: true, render: function (b) { return f.days(b.dso_days); } },
        { label: "Quá hạn", num: true, render: function (b) { return f.vnd(b.overdue_ar_vnd); } },
        { label: "Trễ dương bq (ngày)", num: true, render: function (b) { return b.late_positive_wavg_days == null ? "—" : f.days(b.late_positive_wavg_days); } },
        { label: "Mẫu lịch sử", num: true, render: function (b) { return b.history_invoice_count + " HĐ"; } }
      ], d.buyers, { label: "Khách hàng" }) + '<p class="la-caption">Phơi nhiễm (số dư lớn) khác ưu tiên xử lý; hóa đơn chưa đến hạn không phải lỗi của khách.</p>') +
      panel("products", ctx, ui.table([
        { label: "Dòng hàng", key: "product_name" }, { label: "Loại", key: "category" }, { label: "Giá trị", num: true, render: function (p) { return f.vnd(p.inv_vnd); } },
        { label: "% INV", num: true, render: function (p) { return f.pct(p.share_of_inv); } }, { label: "Tuổi tồn tối đa", num: true, render: function (p) { return p.max_days_in_stock + " / ngưỡng " + p.slow_threshold_days; } },
        { label: "Chậm luân chuyển", num: true, render: function (p) { return p.slow_flag ? f.vnd(p.slow_moving_value_vnd) : "—"; } },
        { label: "Định giá", render: function (p) { return esc(p.valuation_status === "cost_only_nrv_missing" ? "giá gốc, thiếu NRV" : p.valuation_status); } }
      ], d.products, { label: "Tồn kho" }) + '<p class="la-caption">Giá trị là giá gốc; chưa có giá trị thuần có thể thực hiện (NRV). Ghi giảm giá trị tồn kho không tạo ra tiền; chỉ bán được hàng mới có tiền.</p>') +
      panel("suppliers", ctx, ui.table([
        { label: "Nhà cung cấp", key: "supplier_name" }, { label: "AP", num: true, render: function (s) { return f.vnd(s.ap_vnd); } },
        { label: "Quá hạn", num: true, render: function (s) { return f.vnd(s.overdue_ap_vnd); } }, { label: "Đến hạn 7 ngày", num: true, render: function (s) { return f.vnd(s.due_7d_vnd); } },
        { label: "Trễ bq (ngày)", num: true, render: function (s) { return f.days(s.payment_late_wavg_days); } },
        { label: "Chiết khấu trả sớm", num: true, render: function (s) { return s.early_payment_saving_vnd ? f.vnd(s.early_payment_saving_vnd) : "—"; } }
      ], d.suppliers, { label: "Nhà cung cấp" }) + '<p class="la-caption">DPO cao do quá hạn không phải là tận dụng tín dụng tốt. AP đến hạn tính trên cơ sở chưa VAT.</p>') +
      panel("excluded", ctx, ui.table([{ label: "Dòng hàng", key: "product_line" }, { label: "Giá trị loại", num: true, render: function (x) { return f.vnd(x.excluded_value_vnd); } }, { label: "Lý do", key: "exclusion_reason" }],
        d.inventory_exclusions, { label: "Hàng bị loại" })), { id: "drivers" });

    h += ui.section("Việc nên kiểm (chưa phải hành động)", "engine", '<ul class="lc-lilacts">' + u.actions.map(function (a) {
      return "<li><span><b>" + esc(a.proposed_step) + '</b><br><span class="la-muted">' + esc(a.rationale) + " · " + esc(a.owner_role) + " · cần trước: " + esc((a.prerequisites || []).join("; ")) + "</span></span></li>";
    }).join("") + "</ul>", { id: "actions" });

    h += ui.section("So với tham chiếu", "engine", ui.table([
      { label: "Chỉ số", render: function (b) { return esc(b.metric_id); } }, { label: "Giá trị", num: true, render: function (b) { return f.days(b.value); } },
      { label: "Khoảng tham chiếu", num: true, render: function (b) { return b.range ? f.days(b.range[0]) + "–" + f.days(b.range[1]) : "—"; } },
      { label: "So sánh được?", render: function (b) { return b.comparability === "descriptive_only" ? "Chỉ mô tả" : esc(b.comparability); } }, { label: "Lý do", key: "reason" }
    ], u.benchmark, { label: "Tham chiếu" }) + '<p class="la-caption">Tham chiếu lấy từ workbook, chưa xác minh độc lập và khác phương pháp; không dùng để kết luận tốt hay xấu.</p>', { id: "bench" });

    var rc = u.reconciliation;
    h += ui.section("Truy vết", "engine", ui.dl([
      ["Đối soát", ["matches_ar", "matches_inv", "matches_ap", "matches_ccc"].map(function (k) { return rc[k] ? ui.badge("success", k.replace("matches_", "").toUpperCase()) : ui.badge("error", k); }).join(" ")],
      ["Công thức", u.explanation_detail.formula_ids.map(function (x) { return "<code>" + x + "</code>"; }).join(" ")],
      ["Giả định", esc(u.explanation_detail.assumptions.join(" "))],
      ["Chưa tính được", u.unsupported_metrics.map(function (x) { return '<span title="' + esc(x.reason) + '"><code>' + esc(x.formula_id) + "</code></span>"; }).join(" ")]
    ]), { id: "trace" });
    return h;
  };

  function panel(id, ctx, html) {
    var active = (ctx.tab01 || "buyers") === id;
    return '<div role="tabpanel" id="panel-' + id + '" aria-labelledby="tab-' + id + '"' + (active ? "" : " hidden") + ">" + html + "</div>";
  }
})(window);
