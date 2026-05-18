import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// JSON-LD Article/TechArticle "headline" parity with the visible
// <h1> on each nested page. The structured-data headline is what
// search engines use to construct the article title in rich
// snippets and what AI crawlers cite as the page's primary
// heading; it should match what a human reader sees as the page's
// h1 (stripping the trailing period that the editorial voice
// adds to every learn/philosophy/strategy page).
//
// This test fills the gap left by the earlier structured-data
// pins (breadcrumb-leaf-parity covers BreadcrumbList items but
// not Article/TechArticle headline). The headline drift class:
// a future edit that renames the visible h1 (say,
// strategies/momentum/ <h1> from "Time-series momentum." to
// "Time-series momentum: the trend factor.") would leave the
// JSON-LD headline stuck at the old wording until someone
// independently updated the structured-data block. Until that
// independent update, search engines would index the page under
// the old name while the page itself displayed the new one.
//
// The h1 vs catalog divergence is intentionally allowed (per
// iter 138/141): editorial h1s like "Time-series momentum." or
// "Enums as dispatch tables." are richer than the catalog's
// "Momentum" or "Enums and dispatch". This test pins the
// headline to the h1 (with trailing period stripped) rather than
// to the catalog title, so the JSON-LD echoes the page's actual
// editorial choice.

const ROOT = resolve(__dirname, '..', '..');

interface Section {
  dir: string;
  label: string;
}

const SECTIONS: Section[] = [
  { dir: 'strategies', label: 'strategies' },
  { dir: 'learn', label: 'learn' },
  { dir: 'philosophy', label: 'philosophy' },
  // Quiz pages do not have an Article/TechArticle JSON-LD block,
  // only a BreadcrumbList; they are excluded from this test.
];

function listSubdirSlugs(dir: string): string[] {
  const sectionDir = resolve(ROOT, dir);
  return readdirSync(sectionDir)
    .filter((entry) => {
      const p = resolve(sectionDir, entry);
      return statSync(p).isDirectory() && existsSync(resolve(p, 'index.html'));
    })
    .sort();
}

function extractH1(pageHtml: string): string | null {
  // Match the first <h1>...</h1> block, after stripping any inner
  // markup (strategy/learn/philosophy pages have plain text h1s).
  const re = /<h1[^>]*>([^<]+)<\/h1>/;
  const m = pageHtml.match(re);
  return m ? m[1].trim() : null;
}

function extractJsonLdHeadline(pageHtml: string): string | null {
  // Match the "headline" field anywhere on the page. Strategy/
  // learn/philosophy pages have exactly one TechArticle JSON-LD
  // block with a headline field; the regex matches the field
  // value without committing to a particular position within the
  // JSON.
  const re = /"headline"\s*:\s*"([^"]+)"/;
  const m = pageHtml.match(re);
  return m ? m[1] : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

for (const section of SECTIONS) {
  describe(`/${section.label}/ JSON-LD headline ↔ <h1> parity`, () => {
    const slugs = listSubdirSlugs(section.dir);

    it.each(slugs.map((s) => [s]))(
      `/${section.label}/%s/ JSON-LD headline matches the visible <h1> (period-stripped)`,
      (slug) => {
        const pagePath = resolve(ROOT, section.dir, slug, 'index.html');
        const pageHtml = readFileSync(pagePath, 'utf8');
        const h1 = extractH1(pageHtml);
        const headline = extractJsonLdHeadline(pageHtml);
        expect(
          h1,
          `${section.dir}/${slug}/index.html has no <h1>`
        ).not.toBeNull();
        expect(
          headline,
          `${section.dir}/${slug}/index.html has no JSON-LD "headline" field`
        ).not.toBeNull();
        if (!h1 || !headline) return;
        const h1NoPeriod = decodeEntities(h1).replace(/\.$/, '');
        expect(
          decodeEntities(headline),
          `${section.dir}/${slug}/index.html JSON-LD headline is "${headline}" but <h1> is "${h1}" (period-stripped: "${h1NoPeriod}"). The structured-data headline should echo the visible h1.`
        ).toBe(h1NoPeriod);
      }
    );
  });
}
