import type { Context, Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { backtestLimiter } from './_lib/rate-limit.mts';
import { sha256OfCanonical } from './_lib/canonical-json.mts';

// /api/scan: run one strategy across the entire 23-symbol universe
// and return a Sharpe-ranked table. Companion to /api/compare which
// runs all 5 strategies on one symbol; this is the inverse axis.
//
// Same dispatcher pattern as /api/backtest and /api/compare: validate,
// hash the canonical input, short-circuit on cache hit, consume one
// backtestLimiter slot, fire the background worker, return 202 with
// the hash. The scan blob is stored in the shared `backtest-results`
// store with the literal `"scan-all"` mode tag in the hash input so
// the cache key does not collide with single-backtest or comparison
// runs.
//
// Rate limit: one slot per scan, not 23. A scan that runs every
// strategy against every symbol would be a 5*23 = 115 backtest job;
// charging one slot for the whole scan is a deliberate UX favor that
// lets a user actually explore the universe without burning their
// entire hourly cap on one click. The dispatcher caps slot use to
// once per cache key, so a refresh / re-run on identical inputs is
// free.

interface ScanRequest {
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

  let body: ScanRequest;
  try {
    body = (await req.json()) as ScanRequest;
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!body || !body.strategy || !body.strategy.name || !body.dateRange) {
    return Response.json(
      { error: 'missing strategy or dateRange' },
      { status: 400 }
    );
  }

  const hashInput = { mode: 'scan-all', ...body };
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
  await fetch(`${siteUrl}/.netlify/functions/scan-background`, {
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
  path: '/api/scan',
};
