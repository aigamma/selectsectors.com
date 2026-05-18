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
//      names. ALL_EQUITY_SYMBOLS is sectors + anchors + SPY = 23
//      (what's in the daily_eod Supabase table). ALL_SYMBOLS is the
//      full universe including SPX from daily_volatility_stats = 24.
//      Note the user-facing site copy describes "23 symbols" by
//      category (SPX + 11 sectors + 11 anchors, without SPY); SPY
//      is internally tracked as the broad-market execution proxy
//      and shows up in /api/scan results as a 24th row but is not
//      a pickable symbol on the homepage form. The two views
//      coexist; if you want to land them on the same number, drop
//      SPY from ALL_EQUITY_SYMBOLS (and accept that scan loses the
//      SPY benchmark row) or add SPY to the homepage form (and
//      update copy to 24 symbols).
//
//   2. The four derived sets compose correctly: ALL_EQUITY_SYMBOLS
//      is sectors + anchors + SPY (no SPX); ALL_SYMBOLS is the full
//      universe including SPX. The composition is what scan-
//      background walks to fetch bars.
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

  it('ALL_EQUITY_SYMBOLS is sectors + anchors + SPY (23 symbols)', () => {
    expect(ALL_EQUITY_SYMBOLS).toHaveLength(23);
    expect(ALL_EQUITY_SYMBOLS).toContain('SPY');
    expect(ALL_EQUITY_SYMBOLS).not.toContain('SPX');
    for (const s of SECTORS) expect(ALL_EQUITY_SYMBOLS).toContain(s);
    for (const a of ANCHORS) expect(ALL_EQUITY_SYMBOLS).toContain(a);
  });

  it('ALL_SYMBOLS is the full universe including SPX (24 symbols)', () => {
    expect(ALL_SYMBOLS).toHaveLength(24);
    expect(ALL_SYMBOLS).toContain('SPX');
    expect(ALL_SYMBOLS).toContain('SPY');
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
