import type { Context, Config } from '@netlify/functions';
import { SECTORS, ANCHORS } from './_lib/universe-roster.mts';

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
// in _lib/universe-roster.mts and updated by hand until the Supabase
// roster wiring lands.

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
