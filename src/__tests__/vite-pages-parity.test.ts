import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { resolve } from 'node:path';

// Vite-config-vs-HTML-pages parity test. The vite.config.ts `input`
// map enumerates every HTML page that the production build should
// emit; each entry corresponds to one HTML file in the repo and its
// per-page JS bundle. If someone adds a new HTML page (say, a new
// strategy explainer under /strategies/<name>/) but forgets to add
// the matching `input` entry, the build silently emits the HTML
// without its hashed JS asset, and the page would render with no
// interactive behavior (no nav mount, no chat panel, no form
// handler).
//
// This test asserts the bidirectional match: every HTML file in the
// content directories has a matching vite.config.ts input entry, and
// every input entry corresponds to a real HTML file. Excludes
// dist/, node_modules/, and other non-source paths.

const ROOT = resolve(__dirname, '..', '..');
const VITE_CONFIG_PATH = resolve(ROOT, 'vite.config.ts');
const EXCLUDED_DIRS = ['node_modules', 'dist', '.netlify', '.git', 'pkg', 'scratch'];

function isExcluded(p: string): boolean {
  return EXCLUDED_DIRS.some(
    (d) => p.includes(`${d}/`) || p.includes(`${d}\\`)
  );
}

/**
 * Read vite.config.ts as text and extract the relative paths from
 * the `input` map's resolve() calls. Each entry looks like
 *   key: resolve(__dirname, 'foo/bar/index.html')
 * (sometimes split across multiple lines). The regex looks for the
 * second argument of resolve(__dirname, ...) calls.
 */
function extractInputPaths(viteConfigSource: string): string[] {
  const re = /resolve\(\s*__dirname\s*,\s*['"]([^'"]+)['"]\s*\)/g;
  const paths: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(viteConfigSource)) !== null) {
    paths.push(m[1].replace(/\\/g, '/'));
  }
  return paths;
}

/**
 * Walk the repo for every committed HTML file, normalize to forward
 * slashes, return the list of relative paths.
 */
async function findHtmlFiles(): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of glob('**/*.html')) {
    const abs = resolve(ROOT, entry);
    if (isExcluded(abs)) continue;
    out.push(entry.replace(/\\/g, '/'));
  }
  return out.sort();
}

const viteConfigSource = readFileSync(VITE_CONFIG_PATH, 'utf8');
const declared = new Set(extractInputPaths(viteConfigSource));
const actual = new Set(await findHtmlFiles());

describe('vite-config-vs-HTML-pages parity', () => {
  it('extracted at least 25 input entries from vite.config.ts (sanity check)', () => {
    expect(declared.size).toBeGreaterThanOrEqual(25);
  });

  it('found at least 25 HTML files in the repo (sanity check)', () => {
    expect(actual.size).toBeGreaterThanOrEqual(25);
  });

  it('every HTML file is registered in vite.config.ts input map', () => {
    const missing = [...actual].filter((p) => !declared.has(p));
    expect(
      missing,
      `HTML files exist but are not registered in vite.config.ts: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('every vite.config.ts input entry points at an existing HTML file', () => {
    const orphaned = [...declared].filter((p) => !actual.has(p));
    expect(
      orphaned,
      `vite.config.ts input entries point at missing HTML files: ${orphaned.join(', ')}`
    ).toEqual([]);
  });
});
