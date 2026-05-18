import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// SelectBot topic count parity. The chat-system-prompt's "Topic
// scope" section enumerates the topics SelectBot answers questions
// about as a numbered list ("1. **Rust**, ...", "2. **selectsectors
// itself**, ...", "3. **Quant finance basics**, ...", "4. **Philosophy
// of backtesting**, ..."). The same scope claim appears in plain
// prose as "exactly four topics" / "these four topics" / "four
// topics in scope" inside the prompt itself, and as "four topics"
// in disclaimer/index.html (both inside the FAQPage JSON-LD answer
// and in the visible body prose).
//
// If a future iteration adds or removes a topic, the live count
// (number of "<N>. **...**" entries in the prompt's topic-scope
// section) shifts; every prose mention must update in lockstep or
// the disclaimer and the prompt commentary tell users a different
// scope than the live list.
//
// The source-of-truth is the numbered-list count itself: the
// regex finds lines matching `^\d+\.\s+\*\*.+?\*\*` immediately
// following the "## Topic scope" heading. The number of such
// lines is the live topic count.

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const CHAT_SYSTEM_PROMPT_PATH = resolve(
  ROOT,
  'netlify',
  'functions',
  '_lib',
  'chat-system-prompt.mts'
);
const DISCLAIMER_PATH = resolve(ROOT, 'disclaimer', 'index.html');

const NUMBER_TO_WORD: Record<number, string> = {
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
};

function countTopicsInPrompt(promptSource: string): number {
  // Find the "# Topic scope" heading then count the numbered list
  // items "<N>. **...**" until a different section begins.
  const scopeMatch = promptSource.match(
    /# Topic scope[\r\n]+([\s\S]*?)(?=\n# |\n## )/
  );
  if (!scopeMatch) return 0;
  const body = scopeMatch[1];
  const items = body.match(/^\d+\.\s+\*\*[^*]+\*\*/gm);
  return items ? items.length : 0;
}

const prompt = readFileSync(CHAT_SYSTEM_PROMPT_PATH, 'utf8');
const disclaimer = readFileSync(DISCLAIMER_PATH, 'utf8');
const liveCount = countTopicsInPrompt(prompt);
const expectedWord = NUMBER_TO_WORD[liveCount];

describe('SelectBot topic count parity', () => {
  it('parses a non-zero topic count from the chat-system-prompt', () => {
    expect(
      liveCount,
      `expected to parse some "<N>. **Topic**" entries from the Topic-scope section; found ${liveCount}`
    ).toBeGreaterThan(0);
  });

  it('chat-system-prompt prose mentions "<expectedWord> topics"', () => {
    // The prompt has at least three "<N> topics" mentions: "exactly
    // four topics" + "these four topics" + the comment block's
    // "four topics in scope" + "four areas". All must use the same
    // word as the numbered-list count.
    const re = new RegExp(
      `\\b(one|two|three|four|five|six|seven|eight|nine|ten)\\s+topics?\\b`,
      'gi'
    );
    const mentions = [...prompt.matchAll(re)];
    expect(
      mentions.length,
      `expected at least one "<N> topics" mention in chat-system-prompt.mts; found ${mentions.length}`
    ).toBeGreaterThan(0);
    for (const m of mentions) {
      expect(
        m[1].toLowerCase(),
        `chat-system-prompt mention "${m[0]}" disagrees with live topic count = ${liveCount} (expected word "${expectedWord}").`
      ).toBe(expectedWord);
    }
  });

  it('disclaimer/index.html mentions "<expectedWord> topics" on every surface', () => {
    const re = new RegExp(
      `\\b(one|two|three|four|five|six|seven|eight|nine|ten)\\s+topics?\\b`,
      'gi'
    );
    const mentions = [...disclaimer.matchAll(re)];
    expect(
      mentions.length,
      `expected at least one "<N> topics" mention in disclaimer/index.html; found ${mentions.length}`
    ).toBeGreaterThan(0);
    for (const m of mentions) {
      expect(
        m[1].toLowerCase(),
        `disclaimer mention "${m[0]}" disagrees with live topic count = ${liveCount} (expected word "${expectedWord}").`
      ).toBe(expectedWord);
    }
  });
});
