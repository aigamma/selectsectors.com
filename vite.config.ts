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
        quiz: resolve(__dirname, 'quiz/index.html'),
        quizRustBasics: resolve(__dirname, 'quiz/rust-basics/index.html'),
        quizThisSitesRust: resolve(
          __dirname,
          'quiz/this-sites-rust/index.html'
        ),
        quizQuantFinance: resolve(__dirname, 'quiz/quant-finance/index.html'),
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
        notFound: resolve(__dirname, '404.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
});
