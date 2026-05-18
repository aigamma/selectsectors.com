import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Quiz page title parity. Three places carry the quiz category's
// display name:
//
//   1. quiz/index.html catalog card: <span class="curriculum-title">NAME</span>
//   2. quiz/<slug>/index.html <h1 id="quiz-title">NAME</h1>
//   3. quiz/<slug>/index.html <title>Quiz: NAME · Select Sectors</title>
//
// All three must agree for the UX to be coherent. Iter 139 caught
// the quant-finance quiz <title> as "Quiz: Quant finance" while
// the catalog title and h1 both said "Quant finance basics"; the
// <title> was the only stale surface.
//
// The catalog title is the source-of-truth for the test: it's
// what a user clicks to land on the quiz page and what the chat
// prompt enumerates (pinned to the catalog by the iter-132
// chat-system-prompt-numbers-parity test's QUIZ_SLUG_PROSE table).
// The h1 and <title> are pinned to the catalog title.

const ROOT = resolve(__dirname, '..', '..');
const QUIZ_DIR = resolve(ROOT, 'quiz');
const CATALOG_PATH = resolve(QUIZ_DIR, 'index.html');

interface QuizPage {
  slug: string;
  /** Catalog title text (from the curriculum-title span). */
  catalogTitle: string;
}

function listQuizSlugs(): string[] {
  return readdirSync(QUIZ_DIR)
    .filter((entry) => {
      const p = resolve(QUIZ_DIR, entry);
      return statSync(p).isDirectory() && existsSync(resolve(p, 'index.html'));
    })
    .sort();
}

function extractCatalogTitle(html: string, slug: string): string | null {
  const re = new RegExp(
    `href="/quiz/${slug}/?"[\\s\\S]*?<span class="curriculum-title">([^<]+)<\\/span>`
  );
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

const catalogSource = readFileSync(CATALOG_PATH, 'utf8');
const slugs = listQuizSlugs();
const pages: QuizPage[] = slugs.flatMap((slug) => {
  const title = extractCatalogTitle(catalogSource, slug);
  return title ? [{ slug, catalogTitle: title }] : [];
});

describe('quiz catalog title parity (catalog vs <title> vs <h1>)', () => {
  it('every quiz slug has a catalog title (sanity check)', () => {
    expect(
      pages.length,
      `expected every slug in quiz/ to have a curriculum-title in quiz/index.html; found ${pages.length} for ${slugs.length} slugs`
    ).toBe(slugs.length);
  });

  it.each(pages.map((p) => [p.slug, p]))(
    'quiz %s <h1 id="quiz-title"> matches the catalog curriculum-title',
    (_slug, page) => {
      const path = resolve(QUIZ_DIR, page.slug, 'index.html');
      const html = readFileSync(path, 'utf8');
      const h1Re = /<h1 id="quiz-title">([^<]+)<\/h1>/;
      const m = html.match(h1Re);
      expect(
        m,
        `quiz/${page.slug}/index.html has no <h1 id="quiz-title">`
      ).not.toBeNull();
      if (!m) return;
      const h1 = m[1].trim();
      expect(
        h1,
        `quiz/${page.slug}/ <h1> is "${h1}" but the catalog says "${page.catalogTitle}". Update one or the other.`
      ).toBe(page.catalogTitle);
    }
  );

  it.each(pages.map((p) => [p.slug, p]))(
    'quiz %s <title> contains "Quiz: <catalog-title>"',
    (_slug, page) => {
      const path = resolve(QUIZ_DIR, page.slug, 'index.html');
      const html = readFileSync(path, 'utf8');
      const titleRe = /<title>([^<]+)<\/title>/;
      const m = html.match(titleRe);
      expect(
        m,
        `quiz/${page.slug}/index.html has no <title>`
      ).not.toBeNull();
      if (!m) return;
      const title = m[1].trim();
      const expectedPrefix = `Quiz: ${page.catalogTitle}`;
      expect(
        title.startsWith(expectedPrefix),
        `quiz/${page.slug}/ <title> is "${title}" but should start with "${expectedPrefix}" (catalog title for /quiz/${page.slug}/). Update the <title> or the catalog.`
      ).toBe(true);
    }
  );
});
