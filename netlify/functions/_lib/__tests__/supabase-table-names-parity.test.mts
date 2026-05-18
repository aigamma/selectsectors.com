import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Supabase table names parity. The function layer queries three
// Supabase tables: daily_eod, daily_volatility_stats, and
// spx_intraday_bars (the latter is mentioned in docs but not yet
// queried — it's documented as the SPX 30-minute bar source for a
// future use case). The same table names appear as identifiers in
// README.md and docs/architecture.md (in the data-layer table and
// in prose).
//
// If a future iteration renames a table (or the upstream
// aigamma.com EOD pipeline changes a table name in the shared
// Supabase project), the function code is the runtime source of
// truth — queries against the wrong name will fail at request
// time with a Supabase 404. The documentation references must
// update in lockstep to avoid telling users (or maintainers) the
// wrong name.
//
// The test extracts every `.from('<name>')` argument from the
// .mts files under netlify/functions/ (excluding tests) and
// asserts each captured name appears verbatim in README.md.
// Names mentioned in README but not queried in code (like the
// "snapshots" table from the upstream aigamma.com pipeline that
// READS daily_volatility_stats from) are not flagged because
// they describe upstream state that selectsectors.com does not
// query directly.

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const FUNCTIONS_DIR = resolve(ROOT, 'netlify', 'functions');
const README_PATH = resolve(ROOT, 'README.md');
const ARCHITECTURE_MD_PATH = resolve(ROOT, 'docs', 'architecture.md');

function extractQueriedTableNames(): Set<string> {
  const names = new Set<string>();
  const re = /\.from\(\s*['"]([a-z][a-z0-9_]*)['"]\s*\)/g;
  for (const entry of readdirSync(FUNCTIONS_DIR)) {
    if (!entry.endsWith('.mts')) continue;
    const source = readFileSync(resolve(FUNCTIONS_DIR, entry), 'utf8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      names.add(m[1]);
    }
  }
  return names;
}

const queriedTables = [...extractQueriedTableNames()].sort();

describe('Supabase table names parity', () => {
  it('extracted at least 2 unique table names from netlify/functions/', () => {
    expect(
      queriedTables.length,
      `expected to find .from('<name>') Supabase calls in netlify/functions/*.mts; found ${queriedTables.length}`
    ).toBeGreaterThanOrEqual(2);
  });

  it.each(queriedTables)(
    'README.md mentions the queried table "%s"',
    (table) => {
      const readme = readFileSync(README_PATH, 'utf8');
      // Match the table name wrapped in backticks (which is how
      // the README formats Supabase identifiers) OR as a bare
      // identifier surrounded by word boundaries.
      const re = new RegExp(`\\b${table}\\b`);
      expect(
        re.test(readme),
        `function layer queries Supabase table "${table}" but README.md does not mention it`
      ).toBe(true);
    }
  );

  it.each(queriedTables)(
    'docs/architecture.md mentions the queried table "%s"',
    (table) => {
      const md = readFileSync(ARCHITECTURE_MD_PATH, 'utf8');
      const re = new RegExp(`\\b${table}\\b`);
      expect(
        re.test(md),
        `function layer queries Supabase table "${table}" but docs/architecture.md does not mention it`
      ).toBe(true);
    }
  );
});
