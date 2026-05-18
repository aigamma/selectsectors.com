import type { Context, Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { backtestLimiter } from './_lib/rate-limit.mts';
import { sha256OfCanonical } from './_lib/canonical-json.mts';

// Synchronous dispatcher for the strategy-comparison endpoint at
// /api/compare. Runs the same five-strategy comparison shape as the
// /strategies/ catalog but in a single rate-limit slot rather than
// the five slots a user would burn running them one-by-one.
//
// ## Why this endpoint exists
//
// The single-strategy /api/backtest endpoint is the primary surface,
// but a user comparing strategy ideas wants to see all five running
// against the same bar series side-by-side. Without this endpoint
// they would burn five rate-limit slots (their entire hourly cap and
// then some) to get the same answer. The comparison endpoint accepts
// just {symbol, dateRange}, fires the background function to run all
// five strategies in one pass, and consumes one rate-limit slot.
//
// The hash-cache short-circuits identical re-runs the same way as the
// single-backtest endpoint. The blob store is shared
// (`backtest-results`); the hash includes the literal `"compare-all"`
// tag in the canonical input so a comparison and a single-strategy
// run with the same symbol+dateRange don't collide.

interface CompareRequest {
  symbol: string;
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

  let body: CompareRequest;
  try {
    body = (await req.json()) as CompareRequest;
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || !body.symbol || !body.dateRange) {
    return Response.json(
      { error: 'missing symbol or dateRange' },
      { status: 400 }
    );
  }

  // Tag the canonical-hash input with the literal "compare-all" string
  // so a comparison run and a single-strategy run with the same symbol
  // and date range produce different cache keys.
  const hashInput = { mode: 'compare-all', ...body };
  const hash = await sha256OfCanonical(hashInput);

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

  const decision = await backtestLimiter.consume(ip);
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

  const siteUrl =
    Netlify.env.get('URL') ??
    Netlify.env.get('DEPLOY_URL') ??
    'http://localhost:8888';
  await fetch(`${siteUrl}/.netlify/functions/compare-background`, {
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

export const config: Config = {
  path: '/api/compare',
};
