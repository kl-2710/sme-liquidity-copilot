# sme-liquidity-copilot · Lilact frontend demo

This branch (`feature/frontend-demo`) is a static web demo: HTML, CSS and vanilla JS, with no build step and no backend.

- **Flow and business logic** follow the *SME Finance Copilot AI Agent v2-4* prototype exactly; the four tasks now appear as one continuous conversation with a four-step progress bar.
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
- **Chat:** one continuous conversation. Its four-step progress bar unlocks as the conversation progresses; selecting an available step scrolls to its marker and opens its dashboard tab without restarting the conversation:
  1. Working-capital diagnosis (DSO · DIO · DPO · CCC)
  2. Cash-flow forecast (13 weeks, shortfall windows)
  3. Financing match (ranked catalogue products)
  4. What-if and drafts (levers, then drafts awaiting approval)
- **Detailed dashboard:** tabs for Dashboard, Shortfall, What-if, Approvals and Log. Company data is a full-page workspace with Files and Businesses & snapshots tabs.
- **Company files:** upload CSV, XLSX, XLS and DOCX files. Files stay in this browser's IndexedDB; Word files are reference-only. Uploaded tables do not affect Copilot until reviewed and saved as a snapshot. Deleting a file keeps snapshots already created from it.
- **Permission tiers:** T0 Read · T1 Advise · T2 Draft · T3 Approve. Only the Approve click in the UI runs a *simulated* execution.
- **Data:** three synthetic companies (F01–F03) with collection scenarios. This is not a credit decision.

## Test
```bash
node tests/e2e.mjs                 # 31 browser checks in light, dark and 390 px mobile (needs Playwright + Chromium)
```

## Structure
```
index.html              prototype markup with the Lilact logo and name
css/lilact-tokens.css   Lilact design tokens (brand kit, unchanged)
css/app.css             prototype layout and Lilact single-flow styles; every colour is a Lilact token
js/data.js              prototype synthetic data and scenario presets (unchanged)
js/app.js               prototype application logic and single-flow UI wiring; business flow unchanged
assets/                 Lilact logos, favicons, Inter fonts (OFL)
tools/port_prototype.py historical importer; do not rerun after the single-flow UI changes
tests/e2e.mjs           Playwright smoke test
```
See `docs/PORTING.md` for what was changed relative to the prototype.
