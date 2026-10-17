/* Lilact · UC00 structural check for an uploaded sales-invoice CSV (runs in the browser).
   It only VALIDATES: nothing is saved, nothing is fed to the engines, no row is dropped and no uncertain value
   is converted silently. Every finding names the row, the field and how the value was read. */
(function (root) {
  "use strict";
  var L = root.Lilact = root.Lilact || {};
  L.rules = L.rules || {};

  var REQUIRED = ["invoice_id", "firm_id", "buyer", "amount_vnd", "issue_date", "due_date"];
  var OPTIONAL = ["paid_date"];

  /** Minimal RFC-4180 CSV parser (quotes, escaped quotes, commas/semicolons inside quotes). */
  function parseCsv(text) {
    var delim = (text.split(/\r?\n/)[0].match(/;/g) || []).length > (text.split(/\r?\n/)[0].match(/,/g) || []).length ? ";" : ",";
    var rows = [], row = [], cell = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return { delimiter: delim, rows: rows.filter(function (r) { return r.some(function (x) { return x.trim() !== ""; }); }) };
  }

  function isIsoDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(s + "T00:00:00Z"); return !isNaN(d) && d.toISOString().slice(0, 10) === s;
  }

  function check(text, opts) {
    opts = opts || {};
    var p = parseCsv(text.replace(/^﻿/, ""));
    var issues = [], header = (p.rows[0] || []).map(function (h) { return h.trim(); });
    function add(row, field, code, severity, message) { issues.push({ row: row, field: field, code: code, severity: severity, message: message }); }
    var missingCols = REQUIRED.filter(function (c) { return header.indexOf(c) < 0; });
    missingCols.forEach(function (c) { add(1, c, "MISSING_COLUMN", "error", "Thiếu cột bắt buộc \"" + c + "\"."); });
    var unknown = header.filter(function (h) { return REQUIRED.indexOf(h) < 0 && OPTIONAL.indexOf(h) < 0; });
    if (unknown.length) add(1, unknown.join(", "), "UNMAPPED_COLUMN", "info", "Cột chưa ánh xạ, được giữ nguyên và không dùng: " + unknown.join(", ") + ".");
    var seen = {}, data = p.rows.slice(1), records = [];
    data.forEach(function (r, k) {
      var line = k + 2, rec = {};
      header.forEach(function (h, i) { rec[h] = (r[i] == null ? "" : r[i]).trim(); });
      records.push(rec);
      if (r.length !== header.length) add(line, "*", "COLUMN_COUNT", "warning", "Dòng có " + r.length + " ô, tiêu đề có " + header.length + " cột.");
      REQUIRED.forEach(function (c) { if (header.indexOf(c) >= 0 && !rec[c]) add(line, c, "MISSING_VALUE", "error", "Thiếu giá trị " + c + "; không tự điền 0."); });
      if (rec.invoice_id) { if (seen[rec.invoice_id]) add(line, "invoice_id", "DUPLICATE", "error", "Trùng mã " + rec.invoice_id + " với dòng " + seen[rec.invoice_id] + "."); else seen[rec.invoice_id] = line; }
      if (rec.amount_vnd) {
        if (!/^-?\d+$/.test(rec.amount_vnd)) add(line, "amount_vnd", "AMBIGUOUS_NUMBER", "error", "\"" + rec.amount_vnd + "\" không phải số nguyên VND; không tự đổi dấu chấm/phẩy vì có thể là phân cách nghìn hoặc thập phân.");
        else if (Number(rec.amount_vnd) <= 0) add(line, "amount_vnd", "NON_POSITIVE", "error", "Số tiền phải dương; giá trị đọc được là " + rec.amount_vnd + ".");
      }
      ["issue_date", "due_date", "paid_date"].forEach(function (c) { if (rec[c] && !isIsoDate(rec[c])) add(line, c, "INVALID_DATE", "error", "\"" + rec[c] + "\" không phải ngày YYYY-MM-DD hợp lệ; không tự đoán ngày/tháng."); });
      if (isIsoDate(rec.issue_date) && isIsoDate(rec.due_date) && rec.due_date < rec.issue_date) add(line, "due_date", "DUE_BEFORE_ISSUE", "error", "Hạn thanh toán trước ngày phát hành.");
      if (opts.as_of && isIsoDate(rec.issue_date) && rec.issue_date > opts.as_of) add(line, "issue_date", "AFTER_CUTOFF", "warning", "Ngày phát hành sau ngày chốt " + opts.as_of + ": lệch kỳ, không được tính vào số dư tại ngày chốt.");
      if (opts.firm_id && rec.firm_id && rec.firm_id !== opts.firm_id) add(line, "firm_id", "OTHER_FIRM", "error", "firm_id " + rec.firm_id + " khác doanh nghiệp của phiên (" + opts.firm_id + ").");
    });
    var errorRows = {};
    issues.forEach(function (i) { if (i.severity === "error" && i.row > 1) errorRows[i.row] = 1; });
    return { delimiter: p.delimiter, header: header, record_count: records.length, records: records, issues: issues,
      blocked: missingCols.length > 0 || Object.keys(errorRows).length > 0, rows_with_errors: Object.keys(errorRows).length };
  }

  L.rules.intake = { REQUIRED: REQUIRED, parseCsv: parseCsv, check: check };
  if (typeof module !== "undefined") module.exports = L.rules.intake;
})(typeof window !== "undefined" ? window : globalThis);
