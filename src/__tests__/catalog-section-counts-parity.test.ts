import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

// Catalog-section count-mentions parity. Three catalogs have
// per-section cardinality claims sprinkled across documentation
// surfaces:
//
//   - quiz: "five quiz categories" / "5 quiz categories" (etc.)
//     -> count of subdirectories under quiz/
//   - philosophy: "five philosophy essays" / "5 philosophy essays"
//     -> count of subdirectories under philosophy/
//   - learn: "six Rust lessons" / "6 Rust lessons" / "Six Rust
//     curriculum lessons" -> count of subdirectories under learn/
//
// Each claim must match the actual subdirectory count for that
// catalog. The chat-system-prompt-numbers-parity test pins these
// inside the system prompt only; this test extends the same
// invariant to every .html and .md surface that mentions a count.
//
// Three unambiguous patterns per section (mirroring iter-160 and
// iter-161):
//   1. "<N> quiz categor(y|ies)" / "<N> philosophy (essays|primers)"
//      / "<N> Rust (curriculum lessons|lessons)"
//   2. "<N>-quiz" / "<N>-essay" / "<N>-lesson" compound adjective
//   3. Trailing-categorization form: "Five quizzes", etc.
//
// The narrow regexes avoid false positives (e.g., "five
// philosophical questions" or "six strategies and ten lessons")
// that the broader patterns would match.

const ROOT = resolve(__dirname, '..', '..');

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

function countSubdirs(dir: string): number {
  const sectionDir = resolve(ROOT, dir);
  return readdirSync(sectionDir).filter((entry) => {
    const p = resolve(sectionDir, entry);
    if (!statSync(p).isDirectory()) return false;
    return existsSync(resolve(p, 'index.html'));
  }).length;
}

function tokenToNumber(token: string): number | undefined {
  if (/^\d+$/.test(token)) return parseInt(token, 10);
  const entry = Object.entries(NUMBER_TO_WORD).find(
    ([, w]) => w === token.toLowerCase()
  );
  return entry ? parseInt(entry[0], 10) : undefined;
}

interface Mention {
  file: string;
  line: number;
  matched: number;
  excerpt: string;
}

function findMentions(files: string[], patterns: RegExp[]): Mention[] {
  const out: Mention[] = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const re of patterns) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(lines[i])) !== null) {
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
  }
  return out;
}

const allFiles: string[] = [];
findFiles(ROOT, allFiles);

const quizCount = countSubdirs('quiz');
const philosophyCount = countSubdirs('philosophy');
const learnCount = countSubdirs('learn');

const quizPatterns: RegExp[] = [
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(?:category\s+)?quiz(?:zes|\s+categor(?:y|ies))\b/gi,
];

const philosophyPatterns: RegExp[] = [
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(?:backtesting-)?philosophy\s+(?:essays?|primers?|articles?)\b/gi,
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+philosophy\b/gi,
];

const learnPatterns: RegExp[] = [
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+Rust\s+(?:curriculum\s+)?lessons?\b/gi,
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)-lesson\b/gi,
];

describe('quiz category count-mentions parity', () => {
  const mentions = findMentions(allFiles, quizPatterns);
  it('discovered a meaningful number of mentions', () => {
    expect(mentions.length).toBeGreaterThan(2);
  });
  it('every mention matches quiz/ subdirectory count', () => {
    const wrong = mentions.filter((m) => m.matched !== quizCount);
    if (wrong.length > 0) {
      const summary = wrong
        .map((m) => `  ${m.file}:${m.line}: matched ${m.matched} (expected ${quizCount}) - ...${m.excerpt}...`)
        .join('\n');
      expect.fail(`stale quiz-count mentions (expected ${quizCount}):\n${summary}`);
    }
  });
});

describe('philosophy essay count-mentions parity', () => {
  const mentions = findMentions(allFiles, philosophyPatterns);
  it('discovered a meaningful number of mentions', () => {
    expect(mentions.length).toBeGreaterThan(2);
  });
  it('every mention matches philosophy/ subdirectory count', () => {
    const wrong = mentions.filter((m) => m.matched !== philosophyCount);
    if (wrong.length > 0) {
      const summary = wrong
        .map((m) => `  ${m.file}:${m.line}: matched ${m.matched} (expected ${philosophyCount}) - ...${m.excerpt}...`)
        .join('\n');
      expect.fail(`stale philosophy-count mentions (expected ${philosophyCount}):\n${summary}`);
    }
  });
});

describe('learn lesson count-mentions parity', () => {
  const mentions = findMentions(allFiles, learnPatterns);
  it('discovered a meaningful number of mentions', () => {
    expect(mentions.length).toBeGreaterThan(2);
  });
  it('every mention matches learn/ subdirectory count', () => {
    const wrong = mentions.filter((m) => m.matched !== learnCount);
    if (wrong.length > 0) {
      const summary = wrong
        .map((m) => `  ${m.file}:${m.line}: matched ${m.matched} (expected ${learnCount}) - ...${m.excerpt}...`)
        .join('\n');
      expect.fail(`stale learn-count mentions (expected ${learnCount}):\n${summary}`);
    }
  });
});
