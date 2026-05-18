import type { Context, Config } from '@netlify/functions';
import { chatLimiter } from './_lib/rate-limit.mts';

// Read-only inspection of the per-IP chat rate-limit state. The
// frontend fetches this when the chat panel opens so it can render a
// "you have N messages left this hour" hint before the user types.
// No slot is consumed.
//
// The `available` field reports whether the ANTHROPIC_API_KEY env var
// is set on this deploy. If it isn't, /api/chat returns 503 on every
// send; the frontend uses this flag to disable the send button + show
// a clear "chat is unavailable on this deploy" message BEFORE the
// user types and submits, rather than letting them write a message
// and only then discover it can't be delivered.

export default async (req: Request, context: Context): Promise<Response> => {
  const ip =
    context.ip ??
    req.headers.get('x-nf-client-connection-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  const info = await chatLimiter.read(ip);
  return Response.json({
    caps: { hour: chatLimiter.limits.hour, day: chatLimiter.limits.day },
    available: Boolean(Netlify.env.get('ANTHROPIC_API_KEY')),
    ...info,
  });
};

export const config: Config = {
  path: '/api/chat-status',
};
