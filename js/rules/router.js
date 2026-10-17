/* Lilact · 3 × 3 routing matrix (fixed rules; the LLM never chooses a cell).
   Source of truth: "Ma trận 9 trường hợp.png" and the matrix section of "Luồng riêng 4 tác vụ.html" /
   "Workflow tổng thể.html". Labels and texts below are transcribed verbatim from those documents.
   Rows = W from Task 1 (W0/W1/W2), columns = TH from Task 2 (TH01/TH02/TH03).
   If either axis is unknown, no cell is assigned ("một trục unknown → không gán ô, vẫn hiện phần đã tính được"). */
(function (root) {
  "use strict";
  var L = root.Lilact = root.Lilact || {};
  L.rules = L.rules || {};

  var ROWS = {
    W0: "Chưa thấy dấu hiệu",
    W1: "Cần theo dõi",
    W2: "Điểm nghẽn trọng yếu"
  };
  var COLS = {
    TH01: { label: "Thiếu tiền", short: "Thiếu", task3: "tìm nguồn bù", branch: "cover" },
    TH02: { label: "Cân bằng", short: "Cân bằng", task3: "giữ thanh khoản", branch: "hold" },
    TH03: { label: "Dư tiền", short: "Dư", task3: "dùng tiền có kỷ luật", branch: "surplus" }
  };

  var CELLS = {
    M1: { w: "W0", th: "TH01", title: "Thiếu do lệch lịch", question: "thu đúng hạn về sau lương, thuế?",
      see: "Chưa thấy điểm nghẽn, nhưng có ngày tiền dưới Rtarget.",
      task2: "Chỉ ra khoản chi (lương, thuế, gốc vay) và khoản thu đúng hạn về sau, bằng ngày và số tiền.",
      task3: "Dự trữ trên Rmin, nguồn sẵn có, cầu nối kịp ngày.",
      task4: "So giữ nguyên, nguồn nội bộ kịp ngày, tài trợ ngắn nếu thật cần.",
      forbid: "Gán lỗi cho khách khi hóa đơn chưa đến hạn." },
    M2: { w: "W0", th: "TH02", title: "Cân bằng, chưa thấy nghẽn", question: "stress còn đủ? giữ nguyên hợp lệ",
      see: "Đủ dữ liệu, không có tín hiệu; base giữ được mục tiêu.",
      task2: "Chạy stress bắt buộc trước khi nói \"đủ\"; tìm biến số nhạy nhất.",
      task3: "Không có mục tiêu mới thì giữ nguyên là kết quả hợp lệ; có đơn hàng mới thì xét vốn tăng thêm.",
      task4: "Thêm lịch mua, lương, thu, thuế của đơn mới; stress thiếu thì mở dự phòng.",
      forbid: "Tạo nhu cầu vay hoặc đầu tư chỉ để có phương án." },
    M3: { w: "W0", th: "TH03", title: "Dư, chưa thấy nghẽn", question: "dư từ đâu, dùng an toàn bao nhiêu?",
      see: "Tiền trên Rupper đủ lâu, chưa có tín hiệu vốn lưu động.",
      task2: "Xác minh dư đến từ hoạt động, vay, khách ứng trước hay nguồn một lần.",
      task3: "Giữ dự trữ và nghĩa vụ trong stress trước; rồi so giữ tiền, trả nợ, chiết khấu, công cụ ngắn hạn.",
      task4: "Kiểm SafeCash đến ngày thu hồi, cả base và stress.",
      forbid: "Coi toàn bộ số dư là tiền nhàn rỗi." },
    M4: { w: "W1", th: "TH01", title: "Thiếu, có dấu hiệu cần kiểm", question: "dấu hiệu có thật gây thiếu không?",
      see: "Một tín hiệu chưa trọng yếu, và base có thiếu.",
      task2: "Nối finding với sự kiện tiền; phép thử thu đúng lịch làm gap giảm bao nhiêu.",
      task3: "Ưu tiên ứng viên gắn đúng nguồn gây thiếu và kịp ngày.",
      task4: "So can thiệp nhẹ với cầu nối ngắn hạn.",
      forbid: "Kết luận doanh nghiệp yếu từ một dấu hiệu; lấy giá sổ làm tiền bán tồn." },
    M5: { w: "W1", th: "TH02", title: "Cân bằng, có dấu hiệu", question: "dấu hiệu kéo dài thì còn đủ?",
      see: "Base còn đủ nhưng có tín hiệu cần theo dõi.",
      task2: "Stress đúng khách, lô, nghĩa vụ đó; tìm mức chậm khiến tiền xuống dưới dự trữ.",
      task3: "Chỉ mở nguồn dự phòng khi stress cho thấy cần.",
      task4: "Kiểm trước khi nhận đơn mới hoặc đổi chính sách tín dụng cho đơn sau.",
      forbid: "Thay kế hoạch thu nợ bằng gợi ý chung của Task 1." },
    M6: { w: "W1", th: "TH03", title: "Dư, có dấu hiệu", question: "dư do thu tốt hay giảm hoạt động?",
      see: "Dư kéo dài, kèm tín hiệu cần theo dõi.",
      task2: "Dư do thu tốt hay do giảm mua, giảm đơn; không tự chọn một lý do.",
      task3: "Giới hạn phân bổ theo stress và lịch cần tiền; có thể ưu tiên giữ tiền.",
      task4: "Thử khách chậm hơn, đơn hàng quay lại làm chi tăng.",
      forbid: "Cảnh báo hiệu quả dùng tiền khi chưa tính thời gian dư và chi phí." },
    M7: { w: "W2", th: "TH01", title: "Thiếu và nghẽn trọng yếu", question: "nghẽn nào tác động lớn nhất?",
      see: "Tín hiệu vượt ngưỡng vận hành và trọng yếu, base có thiếu.",
      task2: "Đo tác động của điểm nghẽn lên lịch tiền trước khi chọn giải pháp.",
      task3: "Tìm song song nguồn sẵn có kịp ngày, biện pháp thương mại, tài trợ ngoài đủ điều kiện; nghĩa vụ bắt buộc trước.",
      task4: "Phối hợp nhiều nguồn, đối tác từ chối, lịch trả nợ sau đó.",
      forbid: "Gắn nhãn \"đã giải quyết\" khi còn phần chưa bù." },
    M8: { w: "W2", th: "TH02", title: "Đủ tiền, vốn bị giữ lớn", question: "nguồn nào đang che áp lực?",
      see: "Điểm nghẽn lớn nhưng base chưa thiếu, không dư kéo dài.",
      task2: "Cầu tiền chứng minh nguồn nào đang che áp lực (tiền đầu kỳ, khoản thu khác).",
      task3: "Không ép vay; có thể chuẩn bị nguồn dự phòng.",
      task4: "Stress chậm kéo dài, mất cam kết thu, nợ đáo hạn; xử lý nghẽn có làm tiền bền hơn không.",
      forbid: "Suy tiết kiệm lãi trực tiếp từ việc CCC giảm." },
    M9: { w: "W2", th: "TH03", title: "Dư và nghẽn trọng yếu", question: "vì sao vừa dư vừa nghẽn?",
      see: "Tiền đang dư, trong khi công nợ hoặc tồn kho vẫn nghẽn lớn.",
      task2: "Dư do vay mới, khách ứng trước hay nguồn khác bù cho tiền kẹt ở khách, tồn.",
      task3: "Kiểm mục đích vay, nghĩa vụ đơn hàng, stress điểm nghẽn trước mọi phân bổ.",
      task4: "Thử tình huống không thu được khoản đang nghẽn.",
      forbid: "Lấy dư tiền để gỡ nhãn điểm nghẽn; SafeCash = 0 vẫn có thể là kết quả đúng." }
  };

  var GRID = { W0: ["M1", "M2", "M3"], W1: ["M4", "M5", "M6"], W2: ["M7", "M8", "M9"] };
  var COL_ORDER = ["TH01", "TH02", "TH03"];

  /** Fixed rule: (W, TH) → cell id, or a structured reason why no cell is assigned. */
  function route(w, th) {
    var missing = [];
    if (!GRID[w]) missing.push("W");
    if (COL_ORDER.indexOf(th) < 0) missing.push("TH");
    if (missing.length) return { cell: null, missing: missing };
    var id = GRID[w][COL_ORDER.indexOf(th)];
    return { cell: id, missing: [], branch: COLS[th].branch, def: CELLS[id] };
  }

  L.rules.router = { ROWS: ROWS, COLS: COLS, CELLS: CELLS, GRID: GRID, COL_ORDER: COL_ORDER, route: route };
  if (typeof module !== "undefined") module.exports = L.rules.router;
})(typeof window !== "undefined" ? window : globalThis);
