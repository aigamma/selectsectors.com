import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Triple parity for the chat message-length cap. The value 4000
// appears as `MAX_MESSAGE_CHARS` in three places:
//
//   1. src/chat.ts                 (frontend client-side cap)
//   2. netlify/functions/chat.mts  (server-side cap)
//   3. src/layout.ts               (HTML textarea maxlength attr)
//
// All three must agree. If the frontend client cap is 4000 but the
// HTML maxlength is 3000, the textarea silently truncates user
// input to 3000 chars; the chat.ts cap check sees 3000 (< 4000) and
// submits successfully. If the server cap is 3000 but the client
// is 4000, the user sees a server-side 400 ("conversation too
// long") after typing. All three must match for the UX to be
// coherent.
//
// The test reads each of the three files, extracts the value via
// regex, and asserts equality.

const ROOT = resolve(__dirname, '..', '..', '..', '..');

interface Source {
  label: string;
  path: string;
  pattern: RegExp;
}

const SOURCES: Source[] = [
  {
    label: 'chat.ts MAX_MESSAGE_CHARS',
    path: resolve(ROOT, 'src', 'chat.ts'),
    pattern: /const MAX_MESSAGE_CHARS\s*=\s*(\d+);/,
  },
  {
    label: 'chat.mts MAX_MESSAGE_CHARS',
    path: resolve(ROOT, 'netlify', 'functions', 'chat.mts'),
    pattern: /const MAX_MESSAGE_CHARS\s*=\s*(\d+);/,
  },
  {
    label: 'layout.ts textarea maxlength',
    path: resolve(ROOT, 'src', 'layout.ts'),
    pattern: /maxlength="(\d+)"/,
  },
];

function extract(source: Source): number {
  const content = readFileSync(source.path, 'utf8');
  const m = content.match(source.pattern);
  if (!m) {
    throw new Error(`pattern not found in ${source.label} (${source.path})`);
  }
  return parseInt(m[1], 10);
}

describe('chat message-length cap parity', () => {
  const values = SOURCES.map((s) => ({ label: s.label, value: extract(s) }));

  it('all three sources have a numeric value', () => {
    for (const { label, value } of values) {
      expect(value, `${label} should be a finite number`).toBeGreaterThan(0);
    }
  });

  it('all three sources agree on the cap', () => {
    const unique = new Set(values.map((v) => v.value));
    expect(
      unique.size,
      `chat message-length cap diverges: ${values
        .map((v) => `${v.label}=${v.value}`)
        .join(', ')}`
    ).toBe(1);
  });
});
