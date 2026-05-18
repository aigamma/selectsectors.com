import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { STRATEGY_DEFAULTS } from '../strategy.mts';

// api-docs /api/health example: strategies-array parity. The
// api-docs/index.html page shows a sample JSON response for the
// GET /api/health endpoint that includes a "strategies" array
// listing the strategy keys the WASM engine knows about. The live
// /api/health implementation in netlify/functions/health.mts
// computes that array as Object.keys(STRATEGY_DEFAULTS); the docs
// example must list the same names in the same order. If a future
// iteration adds a 7th strategy to STRATEGY_DEFAULTS, the live
// endpoint's response automatically includes it, but the docs
// JSON example would still show the old 6-name list until the
// page is manually updated.
//
// The iter-128 api-docs-universe-example-parity test does the
// same for the /api/universe sectors and anchors arrays; this is
// the equivalent for /api/health's strategies array.

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const API_DOCS_PATH = resolve(ROOT, 'api-docs', 'index.html');

function extractStrategiesArray(html: string): string[] | null {
  // Match: "strategies": [
  //   "name1",
  //   "name2",
  //   ...
  // ]
  // The opening "strategies": [ ... ] block. Use [\s\S] to allow
  // newlines inside the array body.
  const re = /"strategies"\s*:\s*\[([\s\S]*?)\]/;
  const m = html.match(re);
  if (!m) return null;
  const body = m[1];
  const stringRe = /"([a-z][a-z0-9_]*)"/g;
  const out: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = stringRe.exec(body)) !== null) {
    out.push(sm[1]);
  }
  return out;
}

const apiDocs = readFileSync(API_DOCS_PATH, 'utf8');
const exampleStrategies = extractStrategiesArray(apiDocs);
const liveStrategies = Object.keys(STRATEGY_DEFAULTS);

describe('api-docs /api/health "strategies" example parity', () => {
  it('extracts a "strategies" array from the api-docs example', () => {
    expect(
      exampleStrategies,
      `expected a "strategies": [...] block in api-docs/index.html`
    ).not.toBeNull();
    if (exampleStrategies) {
      expect(exampleStrategies.length).toBeGreaterThan(0);
    }
  });

  it('example matches Object.keys(STRATEGY_DEFAULTS) order and contents', () => {
    expect(
      exampleStrategies,
      `expected example strategies ${JSON.stringify(exampleStrategies)} to equal Object.keys(STRATEGY_DEFAULTS) ${JSON.stringify(liveStrategies)}`
    ).toEqual(liveStrategies);
  });
});
