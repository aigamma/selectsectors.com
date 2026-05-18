import type { Context, Config } from '@netlify/functions';
import { readRateLimit, HOUR_LIMIT, DAY_LIMIT } from './_lib/rate-limit.mts';

// Read-only inspection of the per-IP rate-limit state. The frontend
// fetches this on page load so the backtest button can render a
// "you have N backtests left this hour, M today" banner before the
// user clicks. No slot is consumed.

export default async (req: Request, context: Context): Promise<Response> => {
  const ip =
    context.ip ??
    req.headers.get('x-nf-client-connection-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  const info = await readRateLimit(ip);
  return Response.json({
    caps: { hour: HOUR_LIMIT, day: DAY_LIMIT },
    ...info,
  });
};

export const config: Config = {
  path: '/api/rate-status',
};
