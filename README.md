# selectsectors.com

A public-web backtesting surface for the SPX index, the eleven SPDR sector
ETFs, and the eleven anchor single names that dominate the top-by-options-
volume ranking. Same instrument universe as the AI Gamma desktop
backtester (`C:\aigamma-backtester`), accessible from any browser with
rate-limiting so the public version stays viable without a Massive
Developer tier per visitor.

## Status

Pre-1.0 scaffold. The repo is greenfield as of 2026-05-17.

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
├── CLAUDE.md                  (gitignored; Claude session context)
├── .gitignore
├── netlify.toml
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/                       frontend entry
│   ├── main.ts
│   └── style.css
├── netlify/
│   └── functions/             TypeScript serverless + background functions
│       ├── _lib/
│       │   └── rate-limit.mts      Netlify Blobs rate-limit helper
│       ├── health.mts              GET /api/health
│       ├── universe.mts            GET /api/universe
│       ├── rate-status.mts         GET /api/rate-status (read-only)
│       ├── backtest.mts            POST /api/backtest (rate-limited dispatch)
│       ├── result.mts              GET /api/result?hash=
│       └── backtest-background.mts 15-minute wall-clock worker
├── crates/
│   └── backtest-core/         Rust → WASM
│       ├── Cargo.toml
│       └── src/
│           └── lib.rs
└── docs/
    └── architecture.md
```

## Local development

Requires Node 20+, Rust 1.79+, `wasm-pack`, and the Netlify CLI.

```sh
git clone https://github.com/aigamma/selectsectors.com.git
cd selectsectors.com
npm install
cargo install wasm-pack         # one-time
npm run build:wasm              # builds crates/backtest-core → pkg/
netlify dev                     # frontend on :8888, functions on :8888/api/*
```

## License

MIT.
