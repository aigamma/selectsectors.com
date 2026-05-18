import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// Production HTML page count parity. The README ("33 production
// HTML pages total") and the changelog meta description ("Currently
// v0.1.4 with 33 production pages") both mention the count.
// Definition of "production page": every index.html file in the
// repo (one per directory) plus the root index.html. 404.html is
// excluded because it is intentionally noindexed and serves the
// catch-all 404 response, not a content page.
//
// The iter-150 README test count was made drift-proof; this is
// the page-count claim which IS still numeric and SHOULD be drift-
// catchable. Iter 164 caught both surfaces stale at "31" while the
// actual count is 33 (the addition of /glossary/ and /api-docs/
// in v0.1.3 brought the total from the original ~31 to 33; the
// documentation claims were not propagated).

const ROOT = resolve(__dirname, '..', '..');
const README_PATH = resolve(ROOT, 'README.md');
const CHANGELOG_PATH = resolve(ROOT, 'changelog', 'index.html');

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

function countIndexPages(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!shouldSkipDir(entry)) count += countIndexPages(full);
    } else if (st.isFile() && entry === 'index.html') {
      count++;
    }
  }
  return count;
}

const liveCount = countIndexPages(ROOT);

describe('production HTML page count parity', () => {
  it('found a meaningful number of production HTML pages', () => {
    expect(liveCount, `expected >20 production pages; found ${liveCount}`).toBeGreaterThan(20);
  });

  it('README.md claims the correct production page count', () => {
    const source = readFileSync(README_PATH, 'utf8');
    // Match: "<N> production HTML pages total" - capture N for the
    // failure message.
    const re = /(\d+)\s+production\s+HTML\s+pages\s+total/i;
    const m = source.match(re);
    expect(
      m,
      `expected "<N> production HTML pages total" pattern in README.md`
    ).not.toBeNull();
    if (!m) return;
    expect(
      parseInt(m[1], 10),
      `README.md says ${m[1]} pages but actual count is ${liveCount}. Update README or the page list.`
    ).toBe(liveCount);
  });

  it('changelog meta description claims the correct production page count', () => {
    const source = readFileSync(CHANGELOG_PATH, 'utf8');
    // Match: "Currently v<version> with <N> production pages"
    const re = /Currently\s+v[\d.]+\s+with\s+(\d+)\s+production\s+pages/i;
    const m = source.match(re);
    expect(
      m,
      `expected "Currently v... with <N> production pages" pattern in changelog/index.html`
    ).not.toBeNull();
    if (!m) return;
    expect(
      parseInt(m[1], 10),
      `changelog meta description says ${m[1]} pages but actual count is ${liveCount}. Update the meta description.`
    ).toBe(liveCount);
  });
});
