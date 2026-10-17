# Lilact frontend demo: how it works

This is a static app: HTML, CSS and vanilla JS, with no build step and no backend. It runs on its own on branch `feature/frontend-demo`.

## Run
```bash
python3 -m http.server 8000      # from the repository root
# open http://127.0.0.1:8000/  (opening index.html directly also works)
node --test tests/*.test.mjs     # rule + workflow-state unit tests (Node ≥ 18)
node tests/e2e.mjs               # browser flow test (needs Playwright + Chromium); SHOTS=dir saves screenshots
```

## Where the numbers come from
Every section header carries a source label: **Engine**, **Dữ liệu nguồn**, **Quy tắc demo**, **Kịch bản**, **Giả định**, or **Danh mục giả lập**.

| Layer | Files | Source |
|---|---|---|
| UC01 metrics, drivers, insights, evidence | `data/engine/F0x.js` → `uc01` | Real `calculate_working_capital` output, exported by `tools/export_engine.py` from `feature/uc1-uc2-full@a49d4c9` |
| UC02 daily/weekly ledger, cash events, engine alerts, adverse case | `data/engine/F0x.js` → `uc02.base`, `uc02.estimated_receipts_late_14d` | Real `calculate_cash_forecast(weeks=13)` output, base and the engine's own late-receipts case |
| Rtarget, Rupper, W materiality | `data/demo/policy.js` + the UC00 form | Proposed `demo_assumption` values; used only after the user saves them |
| W / TH axes, 3 × 3 router, cause names, counterfactuals | `js/rules/classify.js`, `router.js`, `explain.js` | Demo rules transcribed from the workflow documents |
| Financing options | `data/demo/catalogue.js`, `js/rules/uc03_match.js` | Simulated catalogue with fictional providers; workflow ranking rules |
| What-if, verdicts, approval re-run | `js/rules/scenario.js`, `uc04_simulate.js`, `js/state.js` | Demo rules applied to a clone of the engine's cash events |

The demo rules re-add the engine's own `cash_events` to rebuild the ledger. The unit test `ledger rebuilt … equals the engine daily ledger` checks that this matches the engine to the VND for all three firms and both cases. No presentation file contains a financial result.

## Screens and workflow
| Screen | Workflow step | What it enforces |
|---|---|---|
| UC00 · Dữ liệu | UC00 ①–③ + "Đủ để tính?" | Sources, field mapping and engine data-quality/reconciliation checks. Threshold policy form. Explicit confirmation creates `snapshot_id` + `analysis_bundle_id`. A CSV upload check runs in the browser only: nothing is saved and no row is dropped. |
| Task 1 · Chẩn đoán | UC01 ①–⑤ | DSO/DIO/DPO/CCC with formula IDs, three capital pockets, W classification with signals, drivers by customer/lot/supplier, actions to check, descriptive benchmark, reconciliation. |
| Task 2 · Dự báo | UC02 ①–⑦ + router | 91-day chart with Rmin/Rtarget/Rupper; episodes vs Rtarget (selectable); need_date/need_target/floor_need; cash bridge tied to 1 VND; counterfactuals; five cause types; 3 × 3 matrix with the active cell and its "Không được"; weekly table with engine alerts; daily ledger with an event drill-down. |
| Task 3 · Giải pháp | UC03 ①–⑤ by column | TH01: ≤ 3 ranked candidates and the rejected list with reasons (untimely, pledged, essential supplier, no buyer evidence, headroom LQ17). TH02: hold, with a contingency if stress shows a need. TH03: SafeCash for base and stress. |
| Task 4 · Thử & duyệt | UC04 ①–⑥ | Base + adverse before/after, verdict enum, LQ18 check, a return to Task 3 when the result is partial. Tier-2 draft; approve needs an approver name and reject needs a reason. Approval runs a simulated execution exactly once, creates a new bundle, marks the old one stale and re-runs Task 2 (checking for new shortfalls). |
| Nhật ký | bundle contract | Current vs stale bundles, scenario runs, audit trail (localStorage). |

**Locks:**
- Task 1–4 stay locked until UC00 is confirmed.
- Task 3 is locked while a matrix axis is unknown.
- Task 4 is locked for the surplus branch, when there is no need, or when no candidate is selected.

Every lock says why and links to the step that unlocks it.

## Known gaps (not implemented, by design or for lack of a backend)
- **No persistence:** there is no server, so approvals and bundles live in localStorage and the browser holds the audit log. The real system writes `logs/audit.jsonl`.
- **Uploads do not reach the engines:** the UC00 upload is only checked in the browser.
- **The engine never sees approved changes:** after approval, Task 2 is re-run with the demo ledger on the engine events.
- **Rules not yet in the engine:** W, TH, routing, UC03 and UC04 run as browser demo rules. They should move to backend endpoints keyed by `analysis_bundle_id`.
- **6-month horizon:** see CONFLICTS.md #1.
- **No Task 4 for the surplus branch, and no "new order" what-if:** the data has no new-order schedules.
- **No textile-industry layer:** the parameters from [L] (L/C, Tết payroll, FX stress) are not in the data.
- **No LLM narrative or chat:** the deterministic engine texts are shown instead.
