# selectsectors.com

A public-web backtesting surface for the SPX index, the eleven SPDR sector
ETFs, and the eleven anchor single names that dominate the top-by-options-
volume ranking. Same instrument universe as the AI Gamma desktop
backtester (`C:\aigamma-backtester`), accessible from any browser with
rate-limiting so the public version stays viable without a Massive
Developer tier per visitor.

## Status

v0.1.2. The full content + interactive surface shipped over a multi-iteration
build session ending 2026-05-18. The site is functionally complete:

- 6-strategy WASM backtester (buy and hold, SMA crossover, momentum, RSI
  mean reversion, Donchian breakout, Bollinger Bands mean reversion) end-
  to-end through a Netlify background function, with results cached by
  content-hash and a buy-and-hold benchmark overlay on every result.
- SelectBot chatbot (Anthropic SDK with claude-sonnet-4-6 + prompt
  caching + SSE streaming) covering Rust, this site, quant finance
  basics, and the philosophy of backtesting. Floating chat panel on
  every page; conversation persists to localStorage. Rate-limited at
  30 messages/hour and 100/day per IP.
- 6 Rust curriculum lessons under `/learn/`, each anchored against the
  actual `crates/backtest-core/` source via Vite's `?raw` import (the
  curriculum cannot drift from the code): why-rust, this-sites-rust,
  ownership, enums-and-dispatch, error-handling, wasm.
- 5 quiz categories with 36 multiple-choice questions under `/quiz/`,
  with localStorage progress persistence: rust-basics, this-sites-rust,
  quant-finance, rust-intermediate, wasm-internals.
- 6 per-strategy explainer pages under `/strategies/{name}/`, each
  pairing intuition + math + the exact Rust source + a "Try it" link
  that pre-fills the backtester form via `?strategy=` and `?symbol=`
  query parameters.
- 5 philosophy primers under `/philosophy/`: overfitting, survivorship
  bias, lookahead bias, backtest vs live, regimes.
- Cross-axis exploration: `/compare/` runs all six strategies on
  one symbol; `/scan/` runs one strategy across all 23 symbols. Both
  consume one rate-limit slot regardless of the internal backtest
  count.
- Reference pages: `/disclaimer/`, `/changelog/`, `/glossary/`
  (alphabetical reference of every quant-finance + Rust term used
  across the site).
- 118 unit tests (44 Rust, 74 TypeScript across rate-limit,
  canonical-json, strategy translation, HTML-escape helpers, sitemap
  validity over 30 URLs, and internal-link checking), three-job GitHub
  Actions CI workflow that runs cargo test, Vitest, and the production
  build on every push.
- SEO surface: structured data (WebSite, Organization, Course,
  FAQPage, Article/TechArticle, BreadcrumbList), OG + Twitter Card
  meta tags on every page, SVG OG image, sitemap.xml with 30 URLs.
- 30 production HTML pages total.

Deployment dependencies: `ANTHROPIC_API_KEY` env var on the Netlify
project for the chatbot (without it `/api/chat` returns 503). All other
env vars are already set: `SUPABASE_URL`, `SUPABASE_ANON_KEY`.

## Stack

- **Frontend.** Vanilla TypeScript + Vite, served as static assets from
  Netlify CDN. Dark theme + Calibri/system sans-serif to match the
  aigamma.com visual family. No React for the MVP; the surface is small
  enough that hand-written HTML + a small amount of TS keeps the bundle
  under 20 KB and the time-to-first-paint trivially under 100 ms.
- **Backend.** Netlify Functions written in TypeScript.
  - Serverless functions for synchronous reads (cached backtest results,
    universe roster, health).
  - **Background functions** (`-background.mts` suffix, 15-minute wall
    clock, 202 Accepted immediately) for new backtest runs that exceed
    the 26-second synchronous timeout. Background functions write
    finished results into Netlify Blobs keyed by a content hash of the
    inputs; the serverless `/api/result?hash=...` endpoint reads them
    back.
  - Scheduled function that pulls daily EOD data from Massive into
    Supabase once per weekday after the close.
- **Backtest engine.** Rust crate at `crates/backtest-core` compiled to
  WebAssembly via `wasm-pack`, loaded by the background function for
  the heavy math (vectorized P&L, Sharpe ratios, drawdown curves, return
  distributions). Rust gives us native-speed scans across the 23-symbol
  daily-bar histories without paying a JS interpretation tax.
- **Data layer.** Reads from the existing aigamma.com Supabase
  project (`tbxhvpoyyyhbvoyefggu`), which already maintains the
  daily EOD universe this site needs. `daily_eod` carries the eleven
  SPDR sectors plus the eleven anchor single names, populated by
  Massive Stocks Starter every weekday at 21:30 UTC.
  `daily_volatility_stats` carries SPX close (derived from the
  intraday `snapshots` table), and `spx_intraday_bars` has 30-minute
  SPX aggregates from Massive Indices Starter. No dedicated refresh
  job for this site; the aigamma.com EOD pipeline is the upstream.
  Options-chain data is out of scope for the public site (it lives
  only in the desktop backtester behind the user's own Massive
  Options Developer key).
- **Rate limiting.** Per-IP counter in Netlify Blobs. Two rolling
  windows enforced together: 2 backtests/hour AND 5 backtests/day
  (whichever bites first). Universe and health endpoints uncapped.
  The synchronous dispatcher at `/api/backtest` checks both windows
  atomically before firing the background function; the read-only
  `/api/rate-status` endpoint lets the frontend render a "you have
  N left" banner without consuming a slot.

## EOD depth

The site reads daily bars from the same Supabase tables the desktop
`aigamma-backtester` uses, so the public-web history matches the
local-desktop history one-for-one with one outstanding gap:

| Series                           | Source                       | Range                        |
| -------------------------------- | ---------------------------- | ---------------------------- |
| SPX close                        | `daily_volatility_stats`     | 2022-01-03 to present        |
| SPX 30-minute bars               | `spx_intraday_bars`          | 2022 onwards (intraday)      |
| 11 SPDR sectors + 11 anchors EOD | `daily_eod`                  | 2024-04-25 to present        |

The `daily_eod` table starts ~2 years back; the desktop app's
`stocks_history.duckdb` runs from 2022-01-03. Closing that depth
gap requires re-running `scripts/backfill/daily-eod.mjs` (in the
aigamma.com repo) against Massive Stocks Starter from 2022-01-03
to 2024-04-25 for the 22 stock/ETF symbols. That backfill is a
separately authorized operation since it does cost real Massive
API calls.

## Universe

23 symbols total. Locked at scaffold time; future tiers may add more.

| Category              | Symbols                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| SPX index             | SPX                                                                        |
| Broad-market ETF      | SPY (proxy for SPX execution slippage)                                     |
| SPDR sector ETFs (11) | XLB, XLC, XLE, XLF, XLI, XLK, XLP, XLU, XLV, XLY, XLRE                     |
| Anchor single names   | The eleven names from `aigamma.com/options-volume-roster` (top-by-OV)      |

The eleven anchor single names match the count of the SPDR sector ETFs
intentionally so the two groups read in parallel on the UI.

## Why this exists

The AI Gamma desktop backtester (`C:\aigamma-backtester`) is a single
binary that ships under 30 MB and runs the same backtest logic locally
against a user's own Massive subscription. selectsectors.com is the
public-web cousin: rate-limited, narrower scope, lower friction for
someone who wants to evaluate a strategy idea without installing
anything. The two share a Rust core (the `backtest-core` crate is the
shared library), but diverge on the data plane and the agent loop.

## Repo layout

```
.
├── README.md
├── CLAUDE.md                       (gitignored; Claude session context)
├── STATUS.md                       (append-only iteration log)
├── .gitignore
├── .github/workflows/ci.yml        cargo test + vitest + build
├── netlify.toml
├── package.json
├── tsconfig.json
├── vite.config.ts                  multi-entry: 25 page entries
├── vitest.config.ts
│
├── index.html                      homepage (the backtester)
├── 404.html
├── public/                         static assets copied to dist/
│   ├── favicon.svg
│   ├── robots.txt
│   └── sitemap.xml
│
├── learn/                          curriculum
│   ├── index.html                  six-card landing
│   ├── why-rust/                   lesson 01
│   ├── this-sites-rust/            lesson 02 (inlines crate source)
│   ├── ownership/                  lesson 03
│   ├── enums-and-dispatch/         lesson 04
│   ├── error-handling/             lesson 05
│   └── wasm/                       lesson 06
│
├── strategies/                     one page per strategy
│   ├── index.html                  catalog
│   ├── buy-and-hold/
│   ├── sma-crossover/
│   ├── momentum/
│   ├── rsi-mean-reversion/
│   ├── breakout/
│   └── bollinger-bands/
│
├── compare/                        all 6 strategies on one symbol
├── scan/                           one strategy across all 23 symbols
│
├── philosophy/                     primers
│   ├── index.html
│   ├── overfitting/
│   ├── survivorship-bias/
│   ├── lookahead-bias/
│   ├── backtest-vs-live/
│   └── regimes/
│
├── quiz/                           interactive quizzes
│   ├── index.html
│   ├── rust-basics/
│   ├── this-sites-rust/
│   ├── quant-finance/
│   ├── rust-intermediate/
│   └── wasm-internals/
│
├── disclaimer/                     legal + risk disclosure
├── changelog/                      release log
├── glossary/                       term reference (quant + Rust)
│
├── src/                            frontend entries (one per page) + shared
│   ├── main.ts                     homepage entry
│   ├── layout.ts                   shared shell (header, footer, chat mount)
│   ├── chat.ts                     SelectBot floating chat panel
│   ├── quiz.ts                     quiz engine (mountQuiz)
│   ├── quiz-data/*.json            quiz content
│   ├── strategy-page.ts            shared strategy-page helper
│   ├── learn-*.ts                  per-lesson entries
│   ├── strategy-*.ts               per-strategy entries
│   ├── philosophy-*.ts             per-essay entries
│   ├── quiz-*.ts                   per-quiz entries
│   ├── not-found.ts                404 entry
│   └── style.css
│
├── netlify/
│   └── functions/                  TypeScript serverless + background
│       ├── _lib/
│       │   ├── rate-limit.mts      parameterized rate-limiter factory
│       │   ├── canonical-json.mts  shared cache-key derivation
│       │   ├── strategy.mts        API to Rust-serde wire-format translation
│       │   ├── chat-system-prompt.mts  SelectBot's grounded system prompt
│       │   └── __tests__/          Vitest suite
│       ├── health.mts              GET /api/health
│       ├── universe.mts            GET /api/universe
│       ├── rate-status.mts         GET /api/rate-status
│       ├── chat-status.mts         GET /api/chat-status
│       ├── backtest.mts            POST /api/backtest (rate-limited)
│       ├── compare.mts             POST /api/compare (all strategies, 1 symbol)
│       ├── scan.mts                POST /api/scan (1 strategy, all 23 symbols)
│       ├── result.mts              GET /api/result?hash=
│       ├── chat.mts                POST /api/chat (SSE streaming)
│       ├── backtest-background.mts 15-min wall-clock WASM runner
│       ├── compare-background.mts  compare dispatcher
│       └── scan-background.mts     scan dispatcher
│
├── crates/
│   └── backtest-core/              Rust to WASM
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs              WASM entry points
│           ├── bars.rs             DailyBar
│           ├── metrics.rs          Sharpe, drawdown, hit rate, CAGR
│           ├── error.rs            BacktestError enum
│           └── strategies/         one file per strategy
│               ├── mod.rs          StrategyKind dispatch
│               ├── buy_and_hold.rs
│               ├── sma_crossover.rs
│               ├── momentum.rs
│               ├── rsi_meanreversion.rs
│               ├── breakout.rs
│               └── bollinger_bands.rs
│
└── docs/
    └── architecture.md
```

## Local development

Requires Node 22+, Rust 1.79+, `wasm-pack`, and the Netlify CLI.

```sh
git clone https://github.com/aigamma/selectsectors.com.git
cd selectsectors.com
npm install

# wasm-pack: install via cargo, or download the prebuilt binary if
# `cargo install` hits a transient registry-cache issue.
cargo install wasm-pack
# or:
# curl -L https://github.com/rustwasm/wasm-pack/releases/download/v0.13.1/wasm-pack-v0.13.1-x86_64-unknown-linux-musl.tar.gz | tar -xz

npm run build:wasm              # builds crates/backtest-core → pkg/
npm run typecheck               # TypeScript strict checks
npm run test                    # Vitest on rate-limit + canonical-json
cargo test --manifest-path crates/backtest-core/Cargo.toml --lib

netlify dev                     # frontend on :8888, functions on :8888/api/*
```

Environment variables (see `.env.example`):

- `SUPABASE_URL` — the shared aigamma.com Supabase project URL
  (committed in `.env.example` since it's a public domain).
- `SUPABASE_ANON_KEY` — the read-only publishable key. Read-only
  posture; RLS gates any write paths.
- `ANTHROPIC_API_KEY` — required for `/api/chat`. Without it, the
  chat panel still renders but every send returns a 503. Set on the
  Netlify project under Site settings -> Environment variables.

## License

MIT.
