import type { Context, Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { consumeRateLimit } from './_lib/rate-limit.mts';

// Synchronous dispatcher for backtest requests. Three jobs:
//
//   1. Enforce the per-IP rate limit (2/hour and 5/day; see
//      _lib/rate-limit.mts for the rationale).
//   2. Compute the content-hash of the request body so the
//      `backtest-results` Netlify Blob store can short-circuit
//      identical re-runs.
//   3. If no cached result exists, fire the background function and
//      return 202 with the hash; the frontend polls /api/result.
//
// The rate limit is consumed BEFORE the cache check, which means a
// re-run with identical inputs still costs the user one slot. That
// is deliberate: if a malicious caller hammered with identical
// requests they would otherwise bypass the limit entirely. The
// trade-off is a legitimate user who hits refresh by accident pays
// twice; in practice that costs them one of two hourly slots, which
// is acceptable.

interface BacktestRequest {
  symbol: string;
  strategy: { name: string; params: Record<string, number> };
  dateRange: { start: string; end: string };
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('method not allowed; use POST', { status: 405 });
  }

  const ip =
    context.ip ??
    req.headers.get('x-nf-client-connection-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';

  // Parse and validate the body first so we do not consume a rate
  // limit slot for a malformed request. Bare-minimum schema check;
  // the WASM core will fail clearly on anything past this shape.
  let body: BacktestRequest;
  try {
    body = (await req.json()) as BacktestRequest;
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || !body.symbol) {
    return Response.json({ error: 'missing symbol' }, { status: 400 });
  }

  // Cache short-circuit: identical inputs hash to the same key.
  // Check BEFORE consuming the rate limit so a re-run on a cached
  // backtest does not cost a slot. Reverse the order from what the
  // header comment above describes if rate-limit-bypass via cached
  // requests becomes a problem; current trade favors UX over
  // strict cap enforcement.
  const hash = await sha256OfCanonical(body);
  const resultStore = getStore('backtest-results');
  const cached = await resultStore.get(hash, { type: 'json' });
  if (cached !== null) {
    return Response.json({
      status: 'ready',
      hash,
      cached: true,
      result: cached,
    });
  }

  // Consume one slot of each rate-limit window.
  const decision = await consumeRateLimit(ip);
  if (!decision.allowed) {
    const resetAt =
      decision.reason === 'hour-exceeded'
        ? decision.info.hourly.resetAt
        : decision.info.daily.resetAt;
    const retryAfterSec = Math.max(
      1,
      Math.ceil((resetAt - Date.now()) / 1000)
    );
    return Response.json(
      {
        error: 'rate limit exceeded',
        reason: decision.reason,
        rateLimits: decision.info,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSec) },
      }
    );
  }

  // Fire the background function. Fire-and-forget: the background
  // function returns 202 immediately and the actual work continues
  // for up to 15 minutes asynchronously. The dispatch response is
  // sent back to the client right after this POST is queued.
  const siteUrl =
    Netlify.env.get('URL') ??
    Netlify.env.get('DEPLOY_URL') ??
    'http://localhost:8888';
  await fetch(`${siteUrl}/.netlify/functions/backtest-background`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  return Response.json(
    {
      status: 'queued',
      hash,
      rateLimits: decision.info,
    },
    { status: 202 }
  );
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

export const config: Config = {
  path: '/api/backtest',
};
