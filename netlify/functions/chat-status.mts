import type { Context, Config } from '@netlify/functions';
import { chatLimiter } from './_lib/rate-limit.mts';

// Read-only inspection of the per-IP chat rate-limit state. The
// frontend fetches this when the chat panel opens so it can render a
// "you have N messages left this hour" hint before the user types.
// No slot is consumed.

export default async (req: Request, context: Context): Promise<Response> => {
  const ip =
    context.ip ??
    req.headers.get('x-nf-client-connection-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  const info = await chatLimiter.read(ip);
  return Response.json({
    caps: { hour: chatLimiter.limits.hour, day: chatLimiter.limits.day },
    ...info,
  });
};

export const config: Config = {
  path: '/api/chat-status',
};
