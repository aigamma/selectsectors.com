import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SECTORS } from '../universe-roster.mts';

// README.md universe-table parity. The README has a hardcoded
// table listing the 11 SPDR sector ETFs as a comma-separated row:
// "XLB, XLC, XLE, XLF, XLI, XLK, XLP, XLU, XLV, XLY, XLRE". The
// universe-roster.mts SECTORS array is the source-of-truth; the
// iter-128 api-docs-universe-example-parity test pins the same
// list inside the api-docs/index.html JSON example. This file
// extends the pin to the README table.
//
// If a future iteration adds a 12th SPDR sector (e.g., a new
// theme-sector ETF launched by State Street and rolled into the
// public-site universe), the universe-roster array changes and
// the live /api/universe response changes; the README table
// would still claim 11 sectors with the old list. This test
// catches that drift.

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const README_PATH = resolve(ROOT, 'README.md');

function extractSectorList(readme: string): string[] | null {
  // Match the table row: "SPDR sector ETFs (<N>) | <comma-separated>"
  // and capture the comma-separated cell.
  const re = /SPDR\s+sector\s+ETFs\s*\(\d+\)\s*\|\s*([A-Z][A-Z\s,]*[A-Z])/;
  const m = readme.match(re);
  if (!m) return null;
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const readme = readFileSync(README_PATH, 'utf8');
const declared = extractSectorList(readme);

describe('README universe table parity', () => {
  it('README has a parseable "SPDR sector ETFs" row', () => {
    expect(
      declared,
      `expected "SPDR sector ETFs (N) | <symbols>" row in README.md`
    ).not.toBeNull();
  });

  it('README sectors row matches SECTORS array order and contents', () => {
    expect(
      declared,
      `expected README sectors row ${JSON.stringify(declared)} to equal SECTORS ${JSON.stringify(SECTORS)}`
    ).toEqual(SECTORS);
  });
});
