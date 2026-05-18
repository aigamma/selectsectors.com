import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Catalog lede count parity test.
//
// Each top-level catalog page (/quiz/, /learn/, /philosophy/,
// /strategies/) opens with a hero <p class="lede"> that describes
// what the section contains. If that lede states a count ("Five
// category quizzes...", "Six strategies...", "These five essays..."),
// the count must match the actual number of subdirectory pages.
// The number of pages can change over time as iterations add or
// remove content; the lede is prose, not generated, so drift is
// silent until a reader notices.
//
// This test discovered two drifts at the time it was written:
//   - quiz/index.html said "Three category quizzes" when there
//     were 5 (iter 84+85 added rust-intermediate and wasm-internals
//     but the lede was not updated).
//   - philosophy/index.html said "the four most common ways
//     backtests lie" when there were 5 essays (the regimes essay
//     was added later but the framing referred to the original 4
//     "ways backtests lie" categories).
//
// The test walks each catalog directory, counts subdirectory
// index.html files, and searches the lede paragraph for English
// count-words ("Three", "Four", ..., "Ten") used as cardinality
// claims. If a count-word appears, it must match the actual count.
// If no count-word appears, the lede is drift-proof and the test
// passes silently for that section.

const ROOT = resolve(__dirname, '..', '..');

const WORD_TO_NUMBER: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

interface Catalog {
  /** Display label used in test names. */
  label: string;
  /** Section directory relative to repo root. */
  dir: string;
}

const CATALOGS: Catalog[] = [
  { label: 'quiz', dir: 'quiz' },
  { label: 'learn', dir: 'learn' },
  { label: 'philosophy', dir: 'philosophy' },
  { label: 'strategies', dir: 'strategies' },
];

function countSubdirPages(dir: string): number {
  const sectionDir = resolve(ROOT, dir);
  return readdirSync(sectionDir).filter((entry) => {
    const p = resolve(sectionDir, entry);
    if (!statSync(p).isDirectory()) return false;
    return existsSync(resolve(p, 'index.html'));
  }).length;
}

function extractLede(html: string): string | null {
  // Capture the contents of the first <p class="lede"> element on
  // the page. Cross-line match because catalog ledes typically span
  // multiple lines. We don't need to parse HTML properly; the lede
  // is plain prose with at most <code> spans, and the count-word
  // search is whole-word case-insensitive.
  const m = html.match(/<p class="lede">([\s\S]*?)<\/p>/);
  return m ? m[1] : null;
}

function findCountWordInLede(lede: string): { word: string; value: number } | null {
  // The cardinality claim about a catalog section follows the
  // pattern: a count-word followed within ~3 intermediate words by
  // a noun describing the section's content type ("quiz/quizzes",
  // "essay/essays", "strateg/strategies", "lesson/lessons",
  // "categor/category/categories", "section", "chapter", "page").
  // Matching this pattern instead of any count-word avoids false
  // positives like "one question at a time" (where "one" is a prose
  // numeral, not a cardinality claim). Case-insensitive; word
  // boundaries so "four" inside "fourteen" does not match.
  const COUNT_NOUN_RE =
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?:\s+\w+){0,3}\s+(?:quiz|essay|strateg|lesson|categor|section|chapter|page)/i;
  const m = lede.match(COUNT_NOUN_RE);
  if (!m) return null;
  const word = m[1].toLowerCase();
  return { word, value: WORD_TO_NUMBER[word] };
}

for (const catalog of CATALOGS) {
  describe(`/${catalog.label}/ catalog lede count parity`, () => {
    const catalogPath = resolve(ROOT, catalog.dir, 'index.html');
    const html = readFileSync(catalogPath, 'utf8');
    const lede = extractLede(html);
    const actualCount = countSubdirPages(catalog.dir);

    it(`catalog page has a <p class="lede"> element`, () => {
      expect(
        lede,
        `expected <p class="lede"> in ${catalog.dir}/index.html`
      ).not.toBeNull();
    });

    it(`lede count-word (if any) matches the actual subdirectory page count`, () => {
      if (lede === null) return; // covered by previous test
      const stated = findCountWordInLede(lede);
      if (stated === null) {
        // No count-word in lede. Drift-proof; pass silently.
        return;
      }
      expect(
        stated.value,
        `/${catalog.dir}/ has ${actualCount} subdirectory pages but the lede says "${stated.word}" (${stated.value}). ` +
          `Update the lede in ${catalog.dir}/index.html or add/remove pages to match.`
      ).toBe(actualCount);
    });
  });
}
