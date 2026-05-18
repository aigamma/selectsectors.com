import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Sitemap-validity test. Every URL declared in public/sitemap.xml
// must correspond to an actual HTML file in the project root, so a
// future edit that renames a page or deletes a page without updating
// the sitemap breaks CI before it ships. Conversely, adding a new
// page without adding it to the sitemap is also worth catching, but
// we let that go for now because new-page-not-yet-in-sitemap is a
// common transient state during development; the sitemap is updated
// at commit time, not at file-creation time.
//
// The test runs against the source files (public/sitemap.xml + the
// repo's HTML files), not the built dist/ output, so it doesn't
// require a build step to run.

const ROOT = resolve(__dirname, '..', '..');
const SITEMAP_PATH = resolve(ROOT, 'public', 'sitemap.xml');
const BASE_URL_RE = /^https?:\/\/[^/]+\//;

function extractUrls(sitemapXml: string): string[] {
  const re = /<loc>([^<]+)<\/loc>/g;
  const urls: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sitemapXml)) !== null) {
    urls.push(m[1]);
  }
  return urls;
}

function urlToFilePath(url: string): string {
  const path = url.replace(BASE_URL_RE, '');
  if (path === '') return 'index.html';
  if (path.endsWith('/')) return path + 'index.html';
  return path;
}

const sitemap = readFileSync(SITEMAP_PATH, 'utf8');
const urls = extractUrls(sitemap);

describe('sitemap.xml', () => {
  it('has at least 25 URLs (covers the full v0.1.0 surface)', () => {
    expect(urls.length).toBeGreaterThanOrEqual(25);
  });

  it('contains the four canonical landing URLs', () => {
    const expected = [
      'https://selectsectors.com/',
      'https://selectsectors.com/learn/',
      'https://selectsectors.com/strategies/',
      'https://selectsectors.com/philosophy/',
    ];
    for (const url of expected) {
      expect(urls).toContain(url);
    }
  });

  it.each(urls)('URL %s maps to an existing HTML file', (url) => {
    const filePath = urlToFilePath(url);
    const fullPath = resolve(ROOT, filePath);
    expect(existsSync(fullPath), `missing file for ${url}: ${fullPath}`).toBe(true);
  });
});
