# Ghi chú cập nhật UC-01

## Cập nhật mới nhất: agent tiếng Anh thuần
- Thêm `src/router.py`: từ điển ý định tiếng Anh (6 nhóm), khớp cụm từ dài nhất trước, chịu lỗi chính tả nhẹ, từ chối tiếng Việt, chặn chủ đề ngoài phạm vi, ép `firm_id` từ `AuthContext`.
- Viết lại `src/agent.py`: system prompt tiếng Anh, báo cáo 3 đoạn (Executive Summary & Receivables / Inventory & Payables / Benchmarking & Disclaimers), câu "one day of DSO..." và câu "not a credit decision" do hệ thống gắn cố định, kiểm tra bản nháp LLM, ánh xạ tên người nhận tiếng Anh sang tên trong dữ liệu.
- Bổ sung `max_days_past_due` cho nhà cung cấp, cửa sổ đến hạn AP (net), đối soát tổng nhóm tuổi nợ, ghi nhãn `config_version`/`mode`.
- Vá `draft_action`: lý do chặn bằng tiếng Anh, bắt cả "VND 871,565,000" và "871,565,000 VND".
- Chuyển test vào thư mục `test/`; thêm `conftest.py`, `pytest` vào `requirements.txt`; test agent chạy bằng câu hỏi tiếng Anh.
- **Đã bỏ:** `src/narrative.py`, `test/test_narrative.py` (bản diễn giải tiếng Việt, không còn dùng), `src/agent_backup.py` (bản sao lưu cũ).

## Cập nhật ban đầu
## Đã thay đổi
- Bổ sung `src/data_loader.py`: đọc các sheet `D_firms`, `D_financials`, `D_sales`, `D_purchases`, `D_inventory` từ workbook; kiểm tra mã doanh nghiệp, kỳ dữ liệu, hóa đơn trùng và thanh toán/credit vượt giá trị hóa đơn.
- Bổ sung `src/working_capital.py`: tính chỉ tiêu UC-01 bằng Python thuần, trả `raw_value`, `display_value`, Formula ID, evidence, reconciliation, cảnh báo và các chỉ tiêu chưa đủ dữ liệu.
- Bổ sung schema kết quả có phiên bản ở `src/schemas.py`; tích hợp vào `src/tools.py` và giữ nguyên luồng Agent / phân quyền / audit log.
- Thêm `test_uc01.py` để đối chiếu giá trị tham chiếu workbook và kiểm thử các biên: ngày đến hạn, thanh toán sau ngày chốt, hóa đơn trùng, thanh toán một phần, hàng gia công và chiết khấu 2/10 net 30.
- Tạo `.env.example` để người dùng tự cấu hình. Không đưa `.env`, API key, `.venv` hoặc audit log cá nhân vào gói bàn giao.

## Kết quả kiểm thử
- `python -m pytest -q`: toàn bộ test trong `test/` đạt.
- `python test/test_permission.py`: đạt các kiểm tra từ chối Tier 3/tool lạ, ép `firm_id`, và tạo bản nháp Tier 2.
- `python -m compileall -q src test`: đạt.

## Giới hạn cần lưu ý
- Workbook hiện tại đánh dấu dữ liệu là dữ liệu thử nghiệm hư cấu; không được xem kết quả F01/F02/F03 là chẩn đoán doanh nghiệp thật.
- `forecast_cash` và danh mục `match_financing` vẫn là demo cố định trong code cũ, không phải dự báo dòng tiền/báo giá tài trợ thực tế.
- Một số công thức trong SRS cần dữ liệu chưa có trong workbook (ví dụ số dư bình quân hằng ngày, giá trị NRV, nghĩa vụ gross gồm VAT, hạn mức chưa rút, dữ liệu dòng tiền). Những chỉ tiêu này được báo thiếu dữ liệu/không hỗ trợ thay vì tự bịa số.
