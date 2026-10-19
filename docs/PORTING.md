# Porting notes: SME Finance Copilot v2-4 → Lilact identity

**Source:** `SME_Finance_Copilot_AI_Agent_v2-4.html`, a single-file prototype.
**Importer:** `tools/port_prototype.py` is retained as a historical porting utility. **Do not rerun it:** it regenerates `index.html`, `css/app.css` and application JavaScript and would overwrite the single-flow interface changes. This demo has no build step.

## Single-flow interface
- The four task navigation modules have been replaced by one continuous conversation with a four-step progress bar.
- Step status is presented from the existing `S.stage` and `unlockedTask()` state. Selecting an available step scrolls to its conversation divider (or the welcome hero for Step 1 before its first divider exists) and opens its dashboard tab; it does not change the stage or rerun calculations.
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
- Numbers use the Vietnamese convention `1.234.567,89`, money is shown in `M`/`bn`, dates in `dd/mm/yyyy`; the shared helpers are in `js/formatters.js` (loaded before `js/app.js`).
- Navigation uses an explicit `S.view` (`chat` / `data`) through `showView()`, so New chat, Approval queue and chat history switch screens directly.
- The dashboard opens with a liquidity-state banner (SRS v1.3: W axis, TH01/TH02/TH03, M1–M9). It always uses the Base case; Rmin = 50% and Rupper = 200% of Rtarget, the FOB thresholds and a 30-day invoice term are demo assumptions, so the result is labelled provisional.

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
- Demo accounts are bound to F01, F02 and F03 respectively (`demo@`, `beta.demo@`, `gamma.demo@smecopilot.vn`) and cannot import data. A signed-up account analyses the one business it creates from its own files; that business is named after the account's company and renamed when the profile changes. Until it exists, the chat input is disabled and the welcome screen offers *Upload company data*.
- Saved chats record the company they belong to and only the account's company chats are listed.
- Calculations, routing and the four steps are unchanged; only which company is in context changed.


## SRS v1.3 alignment of UC01 and UC02
- **One engine for every source** (`js/engine.js`, parameters in `js/config.js`): the sample companies and uploaded files are normalised into the same snapshot and run through the same rules (BR-02.18). `js/data.js` only holds raw data (generated by `tools/build_demo_data.py` from the UC01 workbook and `cash_plans.csv`).
- **Period:** N = period end − period start + 1, from the financial statements or the cut-off/period pickers (default start = as_of − 182; 183 days for the samples). COGS of a different period is converted linearly and flagged provisional.
- **UC01:** per-invoice overdue ratio, type-based lot ages, R-AP-OD / R-AP-INFO, E_AR / E_INV / E_AP with double-count protection, c_i, H/L/HL, BN0–BN7, findings, cause breakdown (1)–(7), counterparty and lot profiles, the dashboard of Table 3-1 with evidence and a minimal threshold-policy dialog.
- **UC02:** delay samples (180 days, truncated open invoices), weighted Base / P25 / P75 with the customer → company → 7-day fallback, conditional delays for overdue invoices, historical / due-date payment timing, five scenarios with the BR-02.16 order check, Cash0 and Rmin / Rtarget / Rupper by source, two-week blocks, episodes coloured by their worst day, TH on Base, matrix cell only for the same snapshot.
- **Links and request:** contributing factors with L1 / L2 / L3 links (candidate / supported, never confirmed) and an immutable gap_request behind the "Find financing" buttons; rankFor is unchanged.
- **Chat:** guards for threshold changes, causal claims and out-of-scope questions; deterministic five-part (UC01) and four-part (UC02) answers from a fact registry, checked by verifyAnswer; tool names of Table 2-5 with a "Tools used" line; English only.
- **Feedback loop:** one forecast log per snapshot and configuration version; reconciliation of older logs with a newer snapshot (FB-2/3/4/6) and model_health on the Shortfall tab.
- Decisions taken where the SRS is open are marked `// SRS-DECISION:` in the code.
