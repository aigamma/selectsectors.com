// Single source of truth for the 23-symbol roster the site backtests
// against. Previously duplicated across universe.mts (which serves
// /api/universe), scan-background.mts (which fans out across all 23
// symbols), and chat-system-prompt.mts (which embeds the anchor list
// in SelectBot's grounding text). Three copies of the same list is
// exactly the drift profile the recent source-of-truth iterations
// have been chasing: if Eric refreshes the anchor names list when
// the upstream aigamma.com options-volume-roster regenerates, three
// places need to update in lockstep or one of them silently misleads
// users.
//
// This module is the new single canonical place. Three downstream
// surfaces consume it; each re-export below is referenced by exactly
// one external consumer so a future reader can trace the dependency
// graph by grep.

/**
 * The eleven SPDR sector ETFs. Fixed; will not rotate quarter-to-
 * quarter the way the anchor single names do.
 *
 * Typed as plain `string[]` rather than `readonly [...]` literal tuple
 * because the consuming code passes these arrays to APIs (Supabase
 * `.in()`, Array.prototype.includes() on dynamic strings) that expect
 * a mutable string array. The literal-tuple ergonomics aren't worth
 * the friction at the call sites.
 */
export const SECTORS: string[] = [
  'XLB',
  'XLC',
  'XLE',
  'XLF',
  'XLI',
  'XLK',
  'XLP',
  'XLU',
  'XLV',
  'XLY',
  'XLRE',
];

/**
 * The eleven anchor single names. Pinned to the aigamma.com options-
 * volume-roster anchor tier as of 2026-05-17. Refresh this list when
 * the upstream roster regenerates; the long-term answer is to read
 * the list from Supabase so it stays in sync automatically, but for
 * the public site the hardcoded list with a manual refresh is
 * acceptable since rotation is quarter-scale rather than daily.
 */
export const ANCHORS: string[] = [
  'NVDA',
  'TSLA',
  'AAPL',
  'AMD',
  'AMZN',
  'META',
  'MSFT',
  'GOOGL',
  'PLTR',
  'COIN',
  'SMCI',
];

/**
 * The 22 equity/ETF symbols held in the daily_eod Supabase table.
 * Excludes SPX (which is index-only and lives in
 * daily_volatility_stats) and includes SPY (the broad-market ETF
 * proxy for SPX execution). The scan-background dispatcher uses this
 * for its single IN-clause Supabase query.
 */
export const ALL_EQUITY_SYMBOLS: string[] = [...SECTORS, ...ANCHORS, 'SPY'];

/**
 * The full 23-symbol universe including SPX, in the canonical order
 * the homepage form's optgroups render: SPX first, then SPY, then
 * sectors, then anchors. Useful for any caller that wants to iterate
 * the full universe in display order.
 */
export const ALL_SYMBOLS: string[] = ['SPX', 'SPY', ...SECTORS, ...ANCHORS];
