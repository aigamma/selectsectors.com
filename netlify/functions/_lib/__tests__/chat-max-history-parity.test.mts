import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Chat message-history cap parity. The maximum number of messages
// in a chat conversation is enforced in two places:
//
//   1. src/chat.ts                 (client-side: slice history
//      to last MAX_HISTORY messages before sending)
//   2. netlify/functions/chat.mts  (server-side: reject the
//      request with 400 if messages.length > MAX_HISTORY_MESSAGES)
//
// If these two constants diverge (say the client cap drops to 20
// while the server stays at 30, or vice versa), the user-facing
// behavior either fails to enforce the limit at all or silently
// truncates without the server seeing the trim, producing a
// confusing UX. The iter-121 chat-maxlength-parity test pinned a
// similar invariant for MAX_MESSAGE_CHARS (the per-message
// character cap); this test does the analog for the conversation-
// length cap.
//
// The two constants have different names because they live in
// different modules (the client uses MAX_HISTORY, the server
// uses MAX_HISTORY_MESSAGES); the test extracts both via regex
// and asserts the values are equal.

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const CHAT_TS_PATH = resolve(ROOT, 'src', 'chat.ts');
const CHAT_MTS_PATH = resolve(ROOT, 'netlify', 'functions', 'chat.mts');

function extractConst(source: string, name: string): number | null {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)\\s*;`);
  const m = source.match(re);
  return m ? parseInt(m[1], 10) : null;
}

const chatTsSource = readFileSync(CHAT_TS_PATH, 'utf8');
const chatMtsSource = readFileSync(CHAT_MTS_PATH, 'utf8');

const clientMax = extractConst(chatTsSource, 'MAX_HISTORY');
const serverMax = extractConst(chatMtsSource, 'MAX_HISTORY_MESSAGES');

describe('chat message-history cap parity', () => {
  it('src/chat.ts declares MAX_HISTORY', () => {
    expect(
      clientMax,
      `expected "const MAX_HISTORY = <number>;" in src/chat.ts`
    ).not.toBeNull();
  });

  it('netlify/functions/chat.mts declares MAX_HISTORY_MESSAGES', () => {
    expect(
      serverMax,
      `expected "const MAX_HISTORY_MESSAGES = <number>;" in netlify/functions/chat.mts`
    ).not.toBeNull();
  });

  it('client MAX_HISTORY equals server MAX_HISTORY_MESSAGES', () => {
    if (clientMax === null || serverMax === null) return;
    expect(
      clientMax,
      `src/chat.ts MAX_HISTORY = ${clientMax} disagrees with netlify/functions/chat.mts MAX_HISTORY_MESSAGES = ${serverMax}. Both must equal so the client's slice and the server's reject use the same threshold.`
    ).toBe(serverMax);
  });
});
