import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ANCHORS, SECTORS } from '../universe-roster.mts';

// disclaimer/index.html numbers parity. The disclaimer page is the
// legal/user-facing surface that describes what the site actually
// does in plain prose, including counts of universe components and
// of SelectBot topics. Those counts must match the live source-of-
// truth or the disclaimer misleads users about what the site is.
//
// The disclaimer rate-limit numbers are pinned by the iter-153
// extension to rate-limit-numbers-parity. This file pins the
// universe-roster cardinality claims that the disclaimer makes:
//
//   - "eleven anchor single names" (lines 58, 115, 165) ->
//     ANCHORS.length
//   - "SPDR sectors" implicit count (line 58, 165) -> SECTORS.length
//     (no specific number in prose; the test verifies the phrase
//     is present so a future SECTORS rename surfaces here too)
//
// The chat-system-prompt cardinality is pinned separately by
// chat-system-prompt-numbers-parity (iter 131). This file is the
// disclaimer counterpart.

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const DISCLAIMER_PATH = resolve(ROOT, 'disclaimer', 'index.html');

const NUMBER_TO_WORD: Record<number, string> = {
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
  11: 'eleven',
  12: 'twelve',
};

describe('disclaimer numbers parity', () => {
  const html = readFileSync(DISCLAIMER_PATH, 'utf8');

  it('"<eleven> anchor single names" matches ANCHORS.length on every mention', () => {
    const expectedWord = NUMBER_TO_WORD[ANCHORS.length];
    expect(
      expectedWord,
      `NUMBER_TO_WORD has no entry for ${ANCHORS.length}; extend the table`
    ).toBeDefined();
    if (!expectedWord) return;
    // Match every occurrence of a count word followed by "anchor
    // single name(s)" in any case. The disclaimer has THREE such
    // mentions (lines 58, 115, 165); a future ANCHORS.length change
    // must update all three.
    const re = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+anchor\s+single\s+names?\b/gi;
    const matches = [...html.matchAll(re)];
    expect(
      matches.length,
      `expected at least one "<word> anchor single names" mention in disclaimer/index.html; found ${matches.length}`
    ).toBeGreaterThanOrEqual(1);
    for (const m of matches) {
      expect(
        m[1].toLowerCase(),
        `disclaimer mention "${m[0]}" disagrees with ANCHORS.length = ${ANCHORS.length} (expected word "${expectedWord}").`
      ).toBe(expectedWord);
    }
  });

  it('contains a SPDR sectors reference (sanity, no count drift)', () => {
    // The disclaimer prose uses "SPDR sectors" without a specific
    // count word; this assertion verifies the phrase is still
    // present so a future restructure of the disclaimer would
    // surface a missing reference. The actual SECTORS.length pin
    // is in the chat-system-prompt cardinality check; this is a
    // looser "the phrase exists" check.
    expect(
      html.match(/SPDR\s+sectors?/i),
      `expected disclaimer/index.html to mention "SPDR sector" with the live SECTORS array (length ${SECTORS.length})`
    ).not.toBeNull();
  });
});
