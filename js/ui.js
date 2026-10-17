/* Lilact · UI building blocks (string templates; no framework). Mirrors the kit macros in
   ui-kit/templates/components/_macros.html so every task uses the same patterns. */
(function (root) {
  "use strict";
  var L = root.Lilact = root.Lilact || {};
  var f = L.fmt, esc = f.esc;

  var ICONS = {
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    steps: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
    inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    flask: '<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h8"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 5v4h4M4 13a8 8 0 0 0 14.9 3M20 19v-4h-4"/>'
  };
  function icon(name, size) {
    size = size || 16;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || "") + "</svg>";
  }
  /** Cash alert icon: the shape differs per level so colour is never the only signal (kit macro alert_icon). */
  function alertIcon(level, size) {
    size = size || 16;
    var bg = "var(--lc-color-bg-surface)", inner;
    if (level === "yellow") inner = '<circle cx="8" cy="8" r="6.5" fill="currentColor"/><path d="M8 4.6v4.2" stroke="' + bg + '" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.3" r="1" fill="' + bg + '"/>';
    else if (level === "orange") inner = '<path d="M8 1.6l6.9 12.2H1.1z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><path d="M8 6v3.6" stroke="' + bg + '" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="11.6" r=".95" fill="' + bg + '"/>';
    else inner = '<path d="M5.3 1.5h5.4l3.8 3.8v5.4l-3.8 3.8H5.3l-3.8-3.8V5.3z" fill="currentColor"/><path d="M8 4.6v4.2" stroke="' + bg + '" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.3" r="1" fill="' + bg + '"/>';
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 16 16" aria-hidden="true">' + inner + "</svg>";
  }
  var ALERT_LABEL = { yellow: "Cảnh báo vàng", orange: "Cảnh báo cam", red: "Cảnh báo đỏ" };
  /** Engine "green" means no alert: the brand has no green level, so it renders as a neutral text label. */
  function alertBadge(level, text) {
    if (level === "yellow" || level === "orange" || level === "red")
      return '<span class="lc-badge lc-badge--alert-' + level + '">' + alertIcon(level) + esc(text || ALERT_LABEL[level]) + "</span>";
    if (level === "unknown") return '<span class="lc-badge lc-badge--neutral">' + icon("info") + "Chưa xác định</span>";
    return '<span class="la-noalert">Không cảnh báo</span>';
  }
  function badge(kind, text, ic) {
    return '<span class="lc-badge lc-badge--' + kind + '">' + icon(ic || ({ success: "check", error: "x" }[kind] || "info")) + esc(text) + "</span>";
  }
  function chip(text, kind, attrs) { return '<span class="lc-chip' + (kind ? " lc-chip--" + kind : "") + '"' + (attrs || "") + ">" + esc(text) + "</span>"; }
  /** Evidence chip: a button that opens the evidence drawer. */
  function evidence(id, payloadKey) {
    return '<button type="button" class="lc-chip lc-chip--evidence la-ev" data-evidence="' + esc(payloadKey || id) + '">' + esc(id) + "</button>";
  }
  function metric(label, value, unit, source, extra) {
    return '<div class="lc-card lc-metric">' +
      '<div class="lc-metric__label">' + esc(label) + "</div>" +
      '<div><span class="lc-metric__value">' + esc(value) + "</span>" + (unit ? '<span class="lc-metric__unit">' + esc(unit) + "</span>" : "") + "</div>" +
      (source ? '<div class="lc-metric__source">' + source + "</div>" : "") + (extra || "") + "</div>";
  }
  function alertBox(level, title, body) {
    var ic = level === "info" ? icon("info", 20) : alertIcon(level, 20);
    return '<div class="lc-alert lc-alert--' + level + '" role="' + (level === "red" ? "alert" : "status") + '">' + ic +
      '<div><div class="lc-alert__title">' + esc(title) + '</div><div class="lc-alert__body">' + body + "</div></div></div>";
  }
  function note(kind, html) { return '<div class="la-note la-note--' + kind + '">' + icon(kind === "demo" ? "flask" : kind === "stale" ? "clock" : "info") + "<span>" + html + "</span></div>"; }
  /** Provenance label: every block of numbers says where it comes from. */
  var SOURCE = {
    engine: '<span class="la-src la-src--engine" title="Số do engine UC01/UC02 thật tính (snapshot xuất từ feature/uc1-uc2-full@a49d4c9)">Engine</span>',
    rule: '<span class="la-src la-src--rule" title="Quy tắc demo trong trình duyệt, theo tài liệu luồng; chưa phải engine chính thức">Quy tắc demo</span>',
    scenario: '<span class="la-src la-src--scenario" title="Kết quả kịch bản giả định, không phải dự báo cơ sở">Kịch bản</span>',
    observed: '<span class="la-src la-src--observed" title="Dữ liệu nguồn quan sát được trong snapshot">Dữ liệu nguồn</span>',
    assumption: '<span class="la-src la-src--assumption" title="Giả định demo, chưa được chủ doanh nghiệp duyệt">Giả định</span>',
    catalogue: '<span class="la-src la-src--assumption" title="Danh mục giả lập, tên tổ chức hư cấu">Danh mục giả lập</span>'
  };
  function section(title, srcKey, body, opts) {
    opts = opts || {};
    return '<section class="la-section"' + (opts.id ? ' id="' + opts.id + '"' : "") + ' aria-labelledby="' + (opts.id || "") + '-h"><header class="la-section__head"><h2 id="' + (opts.id || "") + '-h">' + esc(title) + "</h2>" + (srcKey ? SOURCE[srcKey] : "") + (opts.actions || "") + "</header>" + body + "</section>";
  }
  /** Responsive table: horizontal scroll with a sticky first column on narrow screens. */
  function table(cols, rows, opts) {
    opts = opts || {};
    var h = '<div class="la-table-wrap" tabindex="0" role="region" aria-label="' + esc(opts.label || "Bảng") + '"><table class="lc-table la-table">' +
      (opts.caption ? '<caption class="lc-visually-hidden">' + esc(opts.caption) + "</caption>" : "") + "<thead><tr>" +
      cols.map(function (c) { return '<th scope="col"' + (c.num ? ' class="num"' : "") + ">" + esc(c.label) + "</th>"; }).join("") + "</tr></thead><tbody>";
    if (!rows.length) h += '<tr><td colspan="' + cols.length + '" class="la-empty-row">' + esc(opts.empty || "Không có dòng nào.") + "</td></tr>";
    rows.forEach(function (r) {
      h += "<tr" + (r._attrs || "") + ">" + cols.map(function (c, i) {
        var v = typeof c.render === "function" ? c.render(r) : esc(r[c.key]);
        return (i === 0 ? '<th scope="row"' : "<td") + (c.num ? ' class="num"' : "") + ">" + v + (i === 0 ? "</th>" : "</td>");
      }).join("") + "</tr>";
    });
    return h + "</tbody></table></div>";
  }
  function locked(title, reason, action) {
    return '<div class="lc-card la-locked" role="status"><div class="lc-empty__icon">' + icon("lock", 28) + "</div><h2>" + esc(title) + "</h2><p>" + reason + "</p>" + (action || "") + "</div>";
  }
  function empty(title, body, action) {
    return '<div class="lc-card lc-empty"><div class="lc-empty__icon">' + icon("inbox", 28) + "</div><h3>" + esc(title) + '</h3><p class="la-muted">' + body + "</p>" + (action || "") + "</div>";
  }
  function btn(label, kind, attrs, ic) {
    attrs = attrs || "";
    return "<button" + (/\btype=/.test(attrs) ? "" : ' type="button"') + ' class="lc-btn lc-btn--' + (kind || "primary") + '" ' + attrs + ">" + (ic ? icon(ic) : "") + esc(label) + "</button>";
  }
  function dl(pairs) { return '<dl class="la-dl">' + pairs.map(function (p) { return "<dt>" + p[0] + "</dt><dd>" + p[1] + "</dd>"; }).join("") + "</dl>"; }

  L.ui = { icon: icon, alertIcon: alertIcon, alertBadge: alertBadge, badge: badge, chip: chip, evidence: evidence, metric: metric, alertBox: alertBox,
    note: note, SOURCE: SOURCE, section: section, table: table, locked: locked, empty: empty, btn: btn, dl: dl, ALERT_LABEL: ALERT_LABEL };
})(typeof window !== "undefined" ? window : globalThis);
