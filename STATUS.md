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
- `tsconfig.json` - strict TypeScript, ES2022 target, includes both
  `src/` (frontend) and `netlify/` (functions).
- `vite.config.ts` - minimal Vite setup, static-only.
- `index.html` - single-page landing surface with header, universe
  grid (sectors + anchors columns), backtest form placeholder,
  footer.
- `src/main.ts` - frontend entry that fetches `/api/universe` and
  populates the sector and anchor lists.
- `src/style.css` - AI Gamma design tokens (dark theme, Calibri,
  four-color palette) matching the rest of the brand family.
- `netlify/functions/health.mts` - smoke-test endpoint at `/api/health`.
- `netlify/functions/universe.mts` - returns the 23-symbol roster.
- `netlify/functions/result.mts` - polled by the frontend for
  completed backtest results from the `backtest-results` Blob
  store.
- `netlify/functions/backtest-background.mts` - 15-minute wall-clock
  background function that runs the WASM backtest core and writes
  the result blob.
- `netlify/functions/refresh-data-background.mts` - daily EOD
  refresh that pulls from Massive into Supabase. Stubbed.
- `netlify/functions/refresh-tick.mts` - scheduled wrapper that
  fires at 21:30 UTC weekdays and dispatches the background
  refresh.
- `crates/backtest-core/Cargo.toml` - Rust crate manifest, configured
  for wasm-pack output. `opt-level = "s"` for small WASM size.
- `crates/backtest-core/src/lib.rs` - `run_backtest` entry point
  exposing the Rust ↔ JS boundary via `serde-wasm-bindgen`. Two
  unit tests pin `compute_total_return` math on the empty and
  two-bar cases.
- `docs/architecture.md` - full architectural reference: request
  flows for page load, backtest run, and daily refresh; the Rust ↔
  WASM rationale; the "no React" rationale; data redistribution
  boundaries (forbidden: raw options chains); future surfaces.
- `.env.example` - documents the four required env vars
  (MASSIVE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY,
  SUPABASE_ANON_KEY) without committing actual values.
- `STATUS.md` (this file) - iteration log.

**Decisions made (locked in at scaffold).**

- **Stack.** Vanilla TypeScript + Vite frontend; Netlify Functions
  (TypeScript) for serverless + background; Rust crate compiled to
  WASM for the backtest math; own Supabase project for daily bars.
- **No React for v1.** The MVP surface is small enough that
  vanilla TS + DOM API ships under 5 KB and React would add 40 KB
  for no architectural benefit. Re-evaluate if the surface grows.
- **Background functions for backtests.** Any backtest that could
  exceed 26 seconds runs through `backtest-background.mts` and
  writes a result blob; the frontend polls `/api/result?hash=`.
- **Netlify Blobs for results, not a Supabase table.** Backtest
  results are deterministic on inputs, so the natural key is
  `sha256(canonical_json(inputs))` and the Blob store is the
  natural fit. Supabase is reserved for time-series.
- **Rate limit.** 3 backtests/min/IP. Universe and health endpoints
  uncapped. Counter lives in Netlify Blobs.
- **Universe pinned at 23 symbols.** SPX + SPY + 11 SPDR sectors +
  11 anchor single names from the aigamma.com options-volume
  roster. Same set the desktop backtester uses.
- **Daily refresh at 21:30 UTC weekdays.** Aligns with the
  aigamma.com `eod-downsample-background.mjs` cadence so both
  pipelines see the same trading-day-complete snapshot from
  Massive's grouped endpoints.
- **No em dashes.** Site-wide AI Gamma brand convention.
- **Brand.** "AI Gamma" everywhere; never "AI Gamma LLC."

**Blockers.**

- No Supabase project for selectsectors.com has been created yet.
  The .env.example documents the variables, but the actual project
  needs to be stood up before the refresh-data-background function
  can write anything.
- No GitHub remote yet. The repo is local-only at scaffold time.
- The eleven anchor single names are hardcoded in
  `netlify/functions/universe.mts` (NVDA, TSLA, AAPL, AMD, AMZN,
  META, MSFT, GOOGL, PLTR, COIN, SMCI). The canonical source is
  the aigamma.com options-volume-roster; sync that into Supabase
  once the project exists rather than maintaining two copies.

**Next 60 minutes.**

- Initialize git and make the first commit.
- Create the Supabase project under the AI Gamma org.
- Document the schema for `daily_bars` in
  `docs/architecture.md` (already covered at the request-flow
  level, but no SQL yet).
- Fill in the actual Massive pull in
  `refresh-data-background.mts` so a manual invocation populates
  one trading day for the 23-symbol universe.
- Wire `backtest-background.mts` to actually call the WASM module
  with bars pulled from Supabase, end-to-end smoke test.

**Priority status.** Scaffold: 100%. Frontend: skeleton (landing,
universe grid, backtest placeholder). Functions: five stubs in
place (health, universe, result, backtest-background,
refresh-data-background) plus the scheduled wrapper
(refresh-tick). Rust crate: skeleton with one scaffold
function (`run_backtest`) and two tests. Supabase: not yet
provisioned. Massive integration: scaffolded only. Backtest
core: scaffolded only.

---
