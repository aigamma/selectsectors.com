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
+---------------------------+        +-------------------+
|    Netlify (this repo)    | <----- | Netlify scheduler |
|                           |        | 21:30 UTC, Mon-Fri |
| - Serverless functions    |        +-------------------+
| - Background functions    |
| - Edge static asset CDN   |
| - Netlify Blobs           |        +-------------------+
+--------------+------------+ <----- |   Massive API     |
               |                     | grouped/stocks    |
               | reads/writes        | grouped/indices   |
               v                     +-------------------+
+---------------------------+
|   Supabase (own project)  |
|                           |
| - daily_bars              |
| - rate_limit (TBD)        |
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
   - Checks the per-IP rate limit in Netlify Blobs (3 backtests/min/IP).
   - Computes `sha256(canonical_json(inputs))` as the cache key.
   - If a blob already exists at `backtest-results/{hash}`, returns
     `{ status: 'ready', hash, result }` immediately.
   - Otherwise, returns `{ status: 'queued', hash }` and fires the
     `backtest-background` function with the request body.
3. Frontend polls `/api/result?hash=...` every 1-2 seconds.
4. When the background function finishes, it writes the result blob
   and the next poll returns `{ status: 'ready', hash, result }`.
5. Frontend renders the result (P&L curve, Sharpe, drawdown, hit
   rate).

### Daily data refresh

1. Netlify scheduled function `refresh-tick.mts` fires at 21:30 UTC
   weekdays. The schedule was picked to align with the aigamma.com
   `eod-downsample-background.mjs` cadence so both pipelines see the
   same "trading day complete" snapshot from Massive's grouped
   endpoints.
2. `refresh-tick` makes a fire-and-forget POST to
   `/.netlify/functions/refresh-data-background` and returns inside
   the 30-second scheduled-function budget.
3. `refresh-data-background` pulls the most recent grouped-bars
   payload for stocks and indices from Massive, filters to the
   23-symbol universe, and upserts into Supabase's `daily_bars`
   table. The full pull is expected to take well under a minute even
   on a slow link.

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

## Future surfaces

Not in scope for the scaffold but worth marking as natural extensions:

- **Per-page chatbot.** Same RAG layer the aigamma.com site uses, but
  with a smaller corpus indexed against the strategy library and the
  results explainer prose.
- **Strategy library page.** A grid of all parameterized strategies
  with one-line descriptions, default param choices, and example
  result thumbnails.
- **Cross-symbol comparison.** Run the same strategy across all 23
  symbols simultaneously and rank by Sharpe or drawdown.
- **Regime conditioning.** A "run only during negative gamma" toggle
  that filters the bar set by the historical gamma regime label
  before executing the strategy. Requires syncing a regime label
  series into Supabase from aigamma.com (or independently computing
  it).
