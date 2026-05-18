import type { Context, Config } from '@netlify/functions';

import { STRATEGY_DEFAULTS } from './_lib/strategy.mts';
import { backtestLimiter, chatLimiter } from './_lib/rate-limit.mts';

// Operational health endpoint. Reports the deploy's commit + deploy
// id (from the Netlify-set env vars), the running site version (from
// the package.json's version field, baked in at function-bundle time),
// the list of strategies the WASM engine knows about, and the
// configured rate-limit caps for both the backtest and chat
// endpoints.
//
// Useful as the first endpoint to hit when verifying a deploy, as a
// machine-readable catalog for any external monitor that wants to
// check the deployed feature set, and as a sanity check that the
// shared _lib/strategy.mts and _lib/rate-limit.mts modules are wired
// into the function bundle correctly (a refactor that accidentally
// dropped one of those imports would show up here as a missing field
// in the response).

// Hardcoded version string. Bumped in the package.json bump commit and
// here in lockstep; the redundancy is intentional so the function can
// report the version without reading package.json at runtime (the
// function-bundle path that would require esbuild to inline the file).
const VERSION = '0.1.3';

export default async (_req: Request, _context: Context): Promise<Response> => {
  const commit = Netlify.env.get('COMMIT_REF') ?? 'unknown';
  const deployId = Netlify.env.get('DEPLOY_ID') ?? 'unknown';
  return Response.json({
    status: 'ok',
    site: 'selectsectors.com',
    version: VERSION,
    commit,
    deployId,
    timestamp: new Date().toISOString(),
    strategies: Object.keys(STRATEGY_DEFAULTS),
    rateLimits: {
      backtest: backtestLimiter.limits,
      chat: chatLimiter.limits,
    },
  });
};

export const config: Config = {
  path: '/api/health',
};
