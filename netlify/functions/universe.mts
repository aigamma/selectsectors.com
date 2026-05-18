import type { Context, Config } from '@netlify/functions';

// The 23-symbol universe rendered as a JSON list. Lives server-side so
// the roster can rotate over time (e.g., the top-by-options-volume
// anchor names list changes as earnings flow through) without a
// frontend redeploy.
//
// The eleven SPDR sectors are fixed. The eleven anchor single names
// are pinned to the same set the aigamma-backtester desktop app uses,
// derived from the aigamma.com options-volume-roster top tier; that
// list is stable on a quarter-to-quarter basis but the long-term
// answer is to read it from Supabase so it stays in sync with the
// roster maintenance pipeline. For the scaffold, it is hardcoded
// here and updated by hand until the Supabase roster wiring lands.

const SECTORS = [
  'XLB', 'XLC', 'XLE', 'XLF', 'XLI',
  'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XLRE',
];

const ANCHORS = [
  // Top-by-options-volume names pinned at scaffold time (2026-05-17).
  // Source: aigamma.com options-volume-roster anchor tier. Refresh
  // this list when the roster is regenerated; the canonical place for
  // automated sync is a follow-on Supabase table read.
  'NVDA', 'TSLA', 'AAPL', 'AMD', 'AMZN',
  'META', 'MSFT', 'GOOGL', 'PLTR', 'COIN', 'SMCI',
];

export default async (_req: Request, _context: Context): Promise<Response> => {
  return Response.json({
    sectors: SECTORS,
    anchors: ANCHORS,
    note: 'Eleven SPDR sector ETFs plus eleven anchor single names from the aigamma.com top-by-options-volume roster.',
  });
};

export const config: Config = {
  path: '/api/universe',
};
