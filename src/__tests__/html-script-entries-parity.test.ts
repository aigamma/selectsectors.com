import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { resolve } from 'node:path';

// HTML-script-vs-TS-entries parity test. Every HTML page has a
// `<script type="module" src="/src/<name>.ts">` line that points
// at its per-page entry file. If someone renames a TS file but
// forgets to update the HTML reference (or adds an HTML page but
// forgets to write the entry file), the page would render but
// loading the script would 404, leaving the page without nav,
// footer, chat panel, and any per-page interactive behavior. Vite
// would not catch this in dev mode because dev serves files
// directly; only a production build + actual page load would
// surface the 404, and even then the page would still render the
// static content.
//
// The vite-pages-parity test (iter 86) checks that vite.config.ts
// input entries match the HTML files. This test checks the next
// layer down: that each HTML file's <script src="/src/X.ts">
// reference matches an actual src/X.ts file in the repo.

const ROOT = resolve(__dirname, '..', '..');
const EXCLUDED_DIRS = ['node_modules', 'dist', '.netlify', '.git', 'pkg', 'scratch'];

function isExcluded(p: string): boolean {
  return EXCLUDED_DIRS.some(
    (d) => p.includes(`${d}/`) || p.includes(`${d}\\`)
  );
}

interface ScriptRef {
  htmlFile: string;
  src: string;
  resolvedPath: string;
}

/**
 * Extract <script type="module" src="/src/..."> references from an
 * HTML file. The regex matches the standard Vite multi-page-app
 * shape used across this codebase.
 */
function extractScriptSrcs(html: string): string[] {
  const re = /<script\b[^>]*\bsrc="(\/src\/[^"]+\.ts)"/g;
  const srcs: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    srcs.push(m[1]);
  }
  return srcs;
}

async function collectScriptRefs(): Promise<ScriptRef[]> {
  const out: ScriptRef[] = [];
  for await (const entry of glob('**/*.html')) {
    const abs = resolve(ROOT, entry);
    if (isExcluded(abs)) continue;
    const html = readFileSync(abs, 'utf8');
    const srcs = extractScriptSrcs(html);
    for (const src of srcs) {
      // src is like "/src/main.ts"; resolve relative to ROOT.
      const resolvedPath = resolve(ROOT, src.slice(1));
      out.push({
        htmlFile: entry.replace(/\\/g, '/'),
        src,
        resolvedPath,
      });
    }
  }
  return out;
}

const refs = await collectScriptRefs();

describe('HTML <script src> entries parity', () => {
  it('found at least 25 script references across HTML files (sanity check)', () => {
    expect(refs.length).toBeGreaterThanOrEqual(25);
  });

  it.each(refs)(
    'HTML $htmlFile references existing TS entry at $src',
    ({ htmlFile, src, resolvedPath }) => {
      const exists = existsSync(resolvedPath);
      expect(
        exists,
        `${htmlFile} references ${src} but ${resolvedPath} does not exist`
      ).toBe(true);
    }
  );
});
