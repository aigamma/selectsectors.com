import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Quiz catalog parity test. Five layers of source-of-truth that must
// agree on the set of quiz categories:
//
//   1. src/quiz-data/<slug>.json     (the question content)
//   2. src/quiz-<slug>.ts            (the per-page entry that imports the JSON)
//   3. quiz/<slug>/index.html        (the HTML page that loads the entry)
//   4. quiz/index.html catalog       (the catalog page that links to the page)
//   5. Each JSON's `slug` field      (must match the filename slug)
//
// If a future iteration adds a 6th category but misses any of the
// five layers, that category is either invisible (missing catalog
// link), broken (missing HTML/JS), or content-less (missing JSON).
// This test catches all four "missing" cases plus the slug-mismatch
// case.

const ROOT = resolve(__dirname, '..', '..');
const QUIZ_DATA_DIR = resolve(ROOT, 'src', 'quiz-data');
const CATALOG_PATH = resolve(ROOT, 'quiz', 'index.html');

function listJsonSlugs(): string[] {
  return readdirSync(QUIZ_DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

const jsonSlugs = listJsonSlugs();
const catalogSource = readFileSync(CATALOG_PATH, 'utf8');

describe('quiz catalog parity', () => {
  it('found at least 3 quiz JSON files (sanity check)', () => {
    expect(jsonSlugs.length).toBeGreaterThanOrEqual(3);
  });

  it.each(jsonSlugs)(
    'quiz %s has a matching src/quiz-<slug>.ts entry',
    (slug) => {
      const path = resolve(ROOT, 'src', `quiz-${slug}.ts`);
      expect(
        existsSync(path),
        `src/quiz-data/${slug}.json exists but src/quiz-${slug}.ts does not`
      ).toBe(true);
    }
  );

  it.each(jsonSlugs)(
    'quiz %s has a matching quiz/<slug>/index.html page',
    (slug) => {
      const path = resolve(ROOT, 'quiz', slug, 'index.html');
      expect(
        existsSync(path),
        `src/quiz-data/${slug}.json exists but quiz/${slug}/index.html does not`
      ).toBe(true);
    }
  );

  it.each(jsonSlugs)(
    'quiz %s is linked from quiz/index.html catalog',
    (slug) => {
      const linkRe = new RegExp(`href="/quiz/${slug}/?"`);
      expect(
        linkRe.test(catalogSource),
        `src/quiz-data/${slug}.json exists but quiz/index.html does not link to /quiz/${slug}/`
      ).toBe(true);
    }
  );

  it.each(jsonSlugs)(
    'quiz %s JSON has slug field matching the filename',
    (slug) => {
      const path = resolve(QUIZ_DATA_DIR, `${slug}.json`);
      const data = JSON.parse(readFileSync(path, 'utf8')) as { slug: string };
      expect(data.slug, `expected slug "${slug}" but JSON says "${data.slug}"`).toBe(slug);
    }
  );
});
