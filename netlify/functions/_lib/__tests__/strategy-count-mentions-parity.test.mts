import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

import { STRATEGY_DEFAULTS } from '../strategy.mts';

// Strategy count-mentions parity. The phrase "six strategies" /
// "6 strategies" / "6-strategy" appears across many documentation
// surfaces (HTML pages, markdown docs) as a cardinality claim
// about the strategy library. Object.keys(STRATEGY_DEFAULTS).length
// is the source of truth: the rust-ts-parity test guarantees that
// matches the Rust StrategyKind enum, and the strategy-specs-
// parity test guarantees it matches STRATEGY_SPECS.
//
// If a future iteration adds a 7th strategy, every documentation
// surface mentioning "six strategies" needs to update. The
// chat-system-prompt cardinality test pins one specific surface
// (the prompt's grounding text). This test extends coverage to all
// .html files plus the README.md and docs/architecture.md, by
// walking the source tree and asserting every "<N>-strategy" or
// "<N> strategies" or "<word> strategies" claim matches the live
// count.
//
// Changelog and STATUS.md mentions are excluded because they
// describe historical state at a given release (changelog v0.1.0
// might legitimately say "1-strategy WASM backtester" if it
// described that release's actual count).

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
        // Skip the changelog page since the release notes
        // intentionally describe prior states.
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

const liveCount = Object.keys(STRATEGY_DEFAULTS).length;
const expectedWord = NUMBER_TO_WORD[liveCount];

const allFiles: string[] = [];
findFiles(ROOT, allFiles);

const allMentions: CountMention[] = [];
for (const file of allFiles) {
  const content = readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Three unambiguous cardinality patterns:
    //   1. "<N>-strategy" (compound adjective; clearly the library
    //      size, e.g., "6-strategy WASM backtester")
    //   2. "all <N> strategies" (the universal-quantifier form
    //      means "every strategy in the library")
    //   3. "<N> strategies in this site's WASM" / "<N> strategies
    //      in `crates/backtest-core" (specific set reference;
    //      conservatively recognized by the "in" preposition
    //      directly following the count)
    // We deliberately do NOT match the looser "<N> strategies"
    // alone because that pattern false-positives on contextual
    // mentions like "two strategy parameters" or "five strategies
    // in a small crate" (a hypothetical comparison in a lesson,
    // not a claim about the live library size).
    const patterns: RegExp[] = [
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)-strateg(?:y|ies)\b/gi,
      /\ball\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+strateg(?:y|ies)\b/gi,
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+strateg(?:y|ies)\s+in\s+(?:this\s+site|`crates|the\s+library|the\s+catalog|the\s+site)/gi,
    ];
    for (const re of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const token = m[1].toLowerCase();
        const matchedNumber = /^\d+$/.test(token)
          ? parseInt(token, 10)
          : Object.entries(NUMBER_TO_WORD).find(([, w]) => w === token)?.[0];
        if (matchedNumber === undefined) continue;
        allMentions.push({
          file: relative(ROOT, file).split(sep).join('/'),
          line: i + 1,
          matchedNumber: typeof matchedNumber === 'string' ? parseInt(matchedNumber, 10) : matchedNumber,
          excerpt: line.slice(Math.max(0, m.index - 20), m.index + 60).trim(),
        });
      }
    }
  }
}

describe('strategy count-mentions parity (every "<N> strategies" matches Object.keys(STRATEGY_DEFAULTS).length)', () => {
  it('discovered a meaningful number of strategy-count mentions', () => {
    expect(
      allMentions.length,
      `expected to find several "<N> strategies" mentions across the docs; found ${allMentions.length}`
    ).toBeGreaterThan(3);
  });

  it('every strategy-count mention matches the live STRATEGY_DEFAULTS count', () => {
    const wrong = allMentions.filter((m) => m.matchedNumber !== liveCount);
    if (wrong.length > 0) {
      const summary = wrong
        .map(
          (m) =>
            `  ${m.file}:${m.line}: matched ${m.matchedNumber} (expected ${liveCount}) - ...${m.excerpt}...`
        )
        .join('\n');
      expect.fail(
        `found ${wrong.length} stale strategy-count mention(s) (expected ${liveCount} / "${expectedWord}"):\n${summary}`
      );
    }
  });
});
