# Pension & Salary Planner — Cloudflare Worker rebuild

**Date:** 2026-07-11
**Source:** `C:\docker\net-core\web-projects\finance` (static HTML/JS/CSS app)
**Target:** Cloudflare Worker `pension-planner` in this repo, deployed to the account in `.env`.

## Goal

Rebuild the UK pension & salary planner as a single Cloudflare Worker: static
assets served from the edge, plus a server-side API route that proxies the
"Analyse with Claude" feature so the Anthropic API key never reaches the
browser. Fix the bugs found in the original, refresh the tax data to the
2026-27 tax year, and redesign the UI.

## Architecture

```
wrangler.jsonc          worker config (assets binding + main module)
src/worker.js           fetch handler: POST /api/analyse → Anthropic API (streams)
public/
  index.html            single page
  styles.css            statement-style design, light + dark themes
  js/tax-data.js        TAX_CONFIG for 2026-27 (pure data, ES module)
  js/engine.js          pure calculation functions (ES module, unit-tested)
  js/charts.js          Chart.js setup/update, theme-aware
  js/app.js             DOM wiring, scenarios, modals, streaming chat
test/engine.test.js     node --test unit tests against public/js/engine.js
```

- The calculation engine stays **client-side**: it is a calculator, inputs are
  sensitive, and nothing needs a round trip. Only the optional AI analysis
  leaves the browser.
- `ANTHROPIC_API_KEY` is a Worker secret. `/api/analyse` calls
  `claude-opus-4-8` via `@anthropic-ai/sdk` and streams the response to the
  client as JSONL events.
- Scenarios and last-used form values persist in `localStorage` (unchanged
  from the original — no accounts, no server state).

## Tax data (2026-27, verified 2026-07-11)

- Personal allowance £12,570, tapered £1 per £2 above £100,000.
- Scotland: Starter 19% to £16,537; Basic 20% to £29,526; Intermediate 21% to
  £43,662; Higher 42% to £75,000; Advanced 45% to £125,140; Top 48%.
  (Sources: gov.scot 2026-27 rates and bands.)
- Rest of UK: Basic 20% to £50,270; Higher 40% to £125,140; Additional 45%.
- Employee NI: 8% £12,570–£50,270; 2% above.
- Employer NI: 15% above £5,000.
- Full new state pension £241.30/week = £12,547.60/yr (4.8% triple lock,
  April 2026); 35 qualifying years for full, minimum 10.
- Annual allowance £60,000, tapered above £260,000 adjusted income to a
  £10,000 floor.

Band maths: bands are sized relative to the standard PA (£12,570) and applied
over taxable income (gross − actual PA), which matches HMRC behaviour when the
PA is tapered.

## Bugs fixed from the original

1. `calculateRetirementIncome` claimed "net wealth = pot + savings − mortgage"
   but never subtracted the mortgage. Now subtracted (and shown in the UI).
2. `setGrowthRate` referenced the global `event`, crashing when invoked from
   `loadScenario`. Now takes the button element explicitly.
3. Duplicate `id="optimizationContent"` (panel + modal) meant the modal never
   populated. Single ID now.
4. The tax-optimisation engine existed but no button ever invoked it. Now a
   visible "Tax optimisation" action.
5. Relief-at-source higher-rate relief was applied to the current-year summary
   but ignored in the year-by-year projection. Now consistent.
6. Scenario names were injected into `innerHTML` unescaped (XSS via saved
   name). Escaped now.
7. Outdated figures: state pension £11,502 (2024-25), NI thresholds from
   weekly rounding, employer NI threshold £4,992. All updated.

## UI design

Direction: a UK pension statement, beautifully set. Cool paper surface, ink
text, one deep sterling-green accent, ledger double-rules as section dividers,
tabular numerals for all figures. Display face: Newsreader (masthead + hero
figures); everything else system sans. Dark theme = "evening ledger" using the
dataviz dark chrome. Signature element: the statement strip — a masthead band
with the projected pot as the hero figure over a double rule, with the
age→retirement timeline beneath.

Charts follow the dataviz skill: validated categorical palette (blue/aqua/
yellow, dark-stepped variants for dark mode), 2px lines, stacked bars with 2px
surface gaps, hairline grids, tooltips, legends.

Interaction changes: auto-recalculate (debounced) replaces the Calculate
button; region is a segmented Scotland / rest-of-UK control; theme toggle
(system default); modals close on Esc/backdrop and are aria-labelled.

## AI analysis

`POST /api/analyse` accepts `{plan, question?, history?}` where `plan` is the
computed summary. The worker builds the prompt server-side, calls
`claude-opus-4-8` with adaptive thinking, and streams text deltas. The client
renders markdown and allows follow-up questions in the same conversation.

## Testing

- `npm test` → `node --test` over the pure engine (income tax both regions,
  PA taper, NI, state pension, salary sacrifice vs RAS vs net pay, projection
  maths, annual allowance taper, mortgage subtraction).
- `wrangler dev` smoke test: page loads, engine runs, API route responds
  (401-equivalent error without secret is acceptable locally).

## Out of scope

- Accounts / server-side persistence, DB bindings.
- Pension carry-forward, MPAA, lifetime allowance modelling.
- The original's `/api/mcp/chat` MCP proxy (replaced by `/api/analyse`).
