# sme-liquidity-copilot · Lilact frontend demo

AI agent for SME working-capital diagnosis, cash-flow forecasting and supply-chain finance matching.
This branch (`feature/frontend-demo`) holds the **Lilact web UI only**. It is a static app (HTML, CSS, vanilla JS) that runs on its own. The Python engines live on `feature/uc1-uc2-full`.

## Run locally
```bash
git checkout feature/frontend-demo
python3 -m http.server 8000        # or any static file server
# open http://127.0.0.1:8000/
```
No install, API key or network is needed (fonts and logos are bundled).

## Test
```bash
node --test tests/*.test.mjs       # 15 unit tests: router, W/TH axes, explanation, UC03, UC04, intake check, workflow state
node tests/e2e.mjs                 # 18 browser checks incl. 1440/820/390 px layouts (needs Playwright with Chromium)
```

## What is real and what is demo
- **Real:** UC01 and UC02 numbers are exported from the real engines (`tools/export_engine.py`, commit `a49d4c9`) on fictional test data.
- **Demo:** threshold policy, W/TH routing, UC03 matching and UC04 simulation are clearly labelled demo rules that follow the workflow documents. The financing catalogue is simulated, with fictional providers.
- **Nothing executes:** drafts need human approval in the UI, and approval is a simulated execution only.

See `docs/FRONTEND.md` for the screen-by-screen mapping and `docs/CONFLICTS.md` for unresolved spec conflicts.

## Structure
```
index.html            app shell
css/                  lilact-tokens.css + lilact.css (from the Lilact brand kit), app.css (layout only, tokens only)
assets/               logos, favicons, Inter fonts (OFL) from the brand kit
js/rules/             pure rule modules (ledger, router, classify, explain, scenario, uc03, uc04, intake check)
js/views/             one view per task (uc00…uc04, log)
js/state.js, app.js   workflow state, bundles, approvals, routing, locks
data/engine/          generated engine exports (do not edit)
data/demo/            demo policy, simulated catalogue, intake contract, sample CSV with errors
tools/                export_engine.py
tests/                node:test unit tests, Playwright e2e
```
