# Porting notes: SME Finance Copilot v2-4 → Lilact identity

**Source:** `SME_Finance_Copilot_AI_Agent_v2-4.html`, a single-file prototype.
**Importer:** `tools/port_prototype.py` is retained as a historical porting utility. **Do not rerun it:** it regenerates `index.html`, `css/app.css` and application JavaScript and would overwrite the single-flow interface changes. This demo has no build step.

## Single-flow interface
- The four task navigation modules have been replaced by one continuous conversation with a four-step progress bar.
- Step status is presented from the existing `S.stage` and `unlockedTask()` state. Selecting an available step scrolls to its conversation divider (or the welcome hero for Step 1 before its first divider exists) and opens its dashboard tab; it does not change the stage or rerun calculations.
- Advancing the conversation adds one divider per reached step. New chat and company changes clear the dividers with the conversation.
- Only the interface and its browser tests changed for this presentation. Routing, calculations, data, and the order of the four business steps are preserved.

## Kept exactly as in the prototype
- **Flow and business behaviour:** all screens and their order, the auth flow, chat routing and intents, task unlocking, tool calls and tiers, the calculations, the financing catalogue and ranking, the what-if levers, drafts, approval and rejection dialogs, the audit log, data upload, settings and pins.
- **Data:** the synthetic data (`DATA`) and the scenario presets (`SC`).
- **Language:** English UI text.

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
- **Mixed-language strings:** a few leftover Vietnamese strings in an otherwise English UI were translated: "Mọi draft(s) phải được you duyệt…", "…để đưa on hàng chờ, then duyệt…", the "Ra" (out) label in the chart tooltip, the "before / sau" heading and the "Xong" button.
- **Missing function:** `botNote()` was called after an approval, and on chat errors, but was never defined. That threw a ReferenceError and the confirmation message never appeared in the chat. It is now defined with the prototype's own `newBot`, `say` and `suggestRow` helpers.
