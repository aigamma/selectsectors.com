import { defineConfig } from 'vite';

// Vite config for the static frontend. The Rust → WASM backtest core
// lives at `crates/backtest-core/` and builds to `pkg/` via wasm-pack;
// the frontend itself does NOT import that WASM (the backtest runs
// inside the Netlify background function, server-side). The WASM is
// only present in the repo as an artifact the function bundles at
// deploy time.
//
// Two reasons to keep the frontend small: cold-start time on a fresh
// page load is dominated by JS parse + execute on weak hardware, and
// a minimal frontend means the entire surface ships under 20 KB
// gzipped so the static CDN cache returns the page in under 100 ms
// to a first-time visitor anywhere in the world.
export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: {
      input: 'index.html',
    },
  },
  server: {
    port: 5173,
  },
});
