/* Nhật ký · bundles (current vs stale), drafts and the audit trail of this browser session. */
(function (root) {
  "use strict";
  var L = root.Lilact, f = L.fmt, ui = L.ui, esc = f.esc;
  L.views = L.views || {};
  L.views.log = function (ctx) {
    var F = ctx.fs, st = L.store.state();
    var h = '<div class="la-page-intro"><p>Mọi kết quả gắn với một <code>analysis_bundle_id</code>. Đổi ngưỡng hoặc duyệt một phương án tạo bundle mới; bundle cũ được giữ để đối chiếu nhưng đánh dấu đã cũ.</p></div>';
    h += ui.section("Bundle phân tích", null, ui.table([
      { label: "Bundle", render: function (b) { return "<code>" + esc(b.id) + "</code>"; } },
      { label: "Trạng thái", render: function (b) { return b.status === "current" ? ui.badge("success", "Hiện hành") : ui.badge("warning", "Đã cũ", "clock"); } },
      { label: "Nguồn gốc", render: function (b) { return esc(b.origin_label) + (b.parent_id ? ' <span class="la-caption">từ ' + esc(b.parent_id) + "</span>" : ""); } },
      { label: "Snapshot · chính sách", render: function (b) { return "<code>" + esc(b.snapshot_id) + "</code> · " + esc(b.policy_version); } },
      { label: "Phương án đã áp", render: function (b) { return b.change_sets.length ? b.change_sets.map(function (c) { return esc(c.draft_id + " (" + c.scenario_run_id + ")"); }).join(", ") : "—"; } },
      { label: "Kiểm tra chạy lại", render: function (b) { return b.rerun_check ? (b.rerun_check.ok ? ui.badge("success", "Không thiếu mới") : ui.badge("warning", "Có thiếu mới / đợt xấu đi")) : "—"; } },
      { label: "Lý do cũ", render: function (b) { return esc(b.stale_reason || ""); } }
    ], F.bundles.slice().reverse(), { label: "Bundle", empty: "Chưa có bundle: hãy xác nhận dữ liệu ở UC00." }), { id: "bundles" });
    h += ui.section("Kịch bản đã chạy", "scenario", ui.table([
      { label: "Mã", render: function (s) { return "<code>" + esc(s.scenario_run_id) + "</code>"; } }, { label: "Bundle", key: "bundle_id" },
      { label: "Phương án", render: function (s) { return esc(s.option_ids.join(" + ")); } }, { label: "Verdict", key: "verdict" }, { label: "Lúc", render: function (s) { return f.datetime(s.created_at); } }
    ], F.scenarios.slice().reverse(), { label: "Kịch bản", empty: "Chưa chạy kịch bản nào." }), { id: "scen" });
    h += ui.section("Nhật ký thao tác", null, ui.table([
      { label: "Thời điểm", render: function (a) { return f.datetime(a.ts); } }, { label: "DN", key: "firm" }, { label: "Sự kiện", render: function (a) { return "<code>" + esc(a.event) + "</code>"; } }, { label: "Chi tiết", key: "detail" }
    ], st.audit.filter(function (a) { return a.firm === st.firm; }), { label: "Nhật ký", empty: "Chưa có thao tác." }) +
      '<p class="la-caption">Nhật ký chỉ nằm trong trình duyệt này (localStorage), dùng cho demo; hệ thống thật ghi vào logs/audit.jsonl ở backend.</p>' +
      '<div class="la-actions">' + ui.btn("Xóa trạng thái demo của " + st.firm, "secondary", 'data-action="reset"') + "</div>", { id: "audit" });
    return h;
  };
})(window);
