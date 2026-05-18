import type { Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

// Background function for long-running backtests. Netlify Background
// Functions get a 15-minute wall-clock execution budget instead of
// the 26-second synchronous limit, and they return 202 immediately so
// the caller is not blocked.
//
// Inputs (POST JSON body):
//   - symbols: string[]                 universe slice for this run
//   - strategy: { name: string, params: Record<string, number> }
//   - dateRange: { start: string, end: string }   ISO dates
//
// The function:
//   1. Computes a sha256 over the canonical JSON of the inputs to
//      derive the cache key.
//   2. Loads the Rust → WASM backtest core (`pkg/backtest_core.js`,
//      built by `npm run build:wasm`).
//   3. Pulls daily bars for the requested symbols from Supabase.
//   4. Runs the strategy through the WASM engine.
//   5. Writes the result JSON into the `backtest-results` Blob store
//      under the cache key. The /api/result endpoint reads it back.
//
// Scaffolding: the WASM call and the Supabase query are stubbed.
// The function shape is the contract; the body fills in as the
// crate and the data layer come online.

interface BacktestRequest {
  symbols: string[];
  strategy: { name: string; params: Record<string, number> };
  dateRange: { start: string; end: string };
}

export default async (req: Request, _context: Context): Promise<Response> => {
  let body: BacktestRequest;
  try {
    body = (await req.json()) as BacktestRequest;
  } catch {
    return new Response('invalid request body', { status: 400 });
  }

  const hash = await sha256OfCanonical(body);

  // The result blob acts as the persistence layer. If a re-run hits
  // identical inputs, the /api/result poll just returns the existing
  // blob and we never re-execute. Background functions ignore return
  // values, so the only externally visible effect is the blob write.
  const store = getStore('backtest-results');

  // Placeholder result. Replace with the WASM call and the Supabase
  // pull once the crate and the data layer are wired in.
  const result = {
    inputs: body,
    pnl: { total: 0, daily: [] },
    metrics: { sharpe: 0, maxDrawdown: 0, hitRate: 0 },
    note: 'scaffold placeholder; backtest core not yet wired in',
    computedAt: new Date().toISOString(),
  };

  await store.setJSON(hash, result);
};

// Canonical JSON keeps the cache key stable across key-order
// permutations in the input object. Without it, two POSTs with the
// same values but different key order would compute different
// hashes and re-run the backtest, defeating the cache.
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => {
    const v = (value as Record<string, unknown>)[k];
    return JSON.stringify(k) + ':' + canonicalize(v);
  });
  return '{' + parts.join(',') + '}';
}

async function sha256OfCanonical(value: unknown): Promise<string> {
  const data = new TextEncoder().encode(canonicalize(value));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
