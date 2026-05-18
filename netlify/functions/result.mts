import type { Context, Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

// Read-back endpoint for completed backtests. The flow is:
//
//   1. Frontend POSTs to /api/backtest with the strategy params.
//      That route returns a content-hash for the inputs (no
//      computation yet) and immediately fires the
//      `backtest-background` function.
//   2. The background function runs the WASM backtest, writes the
//      JSON result into the `backtest-results` Netlify Blob store
//      keyed by the same content-hash.
//   3. The frontend polls this endpoint with the hash until the
//      blob exists, then renders the result.
//
// The blob store is the only durable artifact a backtest produces.
// Results are deterministic functions of inputs, so the hash is the
// natural cache key and a re-run with identical inputs short-circuits
// to the existing blob without ever invoking the background function
// a second time.

export default async (req: Request, _context: Context): Promise<Response> => {
  const url = new URL(req.url);
  const hash = url.searchParams.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
    return Response.json(
      { error: 'missing or malformed hash; expected a 64-char hex sha256' },
      { status: 400 }
    );
  }

  const store = getStore('backtest-results');
  const blob = await store.get(hash, { type: 'json' });
  if (!blob) {
    return Response.json({ status: 'pending', hash }, { status: 202 });
  }

  return Response.json({ status: 'ready', hash, result: blob });
};

export const config: Config = {
  path: '/api/result',
};
