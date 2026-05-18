import type { Context, Config } from '@netlify/functions';
import Anthropic from '@anthropic-ai/sdk';

import { chatLimiter } from './_lib/rate-limit.mts';
import { CHAT_SYSTEM_PROMPT } from './_lib/chat-system-prompt.mts';

// /api/chat — streaming chatbot endpoint backed by the Anthropic SDK.
//
// ## Wire format
//
// Request (POST):
//   { messages: [{ role: 'user' | 'assistant', content: string }, ...] }
//
// The frontend keeps the full conversation in localStorage and posts
// the entire history on every turn. That makes the function stateless
// (the only durable state on the backend is the rate-limit counter)
// and lets the user clear their local conversation without involving
// the server.
//
// Response (SSE):
//   data: { type: 'text_delta', text: '<chunk>' }   (repeated)
//   data: { type: 'done', usage: { input_tokens, output_tokens, cache_read_input_tokens? } }
//   data: { type: 'error', message: '<msg>' }       (if anything fails mid-stream)
//
// SSE is the right wire format for streaming chat: the browser's
// EventSource API is ubiquitous, the framing is trivial, and there is
// no need for a full WebSocket because the conversation is half-
// duplex (request, then streamed response, then close).
//
// ## Prompt caching
//
// The system prompt is sent inside a content block with
// `cache_control: { type: 'ephemeral' }`. The Anthropic cache has a
// 5-minute TTL, so a conversation with messages spaced more than 5
// minutes apart pays the full system-prompt input cost on each "cold"
// message. For an active session the cache hit rate is near 100%
// after the first message and the per-message input cost drops by
// ~90%.
//
// ## Model
//
// claude-sonnet-4-6 is the right balance of cost, speed, and quality
// for an educational chatbot. claude-opus-4-7 would be smarter but
// at ~3x the cost; claude-haiku-4-5 would be cheaper but loses
// nuance on the more interesting Rust-architecture questions that
// this bot exists to answer well.

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
}

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1500;
const MAX_HISTORY_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 4000;

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('method not allowed; use POST', { status: 405 });
  }

  const ip =
    context.ip ??
    req.headers.get('x-nf-client-connection-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';

  // Parse and validate before consuming rate-limit slot so malformed
  // requests don't burn the user's hourly allowance.
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json(
      { error: 'messages must be a non-empty array' },
      { status: 400 }
    );
  }

  if (body.messages.length > MAX_HISTORY_MESSAGES) {
    return Response.json(
      {
        error: `conversation too long (max ${MAX_HISTORY_MESSAGES} messages); please clear the chat and start again`,
      },
      { status: 400 }
    );
  }

  for (const msg of body.messages) {
    if (msg.role !== 'user' && msg.role !== 'assistant') {
      return Response.json(
        { error: `invalid role: \`${String(msg.role)}\`` },
        { status: 400 }
      );
    }
    if (typeof msg.content !== 'string' || msg.content.length === 0) {
      return Response.json({ error: 'each message needs string content' }, { status: 400 });
    }
    if (msg.content.length > MAX_MESSAGE_CHARS) {
      return Response.json(
        {
          error: `message too long (max ${MAX_MESSAGE_CHARS} chars)`,
        },
        { status: 400 }
      );
    }
  }

  // Anthropic requires the last message to be from the user.
  const last = body.messages[body.messages.length - 1];
  if (last.role !== 'user') {
    return Response.json(
      { error: 'the last message must be from the user' },
      { status: 400 }
    );
  }

  const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return Response.json(
      { error: 'ANTHROPIC_API_KEY not configured on this deploy' },
      { status: 503 }
    );
  }

  // Consume one slot of the chat rate limit. Returns 429 with the
  // counters in the body so the frontend can render the precise
  // reset time.
  const decision = await chatLimiter.consume(ip);
  if (!decision.allowed) {
    const resetAt =
      decision.reason === 'hour-exceeded'
        ? decision.info.hourly.resetAt
        : decision.info.daily.resetAt;
    const retryAfterSec = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    return Response.json(
      {
        error: 'chat rate limit exceeded',
        reason: decision.reason,
        rateLimits: decision.info,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSec) },
      }
    );
  }

  const client = new Anthropic({ apiKey });

  // Build the SSE stream. The pattern is: open a ReadableStream
  // controller, kick off the SDK's async iterator inside an async IIFE,
  // and pipe each event into the controller as an SSE `data: ...` line.
  const encoder = new TextEncoder();
  const sseLine = (obj: unknown): Uint8Array =>
    encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const sdkStream = client.messages.stream({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: [
            {
              type: 'text',
              text: CHAT_SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: body.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        });

        // Surface text deltas as we get them. The SDK's iterator yields
        // all event types; we filter to content_block_delta with a
        // text_delta payload, which is the streaming text chunk.
        for await (const event of sdkStream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(
              sseLine({ type: 'text_delta', text: event.delta.text })
            );
          }
        }

        // Final usage stats. The SDK's finalMessage() resolves once the
        // stream completes; reading .usage from it gives us the input/
        // output token counts and the cache read/write counts so the
        // frontend can show "cached: yes/no" if it wants to.
        const final = await sdkStream.finalMessage();
        controller.enqueue(
          sseLine({
            type: 'done',
            usage: final.usage,
            rateLimits: decision.info,
          })
        );
        controller.close();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        controller.enqueue(sseLine({ type: 'error', message }));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};

export const config: Config = {
  path: '/api/chat',
};
