import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Learn page title parity. Mirrors quiz-titles-parity (iter 139)
// and philosophy-titles-parity (iter 140) for the /learn/ section.
//
// The /learn/ section has six lessons. Each lesson page carries a
// <title> that should start with the catalog curriculum-title for
// SEO/tab-strip identifiability. The <h1> is allowed to diverge
// from the catalog title for editorial reasons (the catalog title
// is blurb-style; the h1 is the page's punchier lead-in). Two
// current divergences are intentional and the test allows them:
//
//   - enums-and-dispatch: catalog "Enums and dispatch", <h1>
//     "Enums as dispatch tables." (the lesson reframes the concept
//     as "tables" for the dispatch idiom, which is the educational
//     hook the lesson opens with).
//   - wasm: catalog "Rust to WebAssembly with wasm-bindgen", <h1>
//     "Rust to WebAssembly." (the h1 omits "with wasm-bindgen" for
//     brevity; the qualifier appears in the page body and the
//     <title> tag).
//
// The test pins only the <title> tag to the catalog title (starts-
// with check). Iter 141 caught four <title>-side drift bugs:
// ownership truncated "in numerical code", wasm truncated "with
// wasm-bindgen", this-sites-rust and why-rust were missing the
// " · Learn · " middle separator. Those were fixed in the same
// commit that added this test.

const ROOT = resolve(__dirname, '..', '..');
const LEARN_DIR = resolve(ROOT, 'learn');
const CATALOG_PATH = resolve(LEARN_DIR, 'index.html');

interface LearnPage {
  slug: string;
  catalogTitle: string;
}

function listLearnSlugs(): string[] {
  return readdirSync(LEARN_DIR)
    .filter((entry) => {
      const p = resolve(LEARN_DIR, entry);
      return statSync(p).isDirectory() && existsSync(resolve(p, 'index.html'));
    })
    .sort();
}

function extractCatalogTitle(html: string, slug: string): string | null {
  const re = new RegExp(
    `href="/learn/${slug}/?"[\\s\\S]*?<span class="curriculum-title">([^<]+)<\\/span>`
  );
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

const catalogSource = readFileSync(CATALOG_PATH, 'utf8');
const slugs = listLearnSlugs();
const pages: LearnPage[] = slugs.flatMap((slug) => {
  const title = extractCatalogTitle(catalogSource, slug);
  return title ? [{ slug, catalogTitle: title }] : [];
});

describe('learn catalog title parity (catalog vs <title>)', () => {
  it('every learn slug has a catalog title (sanity check)', () => {
    expect(
      pages.length,
      `expected every slug in learn/ to have a curriculum-title in learn/index.html; found ${pages.length} for ${slugs.length} slugs`
    ).toBe(slugs.length);
  });

  it.each(pages.map((p) => [p.slug, p]))(
    'learn %s <title> starts with the catalog curriculum-title',
    (_slug, page) => {
      const path = resolve(LEARN_DIR, page.slug, 'index.html');
      const html = readFileSync(path, 'utf8');
      const titleRe = /<title>([^<]+)<\/title>/;
      const m = html.match(titleRe);
      expect(
        m,
        `learn/${page.slug}/index.html has no <title>`
      ).not.toBeNull();
      if (!m) return;
      const title = m[1].trim();
      expect(
        title.startsWith(page.catalogTitle),
        `learn/${page.slug}/ <title> is "${title}" but should start with the catalog title "${page.catalogTitle}". Update the <title> or the catalog.`
      ).toBe(true);
    }
  );
});
