import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

import { SECTORS, ANCHORS } from '../universe-roster.mts';

// Universe component count-mentions parity. Two cardinalities
// appear across documentation surfaces:
//   - SECTORS.length = 11 ("eleven SPDR sectors" / "11 SPDR sector
//     ETFs" / "the eleven SPDR sectors")
//   - ANCHORS.length = 11 ("eleven anchor single names" / "11
//     anchor names" / "the eleven anchor names")
//
// Both currently equal 11 (which makes drift-catching extra hard
// without parity tests since the two share a value). If a future
// iteration adds a 12th anchor name (e.g., a new high-options-
// volume single name promoted from candidate to anchor), the
// disclaimer-numbers-parity test catches ANCHORS-specific
// mentions in the disclaimer; this test extends to all .html and
// .md surfaces.
//
// Unlike the iter-160 strategy / iter-161 symbol pattern, the
// universe-component mentions are usually accompanied by the
// noun "SPDR sector" or "anchor single name(s)" which is highly
// specific, so the regex doesn't need the "all <N>" or "<N>-X"
// compound forms — just "<N> SPDR sector" and "<N> anchor".

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
        const rel = relative(ROOT, full).split(sep).join('/');
        if (rel === 'changelog/index.html') continue;
        if (rel === 'STATUS.md') continue;
        if (rel === 'CLAUDE.md') continue;
        files.push(full);
      }
    }
  }
}

interface Mention {
  file: string;
  line: number;
  matched: number;
  excerpt: string;
}

function tokenToNumber(token: string): number | undefined {
  if (/^\d+$/.test(token)) return parseInt(token, 10);
  const entry = Object.entries(NUMBER_TO_WORD).find(
    ([, w]) => w === token.toLowerCase()
  );
  return entry ? parseInt(entry[0], 10) : undefined;
}

function findMentions(
  files: string[],
  pattern: RegExp
): Mention[] {
  const out: Mention[] = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(lines[i])) !== null) {
        const n = tokenToNumber(m[1]);
        if (n === undefined) continue;
        out.push({
          file: relative(ROOT, file).split(sep).join('/'),
          line: i + 1,
          matched: n,
          excerpt: lines[i].slice(Math.max(0, m.index - 20), m.index + 60).trim(),
        });
      }
    }
  }
  return out;
}

const allFiles: string[] = [];
findFiles(ROOT, allFiles);

const sectorPattern =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+SPDR\s+sector\b/gi;
const anchorPattern =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+anchor\s+(?:single\s+)?names?\b/gi;

const sectorMentions = findMentions(allFiles, sectorPattern);
const anchorMentions = findMentions(allFiles, anchorPattern);

describe('SPDR sector count mentions parity (every "<N> SPDR sector" matches SECTORS.length)', () => {
  it('discovered a meaningful number of mentions', () => {
    expect(
      sectorMentions.length,
      `expected to find several "<N> SPDR sector" mentions; found ${sectorMentions.length}`
    ).toBeGreaterThan(3);
  });

  it('every mention matches SECTORS.length', () => {
    const wrong = sectorMentions.filter((m) => m.matched !== SECTORS.length);
    if (wrong.length > 0) {
      const summary = wrong
        .map(
          (m) =>
            `  ${m.file}:${m.line}: matched ${m.matched} (expected ${SECTORS.length}) - ...${m.excerpt}...`
        )
        .join('\n');
      expect.fail(
        `found ${wrong.length} stale SPDR sector-count mention(s) (expected ${SECTORS.length}):\n${summary}`
      );
    }
  });
});

describe('anchor single-name count mentions parity (every "<N> anchor name(s)" matches ANCHORS.length)', () => {
  it('discovered a meaningful number of mentions', () => {
    expect(
      anchorMentions.length,
      `expected to find several "<N> anchor name" mentions; found ${anchorMentions.length}`
    ).toBeGreaterThan(3);
  });

  it('every mention matches ANCHORS.length', () => {
    const wrong = anchorMentions.filter((m) => m.matched !== ANCHORS.length);
    if (wrong.length > 0) {
      const summary = wrong
        .map(
          (m) =>
            `  ${m.file}:${m.line}: matched ${m.matched} (expected ${ANCHORS.length}) - ...${m.excerpt}...`
        )
        .join('\n');
      expect.fail(
        `found ${wrong.length} stale anchor-count mention(s) (expected ${ANCHORS.length}):\n${summary}`
      );
    }
  });
});
