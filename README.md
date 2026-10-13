# SME Liquidity Copilot — UC-01 (TV1)

## Phạm vi hiện đã triển khai

- **Agent chạy hoàn toàn bằng tiếng Anh.** Luồng xử lý: `AuthContext` của phiên → bộ định tuyến ý định `src/agent/router.py` (từ điển tiếng Anh) → `get_working_capital` (Tier 0, `firm_id` do server ép) → báo cáo tiếng Anh 3 đoạn (`src/agent/agent.py`). Câu hỏi tiếng Việt bị từ chối bằng một câu trả lời tiếng Anh.
- `get_working_capital` đọc dữ liệu từ workbook Excel và tính bằng Python; không dùng LLM để tính số. LLM chỉ viết lời diễn giải qua placeholder `[[FACT:id]]`; mọi số do server định dạng, và bản nháp lỗi bị chặn rồi chuyển sang bản diễn giải tất định (không cần API key).
- Chỉ tiêu tính được: AR, AP, INV thuộc sở hữu, Rev, COGS, PUR, DSO, DIO, DPO (trên COGS và trên PUR), CCC, TWC, vốn tương đương 1 ngày DSO/DIO/DPO, AR quá hạn theo nhóm tuổi nợ, tập trung khách hàng, tồn kho chậm luân chuyển, AP quá hạn và số ngày trễ, kỳ hạn và hành vi thanh toán, chiết khấu trả sớm.
- Có đối soát AR/INV/AP/CCC và tổng các nhóm tuổi nợ; `raw_value` giữ nguyên, chỉ làm tròn ở `display_value`.
- Yêu cầu soạn thư nhắc nợ (Tier 2): chỉ tạo bản nháp chờ chủ doanh nghiệp duyệt, người nhận phải là khách của đúng doanh nghiệp trong phiên và số tiền luôn được ép về số đã xác minh.
- Giữ nguyên tầng quyền (`src/agent/permissions.py`), ép `firm_id` theo phiên và audit log.

## Cảnh báo dữ liệu

Workbook trong thư mục `data/` là **dữ liệu thử nghiệm hư cấu**. Các kết quả mẫu dùng để kiểm thử công thức, không phải đánh giá một doanh nghiệp có thật. Để chạy với dữ liệu thật, cần workbook cùng cấu trúc sheet và xác minh nguồn sổ kế toán.

Các trường AP đến hạn trong 7/30 ngày hiện được tính trên cơ sở net (chưa gồm VAT) và gắn nhãn `due_basis = net_of_VAT`; chưa phải lịch tiền gross. Công cụ `forecast_cash` là UC-02 thật (xem mục bên dưới). `match_financing` và `simulate_scenario` vẫn là bản demo cố định trong `src/agent/tools.py` (UC-03 và UC-04 chưa làm); agent không gọi chúng, không coi đó là báo giá hay kịch bản thật.

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
python tests/agent/test_permission.py
```

Thư mục `tests/` chia theo lớp: `tests/uc01/` (`test_uc01.py`, `test_uc01_edge.py`: công thức và biên dữ liệu), `tests/agent/` (`test_router.py`: từ điển ý định, bảo mật `firm_id`, báo cáo tiếng Anh, luồng bản nháp; `test_permission.py`; `test_agent.py`: chạy thử bằng dòng lệnh). Các thư mục `tests/uc02`, `uc03`, `uc04`, `integration` đang để trống cho các UC sau. Mỗi thư mục test có `__init__.py` để hai UC có thể dùng chung tên file test.

## Chạy agent

```powershell
python tests/agent/test_agent.py
```

Câu 1, 2, 4, 5 chạy không cần API key; câu 3 (soạn thư) cần `OPENAI_API_KEY`. Audit log: `logs/audit.jsonl`.

## Cấu trúc thư mục

```
src/
├─ core/                    # dùng chung, không import agent hay UC nào: config.py, logger.py, data_loader.py
├─ agent/                   # lớp agent: agent.py (run_agent), router.py, permissions.py, tools.py
├─ uc01_working_capital/    # UC-01: working_capital.py (tính toán), schemas.py (kết quả có phiên bản)
├─ uc02_cash_forecast/      # UC-02: cash_forecast.py (dự báo tiền 13 tuần), schemas.py
├─ uc03_financing_match/    # UC-03 (chưa làm)
└─ uc04_scenarios/          # UC-04 (chưa làm)
tests/                      # uc01/, agent/, uc02/, uc03/, uc04/, integration/
data/                       # uc1_workbook.xlsx, cash_plans.csv (kế hoạch chi giả lập của UC-02), danh mục tài trợ UC-03 sau này
docs/                       # tài liệu (CHANGES_UC01.md, SRS các UC)
```

Quy tắc import một chiều: `core` không import `agent` hay `ucNN_*`; `ucNN_*` không import `agent`; UC sau chỉ lấy kết quả của UC trước. Thêm UC mới: viết code trong thư mục UC tương ứng, rồi đăng ký ở 3 nơi trong `src/agent/`: `tools.py` (TOOL_REGISTRY), `permissions.py` (TOOL_TIERS), `router.py` (INTENT_DICTIONARY).

## UC-02: dự báo tiền 13 tuần và cảnh báo thiếu hụt

- Hỏi bằng tiếng Anh, ví dụ: `Will I run short of cash in the next 13 weeks?`, `Show my cash forecast for the next 8 weeks`. Router chọn `CASH_FORECAST` và gọi `forecast_cash` (Tier 1, tự chạy, không tạo giao dịch).
- Công thức T2-01 đến T2-18 nằm trong `src/uc02_cash_forecast/cash_forecast.py` (tính bằng Decimal, đối soát ≤ 1 VND). Tiền đầu lấy từ `D_financials.opening_cash_vnd`, mức dự phòng từ `D_firms.min_cash_buffer_vnd`, ngày thu dựa trên độ trễ thanh toán của từng khách từ UC-01, kế hoạch chi (lương, thuê, thuế...) từ `data/cash_plans.csv`. Tất cả là **dữ liệu giả lập** (kết quả luôn mang trạng thái `provisional`).
- Bàn giao cho UC-03: `summary.first_gap_week` và `summary.max_gap_vnd` (khoản thiếu lớn nhất so với mức dự phòng; khoản thiếu để không âm là `summary.peak_zero_gap_vnd`, hai số này không cộng với nhau).
- Diễn giải tiếng Anh: có `OPENAI_API_KEY` thì mô hình viết bản nháp bằng token `[[FACT:id]]` và hệ thống kiểm tra từng claim (sai thì viết lại 1 lần, rồi dùng mẫu tất định); không có khóa thì dùng mẫu tất định. Kết quả gồm 4 phần, bảng tuần và dòng `Tools used: forecast_cash`. Mỗi lần phát hành ghi một dòng audit đầy đủ vào `logs/audit.jsonl`; hỏi kịch bản thu chậm bằng câu như `Will I run short of cash if receipts are 7 days late?`.
- Chạy test: `python -m pytest tests/uc02 -q`.

## REST API và giao diện (UC-02)

- **Giao diện Streamlit** (không cần API key): `streamlit run app.py` rồi mở http://localhost:8501. Tab *Cash Forecast* có 4 thẻ chỉ số (Opening Cash, Min Cash Date, First Deficit Date, Max Deficit Amount), bảng 13 tuần có nhãn và màu cảnh báo, bấm một dòng trong bảng hoặc chọn tuần để xem số dư từng ngày và các khoản thu chi của tuần đó.
- **REST API**: đặt khóa rồi chạy máy chủ (PowerShell):
  ```powershell
  $env:TV2_API_KEYS = "key-f01:F01,key-f02:F02"
  uvicorn src.api.tv2_routes:app --reload
  ```
  Tài liệu tương tác: http://127.0.0.1:8000/docs. Mọi lời gọi cần header `X-API-Key`; doanh nghiệp lấy từ khóa, không lấy từ nội dung yêu cầu (gửi `firm_id` khác với khóa sẽ bị từ chối 403).
  - `POST /api/v1/tv2/forecasts` với `{firm_id, as_of, weeks, buffer_vnd, weekly_only}` (tùy chọn `case_id`, `extra_days`, header `Idempotency-Key`).
  - `GET /api/v1/tv2/evidence/invoices` và `GET /api/v1/tv2/evidence/events` với `page`, `page_size` (tối đa 100), tùy chọn `run_id`; `events` còn lọc theo `week`, `day`, `direction`, `include_beyond`.
- `weekly_only=true` chỉ trả tóm tắt và bảng tuần (không có bảng ngày, `cash_events`, đợt thiếu), giảm khoảng 60% dung lượng; số liệu không đổi.
- Giới hạn thời gian công cụ: `TOOL_TIMEOUT` (mặc định 30 giây). Mọi ngày hiển thị theo dd/mm/yyyy; trường ngày thô trong JSON vẫn là ISO (yyyy-mm-dd).

