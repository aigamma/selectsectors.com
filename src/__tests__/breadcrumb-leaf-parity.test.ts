import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Breadcrumb-leaf parity test. Every nested page under /strategies/,
// /learn/, /quiz/, and /philosophy/ has a breadcrumb at the top of
// the page (Home > Section > Leaf) where the leaf <li> carries
// aria-current="page" and the displayed text. That leaf text is
// the navigational label the user sees after clicking a catalog
// card; it should match the catalog's curriculum-title for that
// page so the navigation trail tells a coherent story (you clicked
// "Momentum" in the catalog, you arrive on a page whose breadcrumb
// also says "Momentum").
//
// Iter 142 caught three breadcrumb leaves that diverged from their
// catalog titles, in each case displaying the page's <h1> text
// instead:
//
//   - strategies/momentum: breadcrumb said "Time-series momentum"
//     (the h1 styling) while the catalog says "Momentum"
//   - learn/enums-and-dispatch: breadcrumb said "Enums as dispatch
//     tables" (the h1 styling) while the catalog says "Enums and
//     dispatch"
//   - learn/wasm: breadcrumb said "Rust to WebAssembly" (a stale
//     short form) while the catalog says "Rust to WebAssembly with
//     wasm-bindgen"
//
// All three were fixed in the same commit that added this test.
// The breadcrumb leaf is a navigational element; it follows the
// catalog title rather than the editorial h1 so the user sees the
// same label in the breadcrumb that they clicked in the catalog.
// The h1 retains its editorial freedom (per the iter-141 learn-
// titles-parity precedent).

const ROOT = resolve(__dirname, '..', '..');
const LAYOUT_PATH = resolve(ROOT, 'src', 'layout.ts');

interface Section {
  /** Directory under repo root. */
  dir: string;
  /** Display label for test names. */
  label: string;
  /** URL prefix used in catalog hrefs. */
  hrefPrefix: string;
}

const SECTIONS: Section[] = [
  { dir: 'strategies', label: 'strategies', hrefPrefix: '/strategies/' },
  { dir: 'learn', label: 'learn', hrefPrefix: '/learn/' },
  { dir: 'quiz', label: 'quiz', hrefPrefix: '/quiz/' },
  { dir: 'philosophy', label: 'philosophy', hrefPrefix: '/philosophy/' },
];

function extractNavLabelForHref(layoutSource: string, hrefPrefix: string): string | null {
  // Parse one NAV_LINKS entry by its `href` value. The NAV_LINKS
  // array is the source of truth for top-nav label text; the
  // breadcrumb ancestor on each nested page should display the same
  // label as the top-nav link to that section.
  const re = new RegExp(
    `\\{\\s*href:\\s*'${hrefPrefix.replace(/\//g, '\\/')}',\\s*label:\\s*'([^']+)'`
  );
  const m = layoutSource.match(re);
  return m ? m[1] : null;
}

function extractBreadcrumbAncestor(pageHtml: string, hrefPrefix: string): string | null {
  // Match <li><a href="<hrefPrefix>">LABEL</a></li>. The breadcrumb
  // ancestor sits between the Home anchor and the leaf <li>; its
  // href is the section landing page, its label is the displayed
  // text. The regex tolerates the various ways the link can be
  // formatted (with or without aria-label, class attribute) by
  // using non-greedy filler for any attributes inside the <a> tag.
  const re = new RegExp(
    `<li[^>]*>\\s*<a[^>]*href="${hrefPrefix.replace(/\//g, '\\/')}"[^>]*>([^<]+)<\\/a>`
  );
  const m = pageHtml.match(re);
  return m ? m[1].trim() : null;
}

function listSubdirSlugs(dir: string): string[] {
  const sectionDir = resolve(ROOT, dir);
  return readdirSync(sectionDir)
    .filter((entry) => {
      const p = resolve(sectionDir, entry);
      return statSync(p).isDirectory() && existsSync(resolve(p, 'index.html'));
    })
    .sort();
}

function extractCatalogTitle(catalogHtml: string, hrefPrefix: string, slug: string): string | null {
  const re = new RegExp(
    `href="${hrefPrefix}${slug}/?"[\\s\\S]*?<span class="curriculum-title">([^<]+)<\\/span>`
  );
  const m = catalogHtml.match(re);
  return m ? m[1].trim() : null;
}

function extractBreadcrumbLeaf(pageHtml: string): string | null {
  // Match <li aria-current="page">TEXT</li>. The leaf is the only
  // li that carries aria-current="page" in the breadcrumb component;
  // earlier siblings are <a> links to ancestor sections.
  const re = /<li aria-current="page">([^<]+)<\/li>/;
  const m = pageHtml.match(re);
  return m ? m[1].trim() : null;
}

// Decode the basic HTML entities our breadcrumbs use. The
// breadcrumb text occasionally contains &#39; for an apostrophe
// (e.g., "A tour of this site&#39;s Rust"); the catalog uses the
// literal apostrophe. Normalize before comparing.
function decodeEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

const layoutSource = readFileSync(LAYOUT_PATH, 'utf8');

for (const section of SECTIONS) {
  describe(`/${section.label}/ breadcrumb leaf + ancestor parity`, () => {
    const catalogPath = resolve(ROOT, section.dir, 'index.html');
    const catalogSource = readFileSync(catalogPath, 'utf8');
    const slugs = listSubdirSlugs(section.dir);
    const navLabel = extractNavLabelForHref(layoutSource, section.hrefPrefix);

    it(`NAV_LINKS in layout.ts declares a label for ${section.hrefPrefix}`, () => {
      expect(
        navLabel,
        `expected layout.ts NAV_LINKS to have an entry with href='${section.hrefPrefix}'`
      ).not.toBeNull();
    });

    it.each(slugs.map((s) => [s]))(
      `/${section.label}/%s/ breadcrumb ancestor link matches NAV_LINKS label for ${section.hrefPrefix}`,
      (slug) => {
        if (!navLabel) return; // covered by previous sanity test
        const pagePath = resolve(ROOT, section.dir, slug, 'index.html');
        const pageHtml = readFileSync(pagePath, 'utf8');
        const ancestor = extractBreadcrumbAncestor(pageHtml, section.hrefPrefix);
        expect(
          ancestor,
          `${section.dir}/${slug}/index.html breadcrumb has no <a href="${section.hrefPrefix}">...</a> ancestor link`
        ).not.toBeNull();
        if (!ancestor) return;
        expect(
          ancestor,
          `breadcrumb ancestor for /${section.label}/${slug}/ is "${ancestor}" but NAV_LINKS in layout.ts uses "${navLabel}" for ${section.hrefPrefix}. The top-nav label is the source of truth; update one or the other.`
        ).toBe(navLabel);
      }
    );

    it.each(slugs.map((s) => [s]))(
      `/${section.label}/%s/ breadcrumb leaf matches catalog curriculum-title`,
      (slug) => {
        const catalogTitle = extractCatalogTitle(
          catalogSource,
          section.hrefPrefix,
          slug
        );
        expect(
          catalogTitle,
          `${section.dir}/index.html has no curriculum-title for /${section.label}/${slug}/`
        ).not.toBeNull();
        if (!catalogTitle) return;

        const pagePath = resolve(ROOT, section.dir, slug, 'index.html');
        const pageHtml = readFileSync(pagePath, 'utf8');
        const leaf = extractBreadcrumbLeaf(pageHtml);
        expect(
          leaf,
          `${section.dir}/${slug}/index.html has no <li aria-current="page"> breadcrumb leaf`
        ).not.toBeNull();
        if (!leaf) return;

        expect(
          decodeEntities(leaf),
          `breadcrumb leaf for /${section.label}/${slug}/ is "${leaf}" but the catalog says "${catalogTitle}". The breadcrumb is a navigational label that should match what the user clicked.`
        ).toBe(catalogTitle);
      }
    );
  });
}
