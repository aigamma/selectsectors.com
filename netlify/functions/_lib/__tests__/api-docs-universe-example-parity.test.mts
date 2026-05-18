import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SECTORS, ANCHORS } from '../universe-roster.mts';

// api-docs example response parity for GET /api/universe.
//
// /api-docs/index.html shows a sample JSON response for the universe
// endpoint that hardcodes the eleven SPDR sector ETFs and the eleven
// anchor single names as literal arrays. The actual /api/universe
// implementation reads from universe-roster.mts (the single source
// of truth introduced in iter 57). If a future refresh of the anchor
// names rotates one name out (e.g., COIN drops off and is replaced
// by a different high-options-volume name), the docs example would
// silently go stale while the live endpoint returns the updated list.
//
// This test parses the example response JSON-like text out of
// api-docs/index.html and asserts that both arrays (sectors and
// anchors) match the source-of-truth arrays in universe-roster.mts.
//
// SECTORS is fixed (the eleven SPDR sector ETFs don't rotate), so
// drift there is unlikely; but the test still covers it for
// symmetry and for the case where a new SPDR sector ETF is added
// upstream (XLRE was added in 2015, in principle a new one could
// land in the future).

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const API_DOCS_PATH = resolve(ROOT, 'api-docs', 'index.html');

/**
 * Extract a quoted-symbol array from a chunk of HTML/JSON-like text.
 * Looks for the key (e.g., `"sectors"`) followed by `:`, then captures
 * everything inside the next `[...]` block, then splits on `","` to
 * get the values. Returns `null` if the key is not found.
 */
function extractArrayAfterKey(text: string, key: string): string[] | null {
  const keyRe = new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)\\]`);
  const m = text.match(keyRe);
  if (!m) return null;
  const body = m[1];
  // Symbols are uppercase letters/digits; the test relies on the
  // example having no embedded commas inside symbol names.
  const symbolRe = /"([A-Z][A-Z0-9.]*)"/g;
  const out: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = symbolRe.exec(body)) !== null) {
    out.push(sm[1]);
  }
  return out;
}

describe('api-docs /api/universe example parity', () => {
  const html = readFileSync(API_DOCS_PATH, 'utf8');

  it('extracts a "sectors" array from the docs example', () => {
    const found = extractArrayAfterKey(html, 'sectors');
    expect(found, 'no "sectors" array found in api-docs/index.html').not.toBeNull();
    expect(found!.length).toBeGreaterThan(0);
  });

  it('extracts an "anchors" array from the docs example', () => {
    const found = extractArrayAfterKey(html, 'anchors');
    expect(found, 'no "anchors" array found in api-docs/index.html').not.toBeNull();
    expect(found!.length).toBeGreaterThan(0);
  });

  it('docs "sectors" example matches universe-roster.mts SECTORS', () => {
    const docs = extractArrayAfterKey(html, 'sectors');
    expect(
      docs,
      `expected docs sectors ${JSON.stringify(docs)} to equal SECTORS ${JSON.stringify(SECTORS)}`
    ).toEqual(SECTORS);
  });

  it('docs "anchors" example matches universe-roster.mts ANCHORS', () => {
    const docs = extractArrayAfterKey(html, 'anchors');
    expect(
      docs,
      `expected docs anchors ${JSON.stringify(docs)} to equal ANCHORS ${JSON.stringify(ANCHORS)}`
    ).toEqual(ANCHORS);
  });
});
