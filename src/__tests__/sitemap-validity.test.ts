import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

// Sitemap-validity test. Bidirectional check:
//
//   1. Every URL declared in public/sitemap.xml must correspond to
//      an actual HTML file in the project (a rename or delete that
//      forgets to update the sitemap breaks CI before it ships).
//   2. Every shipped index.html in the project must appear in the
//      sitemap (a new page that forgets to add itself to the
//      sitemap is invisible to crawlers; iter 126 added this check
//      after the site reached a steady-state where new-page work is
//      rare enough that the "transient missing-from-sitemap state"
//      that prompted the original looseness is no longer worth
//      tolerating).
//
// Pages with <meta name="robots" content="noindex"> are exempt
// from the reverse check (e.g., 404.html which is intentionally
// noindexed and intentionally not in the sitemap).
//
// The test runs against the source files (public/sitemap.xml +
// the repo's HTML files), not the built dist/ output, so it doesn't
// require a build step to run.

const ROOT = resolve(__dirname, '..', '..');
const SITEMAP_PATH = resolve(ROOT, 'public', 'sitemap.xml');
const BASE_URL_RE = /^https?:\/\/[^/]+\//;
const SITE_ORIGIN = 'https://selectsectors.com';

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
const urlSet = new Set(urls);

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

/**
 * Walk the repo for HTML files that represent shipped pages. An
 * index.html under a content directory (e.g. learn/why-rust/index.html)
 * is a page; 404.html is also a page (special-cased below for the
 * noindex exemption).
 */
function findShippedHtmlFiles(dir: string, files: string[]): void {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = resolve(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!shouldSkipDir(entry)) findShippedHtmlFiles(full, files);
    } else if (st.isFile()) {
      if (entry === 'index.html' || entry === '404.html') {
        files.push(full);
      }
    }
  }
}

function fileToCanonicalUrl(absPath: string): string {
  const rel = relative(ROOT, absPath).split(sep).join('/');
  if (rel === 'index.html') return `${SITE_ORIGIN}/`;
  if (rel === '404.html') return `${SITE_ORIGIN}/404`;
  if (rel.endsWith('/index.html')) {
    return `${SITE_ORIGIN}/${rel.slice(0, -'index.html'.length)}`;
  }
  return `${SITE_ORIGIN}/${rel}`;
}

function pageIsNoindex(filePath: string): boolean {
  const html = readFileSync(filePath, 'utf8');
  return /<meta\s+name="robots"\s+content="noindex"/i.test(html);
}

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

describe('sitemap.xml reverse coverage', () => {
  const shipped: string[] = [];
  findShippedHtmlFiles(ROOT, shipped);

  it('discovers a meaningful number of shipped HTML pages', () => {
    // The site has ~30 pages at v0.1.4; this guards against a
    // walker bug that accidentally excludes most pages.
    expect(shipped.length).toBeGreaterThan(20);
  });

  it.each(shipped.map((p) => [relative(ROOT, p), p]))(
    'page %s is in the sitemap (or is noindex)',
    (_label, absPath) => {
      if (pageIsNoindex(absPath)) return; // exempt
      const url = fileToCanonicalUrl(absPath);
      expect(
        urlSet.has(url),
        `${relative(ROOT, absPath)} exists and is not noindex but is not listed in public/sitemap.xml as ${url}. ` +
          `Add it to the sitemap or mark it noindex.`
      ).toBe(true);
    }
  );
});
