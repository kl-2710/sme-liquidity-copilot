/* Lilact · cash chart (port of the kit's lilact/charts.py cash_forecast_svg to the browser).
   Brand rules: base forecast = solid cash-blue line; comparison (adverse / after) = dashed line;
   Rmin = red dotted, Rtarget = neutral dashed, Rupper = blue dash-dot; the selected episode is a band.
   Colours are CSS variables so the chart follows Light/Dark/System. Values are never rounded here;
   the full daily table stays available next to the chart. */
(function (root) {
  "use strict";
  var L = root.Lilact = root.Lilact || {};
  var f = L.fmt;
  function v(t) { return "var(--lc-color-" + t + ")"; }

  /** series: [{rows, label, kind: "base"|"compare"|"adverse"}]; reserves: {rmin, rtarget, rupper} (null ones are skipped). */
  function cash(series, reserves, opts) {
    opts = opts || {};
    var W = opts.width || 880, H = opts.height || 300, pl = 64, pr = 76, pt = 16, pb = 34;
    var base = series[0].rows, n = base.length;
    var vals = [];
    series.forEach(function (s) { s.rows.forEach(function (r) { vals.push(r.closing_vnd); }); });
    Object.keys(reserves || {}).forEach(function (k) { if (reserves[k] != null) vals.push(reserves[k]); });
    var lo = Math.min.apply(null, vals.concat([0])), hi = Math.max.apply(null, vals);
    var pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    var X = function (i) { return pl + i * (W - pl - pr) / Math.max(n - 1, 1); };
    var Y = function (y) { return pt + (hi - y) * (H - pt - pb) / (hi - lo); };
    var o = ['<svg class="lc-chart la-chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + f.esc(opts.label || "Số dư tiền dự báo theo ngày") + '">'];
    if (opts.episode) {
      var a = base.findIndex(function (r) { return r.date === opts.episode.start_date; }), b = base.findIndex(function (r) { return r.date === opts.episode.end_date; });
      if (a >= 0 && b >= 0) o.push('<rect x="' + (X(a) - 3).toFixed(1) + '" y="' + pt + '" width="' + (X(b) - X(a) + 6).toFixed(1) + '" height="' + (H - pt - pb) + '" fill="' + v("alert-" + (opts.level || "orange") + "-bg") + '"/>');
    }
    for (var k = 0; k <= 4; k++) {
      var y = lo + k * (hi - lo) / 4;
      o.push('<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(y).toFixed(1) + '" y2="' + Y(y).toFixed(1) + '" stroke="' + v("border-default") + '"/>');
      o.push('<text x="' + (pl - 8) + '" y="' + (Y(y) + 4).toFixed(1) + '" text-anchor="end">' + f.vndShort(y).replace(" ₫", "") + "</text>");
    }
    if (lo < 0) o.push('<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '" stroke="' + v("text-muted") + '" stroke-width="1"/>');
    var styles = { rmin: ["alert-red", "2 4", "Rmin"], rtarget: ["text-secondary", "7 4", "Rtarget"], rupper: ["status-info", "9 3 2 3", "Rupper"] };
    Object.keys(styles).forEach(function (key) {
      var val = reserves && reserves[key]; if (val == null) return;
      var s = styles[key];
      o.push('<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(val).toFixed(1) + '" y2="' + Y(val).toFixed(1) + '" stroke="' + v(s[0]) + '" stroke-width="1.4" stroke-dasharray="' + s[1] + '"/>');
      o.push('<text x="' + (W - pr + 6) + '" y="' + (Y(val) + 4).toFixed(1) + '" style="fill:' + v(s[0]) + ';font-weight:600">' + s[2] + "</text>");
    });
    series.slice().reverse().forEach(function (s) {
      var pts = s.rows.map(function (r, i) { return X(i).toFixed(1) + "," + Y(r.closing_vnd).toFixed(1); }).join(" ");
      var stroke = s.kind === "adverse" ? v("data-adverse") : s.kind === "compare" ? v("data-receivables") : v("data-cash");
      var dash = s.kind === "base" ? "" : ' stroke-dasharray="6 4"';
      o.push('<polyline points="' + pts + '" fill="none" stroke="' + stroke + '" stroke-width="' + (s.kind === "base" ? 2.4 : 2) + '"' + dash + ' stroke-linejoin="round"/>');
    });
    var step = n > 60 ? 7 : 1;
    base.forEach(function (r, i) {
      if (i % step === 0) o.push('<text x="' + X(i).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + f.dateShort(r.date) + "</text>");
      var w = (W - pl - pr) / Math.max(n - 1, 1);
      o.push('<rect class="la-chart__hit" x="' + (X(i) - w / 2).toFixed(1) + '" y="' + pt + '" width="' + w.toFixed(1) + '" height="' + (H - pt - pb) + '"><title>' +
        f.date(r.date) + ": " + series.map(function (s) { return s.label + " " + f.vnd(s.rows[i] && s.rows[i].closing_vnd); }).join(" · ") + "</title></rect>");
    });
    o.push("</svg>");
    var legend = '<ul class="la-legend" aria-label="Chú giải">' + series.map(function (s) {
      return '<li><i class="la-legend__sw la-legend__sw--' + s.kind + '"></i>' + f.esc(s.label) + "</li>";
    }).join("") + Object.keys(styles).filter(function (k) { return reserves && reserves[k] != null; }).map(function (k) {
      return '<li><i class="la-legend__sw la-legend__sw--' + k + '"></i>' + styles[k][2] + " " + f.vndShort(reserves[k]) + "</li>";
    }).join("") + (opts.episode ? '<li><i class="la-legend__sw la-legend__sw--band"></i>Đợt đang xem</li>' : "") + "</ul>";
    return '<figure class="la-figure">' + o.join("") + legend + "</figure>";
  }

  L.chart = { cash: cash };
})(typeof window !== "undefined" ? window : globalThis);
