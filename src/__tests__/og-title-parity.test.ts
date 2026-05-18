import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

// Open Graph and Twitter Card title parity. Every shipped page has
// a <title>NAME &middot; SECTION? &middot; Select Sectors</title>
// tag and matching <meta property="og:title"> / <meta name="twitter:title">
// tags. The og:title and twitter:title should equal the <title>'s
// stem (the leading portion before the first " &middot; " or " · "
// separator); the trailing " · Section? · Select Sectors" suffix
// is identifying context for browser tabs and bookmarks but
// doesn't belong in social-share card previews where the brand
// suffix is shown separately by the platform.
//
// Iter 149 caught 13 pages with double-encoded "&amp;middot;" in
// their og:title/twitter:title (the literal text "&middot;" was
// being rendered visibly in social previews instead of the
// intended U+00B7 middot character); the fix normalized those
// titles to just the page-name stem (matching the existing
// convention on catalog/top-level pages that already used the
// simpler form). Three pages also had stale stems that diverged
// from the visible <title> (quiz/quant-finance, learn/ownership,
// learn/wasm) due to earlier title bumps that didn't propagate
// to og:title.
//
// This test catches both classes of drift going forward.

const ROOT = resolve(__dirname, '..', '..');

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
    name === 'docs' ||
    name === '.vscode'
  );
}

function findShippedIndexes(dir: string, files: string[]): void {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = resolve(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!shouldSkipDir(entry)) findShippedIndexes(full, files);
    } else if (st.isFile() && entry === 'index.html') {
      files.push(full);
    }
  }
}

function extractMetaContent(html: string, kind: 'name' | 'property', key: string): string | null {
  const re = new RegExp(
    `<meta\\s+(?:[^>]*?\\s)?${kind}="${key}"(?:\\s[^>]*?)?\\s+content="([^"]*)"`,
    'i'
  );
  const m = html.match(re);
  return m ? m[1] : null;
}

function extractTitle(html: string): string | null {
  const re = /<title>([^<]+)<\/title>/;
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Extract the leading "stem" portion of a <title> tag's text
 * (everything before the first separator " &middot; " or " · ").
 * The site convention is "<page name> &middot; <section?> &middot;
 * Select Sectors"; the page-name stem is what og:title and
 * twitter:title should echo.
 */
function extractTitleStem(title: string): string {
  // The HTML source carries the entity "&middot;" verbatim; when
  // the page is rendered, that becomes U+00B7. Split on either
  // form to be tolerant of representation.
  const splitRe = /\s+(?:&middot;|·)\s+/;
  const parts = title.split(splitRe);
  return parts[0].trim();
}

const shipped: string[] = [];
findShippedIndexes(ROOT, shipped);

describe('og:title and twitter:title parity with <title> stem', () => {
  it('discovered a meaningful number of shipped pages', () => {
    expect(shipped.length).toBeGreaterThan(20);
  });

  it.each(shipped.map((p) => [relative(ROOT, p).split(sep).join('/'), p]))(
    'page %s og:title matches <title> stem',
    (_label, absPath) => {
      const html = readFileSync(absPath, 'utf8');
      const ogTitle = extractMetaContent(html, 'property', 'og:title');
      const title = extractTitle(html);
      if (ogTitle === null || title === null) return; // page has no og:title or no <title>
      const stem = extractTitleStem(title);
      expect(
        ogTitle,
        `${relative(ROOT, absPath)} og:title is "${ogTitle}" but <title> stem is "${stem}" (from <title>"${title}"). The og:title should echo the page name without the section/brand suffix.`
      ).toBe(stem);
    }
  );

  it.each(shipped.map((p) => [relative(ROOT, p).split(sep).join('/'), p]))(
    'page %s twitter:title matches <title> stem',
    (_label, absPath) => {
      const html = readFileSync(absPath, 'utf8');
      const twitterTitle = extractMetaContent(html, 'name', 'twitter:title');
      const title = extractTitle(html);
      if (twitterTitle === null || title === null) return; // page has no twitter:title or no <title>
      const stem = extractTitleStem(title);
      expect(
        twitterTitle,
        `${relative(ROOT, absPath)} twitter:title is "${twitterTitle}" but <title> stem is "${stem}". The twitter:title should match og:title and the <title> stem.`
      ).toBe(stem);
    }
  );

  it.each(shipped.map((p) => [relative(ROOT, p).split(sep).join('/'), p]))(
    'page %s og:title does not contain double-encoded &amp;middot;',
    (_label, absPath) => {
      const html = readFileSync(absPath, 'utf8');
      const ogTitle = extractMetaContent(html, 'property', 'og:title');
      if (ogTitle === null) return;
      expect(
        ogTitle.includes('&amp;middot'),
        `${relative(ROOT, absPath)} og:title contains "&amp;middot" which double-encodes to literal text "&middot;" in social previews. Use either the literal · character or the single entity &middot; in attribute values.`
      ).toBe(false);
    }
  );
});
