import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Philosophy page title parity. Mirrors quiz-titles-parity.test.ts
// (iter 139) for the /philosophy/ section. Three places carry each
// essay's display name:
//
//   1. philosophy/index.html catalog card:
//      <span class="curriculum-title">NAME</span>
//   2. philosophy/<slug>/index.html <h1>NAME.</h1>
//      (with a trailing period for the editorial voice the
//      philosophy essays use; the period is part of every essay
//      title and is stripped before comparison with the catalog)
//   3. philosophy/<slug>/index.html <title>NAME · Philosophy · Select Sectors</title>
//
// All three must agree. Currently all five essays do
// (backtest-vs-live, lookahead-bias, overfitting, regimes,
// survivorship-bias) but pinning the relationship blocks a future
// edit from drifting one surface without the others.

const ROOT = resolve(__dirname, '..', '..');
const PHILOSOPHY_DIR = resolve(ROOT, 'philosophy');
const CATALOG_PATH = resolve(PHILOSOPHY_DIR, 'index.html');

interface PhilosophyPage {
  slug: string;
  catalogTitle: string;
}

function listPhilosophySlugs(): string[] {
  return readdirSync(PHILOSOPHY_DIR)
    .filter((entry) => {
      const p = resolve(PHILOSOPHY_DIR, entry);
      return statSync(p).isDirectory() && existsSync(resolve(p, 'index.html'));
    })
    .sort();
}

function extractCatalogTitle(html: string, slug: string): string | null {
  const re = new RegExp(
    `href="/philosophy/${slug}/?"[\\s\\S]*?<span class="curriculum-title">([^<]+)<\\/span>`
  );
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

const catalogSource = readFileSync(CATALOG_PATH, 'utf8');
const slugs = listPhilosophySlugs();
const pages: PhilosophyPage[] = slugs.flatMap((slug) => {
  const title = extractCatalogTitle(catalogSource, slug);
  return title ? [{ slug, catalogTitle: title }] : [];
});

describe('philosophy catalog title parity (catalog vs <title> vs <h1>)', () => {
  it('every philosophy slug has a catalog title (sanity check)', () => {
    expect(
      pages.length,
      `expected every slug in philosophy/ to have a curriculum-title in philosophy/index.html; found ${pages.length} for ${slugs.length} slugs`
    ).toBe(slugs.length);
  });

  it.each(pages.map((p) => [p.slug, p]))(
    'philosophy %s <h1> matches the catalog curriculum-title (period-tolerant)',
    (_slug, page) => {
      const path = resolve(PHILOSOPHY_DIR, page.slug, 'index.html');
      const html = readFileSync(path, 'utf8');
      // Match the FIRST <h1> in the main content. Philosophy essays
      // do not use breadcrumb h1s; the only h1 is the essay title.
      const h1Re = /<h1>([^<]+)<\/h1>/;
      const m = html.match(h1Re);
      expect(
        m,
        `philosophy/${page.slug}/index.html has no <h1>`
      ).not.toBeNull();
      if (!m) return;
      // Strip the trailing period that all philosophy essay h1s use
      // ("Lookahead bias." → "Lookahead bias") before comparing with
      // the catalog. The period is editorial styling for the essay
      // voice and is consistent across every essay's h1; the catalog
      // does not use the period.
      const h1 = m[1].trim().replace(/\.$/, '');
      expect(
        h1,
        `philosophy/${page.slug}/ <h1> is "${m[1].trim()}" (sans trailing period: "${h1}") but the catalog says "${page.catalogTitle}". Update one or the other.`
      ).toBe(page.catalogTitle);
    }
  );

  it.each(pages.map((p) => [p.slug, p]))(
    'philosophy %s <title> starts with the catalog curriculum-title',
    (_slug, page) => {
      const path = resolve(PHILOSOPHY_DIR, page.slug, 'index.html');
      const html = readFileSync(path, 'utf8');
      const titleRe = /<title>([^<]+)<\/title>/;
      const m = html.match(titleRe);
      expect(
        m,
        `philosophy/${page.slug}/index.html has no <title>`
      ).not.toBeNull();
      if (!m) return;
      const title = m[1].trim();
      expect(
        title.startsWith(page.catalogTitle),
        `philosophy/${page.slug}/ <title> is "${title}" but should start with the catalog title "${page.catalogTitle}". Update the <title> or the catalog.`
      ).toBe(true);
    }
  );
});
