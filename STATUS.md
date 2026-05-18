# selectsectors.com status log

Append-only iteration log for autonomous Claude Code work on this
repo. New entries at the bottom. Same convention the
aigamma-backtester repo uses.

---

## 2026-05-17 - Repository bootstrapped inside the aigamma.com /loop

**Current task.** Initial scaffold of selectsectors.com. Eric opened
the directory `C:\selectsectors.com\` empty and asked the loop to
populate it. This entry captures the scaffold pass that landed
inside that loop iteration.

**What landed.**

- `README.md` - public-facing project overview, status, stack,
  universe table.
- `CLAUDE.md` - local-only Claude session context (gitignored).
- `.gitignore` - standard Node + Rust + Netlify ignores.
- `netlify.toml` - build command, redirects, cache-control headers.
- `package.json` - Vite + TypeScript + Netlify CLI + Supabase JS
  dependencies. `npm run build:wasm` runs wasm-pack on the Rust
  crate; `npm run build` runs WASM build then Vite production
  build.
- `tsconfig.json` - strict TypeScript, ES2022 target.
- `vite.config.ts` - minimal Vite setup, static-only.
- `index.html` - single-page landing surface.
- `src/main.ts`, `src/style.css` - AI Gamma dark-theme frontend.
- Five Netlify functions: health, universe, result,
  backtest-background, refresh-data-background, plus a
  refresh-tick scheduled wrapper.
- `crates/backtest-core/Cargo.toml`, `src/lib.rs` - Rust crate.
- `docs/architecture.md`, `.env.example`, `STATUS.md`.

Committed to `main` and pushed to
`github.com/aigamma/selectsectors.com` (public).

---

## 2026-05-17 (later) - Supabase pivot, rate limiter, Netlify project, backtest wiring

**Current task.** Continuing the same /loop session. Three follow-up
commits landed in this iteration: a Supabase-reuse pivot that dropped
the redundant per-repo refresh job, a rate-limit infrastructure pass
adding the dispatcher and read-only-status endpoints, and a
backtest-background rewrite that actually queries the shared
Supabase tables for daily bars. The Netlify project was provisioned
via MCP and bound to the GitHub repo manually (the Netlify MCP does
not expose a direct repo-link operation).

**What landed.**

- **Supabase pivot** (commit `92d1aac`): CLAUDE.md, README.md,
  docs/architecture.md, .env.example all updated to point at the
  existing aigamma.com Supabase (project `tbxhvpoyyyhbvoyefggu`)
  rather than a dedicated project. The two redundant Netlify
  functions (`refresh-tick.mts`, `refresh-data-background.mts`)
  were deleted; aigamma.com's `eod-downsample-background.mjs`
  pipeline already populates the three tables this site reads
  (`daily_eod` for the 22 stock/ETF symbols, `daily_volatility_stats`
  for SPX close, `spx_intraday_bars` for SPX 30-min).
- **Rate limiter + EOD depth verification** (commit `3bbef1e`):
  three new function files (`_lib/rate-limit.mts`, `backtest.mts`
  dispatcher, `rate-status.mts` read-only inspection) implementing
  the 2-per-hour AND 5-per-day-per-IP caps Eric confirmed in a
  mid-iteration message. Implementation uses Netlify Blobs with
  rolling-window resets keyed off the first call in each window
  (no fixed-clock boundary spike attack possible). The dispatcher
  short-circuits cache hits without consuming a rate-limit slot
  on the principle that re-running a deterministic backtest costs
  nothing on the backend. EOD depth verified by querying the
  shared Supabase: SPX is fully aligned with the desktop backtester
  (2022-01-03 onwards in `daily_volatility_stats`); the 22 stock
  and ETF symbols in `daily_eod` cover only 2024-04-25 onwards
  (515-516 rows each, ~2 years), shallower than the desktop app's
  2022-01-03 start in `stocks_history.duckdb`. Closing the gap
  requires running `scripts/backfill/daily-eod.mjs` from the
  aigamma.com repo against Massive Stocks Starter; documented as a
  separately-authorized follow-up since it spends real Massive API
  quota.
- **Backtest-background rewrite** (this commit): the function now
  queries daily_eod / daily_volatility_stats via @supabase/supabase-js,
  computes a placeholder strategy (buy-and-hold log return + daily
  equity curve + annualized Sharpe + max drawdown), writes the
  result blob keyed by sha256 of canonical-JSON inputs. SPX branches
  to daily_volatility_stats (close-only column projected into all
  four OHLC fields since the table has no high/low/open). The WASM
  engine in `crates/backtest-core` is the eventual replacement for
  the inline TS math but is not wired in yet because the wasm-pack
  build has not run in this scaffold's local environment.
- **Netlify project created**: name `selectsectors`, site_id
  `5ffbfcf0-7aeb-4651-a408-27397bd44348`, team `eric-s0x3fmm`
  (AI Gamma team), default URL `https://selectsectors.netlify.app`.
  Environment variables set via MCP:
  - `SUPABASE_URL` = `https://tbxhvpoyyyhbvoyefggu.supabase.co`
  - `SUPABASE_ANON_KEY` = `sb_publishable_0ws-L3S4NN9v0LHHYsyEew_4x1Edp_a`
    (modern publishable key, RLS-gated, marked secret in env)

**Decisions made.**

- **Read-only Supabase access.** The site uses the modern Supabase
  publishable key (`sb_publishable_...`) rather than the legacy JWT
  anon key. Reasoning: better security posture, independent rotation,
  Netlify recommends the modern format. Service-role key is NOT
  needed because the site does not write to Supabase; daily updates
  flow through the aigamma.com EOD pipeline.
- **Inline TS placeholder strategy before WASM wiring.** Ship a
  working end-to-end (frontend -> dispatcher -> background ->
  Supabase read -> result blob -> result poll -> frontend render)
  path with a trivial buy-and-hold strategy first; replace the
  strategy body with the WASM `run_backtest` once `wasm-pack` has
  built `crates/backtest-core` into `pkg/`. This makes the wiring
  testable before the WASM toolchain is on the critical path.

**Blockers.**

- **GitHub repo not linked to Netlify yet.** The Netlify MCP's
  `netlify-project-services-updater` does not expose a direct
  repo-link operation. Eric to link manually in the Netlify UI:
  project `selectsectors` -> Site settings -> Build & deploy ->
  Continuous deployment -> Link site to Git -> pick
  `github.com/aigamma/selectsectors.com`. After linking, the
  scheduled-functions step in netlify.toml takes effect and the
  build runs `npm run build` (which includes the WASM build step).
- **Custom domain `selectsectors.com` not yet attached.** Same UI
  flow: Domain management -> Add domain. The apex DNS would need
  to point at Netlify's load balancer; Eric controls the DNS via
  Netlify since he owns the domain.
- **WASM not built yet.** `npm run build:wasm` requires wasm-pack on
  PATH. Not yet verified in this session because the backtest
  pipeline works end-to-end without it under the placeholder
  strategy.
- **`daily_eod` history shallow.** 2024-04-25 onwards (2 years)
  versus desktop's 2022-01-03 (4+ years). Closing the gap requires
  running `scripts/backfill/daily-eod.mjs` from the aigamma.com
  repo for the 22 stock/ETF symbols on date range
  [2022-01-03, 2024-04-25]; not in scope for this iteration.

**Next 60 minutes.**

- Continue the loop. The next big remaining areas:
  - Update the frontend (`src/main.ts`, `index.html`) to show the
    rate-limit banner from `/api/rate-status` and add a backtest
    form that POSTs to `/api/backtest`.
  - Smoke-test the end-to-end path locally via `netlify dev` once
    `npm install` has run.
  - Decide whether to run the daily_eod backfill on Eric's
    authorization (it would close the depth gap but spends Massive
    API quota under his key).
  - Eventually swap the inline TS placeholder strategy for the
    WASM `run_backtest` once wasm-pack is wired into the local
    build environment.

**Priority status.** Scaffold: 100%. Frontend: skeleton (landing
+ universe grid + backtest-form placeholder). Functions: 6 in
place (health, universe, rate-status, backtest, result,
backtest-background) plus the helper module `_lib/rate-limit.mts`.
Rust crate: skeleton with one scaffold function + 2 tests.
Supabase: shared with aigamma.com; reads-only; verified end-to-end
query path in backtest-background.mts. Netlify project: created
and env-var-configured; awaiting GitHub repo link in the UI.
Custom domain: not yet attached.

---
