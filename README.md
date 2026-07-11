# Pension & Salary Planner

UK pension and salary planner running as a single Cloudflare Worker. Static
assets are served from the edge; an optional `POST /api/analyse` route streams
a Claude-generated review of your plan (the Anthropic API key stays server-side
as a Worker secret).

Rebuilt from the original static app with 2026-27 tax data, bug fixes, and a
redesigned UI — see `docs/superpowers/specs/2026-07-11-pension-planner-worker-design.md`.

## Features

- Income tax (Scotland and rest-of-UK bands), NI, personal-allowance taper
- Salary sacrifice / relief at source / net pay contribution modelling
- Year-by-year pot projection with salary growth and today's-money view
- State pension, annual allowance (with taper) checks
- Tax optimisation suggestions per band boundary
- Saved scenarios + comparison (localStorage), export/print summary
- Streaming Claude analysis with follow-up questions
- Light/dark themes

## Develop

```sh
npm install
npm test          # engine unit tests (node --test)
npm run dev       # wrangler dev on http://localhost:8787
```

For local AI analysis, put `ANTHROPIC_API_KEY=sk-ant-...` in `.dev.vars`
(gitignored).

## Deploy

```sh
npm run deploy
npx wrangler secret put ANTHROPIC_API_KEY
```

## Disclaimers

Estimates for illustration only — not financial advice. Tax figures are for
the 2026-27 UK tax year.
