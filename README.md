# sme-liquidity-copilot · Lilact frontend demo

This branch (`feature/frontend-demo`) is a static web demo: HTML, CSS and vanilla JS, with no build step and no backend.

- **Flow and business logic** follow the *SME Finance Copilot AI Agent v2-4* prototype exactly; the four analysis stages continue in a single conversation, with local chat history and account settings.
- **Visual identity** comes from the Lilact brand kit: logos, colour tokens, Inter fonts and light/dark themes.
- **Not used:** the earlier Lilact 9-case routing workflow.

## Run locally
```bash
git checkout feature/frontend-demo
python3 -m http.server 8000        # or any static file server
# open http://127.0.0.1:8000/  → "Use the demo account"
```

## What the demo does (from the prototype)
- **Sign in:** sign in or sign up (stored in this browser only), or use the demo account. Sign-up requires a company name, a unique 10- or 13-digit tax code, and a password with upper/lowercase letters, a digit and a symbol.
- **One account, one company:** each account analyses exactly one company, kept in the user account (account card and menu: company name, tax code). There is no company switcher.
  - The demo account `demo@smecopilot.vn` (password `Demo@2026`) is bound to the sample company F01 Alpha Garment Subcontractor. Its data is fixed; imports are not available. The former F02/F03 demo accounts are removed from the browser on first load.
  - A new account starts without data: the chat asks to *Upload company data* and stays disabled until the required files are uploaded. The business name always comes from the account (change it in Settings → Account), whatever the uploaded files say.
- **Chat:** one continuous conversation. Analysis advances through the same four business stages in order:
  1. Working-capital diagnosis (DSO · DIO · DPO · CCC)
  2. Cash-flow forecast (13 weeks, shortfall windows)
  3. Solutions (UC03, SRS v2.3 §2.9): sources in the priority order of the matrix cell (matrix.v2, priority.v2), the daily package and what remains under L and under Z
  4. What-if (UC04, SRS v2.3 §2.10): three levers applied to Base, Conservative and Positive
- **Detail views:** Dashboard, Shortfall, Solutions and What-if open one at a time in the right-hand panel. Solutions and What-if also open directly from the sidebar and prepare their own UC01/UC02 results (no stage gate). Audit events remain available internally but are not displayed. Company data is a single full-page Files screen.
- **Analysis and simulation only:** two roles (owner, accountant); there is no approval queue, no drafts and no "executed" state. Decisions and actions happen outside the app; results can be exported (JSON / CSV).
- **Company files:** upload CSV, XLSX, XLS and DOCX files. Files stay in this browser's IndexedDB; Word files are reference-only. Recognised tables (sales and purchase invoices, inventory, 13-week plan, financial statements) are read and checked in the background; once financial statements and at least one cash-flow table are present, the company data is updated automatically and each file shows *Used in analysis* (or what is still missing). The newest file of each type wins. Deleting a file keeps the data already in use.
- **Data:** one synthetic company, F01 (FOB garment maker: own materials, no customer-owned stock), from the workbook `data/uc_workbook_v10.xlsx`: period 01/01–20/06/2026 (N = 171 days), cut-off 20/06/2026, 13-week horizon, opening cash 4,8 billion VND, thresholds `fob.threshold.v3`, reserve levels from Miller–Orr L / Z / H = 5.350,2 / 6.633,1 / 9.198,9 million VND (aliases Rmin / Rtarget / Rupper). F01 is W1 (BN1), TH01, cell M3. UC01/UC02 figures are computed in the browser by `js/engine.js`, UC03/UC04 by `js/uc0304.js`, from the raw invoices, lots, plans and cash history in `js/data.js`; uploaded files go through the same engines. This is not a credit decision.
- **Language:** English only. Numbers use `1.200.000.000`, money `11,85B` / `619,3M` (B = billion VND, M = million VND), dates `30 Sep 2026`. Uploaded files may still use Vietnamese column headers (hidden aliases in `js/config.js`).

## Test
```bash
node tests/e2e.mjs                 # engine acceptance cases (SRS Appendix D/E) and browser checks in light, dark and 390 px mobile
                                   # needs Playwright; PW_CHROMIUM=/path/to/chrome uses an installed browser
```

## Regenerate the sample data
```bash
python3 tools/build_demo_data.py data/uc_workbook_v10.xlsx
```
The script reads the sheets of the workbook by column name (D_F01, D_sales, D_purchases, D_inventory, D_flows, D_UC03, F01_UC1, F01_UC4, Nguong), translates names to English and overwrites `js/data.js`: the raw F01 snapshot (with the 171-day cash history for Miller–Orr), the illustrative product table of UC03, the UC04 defaults, an ID → name map and the what-if presets (`SC`, three-lever change sets). It checks that its Miller–Orr L / Z / H match D_F01 within 1 VND.

## Structure
```
index.html              prototype markup with the Lilact logo and name
css/lilact-tokens.css   Lilact design tokens (brand kit, unchanged)
css/app.css             prototype layout and Lilact single-flow styles; every colour is a Lilact token
js/data.js              raw sample snapshots (generated), financing catalogue and what-if presets
js/config.js            SRS parameters (Appendix C), threshold table fob.threshold.v3 and the Miller–Orr parameters
js/engine.js            deterministic UC01–UC02 engine: snapshot, diagnosis, profiles, five-scenario forecast, Miller–Orr reserves, links, gap_request, feedback loop
js/uc0304.js            UC03 / UC04 engine: prepInput (W, TH, cell, L/Z/H, three paths), priority policy, hard checks, daily package, SafeCash, what-if on three scenarios, compare
js/ui0304.js            Solutions and What-if views, policy/catalogue panel, exports and the UC03/UC04 chat answers
js/i18n.js              English strings of the UC01/UC02 screens and chat answers
js/narrative.js         fact registry, five- and four-part answers, verifyAnswer
js/app.js               application logic and single-flow UI wiring
assets/                 Lilact logos, favicons, Inter fonts (OFL)
tools/port_prototype.py historical importer; do not rerun after the single-flow UI changes
tools/build_demo_data.py regenerates js/data.js from the workbook v10
data/uc_workbook_v10.xlsx source workbook of the sample data and of the acceptance tests
tests/e2e.mjs           Playwright tests (engine acceptance cases, SRS Appendix E E15–E40, F01 acceptance of UC03/UC04, UI in light, dark and 390 px)
tests/fixtures/         legacy sample companies X01–X03 for the SRS Appendix D cases (test only)
```
See `docs/PORTING.md` for what was changed relative to the prototype.


- Chat history, account settings and help are stored or rendered locally. Audit events remain in memory for internal traceability; the audit log is not shown in the interface. Scenarios are fixed by company defaults. Billing is a demo placeholder.
