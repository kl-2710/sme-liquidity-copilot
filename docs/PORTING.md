# Porting notes: SME Finance Copilot v2-4 → Lilact identity

**Source:** `SME_Finance_Copilot_AI_Agent_v2-4.html`, a single-file prototype.
**Importer:** `tools/port_prototype.py` is retained as a historical porting utility. **Do not rerun it:** it regenerates `index.html`, `css/app.css` and application JavaScript and would overwrite the single-flow interface changes. This demo has no build step.

## Single-flow interface
- The four task navigation modules have been replaced by one continuous conversation with a four-step progress bar.
- Step status is presented from the existing `S.stage` and `unlockedTask()` state; it does not change the stage or rerun calculations.
- Advancing the conversation adds one divider per reached step. New chat and company changes clear the dividers with the conversation.
- Only the interface and its browser tests changed for this presentation. Routing, calculations, data, and the order of the four business steps are preserved.

## Sign-up and company files
- Sign-up requires a company name (at least two characters), a unique tax code (10 or 13 digits; an optional hyphenated 10+3 form is normalized to digits), and a password with at least eight characters, uppercase and lowercase letters, a digit and a symbol. The same password rule is used in the browser password-reset form.
- Uploaded files are indexed in the browser's IndexedDB database `lilact.files.v1`, scoped to the signed-in user. CSV/XLS/XLSX tables go through the existing importer (XLS/XLSX uses the first worksheet). DOCX files are reference-only and never enter the importer or calculations.
- Company data is a single Files screen. Reading, checking and saving uploaded tables is a background task: after each upload the newest file of each recognised type is passed through the existing `addRaw` → `evalImport` → `formDefaults` → `saveImport` pipeline, which creates a snapshot as before. The review form, the Businesses & snapshots view and the import success toast are no longer shown.
- If something required is missing (financial statements, a cash-flow table, required columns), nothing is saved and the files show what is still needed. Files of the same type that were superseded show *Replaced by a newer file*. Deleting files leaves the data already in use unchanged.
- Demo accounts keep their fixed sample data; their uploads are stored but marked *Not used*.
- **Do not run `tools/port_prototype.py` again.** It would regenerate the UI and overwrite this single-flow and Company data work.

## Kept exactly as in the prototype
- **Flow and business behaviour:** all screens and their order, the auth flow, chat routing and intents, task unlocking, tool calls and tiers, the calculations, the financing catalogue and ranking, the what-if levers, drafts, approval and rejection dialogs, audit log event collection, data upload, settings and pins.
- **Data:** the synthetic data (`DATA`) and the scenario presets (`SC`).
- **Language:** English UI text. The only Vietnamese left is the hidden list of upload aliases (`UPLOAD_ALIASES` in `js/config.js`), so files with Vietnamese column headers still import.

## Navigation, formatting and SRS v1.3 states
- Numbers use the Vietnamese convention `1.234.567,89`, money is shown in `M` (million VND) / `B` (billion VND, e.g. `11,85B`), dates in `dd/mm/yyyy`; the shared helpers are in `js/formatters.js` (loaded before `js/app.js`).
- Navigation uses an explicit `S.view` (`chat` / `data`) through `showView()`, so New chat, Approval queue and chat history switch screens directly.
- The liquidity-state banner (SRS v1.3: W axis, TH01/TH02/TH03, M1–M9) leads the Shortfall view once step 2 has run (see below). It always uses the Base case; Rmin = 50% and Rupper = 200% of Rtarget, the FOB thresholds and a 30-day invoice term are demo assumptions, so the result is labelled provisional.

## Every gap, chips and alert colours
- Cause and ranking cover every gap, not only `c.defk`. `tv3For(ep)` wraps `rankFor` with a cache per firm|case|gap; the default gap reuses `c.tv3`. `simulate`, `episodes`, `rankFor` and `data.js` are unchanged.
- "Explain gap N" / "Rank financing for gap N" (`/gap\s*(\d+)/i`) select that gap first. Suggestion chips stay above the input (max 4) and are hidden only while a reply is running.
- The 13-week forecast and the daily balance moved from the dashboard to the Shortfall tab (forecast → daily chart → gap cards → ranking). Clicking a gap highlights its weeks and shows its ranking.
- Colours follow SRS 2.8.11.3 through `alertLevel(cashEnd, Rt, Rmin = 0.5·Rt)`: red below 0, below Rmin or gap > 50%; orange 20–50%; yellow 0–20%; green otherwise; blue for TH03 surplus. Gap cards are always red. Week cells use the week-end balance, while "lowest in week" uses the worst day.

## Changed for the Lilact identity
- **Logo and name:** the "✦ SME Finance Copilot" brand mark is replaced by the Lilact logo (light/dark variants) with the descriptor "SME Liquidity Copilot". The chat avatar and welcome mark now use the Lilact symbol. The page title and favicon are Lilact's.
- **Colours:**
  - Every colour in the prototype CSS is mapped to a `--lc-*` token from `css/lilact-tokens.css`, by role and hue (`tools/colormap.py`).
  - The prototype's own variables (`--blue`, `--ink`, `--line`, …) now point at Lilact tokens.
  - The prototype's hard-coded dark-mode overrides were removed, because Lilact tokens switch light/dark themselves. The prototype's theme switch (Light/Dark/System) still drives `data-theme`.
- **Charts:** chart colours in the JS use Lilact data tokens (cash, receivables, inventory, payables, status, alert).
- **Visual style:** gradients are flattened to solid brand colours, in line with the Lilact guideline (flat, calm).
- **Fonts:** Inter and Inter Display are bundled locally instead of system fonts. The prototype's serif headings use Inter Display.

## Text and bug fixes
- **Mixed-language strings:** a few leftover Vietnamese strings in an otherwise English UI were translated: the approval notice, the queue hint, the "Out" label in the chart tooltip, the "before / after" heading and the "Done" button.
- **Missing function:** `botNote()` was called after an approval, and on chat errors, but was never defined. That threw a ReferenceError and the confirmation message never appeared in the chat. It is now defined with the prototype's own `newBot`, `say` and `suggestRow` helpers.


## Single chat workspace updates

The interface hides the audit log while keeping `addLog` and its in-memory events. Scenario selection is fixed by `defCase`. Chat history is stored in this browser per account; buttons in restored conversations are disabled until the user asks again. Billing is a demo placeholder and does not collect payment data.

## One account, one company
- The prototype let any account switch between F01–F03 (and its own uploaded businesses). Each account is now bound to a single company, kept in the user account (account card and menu); the company selector is hidden and chat rows no longer show a company label.
- The demo account `demo@smecopilot.vn` is bound to F01 and cannot import data. (F02 and F03 were removed with the workbook v9 data; their demo accounts are deleted from browser storage on first load.) A signed-up account analyses the one business it creates from its own files; that business is named after the account's company and renamed when the profile changes. Until it exists, the chat input is disabled and the welcome screen offers *Upload company data*.
- Saved chats record the company they belong to and only the account's company chats are listed.
- Calculations, routing and the four steps are unchanged; only which company is in context changed.


## SRS v1.3 alignment of UC01 and UC02
- **One engine for every source** (`js/engine.js`, parameters in `js/config.js`): the sample companies and uploaded files are normalised into the same snapshot and run through the same rules (BR-02.18). `js/data.js` only holds raw data (generated by `tools/build_demo_data.py` from `data/uc_workbook_v9.xlsx`).
- **Period:** N = period end − period start + 1, from the financial statements or the cut-off/period pickers (default start = as_of − 182; F01 uses its declared period, 171 days). COGS of a different period is converted linearly and flagged provisional.
- **UC01:** per-invoice overdue ratio, type-based lot ages, R-AP-OD / R-AP-INFO, E_AR / E_INV / E_AP with double-count protection, c_i, H/L/HL, BN0–BN7, findings, cause breakdown (1)–(7), counterparty and lot profiles, the dashboard of Table 3-1 with evidence and a minimal threshold-policy dialog.
- **UC02:** delay samples (180 days, truncated open invoices), weighted Base / P25 / P75 with the customer → company → 7-day fallback, conditional delays for overdue invoices, historical / due-date payment timing, five scenarios with the BR-02.16 order check, Cash0 and Rmin / Rtarget / Rupper by source, two-week blocks, episodes coloured by their worst day, TH on Base, matrix cell only for the same snapshot.
- **Links and request:** contributing factors with L1 / L2 / L3 links (candidate / supported, never confirmed) and an immutable gap_request behind the "Find financing" buttons; rankFor is unchanged.
- **Chat:** guards for threshold changes, causal claims and out-of-scope questions; deterministic five-part (UC01) and four-part (UC02) answers from a fact registry, checked by verifyAnswer; tool names of Table 2-5 with a "Tools used" line; English only.
- **Feedback loop:** one forecast log per snapshot and configuration version; reconciliation of older logs with a newer snapshot (FB-2/3/4/6) and model_health on the Shortfall tab.
- Decisions taken where the SRS is open are marked `// SRS-DECISION:` in the code.

## Simple view and Expert mode
- The default view is for business owners: plain results only ("Safe cash level", "Cash tied up above normal", Normal / Watch / Severe, Act now / Watch / OK) with a small "Estimate" badge whose tooltip gives the reason. Calculations are unchanged and always run.
- The "Expert mode" checkbox (dashboard data line and Shortfall bar, remembered per browser in `lilact.expert.v1`) adds formulas, rule ids, W/BN/TH/M codes, c_i and shapes, threshold sources and versions, snapshot and run ids, raw VND, the cut-off pickers and the threshold policy.
- Plain wording comes from `tx(key)` in `js/i18n.js`, which uses `<key>.s` when it exists and Expert mode is off; chat answers use the same switch.
- Item status follows the signal level c_i (0 Normal, 1 Watch, 2 Severe).

## Modals
- Every dialog opened with `openModal` gets the shared layout from `layoutModal`: a fixed header (close button and title), a body that scrolls on its own (`overflow-y:auto; min-height:0; overscroll-behavior:contain`) and a fixed footer with the `.acts` buttons. The modal is at most `calc(100dvh - 2rem)` high (100vh fallback), so Save and Cancel stay reachable on short screens.
- While a modal is open the page behind is locked; Esc closes it, Tab stays inside it and focus returns to the element that opened it. The Settings window keeps its own two-pane layout.

## Detail views (one at a time)
- The right-hand panel shows exactly one detail view: Dashboard, Shortfall, What-if or Approvals. It has a header with the view title, the company line, Full screen and a close button (×); there is no tab bar and the 1–4 keyboard shortcuts were removed.
- `openDetail(view, opts)` replaces `setTab`: it sets `S.detail` (formerly `S.tab`), renders only that view, empties the other panes and opens the panel. `opts.gap` selects a gap first; the gap buttons of the UC02 answer still call `selectGap` (`data-gap-open`). Shortfall and What-if fall back to Dashboard before the conversation reaches step 2 / 3, as before.
- A detail view opens only from the "Open…" button of a chat answer: UC01 → Dashboard, UC02 / gap → Shortfall on that gap, UC03 / UC04 options → What-if with the scenario already loaded (`loadScenario`), drafts → Approvals. The sidebar "Approval queue" and the Pending chip also open Approvals.
- Buttons inside a view that used to jump to another view now hand off to the chat (`detailHandoff`): a short note with the Open button of the target view. This covers "Try" in the Shortfall ranking, "Create draft" in What-if, "Find financing" once step 3 is reached, and the empty Approvals view (its "Open What-if" button became a hint).
- `#panelBtn` stays in the chat header but only reopens the most recent detail view (`S.detail`) and shows its name; it never switches to another view. Kept rather than removed so the panel can be reopened after closing it without scrolling back to the answer.
- When the stage advances, an open detail view is re-rendered in place; it no longer switches to the step's view. New chat closes the panel if it showed Shortfall or What-if.
- The pending-draft badge `#apprBadge` moved from the old Approvals tab to the sidebar "Approval queue" item (it replaces the duplicate `#sideBadge`); the Pending chip in the header still shows the count.
- The four-step progress bar is no longer in the interface on this branch, so there is no step click to wire.

## Workbook v9 data
- **Source:** `data/uc_workbook_v9.xlsx`, read by `python3 tools/build_demo_data.py data/uc_workbook_v9.xlsx`, which overwrites `js/data.js`. Columns are found by their header name, never by position; helper columns of the workbook are ignored. Do not edit `js/data.js` by hand.
- **Scope:** only F01 (CMT). Period 01/01/2026–20/06/2026 (N = 171), cut-off 20/06/2026, 13-week horizon, snapshot `F01-20260620-SYN171-v1`, Cash0 1,2 billion, Rmin / Rtarget / Rupper 250 / 500 / 1.000 million, short-term investments 800 million, current assets from F01_UC1. All of them come from D_F01.
- **Cleaning:** D_flows keeps only rows of firm F01 with a valid date, direction and amount. Rows that restate an invoice (`invoice_ref`) are dropped because the invoice is already in D_sales / D_purchases; their confirmed receipt dates are kept as the confirmed date of that invoice (7th field of a sales row).
- **Names:** every Vietnamese name (customers, suppliers, lots, categories) is translated by the `NAMES` dictionary of the script, so no Vietnamese reaches the interface.
- **F02 / F03:** removed from the app (FIRMS, demo accounts, essential-supplier lists). The SRS Appendix D cases that were written on them run on a test-only copy of the previous data (`tests/fixtures/legacy_samples.json`, loaded as X01–X03).
- **Financing:** D_UC03 gives the UC03 product table (`DATA.uc03.F01`) and the catalogue (`DATA.cat`: AR-01, RF-001, FAC-001, FAC-002, INV-001, CL-001, CL-002; the earlier fields are kept so `rankFor` still works for uploaded companies). F01_UC4 gives the UC04 defaults (`DATA.uc04.F01`).
- **Presets:** `SC` was rewritten for the new data; the main demo (F01-C) is workbook UC04 case 1: K1 pays half 7 days early, Beta takes half 14 days later, half of last season's finished goods are sold.

## Engine aligned with workbook v9
The workbook is the reference; where the earlier engine differed, the engine follows the workbook. Each change is marked in `js/engine.js`.
- **UC01:** c_AR / c_INV come only from the DSO / DIO level and c_AP only from a low DPO with a thin buffer (R-AP-1); overdue invoices and slow lots stay signals and details. E_AR / E_INV are the threshold excesses, E_AP is the total overdue payables, money_at_risk = E_AR + E_INV. Materiality share = max(E_AR, E_INV) / current assets; W2 when a level is 2, or a level is 1 and the share is at least 5 %. Thresholds keep the full precision of the Nguong sheet. The cause breakdown scales flagged invoices and lots into E pro rata (DECISION).
- **UC02:** Base delay = weighted mean; P25 / P75 unweighted (PERCENTILE.INC); Optimistic = min(P25, mean), Conservative = max(P75, mean); the conditional set of an overdue invoice includes its own sample; overdue payables land on as_of + offset + (rank mod 5) with a 1-based rank in invoice-id order; supplier timing uses the supplier's own weighted mean lateness on completed payments, else the due date; confirmed receipt dates are used as given; continuing sales use credit 45 days, cost ratio 0,45 and a 7-day cost lag (`config.continuing`).
- **UC03:** `ENGINE.matchFinancing` (two-week blocks, material changes, shape, rounds, DaysLeft, factor shares and roles, scenario A1–A4 / B1 / B2, per-product capacity, cost, timeliness, hard filters, ranking key and package). It drives the chat card and the Shortfall section for the sample company; uploaded companies keep `rankFor`.
- **UC04:** `ENGINE.simulateUC04` (cases 0–6: early / late collection, supplier extension, stock sale with recovery and sale cost) drives the what-if card when the levers match the workbook (sample company, Base, 13 weeks).
- The reconciliation test `V9 · UC01–UC04 of F01 match the workbook v9 results` in `tests/e2e.mjs` checks the Excel values of F01_UC1, F01_UC2, F01_UC03, F01_UC4 and Kiem_thu.

## Dashboard: Receivables, Inventory and Payables
- Section 2 is titled "Receivables, Inventory and Payables". Its three item cards are stacked, each at full width (`.icards` is a column; the 900 px media query no longer touches it).
- Each card has a **Details** button (`data-det`, `aria-expanded`, `aria-controls`) that opens a table right under that card: customers for Receivables, stock lots for Owned inventory, suppliers for Payables. Each card opens and closes on its own; the open set is kept in `S.dash.open`, so sorting or re-rendering keeps it.
- `itemDetailsHTML(d, item)` replaces `detailTablesHTML` / `detailTablesSimpleHTML` and reuses their rows, priorities and sort keys (`scust` / `slot` / `ssup`); no figure is recomputed. Both modes use the same six columns: Name | Amount | Share | Overdue | Longest Overdue (Days) | Priority. Expert mode puts the former extra columns (labels, debt status, tier, average lateness; lot type, status, collateral; dependency, essential, extension) under the name and keeps the exposure / intervention order of the customers.
- Lots have no due date: their Overdue and Longest Overdue cells show "—" and the days in stock appear under the lot name.
- The "Who holds the money" section (widget `tables`) is removed; later sections are renumbered. A saved pin of the old widget is dropped on load (`RETIRED_WIDGETS`). Rows still open the evidence panel, and the "View detailed dashboard" button of the receivables answer opens the Receivables details.

## Suggested questions
- On an empty chat the suggested questions stay by the composer (`#demoChips`), as before. From the first message on, `#demoChips` is never shown again in that chat.
- From then on there is a single suggestion row, under the latest answer only (`placeSuggest`). It merges the answer's own items (`suggestRow`, kept on the element as `_sug`), the flow chips (`chipList`) and the next steps (`nextSuggest`), drops duplicates and the question just asked, and holds at most four questions. When a new answer arrives, the row of the previous answer is removed.
- New chat goes back to the empty state with the chips by the composer. A chat reopened from history gets a fresh row under its last answer; the stored rows are dropped.
- Fixed with it: reopening a chat from history threw `applyStage is not defined` (the function was removed with the tab bar).

## Liquidity-state banner on Shortfall
- The banner ("Cash shortfall ahead" / "Liquidity Shortfall Alert", and the TH02, TH03 and unknown states) moved from the Dashboard to the top of the Shortfall view (`renderGap`). It is shown only when `S.stage ≥ 2`, i.e. after a forecast question has been answered.
- Content, tiles and states are unchanged; the UC01 tiles (capital above the normal level from `money_at_risk`) still read the cached UC01 run. Its "Find financing to cover the gap" button is bound in `bindGapHeader`.

## Confirmation dialogs
- `confirmAction` (delete chat, log out, clear data, delete account) marks the modal with `confirm-dialog`; `openModal` clears it for every other dialog.
- `.modal.confirm-dialog` is `min(400px, 100vw − 32px)` wide, takes its height from the content (the shared `.modal-layout` would otherwise let the dialog grow across the scrim's flex row), has no footer rule and keeps Cancel / the action on the right. Settings and the dialogs with forms or text areas keep their layout.

## Shortfall cleanup
- The weekly forecast no longer has the "Show the daily table" button or the daily table (`dailyTableHTML`, `S.showDaily`, `gap.daily.*` removed). The "Daily balance and gaps" chart stays.
- The overview keeps four tiles (lowest balance, first day below the safe level, cash needed, largest shortfall) in a 4-column grid; the "Overall alert" and "Cash outlook" / "Cash state (Base)" tiles were removed. The banner at the top already shows the alert level and the cash state. `gap.base.note` now refers to the banner.
- The "Forecast confidence" / "Forecast reliability" card and the "Two-week view" / "Two-week blocks" card are no longer shown (`reliabilityHTML`, `blocksHTML`, `fb.*`, `blk.*` removed). `FEEDBACK` (forecast logs, reconciliation, model health in the gap_request) and the engine's blocks are unchanged.
- The financing match (task 3) is not shown in Shortfall until the financing question has been answered (`S.stage ≥ 3`); the answer to task 2 carries that question in its suggestion row. Then the match appears under Cash gaps (`#finMatch`), and the "Open Shortfall →" / "Open ranking" buttons of the task 3 answer, and the hand-off of "Find financing" from step 3, open Shortfall scrolled to it (`openDetail(view, {scroll})`).
- Saved pins of the removed widgets (`reliability`, `blocks`) are dropped on load.

## UC03 Solutions and UC04 What-if (SRS v2.3, workbook v10)
- **Input layer (step 0):** `js/data.js` is regenerated from `data/uc_workbook_v10.xlsx` (F01 is FOB, no customer-owned stock). `js/config.js` holds `fob.threshold.v3` and the Miller–Orr parameters; `ENGINE.resolveReserves` takes L / Z / H from Miller–Orr (σ of the 171-day cash history, TTM revenue) and keeps the aliases rmin / rtarget / rupper. `UC0304.prepInput()` returns W, TH (TH01 if a Base day is below L, else TH02 if a day is above H, else in_band), the matrix.v2 cell (none in the band), L/Z/H and the base / conservative / positive paths (the engine's "optimistic" is published as "positive"; stress_7 and continuing_sales are not used).
- **UC03 (`js/uc0304.js`, view in `js/ui0304.js`):** priority.v2 (MT01): M1 O2 · M3 O4→O1 · M5 O4→O3→O1→O2 · M2 I0 · M4/M6 R0. The A1–A4 / B1 / B2 scenario routing and cause_match of the workbook are not used. Inside a group: timely → eligibility confirmed → speed → cost on the same amount and term → relationship impact → id. Hard checks EL-03-01 … 07; missing evidence is "to consider". FloorGap (L) and TargetGap (Z) are reported separately; the package targets Z on the shortfall days with daily events, each object once, and never creates a shortfall on a later episode or a repayment date. "Don't use this source" saves a new selection version; the policy / catalogue panel is two-role (accountant proposes, owner confirms) with an expiry warning and the packages to rerun.
- **UC04:** exactly three levers (U401 AR early/late with shift_days or absolute_date, U402 AP extension with assumed supplier consent, U403–U404 stock sale with one price basis), one change set on base / conservative / positive (BR-04-01), per scenario CashAfter, min cash, FloorGap, TargetGap, gap days, negative days, WorseDays and tail events. W, CCC and the historical DSO/DIO/DPO never change; th_after and the simulated cell are kept apart from the published cell. Runs are versioned and linked; compare refuses runs on another base. The workbook UC04 cases 2–6 (stress selector) and the "finance one invoice" lever are removed.
- **Removed (UC04.6):** approval queue, drafts, Approve / Reject, "executed (simulated)", tier labels. The app states "Analysis and simulation only; decide and act outside the app" and offers exports.
- **Engine:** `matchFinancing`, `uc03Objects`, `uc03Rounds` and `simulateUC04` (workbook v9) were removed from `js/engine.js`; `simulate` in `js/app.js` is reduced to the baseline path used by the Shortfall chart and the UC01 cards.
