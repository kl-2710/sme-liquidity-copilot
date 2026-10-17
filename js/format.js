/* Lilact · Vietnamese formatting. Money is shown in VND with "." thousands; dates as dd/mm/yyyy.
   Formatting never rounds the stored value; it only changes how it is shown. */
(function (root) {
  "use strict";
  var L = root.Lilact = root.Lilact || {};

  function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
  function vnd(v) {
    if (v == null || v === "" || isNaN(Number(v))) return "—";
    var n = Math.round(Number(v)), s = n < 0 ? "−" : "";
    return s + group(Math.abs(n)) + " ₫";
  }
  /** Compact: 1,37 tỷ ₫ · 850 tr ₫. Used for headline cards; tables keep the full value. */
  function vndShort(v) {
    if (v == null || isNaN(Number(v))) return "—";
    var n = Number(v), a = Math.abs(n), s = n < 0 ? "−" : "";
    if (a >= 1e9) return s + (a / 1e9).toFixed(2).replace(".", ",").replace(/,?0+$/, "") + " tỷ ₫";
    if (a >= 1e6) return s + group(Math.round(a / 1e6)) + " tr ₫";
    return s + group(Math.round(a)) + " ₫";
  }
  function days(v, digits) { return v == null || isNaN(Number(v)) ? "—" : Number(v).toFixed(digits == null ? 1 : digits).replace(".", ","); }
  function pct(v, digits) { return v == null || isNaN(Number(v)) ? "—" : (Number(v) * 100).toFixed(digits == null ? 1 : digits).replace(".", ",") + "%"; }
  function date(s) { if (!s) return "—"; var p = String(s).slice(0, 10).split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : String(s); }
  function dateShort(s) { var p = String(s).split("-"); return p[2] + "/" + p[1]; }
  function datetime(iso) { if (!iso) return "—"; var d = new Date(iso); return date(d.toISOString()) + " " + d.toISOString().slice(11, 16) + " UTC"; }
  /** Replace ISO dates and long integers inside rule texts so engine/rule messages read naturally. */
  function text(s) {
    return String(s).replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, function (_, y, m, d) { return d + "/" + m + "/" + y; })
      .replace(/\b\d{7,}\b/g, function (n) { return vnd(n); });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; });
  }

  L.fmt = { vnd: vnd, vndShort: vndShort, days: days, pct: pct, date: date, dateShort: dateShort, datetime: datetime, text: text, esc: esc, group: group };
  if (typeof module !== "undefined") module.exports = L.fmt;
})(typeof window !== "undefined" ? window : globalThis);
