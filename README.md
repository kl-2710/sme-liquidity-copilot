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
  3. Financing match (one funding plan for the whole shortfall, ranked by the workbook UC03 rules)
  4. What-if and drafts (levers, then drafts awaiting approval)
- **Detail views:** Dashboard, Shortfall, What-if and Approvals open one at a time in the right-hand panel, from the "Open…" button of the matching chat answer; there is no tab bar. Audit events remain available internally but are not displayed. Company data is a single full-page Files screen.
- **Company files:** upload CSV, XLSX, XLS and DOCX files. Files stay in this browser's IndexedDB; Word files are reference-only. Recognised tables (sales and purchase invoices, inventory, 13-week plan, financial statements) are read and checked in the background; once financial statements and at least one cash-flow table are present, the company data is updated automatically and each file shows *Used in analysis* (or what is still missing). The newest file of each type wins. Deleting a file keeps the data already in use.
- **Permission tiers:** T0 Read · T1 Advise · T2 Draft · T3 Approve. Only the Approve click in the UI runs a *simulated* execution.
- **Data:** one synthetic company, F01 (CMT garment subcontractor), from the workbook `data/uc_workbook_v9.xlsx`: period 01/01–20/06/2026 (N = 171 days), cut-off 20/06/2026, 13-week horizon, opening cash 1,2 billion VND, Rmin / Rtarget / Rupper 250 / 500 / 1.000 million VND. Every figure is computed in the browser by `js/engine.js` (UC01–UC04 rules aligned with the workbook) from the raw invoices, lots and plans in `js/data.js`; uploaded files go through the same engine. This is not a credit decision.
- **Language:** English only. Numbers use `1.200.000.000`, money `11,85B` / `619,3M` (B = billion VND, M = million VND), dates `30 Sep 2026`. Uploaded files may still use Vietnamese column headers (hidden aliases in `js/config.js`).

## Test
```bash
node tests/e2e.mjs                 # engine acceptance cases (SRS Appendix D/E) and browser checks in light, dark and 390 px mobile
                                   # needs Playwright; PW_CHROMIUM=/path/to/chrome uses an installed browser
```

## Regenerate the sample data
```bash
python3 tools/build_demo_data.py data/uc_workbook_v9.xlsx
```
The script reads the sheets of the workbook by column name (D_F01, D_sales, D_purchases, D_inventory, D_flows, D_UC03, F01_UC1, F01_UC4), translates names to English and overwrites `js/data.js`: the raw F01 snapshot, the financing table of UC03, the UC04 defaults and the financing catalogue. The what-if presets (`SC`) are kept.

## Structure
```
index.html              prototype markup with the Lilact logo and name
css/lilact-tokens.css   Lilact design tokens (brand kit, unchanged)
css/app.css             prototype layout and Lilact single-flow styles; every colour is a Lilact token
js/data.js              raw sample snapshots (generated), financing catalogue and what-if presets
js/config.js            SRS v1.3 parameters (Appendix C) and threshold table tv1.threshold.v2
js/engine.js            deterministic UC01–UC04 engine: snapshot, diagnosis, profiles, five-scenario forecast, reserves, links, gap_request, financing match, what-if, feedback loop
js/i18n.js              English strings of the UC01/UC02 screens and chat answers
js/narrative.js         fact registry, five- and four-part answers, verifyAnswer
js/app.js               application logic and single-flow UI wiring (four-step chat flow unchanged)
assets/                 Lilact logos, favicons, Inter fonts (OFL)
tools/port_prototype.py historical importer; do not rerun after the single-flow UI changes
tools/build_demo_data.py regenerates js/data.js from the workbook v9
data/uc_workbook_v9.xlsx source workbook of the sample data and of the reconciliation test
tests/e2e.mjs           Playwright tests (engine acceptance cases, workbook v9 reconciliation and UI)
tests/fixtures/         legacy sample companies X01–X03 for the SRS Appendix D cases (test only)
```
See `docs/PORTING.md` for what was changed relative to the prototype.


- Chat history, account settings and help are stored or rendered locally. Audit events remain in memory for internal traceability; the audit log is not shown in the interface. Scenarios are fixed by company defaults. Billing is a demo placeholder.
