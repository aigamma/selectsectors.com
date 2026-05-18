import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { resolve } from 'node:path';

// Env-vars-parity source-of-truth test. The function layer reads
// environment variables via Netlify.env.get('VAR'); .env.example
// documents the set of vars a developer needs to know about (the
// 3 manually-set vars: SUPABASE_URL + SUPABASE_ANON_KEY +
// ANTHROPIC_API_KEY, plus the 4 Netlify-auto-set vars: URL +
// DEPLOY_URL + COMMIT_REF + DEPLOY_ID). If a future iteration adds
// a function that reads NEW_VAR but forgets to document it in
// .env.example, a developer reading .env.example gets a stale
// view: they assume those are the only env vars the functions
// read, when in fact one more is required for the function to
// work correctly.
//
// This test extracts the set of vars actually read from the
// netlify/functions/ tree and asserts the same set appears as
// declared keys in .env.example.

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const ENV_EXAMPLE_PATH = resolve(ROOT, '.env.example');
const FUNCTIONS_DIR = resolve(ROOT, 'netlify', 'functions');

/**
 * Extract the var names declared as `VAR=` lines in .env.example.
 * Returns the set of unique var names.
 */
function extractDeclaredVars(envExampleSource: string): Set<string> {
  const re = /^([A-Z][A-Z0-9_]*)\s*=/gm;
  const vars = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(envExampleSource)) !== null) {
    vars.add(m[1]);
  }
  return vars;
}

/**
 * Extract the var names referenced as `Netlify.env.get('VAR')` calls
 * across every .mts file in netlify/functions/. Walks the tree to
 * find all .mts files, reads them, and accumulates the matched
 * names.
 */
async function extractUsedVars(): Promise<Set<string>> {
  const re = /Netlify\.env\.get\(\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\)/g;
  const used = new Set<string>();
  for await (const entry of glob('netlify/functions/**/*.mts', { cwd: ROOT })) {
    // Skip __tests__ directories: the test files' own comments
    // mention Netlify.env.get('VAR') as documentation, and that
    // would otherwise be picked up as a "used" var. The .mts files
    // outside __tests__ are the actual production function code.
    if (entry.includes('__tests__')) continue;
    const path = resolve(ROOT, entry);
    const source = readFileSync(path, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      used.add(m[1]);
    }
  }
  return used;
}

const declared = extractDeclaredVars(readFileSync(ENV_EXAMPLE_PATH, 'utf8'));
const used = await extractUsedVars();

describe('env vars parity (.env.example vs function-layer reads)', () => {
  it('found at least 4 declared vars in .env.example (sanity check)', () => {
    expect(declared.size).toBeGreaterThanOrEqual(4);
  });

  it('found at least 4 used vars across netlify/functions/ (sanity check)', () => {
    expect(used.size).toBeGreaterThanOrEqual(4);
  });

  it('every var read by a function is documented in .env.example', () => {
    const missing = [...used].filter((v) => !declared.has(v));
    expect(
      missing,
      `function-layer reads these vars but .env.example does not declare them: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('every var declared in .env.example is read by at least one function', () => {
    // The other direction: if .env.example documents a var no
    // function reads, the documentation is misleading (a developer
    // would set the var expecting it to take effect, but no
    // function reads it). Strict equality would also catch the
    // case where the codebase removed the only reader of a var
    // without removing the .env.example entry.
    const orphaned = [...declared].filter((v) => !used.has(v));
    expect(
      orphaned,
      `.env.example declares these vars but no function reads them: ${orphaned.join(', ')}`
    ).toEqual([]);
  });
});
