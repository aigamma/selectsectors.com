import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Internal-link checker. Walks every committed HTML file in the
// repo, extracts each `<a href="/...">` (internal, not protocol-
// relative, not external), and verifies the target maps to an
// existing HTML file. Catches a real class of bug that the
// sitemap-validity test doesn't: a typo in a per-page link that's
// never going to be in the sitemap (e.g., a Try-it link with the
// wrong strategy slug, a breadcrumb pointing at a renamed page).
//
// Rules:
//   - Only checks paths starting with `/` (absolute internal links).
//   - Skips paths starting with `//` (protocol-relative external).
//   - Skips paths with `:` or `#` after the `/` (external schemes,
//     anchor-only references).
//   - Trailing-slash paths (e.g., /learn/) map to learn/index.html.
//   - Direct .html paths map to themselves.
//   - The `/api/*` namespace is the Netlify Functions surface; not
//     a filesystem path, so we skip those.

const ROOT = resolve(__dirname, '..', '..');
const EXCLUDED_DIRS = ['node_modules', 'dist', '.netlify', '.git', 'pkg', 'scratch'];

function isExcluded(p: string): boolean {
  return EXCLUDED_DIRS.some(
    (d) => p.includes(`${d}/`) || p.includes(`${d}\\`)
  );
}

function extractInternalLinks(html: string): string[] {
  const re = /<a\b[^>]*\bhref="(\/[^"#?][^"]*)"/g;
  const links: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    links.push(m[1]);
  }
  return links;
}

function linkToFilePath(link: string): string | null {
  // Skip the Netlify-function namespace.
  if (link.startsWith('/api/')) return null;
  // Skip the .well-known reserved namespace.
  if (link.startsWith('/.well-known/')) return null;
  // /xyz/ -> xyz/index.html
  if (link.endsWith('/')) {
    return link === '/' ? 'index.html' : link.slice(1) + 'index.html';
  }
  // /xyz.html -> xyz.html
  if (link.endsWith('.html')) {
    return link.slice(1);
  }
  // /xyz -> xyz/index.html OR xyz.html (try both)
  return null; // not used in this site's link shapes
}

async function listHtmlFiles(): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of glob('**/*.html')) {
    const abs = resolve(ROOT, entry);
    if (isExcluded(abs)) continue;
    out.push(abs);
  }
  return out;
}

const allFiles = await listHtmlFiles();

interface BrokenLink {
  source: string;
  link: string;
  expectedFile: string;
}

const allBroken: BrokenLink[] = [];
const seenLinks = new Set<string>();

for (const file of allFiles) {
  const html = readFileSync(file, 'utf8');
  const links = extractInternalLinks(html);
  for (const link of links) {
    const cleanLink = link.split('?')[0].split('#')[0];
    if (!cleanLink) continue;
    const filePath = linkToFilePath(cleanLink);
    if (filePath === null) continue; // skipped namespace
    seenLinks.add(cleanLink);
    const fullPath = join(ROOT, filePath);
    try {
      readFileSync(fullPath);
    } catch {
      allBroken.push({
        source: file.replace(ROOT + '\\', '').replace(ROOT + '/', ''),
        link: cleanLink,
        expectedFile: filePath,
      });
    }
  }
}

describe('internal links', () => {
  it('found at least 20 distinct internal hrefs (sanity check that the regex caught anything)', () => {
    expect(seenLinks.size).toBeGreaterThanOrEqual(20);
  });

  it('every internal link points at an existing HTML file', () => {
    if (allBroken.length > 0) {
      const summary = allBroken
        .map((b) => `  ${b.source} → ${b.link} (expected ${b.expectedFile})`)
        .join('\n');
      throw new Error(`Found ${allBroken.length} broken internal link(s):\n${summary}`);
    }
  });
});
