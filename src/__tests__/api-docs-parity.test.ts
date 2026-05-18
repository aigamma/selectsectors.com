import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// API docs parity test. /api-docs/index.html is the public-facing
// HTTP API reference for selectsectors.com. Every user-callable
// Netlify Function under netlify/functions/ must have a matching
// <h3>METHOD /api/<name></h3> heading on the docs page, and every
// such heading on the docs page must correspond to a real function.
//
// "User-callable" means: a function whose filename ends in `.mts`
// (the Netlify Functions TypeScript convention this repo uses), but
// not one ending in `-background.mts` (background functions are
// dispatched internally by their synchronous companion and are not
// callable directly by clients) and not files under the _lib/
// subdirectory (shared helpers, not endpoints) or __tests__/
// (tests).
//
// Why this matters: the api-docs page is the single source of truth
// for what the public API surface is; a new endpoint added to the
// netlify/functions/ directory but not documented is invisible to
// any consumer reading the docs, and a docs heading for an
// endpoint that has been deleted is a 404 trap. The forward and
// reverse checks together pin both drift directions.

const ROOT = resolve(__dirname, '..', '..');
const FUNCTIONS_DIR = resolve(ROOT, 'netlify', 'functions');
const API_DOCS_PATH = resolve(ROOT, 'api-docs', 'index.html');

interface FunctionEndpoint {
  /** Endpoint name (filename without .mts). Becomes /api/<name>. */
  name: string;
  /** Absolute path to the .mts file. */
  path: string;
}

function listUserCallableFunctions(): FunctionEndpoint[] {
  return readdirSync(FUNCTIONS_DIR)
    .filter((entry) => {
      if (!entry.endsWith('.mts')) return false;
      if (entry.endsWith('-background.mts')) return false;
      return true;
    })
    .map((entry) => ({
      name: entry.replace(/\.mts$/, ''),
      path: resolve(FUNCTIONS_DIR, entry),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function findDocsEndpoints(html: string): string[] {
  // Match <h3>METHOD /api/<name></h3> or <h3>METHOD /api/<name>?...</h3>.
  // The query-string suffix on /api/result?hash=<hex> needs to be
  // tolerated so we just capture the path segment up to the first
  // non-identifier character. Method (GET/POST) is required but
  // not captured; only the endpoint name is.
  const re = /<h3>(?:GET|POST)\s+\/api\/([a-z0-9-]+)/gi;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    names.add(m[1]);
  }
  return [...names].sort();
}

const functions = listUserCallableFunctions();
const docsHtml = readFileSync(API_DOCS_PATH, 'utf8');
const docsEndpoints = findDocsEndpoints(docsHtml);
const docsSet = new Set(docsEndpoints);
const functionsSet = new Set(functions.map((f) => f.name));

describe('netlify functions ↔ /api-docs/ parity', () => {
  it('discovers a meaningful number of user-callable functions', () => {
    // Sanity check guarding against a walker bug that returns empty.
    expect(functions.length).toBeGreaterThan(5);
  });

  it('discovers a meaningful number of /api-docs/ endpoint headings', () => {
    expect(docsEndpoints.length).toBeGreaterThan(5);
  });

  it.each(functions.map((f) => [f.name]))(
    'function %s has a matching <h3>METHOD /api/%s</h3> in api-docs',
    (name) => {
      expect(
        docsSet.has(name),
        `netlify/functions/${name}.mts exists but /api-docs/index.html has no <h3>METHOD /api/${name}</h3> heading. ` +
          `Add the endpoint to the docs page or delete the function.`
      ).toBe(true);
    }
  );

  it.each(docsEndpoints.map((name) => [name]))(
    '/api-docs/ heading /api/%s has a matching netlify function file',
    (name) => {
      expect(
        functionsSet.has(name),
        `/api-docs/index.html documents <h3>/api/${name}</h3> but netlify/functions/${name}.mts does not exist. ` +
          `Remove the docs section or restore the function file.`
      ).toBe(true);
    }
  );
});
