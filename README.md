# SME Liquidity Copilot — UC-01 (TV1)

## Phạm vi hiện đã triển khai

- **Agent chạy hoàn toàn bằng tiếng Anh.** Luồng xử lý: `AuthContext` của phiên → bộ định tuyến ý định `src/router.py` (từ điển tiếng Anh) → `get_working_capital` (Tier 0, `firm_id` do server ép) → báo cáo tiếng Anh 3 đoạn (`src/agent.py`). Câu hỏi tiếng Việt bị từ chối bằng một câu trả lời tiếng Anh.
- `get_working_capital` đọc dữ liệu từ workbook Excel và tính bằng Python; không dùng LLM để tính số. LLM chỉ viết lời diễn giải qua placeholder `[[FACT:id]]`; mọi số do server định dạng, và bản nháp lỗi bị chặn rồi chuyển sang bản diễn giải tất định (không cần API key).
- Chỉ tiêu tính được: AR, AP, INV thuộc sở hữu, Rev, COGS, PUR, DSO, DIO, DPO (trên COGS và trên PUR), CCC, TWC, vốn tương đương 1 ngày DSO/DIO/DPO, AR quá hạn theo nhóm tuổi nợ, tập trung khách hàng, tồn kho chậm luân chuyển, AP quá hạn và số ngày trễ, kỳ hạn và hành vi thanh toán, chiết khấu trả sớm.
- Có đối soát AR/INV/AP/CCC và tổng các nhóm tuổi nợ; `raw_value` giữ nguyên, chỉ làm tròn ở `display_value`.
- Yêu cầu soạn thư nhắc nợ (Tier 2): chỉ tạo bản nháp chờ chủ doanh nghiệp duyệt, người nhận phải là khách của đúng doanh nghiệp trong phiên và số tiền luôn được ép về số đã xác minh.
- Giữ nguyên tầng quyền (`src/permissions.py`), ép `firm_id` theo phiên và audit log.

## Cảnh báo dữ liệu

Workbook trong thư mục `data/` là **dữ liệu thử nghiệm hư cấu**. Các kết quả mẫu dùng để kiểm thử công thức, không phải đánh giá một doanh nghiệp có thật. Để chạy với dữ liệu thật, cần workbook cùng cấu trúc sheet và xác minh nguồn sổ kế toán.

Các trường AP đến hạn trong 7/30 ngày hiện được tính trên cơ sở net (chưa gồm VAT) và gắn nhãn `due_basis = net_of_VAT`; chưa phải lịch tiền gross. Các công cụ `forecast_cash`, `match_financing`, `simulate_scenario` vẫn còn trong `src/tools.py` với dữ liệu demo cố định nhưng **agent không gọi chúng** (ngoài phạm vi UC-01); không coi đó là dự báo hay báo giá thật.

## Cài đặt trên Windows / VS Code

Mở Terminal ở thư mục dự án:

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Tạo file `.env` từ `.env.example`, điền `OPENAI_API_KEY` nếu muốn dùng LLM. **Không đưa `.env`, `.venv` hoặc API key vào Git hay file nén gửi người khác.** Nếu một khóa API từng nằm trong file được chia sẻ, hãy thu hồi (revoke) và tạo khóa mới.

## Kiểm thử

Chạy từ thư mục gốc dự án (không cần API key):

```powershell
python -m pytest -q
python test/test_permission.py
```

Thư mục `test/` gồm: `test_uc01.py`, `test_uc01_edge.py` (công thức và biên dữ liệu), `test_router.py` (từ điển ý định, bảo mật `firm_id`, báo cáo tiếng Anh, luồng bản nháp), `test_permission.py`, `test_agent.py`. Đừng thêm `__init__.py` vào `test/` và đừng chạy `python -m test...` vì trùng tên với gói `test` của thư viện chuẩn Python.

## Chạy agent

```powershell
python test/test_agent.py
```

Câu 1, 2, 4, 5 chạy không cần API key; câu 3 (soạn thư) cần `OPENAI_API_KEY`. Audit log: `logs/audit.jsonl`.

## Cấu trúc chính

- `src/router.py`: từ điển ý định tiếng Anh, `AuthContext`, `route_intent()`.
- `src/agent.py`: system prompt tiếng Anh, báo cáo 3 đoạn, vòng lặp tool calling cho bản nháp.
- `src/permissions.py`, `src/tools.py`: tầng quyền và công cụ.
- `src/working_capital.py`, `src/data_loader.py`, `src/schemas.py`: tính toán UC-01, nạp dữ liệu, schema.

## Dữ liệu đầu vào

Mặc định chương trình đọc `data/uc1_workbook.xlsx`; nếu không có thì lấy file `.xlsx` đầu tiên trong `data/` (nên đổi tên file thành `uc1_workbook.xlsx` để tránh lỗi mã hóa tên có dấu khi nén/giải nén). Có thể trỏ sang workbook khác bằng biến môi trường `UC1_WORKBOOK_PATH` trong `.env`; đặt `UC1_DATA_IS_SYNTHETIC=false` khi đã xác minh đây là dữ liệu thật (không giả lập). Workbook phải có các sheet:

- `D_firms`: `firm_id`, `name`, `industry`, `supply_chain_position`, `min_cash_buffer_vnd`
- `D_financials`: `firm_id`, `period`, `period_days`, `revenue_vnd`, `cogs_vnd`
- `D_sales`: `invoice_id`, `firm_id`, `buyer`, `amount_vnd`, `issue_date`, `due_date`, `paid_date`, tùy chọn `revenue_recognition_date`, `is_credit`
- `D_purchases`: `invoice_id`, `firm_id`, `supplier`, `amount_vnd`, `issue_date`, `due_date`, `paid_date`, `early_discount_pct`, `discount_days`, tùy chọn `is_credit`
- `D_inventory`: `firm_id`, `product_line`, `inventory_type`, `qty`, `unit_cost_vnd`, `days_in_stock`, `excluded`, `slow_threshold`

Kỳ `as_of` và `period_days` phải khớp với kỳ có trong `D_financials`; code không tự nội suy số liệu cho kỳ không có dữ liệu.

### Các sheet tùy chọn để hỗ trợ thanh toán từng phần

Nếu có dữ liệu thực tế, có thể bổ sung:

- `payment_allocations`: `firm_id`, `invoice_id`, `allocation_id`, `amount_net_vnd` (hoặc `amount_gross_vnd`), `paid_date` (hoặc `payment_date`)
- `credit_notes`: `firm_id`, `invoice_id`, `amount_net_vnd`, `credit_date`
- `purchase_payment_allocations`: cấu trúc tương tự `payment_allocations`
- `purchase_credits`: `firm_id`, `invoice_id`, `amount_net_vnd`, `credit_date`

Khi các sheet phân bổ có mặt, chúng là nguồn thanh toán chính thức; không suy thanh toán toàn bộ từ `paid_date` của hóa đơn. Tổng thanh toán và credit không được vượt giá trị hóa đơn. Với workbook mẫu hiện tại chưa có các sheet này, chương trình dùng giả định thanh toán một lần và gắn nhãn giả định trong kết quả.

## Giới hạn chưa tự động kết luận

Các công thức cần NRV/giá thanh lý, nhu cầu và tồn an toàn, cờ tranh chấp/PD/LGD, hạn mức ngân hàng, nghĩa vụ bắt buộc, dòng tiền vận hành/CFADS, số dư bình quân, kỳ trước hoặc sổ cái kiểm soát sẽ được liệt kê trong `unsupported_metrics` với `missing_data`, thay vì tự điền số 0.
