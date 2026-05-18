import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Vite config for the multi-page static frontend. The site is an MPA
// (multi-page application): each route is its own HTML file with its
// own JS entry, and Vite produces one bundled HTML + JS pair per
// route in dist/. The right call for an educational site where each
// page is content-heavy and benefits from static SEO rendering and
// where there is no shared SPA state to coordinate across routes.
//
// The Rust to WASM backtest core lives at `crates/backtest-core/` and
// builds to `pkg/` via wasm-pack; the frontend itself does NOT import
// that WASM at runtime (the backtest runs inside the Netlify
// background function, server-side). What the frontend DOES use is
// Vite's `?raw` import syntax to inline the Rust source code at build
// time so the curriculum pages render the exact code that ships, with
// no separate copy of the source to drift out of sync.
//
// As new pages come online (quiz, strategies, philosophy, individual
// curriculum pages), add their HTML path to the `input` map below.
// Vite needs each entry listed explicitly; routes that exist in the
// filesystem but aren't in `input` are not part of the production
// bundle.
export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        home: resolve(__dirname, 'index.html'),
        learn: resolve(__dirname, 'learn/index.html'),
        learnWhyRust: resolve(__dirname, 'learn/why-rust/index.html'),
        learnThisSitesRust: resolve(
          __dirname,
          'learn/this-sites-rust/index.html'
        ),
        learnOwnership: resolve(__dirname, 'learn/ownership/index.html'),
        learnEnumsAndDispatch: resolve(
          __dirname,
          'learn/enums-and-dispatch/index.html'
        ),
        learnErrorHandling: resolve(
          __dirname,
          'learn/error-handling/index.html'
        ),
        learnWasm: resolve(__dirname, 'learn/wasm/index.html'),
        quiz: resolve(__dirname, 'quiz/index.html'),
        quizRustBasics: resolve(__dirname, 'quiz/rust-basics/index.html'),
        quizThisSitesRust: resolve(
          __dirname,
          'quiz/this-sites-rust/index.html'
        ),
        quizQuantFinance: resolve(__dirname, 'quiz/quant-finance/index.html'),
        quizRustIntermediate: resolve(
          __dirname,
          'quiz/rust-intermediate/index.html'
        ),
        quizWasmInternals: resolve(
          __dirname,
          'quiz/wasm-internals/index.html'
        ),
        compare: resolve(__dirname, 'compare/index.html'),
        scan: resolve(__dirname, 'scan/index.html'),
        strategies: resolve(__dirname, 'strategies/index.html'),
        strategyBuyAndHold: resolve(
          __dirname,
          'strategies/buy-and-hold/index.html'
        ),
        strategySmaCrossover: resolve(
          __dirname,
          'strategies/sma-crossover/index.html'
        ),
        strategyMomentum: resolve(__dirname, 'strategies/momentum/index.html'),
        strategyRsiMeanReversion: resolve(
          __dirname,
          'strategies/rsi-mean-reversion/index.html'
        ),
        strategyBreakout: resolve(__dirname, 'strategies/breakout/index.html'),
        strategyBollingerBands: resolve(
          __dirname,
          'strategies/bollinger-bands/index.html'
        ),
        philosophy: resolve(__dirname, 'philosophy/index.html'),
        philosophyOverfitting: resolve(
          __dirname,
          'philosophy/overfitting/index.html'
        ),
        philosophySurvivorshipBias: resolve(
          __dirname,
          'philosophy/survivorship-bias/index.html'
        ),
        philosophyLookaheadBias: resolve(
          __dirname,
          'philosophy/lookahead-bias/index.html'
        ),
        philosophyBacktestVsLive: resolve(
          __dirname,
          'philosophy/backtest-vs-live/index.html'
        ),
        philosophyRegimes: resolve(
          __dirname,
          'philosophy/regimes/index.html'
        ),
        disclaimer: resolve(__dirname, 'disclaimer/index.html'),
        changelog: resolve(__dirname, 'changelog/index.html'),
        glossary: resolve(__dirname, 'glossary/index.html'),
        notFound: resolve(__dirname, '404.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
});
