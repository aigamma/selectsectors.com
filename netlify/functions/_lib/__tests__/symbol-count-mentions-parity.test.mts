import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

import { ALL_SYMBOLS } from '../universe-roster.mts';

// Symbol count-mentions parity. The "23 symbols" cardinality
// claim appears across many documentation surfaces (HTML pages,
// markdown docs). ALL_SYMBOLS.length is the source of truth.
//
// If a future iteration changes the universe size (adding or
// removing an anchor name, or adding SPY if a future decision
// reverses the iter-58 exclusion), every documentation surface
// must update in lockstep with the live count.
//
// The chat-system-prompt-numbers-parity test (iter 131/152) pins
// the chat prompt's mentions specifically. This test is the broader
// cross-file complement, mirroring the iter-160 strategy-count-
// mentions pattern.
//
// Three unambiguous cardinality patterns are recognized:
//   1. "<N>-symbol" compound adjective ("23-symbol universe")
//   2. "all <N> symbols" universal quantifier ("all 23 symbols")
//   3. "<N> symbols total" trailing-total form ("Twenty-three
//      symbols total")
//
// The looser "<N> symbols" alone matches too many contextual
// mentions (e.g., "the 22 symbols in daily_eod" refers to a
// derived subset, not the full universe) and is not used here.
// Changelog and STATUS.md are excluded since they describe
// historical state at each release.

const ROOT = resolve(__dirname, '..', '..', '..', '..');

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
  11: 'eleven',
  12: 'twelve',
  20: 'twenty',
  21: 'twenty-one',
  22: 'twenty-two',
  23: 'twenty-three',
  24: 'twenty-four',
  25: 'twenty-five',
};

function shouldSkipDir(name: string): boolean {
  return (
    name === 'node_modules' ||
    name === 'dist' ||
    name === '.git' ||
    name === 'target' ||
    name === 'pkg' ||
    name === '.netlify' ||
    name === 'public' ||
    name === 'src' ||
    name === 'netlify' ||
    name === 'crates' ||
    name === '.vscode'
  );
}

function findFiles(dir: string, files: string[]): void {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = resolve(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!shouldSkipDir(entry)) findFiles(full, files);
    } else if (st.isFile()) {
      if (entry.endsWith('.html') || entry.endsWith('.md')) {
        const rel = relative(ROOT, full).split(sep).join('/');
        if (rel === 'changelog/index.html') continue;
        if (rel === 'STATUS.md') continue;
        if (rel === 'CLAUDE.md') continue;
        files.push(full);
      }
    }
  }
}

interface CountMention {
  file: string;
  line: number;
  matchedNumber: number;
  excerpt: string;
}

const liveCount = ALL_SYMBOLS.length;

function tokenToNumber(token: string): number | undefined {
  if (/^\d+$/.test(token)) return parseInt(token, 10);
  const entry = Object.entries(NUMBER_TO_WORD).find(
    ([, w]) => w === token.toLowerCase()
  );
  return entry ? parseInt(entry[0], 10) : undefined;
}

const allFiles: string[] = [];
findFiles(ROOT, allFiles);

const allMentions: CountMention[] = [];
for (const file of allFiles) {
  const content = readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const patterns: RegExp[] = [
      // <N>-symbol compound adjective: "23-symbol universe"
      /\b(\d+|twenty-three|twenty-two|twenty-four|twenty-five)-symbol\b/gi,
      // "all <N> symbols": "all 23 symbols"
      /\ball\s+(\d+|twenty-three|twenty-two|twenty-four|twenty-five)\s+symbols\b/gi,
      // "<N> symbols total": "Twenty-three symbols total"
      /\b(\d+|twenty-three|twenty-two|twenty-four|twenty-five)\s+symbols\s+total\b/gi,
    ];
    for (const re of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const n = tokenToNumber(m[1]);
        if (n === undefined) continue;
        allMentions.push({
          file: relative(ROOT, file).split(sep).join('/'),
          line: i + 1,
          matchedNumber: n,
          excerpt: line.slice(Math.max(0, m.index - 20), m.index + 60).trim(),
        });
      }
    }
  }
}

describe('symbol count-mentions parity (every cardinal "<N> symbols" mention matches ALL_SYMBOLS.length)', () => {
  it('discovered a meaningful number of symbol-count mentions', () => {
    expect(
      allMentions.length,
      `expected to find several "<N> symbols" cardinality mentions; found ${allMentions.length}`
    ).toBeGreaterThan(3);
  });

  it('every symbol-count mention matches ALL_SYMBOLS.length', () => {
    const wrong = allMentions.filter((m) => m.matchedNumber !== liveCount);
    if (wrong.length > 0) {
      const summary = wrong
        .map(
          (m) =>
            `  ${m.file}:${m.line}: matched ${m.matchedNumber} (expected ${liveCount}) - ...${m.excerpt}...`
        )
        .join('\n');
      expect.fail(
        `found ${wrong.length} stale symbol-count mention(s) (expected ${liveCount}):\n${summary}`
      );
    }
  });
});
