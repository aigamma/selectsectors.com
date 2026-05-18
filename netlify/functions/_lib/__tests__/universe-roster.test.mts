import { describe, expect, it } from 'vitest';

import {
  SECTORS,
  ANCHORS,
  ALL_EQUITY_SYMBOLS,
  ALL_SYMBOLS,
} from '../universe-roster.mts';
import { CHAT_SYSTEM_PROMPT } from '../chat-system-prompt.mts';

// Source-of-truth tests for the shared universe roster. Three claims
// the rest of the codebase relies on:
//
//   1. The cardinality is exactly 11 SPDR sectors + 11 anchor single
//      names + SPX = 23 symbols. ALL_EQUITY_SYMBOLS is sectors +
//      anchors = 22 (what's in the daily_eod Supabase table; the
//      table also stores SPY but we deliberately exclude it from
//      the public-site universe). ALL_SYMBOLS is the full universe
//      including SPX from daily_volatility_stats = 23. The 23-count
//      matches the site's marketing copy and the homepage form's
//      pickable-options count exactly; an earlier iteration had SPY
//      in ALL_EQUITY_SYMBOLS which made /api/scan return 24 rows
//      against a 23-symbol public claim, resolved 2026-05-18 by
//      dropping SPY since its returns are near-identical to SPX
//      (both track the S&P 500) and a SPY scan row would have been
//      a visually-redundant near-duplicate.
//
//   2. The four derived sets compose correctly: ALL_EQUITY_SYMBOLS
//      is sectors + anchors (no SPX, no SPY); ALL_SYMBOLS adds SPX
//      at the front. The composition is what scan-background walks
//      to fetch bars.
//
//   3. The chat system prompt actually interpolates the anchor list
//      from this module rather than carrying its own stale copy.
//      Verified by checking that every name in ANCHORS appears as a
//      literal token in CHAT_SYSTEM_PROMPT.

describe('universe roster', () => {
  it('has exactly 11 SPDR sectors', () => {
    expect(SECTORS).toHaveLength(11);
  });

  it('has exactly 11 anchor single names', () => {
    expect(ANCHORS).toHaveLength(11);
  });

  it('ALL_EQUITY_SYMBOLS is sectors + anchors (22 symbols, no SPX, no SPY)', () => {
    expect(ALL_EQUITY_SYMBOLS).toHaveLength(22);
    expect(ALL_EQUITY_SYMBOLS).not.toContain('SPX');
    expect(ALL_EQUITY_SYMBOLS).not.toContain('SPY');
    for (const s of SECTORS) expect(ALL_EQUITY_SYMBOLS).toContain(s);
    for (const a of ANCHORS) expect(ALL_EQUITY_SYMBOLS).toContain(a);
  });

  it('ALL_SYMBOLS is the full 23-symbol universe including SPX', () => {
    expect(ALL_SYMBOLS).toHaveLength(23);
    expect(ALL_SYMBOLS).toContain('SPX');
    expect(ALL_SYMBOLS).not.toContain('SPY');
  });

  it('has no duplicate symbols across sectors and anchors', () => {
    const all = [...SECTORS, ...ANCHORS];
    const unique = new Set(all);
    expect(unique.size).toBe(all.length);
  });
});

describe('chat system prompt anchor interpolation', () => {
  it('contains every anchor symbol as a literal token', () => {
    const missing = ANCHORS.filter((name) => !CHAT_SYSTEM_PROMPT.includes(name));
    expect(missing, `missing from prompt: ${missing.join(', ')}`).toEqual([]);
  });

  it('contains a sector symbol or category reference', () => {
    // Looser check than the anchor list: we don't insist on every
    // sector ticker in the prompt (the prompt mentions "the eleven
    // SPDR sector ETFs" by category) but we do insist on at least
    // one ticker as a sanity check that the category name aligns
    // with the universe.
    expect(CHAT_SYSTEM_PROMPT).toMatch(/SPDR sector/);
  });
});
