import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

// Canonical URL parity. Every page that ships a Open Graph url
// meta tag, a JSON-LD url field, and/or a JSON-LD mainEntityOfPage
// @id field must have those three URLs all agree with each other
// AND with the URL derived from the page's actual file path in the
// repo. If a page is moved (e.g., learn/wasm/ -> learn/webassembly/)
// without updating the meta tags and structured data, search
// engines surface the page under the old canonical URL while the
// actual file lives at the new path, breaking link relevance and
// social-share previews.
//
// The canonical URL convention:
//   - index.html (root) -> https://selectsectors.com/
//   - <section>/index.html -> https://selectsectors.com/<section>/
//   - <section>/<slug>/index.html -> https://selectsectors.com/<section>/<slug>/
//
// 404.html is excluded because it has noindex and no og:url.

const ROOT = resolve(__dirname, '..', '..');
const SITE_ORIGIN = 'https://selectsectors.com';

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

function fileToCanonicalUrl(absPath: string): string {
  const rel = relative(ROOT, absPath).split(sep).join('/');
  if (rel === 'index.html') return `${SITE_ORIGIN}/`;
  if (rel.endsWith('/index.html')) {
    return `${SITE_ORIGIN}/${rel.slice(0, -'index.html'.length)}`;
  }
  return `${SITE_ORIGIN}/${rel}`;
}

function extractMetaContent(html: string, kind: 'name' | 'property', key: string): string | null {
  const re = new RegExp(
    `<meta\\s+(?:[^>]*?\\s)?${kind}="${key}"(?:\\s[^>]*?)?\\s+content="([^"]*)"`,
    'i'
  );
  const m = html.match(re);
  if (m) return m[1];
  const reReversed = new RegExp(
    `<meta\\s+(?:[^>]*?\\s)?content="([^"]*)"(?:\\s[^>]*?)?\\s+${kind}="${key}"`,
    'i'
  );
  const mReversed = html.match(reReversed);
  return mReversed ? mReversed[1] : null;
}

function extractJsonLdTopLevelUrl(html: string): string | null {
  // Match the FIRST "url" field that appears alongside a top-level
  // "@type" in an Article/TechArticle JSON-LD block. The simpler
  // approach: find the JSON-LD <script> block, then within that
  // block find the FIRST "url" that is not nested inside an inner
  // object. The current pages have "url" as a top-level field on
  // the Article, and nested "url" values inside author/publisher/
  // image objects; we want the top-level one.
  const blockRe = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/;
  const m = html.match(blockRe);
  if (!m) return null;
  const body = m[1];
  // Find a "url" that appears at the same indentation as "@context"
  // (the top-level fields). Heuristic: the first "url" that follows
  // "@context" and precedes any nested object opener "{". The pages
  // have the top-level "url" early in the block; this works for the
  // current shape.
  const urlAfterContextRe = /"@context"[\s\S]*?"url"\s*:\s*"([^"]+)"/;
  const um = body.match(urlAfterContextRe);
  return um ? um[1] : null;
}

function extractJsonLdMainEntityId(html: string): string | null {
  // mainEntityOfPage carries an @id that should equal the canonical
  // URL for the page.
  const re = /"mainEntityOfPage"\s*:\s*\{[^}]*?"@id"\s*:\s*"([^"]+)"/;
  const m = html.match(re);
  return m ? m[1] : null;
}

const shipped: string[] = [];
findShippedIndexes(ROOT, shipped);

describe('canonical URL parity (og:url, JSON-LD url, @id all match file path)', () => {
  it('discovered a meaningful number of shipped pages', () => {
    expect(shipped.length).toBeGreaterThan(20);
  });

  it.each(shipped.map((p) => [relative(ROOT, p).split(sep).join('/'), p]))(
    'page %s og:url matches canonical URL derived from file path',
    (_label, absPath) => {
      const html = readFileSync(absPath, 'utf8');
      const ogUrl = extractMetaContent(html, 'property', 'og:url');
      if (ogUrl === null) return; // page has no og:url, skip
      const expected = fileToCanonicalUrl(absPath);
      expect(
        ogUrl,
        `${relative(ROOT, absPath)} og:url is "${ogUrl}" but canonical URL is "${expected}". Update the meta tag.`
      ).toBe(expected);
    }
  );

  it.each(shipped.map((p) => [relative(ROOT, p).split(sep).join('/'), p]))(
    'page %s JSON-LD top-level url matches canonical URL',
    (_label, absPath) => {
      const html = readFileSync(absPath, 'utf8');
      const jsonLdUrl = extractJsonLdTopLevelUrl(html);
      if (jsonLdUrl === null) return; // no JSON-LD with top-level url
      const expected = fileToCanonicalUrl(absPath);
      expect(
        jsonLdUrl,
        `${relative(ROOT, absPath)} JSON-LD url is "${jsonLdUrl}" but canonical URL is "${expected}". Update the structured-data block.`
      ).toBe(expected);
    }
  );

  it.each(shipped.map((p) => [relative(ROOT, p).split(sep).join('/'), p]))(
    'page %s JSON-LD mainEntityOfPage @id matches canonical URL',
    (_label, absPath) => {
      const html = readFileSync(absPath, 'utf8');
      const id = extractJsonLdMainEntityId(html);
      if (id === null) return; // no mainEntityOfPage, skip
      const expected = fileToCanonicalUrl(absPath);
      expect(
        id,
        `${relative(ROOT, absPath)} JSON-LD mainEntityOfPage @id is "${id}" but canonical URL is "${expected}". Update the structured-data block.`
      ).toBe(expected);
    }
  );
});
