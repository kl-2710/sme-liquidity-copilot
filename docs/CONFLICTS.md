# Conflicts between sources (unresolved, needs the business owner)

The frontend does **not** silently reconcile the points below. Each entry names the sources, what the UI does now, and what needs a decision.

Sources:
- **[M]** `Ma trận 9 trường hợp.png`
- **[L]** `Luồng riêng 4 tác vụ.html` (bản 4)
- **[W]** `Workflow tổng thể.html`
- **[S2]** Drive "Tài liệu đặc tả hệ thống.docx" v2.0 (06/10/2026)
- **[S1]** Drive "Tài liệu đặc tả hệ thống_UC1 (v2)"
- **[BG]** Lilact Brand Guideline v1.1 and brand kit
- **[B]** the implementation brief for this UI
- **[E]** the engine code on `feature/uc1-uc2-full@a49d4c9`

## 1. Forecast horizon: six months vs 91 days
- **[B]** UC01 and UC02 use a six-month scope; do not revert to 90 days or 13 weeks.
- **[L]/[W]**, "Chỉnh so với sơ đồ cũ": "Dự báo cốt lõi là 13 tuần (91 ngày); sáu tháng chỉ mở khi đủ dữ liệu". [W] Task 1 ① says "N = 90 ngày".
- **[S1]** §2.2.4: reporting period N = 90 (03/07–30/09/2026) and a 180-day payment-behaviour lookback. The 180 days is the only six-month window in the specs.
- **[S2]** UC-02: 13 weeks, `weeks` 1–13.
- **[E]**: `MAX_WEEKS = 13`; the API rejects more.
- **UI now:**
  - Shows the 91-day daily forecast.
  - The "6 tháng" toggle is visible but disabled, with this reason.
  - UC01 shows N = 90 plus the 180-day lookback.
- **Decision needed:**
  - Is the six-month scope the 180-day lookback, or a 26-week forecast?
  - If it is a 26-week forecast, the engine, its golden tests and `cash_plans.csv` must be extended first. The UI would then only need to enable the toggle.

## 2. UC03 ranking order
- **[S2]** BR-03.3 says "Xếp hạng theo chi phí hiệu dụng năm tăng dần, sau đó theo điều kiện và tốc độ"; A2: a late product is "vẫn hiển thị, đánh dấu không kịp và xếp cuối (đề xuất)".
- **[W]/[L]** Task 3 ④–⑤:
  - Hard filter "kịp need_date?".
  - Rank: kịp + đủ > kịp một phần > chậm; then certainty → cost on the covered amount → relationship burden.
  - At most 3 candidates.
- **UI now:** follows [W]/[L], as the brief requires (do not rank by lowest rate; a late source is not timely coverage). Late sources appear in the "bị loại" table with the earliest date they could pay.

## 3. One buffer vs Rmin / Rtarget / Rupper; alert basis
- **[S2]/[E]:**
  - A single owner-set buffer (`D_firms.min_cash_buffer_vnd`).
  - Engine alerts are a ratio of the gap to that buffer: yellow ≤ 20%, orange ≤ 50%, red above that, and negative cash is always red. The engine also emits `green` when there is no gap.
- **[W]/[L]:**
  - Three levels: Rmin, Rtarget, Rupper.
  - TH01 = a day below Rtarget; TH03 = above Rupper for ≥ 14 days.
  - "dưới Rmin hoặc âm: luôn đỏ"; no green level.
- **UI now:**
  - Rmin = engine buffer, which is itself an assumption.
  - Rtarget, Rupper and the W materiality thresholds come from a policy the user saves in UC00. The proposed defaults are labelled `demo_assumption`.
  - Engine alert badges are shown as computed, with their basis stated.
  - Engine `green` is rendered as "Không cảnh báo", not as a green badge.
- **Decision needed:**
  - The real values of Rtarget, Rupper and W.
  - Whether alert levels should be measured against Rtarget, as [W] implies, rather than the buffer.

## 4. Brand palette and tagline
- **[B]:**
  - Palette: Lilac Purple #76539B, Soft Lilac #DCCDEB, Botanical Green #315B49, Deep Slate #25343B, Lilac Mist #F7F5FA.
  - Tagline: "Small acts. Steady cash flow."
- **[BG]:**
  - Colours: Violet 600 #5537C2 and Blue 500 #2B6CE6. None of the brief's hex values exist in the kit.
  - Chương 26.1, "QUYẾT ĐỊNH BẮT BUỘC": Lilact has **no tagline**; use the descriptor "SME Liquidity Copilot".
- **UI now:** follows [BG], because the brief says the guideline wins when values differ.

## 5. Language
- **[E]** README: the agent runs in English only, and Vietnamese questions are refused.
- **[BG]:** the UI is in Vietnamese.
- **UI now:** Vietnamese labels. Engine texts that are English (UC02 insights, assumptions) are shown verbatim rather than translated. Buyer reminder drafts are in English, per [L] Task 4 "Thư nhắc thanh toán buyer (tiếng Anh)".

## 6. W0/W1/W2 rules
- **[W]/[L]:** W comes from UC01 rules plus materiality "VND và % (đã duyệt)". Neither [S1] nor [S2] defines W or its threshold values; [S1] has no W at all.
- **[E]:** produces no W.
- **UI now:** a labelled demo rule (`W-DEMO-01`):
  - UC01 insights are the signals.
  - The money at risk is the matching overdue or slow-stock metric.
  - Concentration counts as a signal but carries no money at risk.
  - If either threshold is missing, W is "unknown" and no matrix cell is assigned.

## 7. Approval wording
- **[S2]** UC-04B: after approval the draft status is "executed (simulated)".
- **[W]/[L]:** "thực thi giả lập đúng một lần", then re-run Task 2.
- **UI now:** status "Đã duyệt · thực thi giả lập" with `executed_count = 1`. A second approval is refused. A new bundle re-runs Task 2 and checks for new shortfalls and for episodes that got worse.

## 8. When UC03 runs
- **[S2]:** "UC-03 chỉ được kích hoạt khi UC-02 phát hiện khoảng thiếu hụt".
- **[W]/[L]:** UC03 always runs once a matrix cell is assigned:
  - TH02: hold liquidity, with a contingency if stress shows a shortfall.
  - TH03: disciplined use of cash, via SafeCash.
- **UI now:** follows [W]/[L]. UC04 is locked for the TH03 branch and explains why: the demo simulator only covers shortfalls.
