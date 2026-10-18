# sme-liquidity-copilot · Lilact frontend demo

This branch (`feature/frontend-demo`) is a static web demo: HTML, CSS and vanilla JS, with no build step and no backend.

- **Flow and business logic** follow the *SME Finance Copilot AI Agent v2-4* prototype exactly.
- **Visual identity** comes from the Lilact brand kit: logos, colour tokens, Inter fonts and light/dark themes.
- **Not used:** the earlier Lilact 9-case routing workflow.

## Run locally
```bash
git checkout feature/frontend-demo
python3 -m http.server 8000        # or any static file server
# open http://127.0.0.1:8000/  → "Use the demo account"
```

## What the demo does (from the prototype)
- **Sign in:** sign in or sign up (stored in this browser only), or use the demo account.
- **Chat:** a chat copilot with four tasks that unlock as the conversation progresses:
  1. Working-capital diagnosis (DSO · DIO · DPO · CCC)
  2. Cash-flow forecast (13 weeks, shortfall windows)
  3. Financing match (ranked catalogue products)
  4. What-if and drafts (levers, then drafts awaiting approval)
- **Detailed dashboard:** tabs for Dashboard, Shortfall, What-if, Approvals, Log and Data (upload your own CSVs).
- **Permission tiers:** T0 Read · T1 Advise · T2 Draft · T3 Approve. Only the Approve click in the UI runs a *simulated* execution.
- **Data:** three synthetic companies (F01–F03) with collection scenarios. This is not a credit decision.

## Test
```bash
node tests/e2e.mjs                 # 21 browser checks in light, dark and 390 px mobile (needs Playwright + Chromium)
```

## Structure
```
index.html              prototype markup with the Lilact logo and name
css/lilact-tokens.css   Lilact design tokens (brand kit, unchanged)
css/app.css             prototype layout; every colour is a Lilact token (generated)
js/data.js              prototype synthetic data and scenario presets (unchanged)
js/app.js               prototype application logic (generated; flow unchanged)
assets/                 Lilact logos, favicons, Inter fonts (OFL)
tools/port_prototype.py regenerates css/app.css, js/*.js and index.html from the prototype HTML
tests/e2e.mjs           Playwright smoke test
```
See `docs/PORTING.md` for what was changed relative to the prototype.
