# sme-liquidity-copilot · Lilact frontend demo

This branch (`feature/frontend-demo`) is a static web demo: HTML, CSS and vanilla JS, with no build step and no backend.

- **Flow and business logic** follow the *SME Finance Copilot AI Agent v2-4* prototype exactly; the four analysis stages continue in a single conversation, with local chat history and account settings.
- **Visual identity** comes from the Lilact brand kit: logos, colour tokens, Inter fonts and light/dark themes.
- **Not used:** the earlier Lilact 9-case routing workflow.

## Run locally
```bash
git checkout feature/frontend-demo
python3 -m http.server 8000        # or any static file server
# open http://127.0.0.1:8000/  → "Use the demo account" (or one of the other demo companies)
```

## What the demo does (from the prototype)
- **Sign in:** sign in or sign up (stored in this browser only), or use the demo account. Sign-up requires a company name, a unique 10- or 13-digit tax code, and a password with upper/lowercase letters, a digit and a symbol.
- **One account, one company:** each account analyses exactly one company, kept in the user account (account card and menu: company name, tax code). There is no company switcher.
  - Demo accounts (password `Demo@2026`) are each bound to one sample company: `demo@smecopilot.vn` → F01 Alpha Garment Subcontractor, `beta.demo@smecopilot.vn` → F02 Beta Fabric Distributor, `gamma.demo@smecopilot.vn` → F03 Gamma Packaging & Trims. Their data is fixed; imports are not available.
  - A new account starts without data: the chat asks to *Upload company data* and stays disabled until the required files are uploaded. The business name always comes from the account (change it in Settings → Account), whatever the uploaded files say.
- **Chat:** one continuous conversation. Analysis advances through the same four business stages in order:
  1. Working-capital diagnosis (DSO · DIO · DPO · CCC)
  2. Cash-flow forecast (13 weeks, shortfall windows)
  3. Financing match (ranked catalogue products)
  4. What-if and drafts (levers, then drafts awaiting approval)
- **Detailed dashboard:** tabs for Dashboard, Shortfall, What-if, Approvals. Audit events remain available internally but are not displayed. Company data is a single full-page Files screen.
- **Company files:** upload CSV, XLSX, XLS and DOCX files. Files stay in this browser's IndexedDB; Word files are reference-only. Recognised tables (sales and purchase invoices, inventory, 13-week plan, financial statements) are read and checked in the background; once financial statements and at least one cash-flow table are present, the company data is updated automatically and each file shows *Used in analysis* (or what is still missing). The newest file of each type wins. Deleting a file keeps the data already in use.
- **Permission tiers:** T0 Read · T1 Advise · T2 Draft · T3 Approve. Only the Approve click in the UI runs a *simulated* execution.
- **Data:** three synthetic companies (F01–F03), one per demo account, over a half-year analysis period (N = 183 days). Every figure is computed in the browser by `js/engine.js` (SRS v1.3 UC01/UC02 rules) from the raw invoices, lots and plans in `js/data.js`; uploaded files go through the same engine. This is not a credit decision.
- **Language:** English only. Numbers use `1.200.000.000`, money `11,85bn` / `619,3M`, dates `30 Sep 2026`. Uploaded files may still use Vietnamese column headers (hidden aliases in `js/config.js`).

## Test
```bash
node tests/e2e.mjs                 # engine acceptance cases (SRS Appendix D/E) and browser checks in light, dark and 390 px mobile
                                   # needs Playwright; PW_CHROMIUM=/path/to/chrome uses an installed browser
```

## Regenerate the sample data
```bash
python tools/build_demo_data.py <backend>/data/uc1_workbook.xlsx <backend>/data/cash_plans.csv
```
The script writes the raw snapshots of F01–F03 into `js/data.js` and keeps the financing catalogue and what-if presets.

## Structure
```
index.html              prototype markup with the Lilact logo and name
css/lilact-tokens.css   Lilact design tokens (brand kit, unchanged)
css/app.css             prototype layout and Lilact single-flow styles; every colour is a Lilact token
js/data.js              raw sample snapshots (generated), financing catalogue and what-if presets
js/config.js            SRS v1.3 parameters (Appendix C) and threshold table tv1.threshold.v2
js/engine.js            deterministic UC01/UC02 engine: snapshot, diagnosis, profiles, five-scenario forecast, reserves, links, gap_request, feedback loop
js/i18n.js              English strings of the UC01/UC02 screens and chat answers
js/narrative.js         fact registry, five- and four-part answers, verifyAnswer
js/app.js               application logic and single-flow UI wiring (four-step chat flow unchanged)
assets/                 Lilact logos, favicons, Inter fonts (OFL)
tools/port_prototype.py historical importer; do not rerun after the single-flow UI changes
tools/build_demo_data.py regenerates js/data.js from the UC01 workbook
tests/e2e.mjs           Playwright tests (engine acceptance cases and UI)
```
See `docs/PORTING.md` for what was changed relative to the prototype.


- Chat history, account settings and help are stored or rendered locally. Audit events remain in memory for internal traceability; the audit log is not shown in the interface. Scenarios are fixed by company defaults. Billing is a demo placeholder.
