# selectsectors.com architecture

## Goals

- Public-web backtesting against the SPX index, the eleven SPDR sector
  ETFs, and the eleven anchor single names that dominate the
  top-by-options-volume ranking on aigamma.com.
- Rate-limited so the public surface stays viable on a single shared
  Massive subscription rather than requiring per-user keys.
- Same Rust core as the desktop backtester; same instrument universe;
  divergent data plane and divergent agent loop.

## Surfaces

```
+---------------------------+
|       Browser (any)       |
| Vite-built static HTML/TS |
+--------------+------------+
               |
               | HTTPS, /api/*
               v
+---------------------------+
|    Netlify (this repo)    |
|                           |
| - Serverless functions    |
| - Background functions    |
| - Edge static asset CDN   |
| - Netlify Blobs           |
+--------------+------------+
               |
               | read-only via anon key
               v
+---------------------------+        +-------------------+
|  aigamma.com Supabase     | <----- |  aigamma.com EOD  |
|  (tbxhvpoyyyhbvoyefggu)   |        |  pipeline writes  |
|                           |        |  21:30 UTC Mon-Fri |
| - daily_eod (sectors      |        | (separate repo;   |
|   + anchor single names)  |        |  not this site)   |
| - daily_volatility_stats  |        +-------------------+
|   (SPX close)             |
| - spx_intraday_bars       |
|   (30-min SPX aggregates) |
+---------------------------+
```

## Request flows

### Page load

1. Browser fetches `/index.html` from Netlify CDN. Cached at the
   edge; static, small (target < 20 KB gzipped including everything
   inline).
2. `src/main.ts` mounts and fires `fetch('/api/universe')` to
   populate the sector and anchor name lists. This is a small
   synchronous serverless function backed by a hardcoded roster at
   scaffold time; later it reads from Supabase so the roster stays
   in sync with the aigamma.com options-volume-roster maintenance
   pipeline.

### Backtest run

1. User picks a symbol, a strategy, params, and a date range. The
   frontend builds the JSON request body.
2. Frontend POSTs to `/api/backtest`. That serverless function:
   - Validates the request shape.
   - Computes `sha256(canonical_json(inputs))` as the cache key.
   - If a blob already exists at `backtest-results/{hash}`, returns
     `{ status: 'ready', hash, cached: true, result }` immediately.
     Cache hits bypass the rate limit on the principle that a
     deterministic re-run of an already-completed backtest costs
     nothing on the backend.
   - Otherwise, atomically consumes one slot from each rate-limit
     window (2/hour and 5/day per IP). If either window is exhausted,
     returns `429 Too Many Requests` with a `Retry-After` header
     and the current counters in the body.
   - Fires the `backtest-background` function with the request body
     and returns `202 Accepted` with `{ status: 'queued', hash,
     rateLimits }`.
3. Frontend polls `/api/result?hash=...` every 1-2 seconds.
4. When the background function finishes, it writes the result blob
   and the next poll returns `{ status: 'ready', hash, result }`.
5. Frontend renders the result (P&L curve, Sharpe, drawdown, hit
   rate).

### Rate limit

Two rolling windows enforced together, both per-IP:

- **Hourly.** 2 backtests in any 60-minute window. Window starts on
  the first call and resets 60 minutes later, not at the top of the
  clock hour. This prevents the boundary-spike attack where a caller
  bursts at :59 and again at :00.
- **Daily.** 5 backtests in any 24-hour window. Same rolling logic.

Both apply simultaneously; whichever exhausts first wins. The
counters live in the `rate-limit` Netlify Blob store keyed by IP.
Reads and writes are atomic at the blob level, which is sufficient
for the load profile (each backtest is expected to take seconds to
minutes, so concurrent requests from a single IP are vanishingly
rare in practice).

The read-only `/api/rate-status` endpoint returns the current
counters without consuming a slot, so the frontend can render a
"you have 2 backtests left this hour" banner on page load.

### Daily data refresh

selectsectors.com does not run its own data refresh. The aigamma.com
EOD pipeline (a separate Netlify project backed by
`github.com/aigamma/aigamma.com`) pulls daily grouped bars from
Massive at 21:30 UTC weekdays and upserts into the shared Supabase
tables this site reads. Concretely:

- `eod-downsample-background.mjs` (in the aigamma.com repo) writes
  the eleven SPDR sectors and the eleven anchor single names into
  `daily_eod` from Massive Stocks Starter.
- `daily_volatility_stats` (SPX close) is derived from a downsample
  of the intraday `snapshots` table that the aigamma.com
  `ingest-background.mjs` populates every five minutes during market
  hours.
- `spx_intraday_bars` (30-minute SPX aggregates) is pulled from
  Massive Indices Starter by the same aigamma.com EOD job.

This site reads those tables read-only via the Supabase anon key.
The trade-off is a hard dependency on the aigamma.com Supabase being
healthy; the upside is one Massive subscription powering both
surfaces with no duplicated pipeline cost.

## Why Rust → WASM for the backtest engine

The math is the dominant cost of a backtest, especially for strategies
that walk every bar and compute rolling statistics. Native Rust
compiled to WebAssembly runs that math at roughly 90% of native speed
inside a Node-runtime function, vs ~20-30% if the same logic were
written in straight TypeScript with `for` loops over typed arrays.
The startup cost (loading the WASM module on cold start, ~20-50 ms) is
amortized over the ~hundreds of milliseconds to seconds the actual
backtest needs.

The crate also doubles as the source of truth for the desktop
backtester's strategy library: any strategy that lands in
`crates/backtest-core` here can be lifted into the desktop app's
`src-tauri/src/...` and re-used unchanged.

## Why no React for the frontend

The MVP surface is:

- A landing page with the universe explanation.
- A form to pick a symbol, a strategy, and params.
- A result panel with a P&L curve and three metrics.

Total: maybe 200 lines of TypeScript. React + JSX would add 40 KB of
bundle for a layer of abstraction that buys nothing at this size.
Vanilla TS with the DOM API ships in under 5 KB. If the surface grows
substantially, React (or Solid, or any of the small-bundle competitors)
can be added later behind a clean module boundary.

## Data redistribution boundaries

The same boundary aigamma.com observes applies here, scaled to the
narrower data set:

- **Allowed.** Daily OHLC bars for the 23-symbol universe, derived
  metrics (Sharpe, drawdown, hit rate), backtest result payloads,
  strategy P&L curves.
- **Forbidden.** Raw options-chain data; that lives only in the
  desktop backtester under the user's own Massive Options Developer
  key and never lands in selectsectors.com's Supabase.

The redistribution boundary is the reason this site is daily-bar
only at v1 and the desktop app is the surface for chain-level work.

## Surfaces that shipped after the scaffold

- **SelectBot floating chat panel.** Anthropic SDK + claude-sonnet-4-6
  + prompt caching + SSE streaming. Grounded system prompt covers
  Rust, this site, quant finance basics, and backtesting philosophy.
  Conversation persists to localStorage. Rate-limited at 30/hour and
  100/day per IP. The corpus is encoded directly in the system prompt
  rather than retrieved via RAG since the site's vocabulary is small
  enough that the cached system prompt covers everything the bot is
  asked about.
- **Strategy library at `/strategies/`.** Six strategies, each with a
  dedicated explainer page (`/strategies/{name}/`) pairing intuition,
  math, the exact Rust source rendered via Vite `?raw` import, and a
  Try-it deep link that pre-fills the homepage form.
- **Cross-axis exploration.** `/compare/` runs all six strategies on
  one symbol and ranks by Sharpe; `/scan/` runs one strategy across
  all 23 symbols and ranks by Sharpe. Both consume one rate-limit
  slot regardless of internal backtest count (the dispatcher fans out
  internally and the user sees a single result).
- **Curriculum.** Six Rust lessons (`/learn/`) and five philosophy
  primers (`/philosophy/`), each with breadcrumb navigation, Article/
  TechArticle JSON-LD, and OG + Twitter Card meta tags.
- **Quiz engine.** Five categories (`/quiz/`) with 36 multiple-choice
  questions, scored with localStorage progress persistence and a
  Course schema.org entry.
- **Reference pages.** `/disclaimer/`, `/changelog/`, `/glossary/`
  (alphabetical reference of every quant-finance + Rust term used on
  the site).

## Future surfaces

Open extensions that have not been implemented yet:

- **Regime conditioning.** A "run only during negative gamma" toggle
  that filters the bar set by the historical gamma regime label
  before executing the strategy. Requires syncing a regime label
  series into Supabase from aigamma.com (or independently computing
  it).
- **Custom-strategy editor.** A Rust-like DSL inside an editor on
  the site that compiles to a parameterized version of an existing
  strategy. Substantially larger lift than any of the shipped
  surfaces since it requires either a JIT compilation step or a
  pre-baked grammar with fixed primitives.
- **Parameter-sweep view.** A heatmap of Sharpe (or drawdown) across
  a 2D grid of two strategy parameters, on one symbol. The compare
  + scan endpoints suggest the right shape: a single rate-limit slot
  that fans out internally.
- **PNG OG image rasterization.** The SVG OG image renders correctly
  on most platforms but Twitter wants a raster image. Plug in
  Sharp or Resvg in a Netlify Build Plugin to rasterize once at
  build time.
