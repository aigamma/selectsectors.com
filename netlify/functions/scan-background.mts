import type { Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { sha256OfCanonical } from './_lib/canonical-json.mts';
import { toStrategyKind } from './_lib/strategy.mts';
import { SECTORS, ALL_EQUITY_SYMBOLS } from './_lib/universe-roster.mts';
// @ts-ignore — pkg/ is built by `npm run build:wasm`; resolved at deploy time.
import { run_backtest } from '../../pkg/backtest_core.js';

// Background worker for /api/scan. Fetches bars for all 23 symbols
// (one Supabase query for the 22 equity/ETF symbols via WHERE IN,
// plus a separate query for SPX from daily_volatility_stats), then
// loops the WASM run_backtest call 23 times with the user's chosen
// strategy and writes a single result blob containing per-symbol
// results sorted by Sharpe descending.
//
// Why one IN query instead of 22 sequential queries: each Supabase
// round-trip is ~50-150ms of TLS + auth + query overhead. Twenty-two
// sequential queries would dominate the entire scan latency at the
// shape we care about (1-3 seconds of math wrapped in 2-5 seconds of
// I/O). One IN query is roughly the cost of one query, since the
// network and auth costs amortize.
//
// Per-symbol failures (not enough bars for the strategy, NotEnoughBars
// from the Rust crate, Supabase errors on a single symbol) are
// captured in the per-symbol entry's `error` field so the user sees
// "FOO: not enough bars" instead of the entire scan failing because
// of one symbol with shallow history.

interface ScanRequest {
  strategy: { name: string; params: Record<string, number> };
  dateRange: { start: string; end: string };
}

interface DailyBarRow {
  symbol: string;
  trading_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface WasmDailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface WasmEquityPoint {
  date: string;
  ret: number;
  equity: number;
}

interface WasmResult {
  symbol: string;
  strategy: string;
  n_bars: number;
  first_date: string;
  last_date: string;
  total_return: number;
  annualized_return: number;
  sharpe: number;
  max_drawdown: number;
  hit_rate: number;
  equity_curve: WasmEquityPoint[];
}

export default async (req: Request, _context: Context): Promise<Response> => {
  let body: ScanRequest;
  try {
    body = (await req.json()) as ScanRequest;
  } catch {
    console.error('scan-background: invalid JSON body');
    return new Response('invalid request body', { status: 400 });
  }

  const hashInput = { mode: 'scan-all', ...body };
  const hash = await sha256OfCanonical(hashInput);
  const startedAt = Date.now();
  const store = getStore('backtest-results');

  const supabaseUrl = Netlify.env.get('SUPABASE_URL');
  const supabaseKey = Netlify.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseKey) {
    await store.setJSON(hash, {
      error: 'supabase env vars not configured',
      inputs: body,
      computedAt: new Date().toISOString(),
    });
    return new Response(null);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Fetch all bars in two queries: one IN-clause query for the 22
  // equity/ETF symbols, plus a separate query for SPX. Group by
  // symbol in the function rather than relying on PostgreSQL ordering
  // for predictability.
  let barsBySymbol: Map<string, DailyBarRow[]>;
  try {
    barsBySymbol = await fetchAllBars(supabase, body.dateRange);
  } catch (err) {
    await store.setJSON(hash, {
      error: `fetch bars failed: ${(err as Error).message}`,
      inputs: body,
      computedAt: new Date().toISOString(),
    });
    return new Response(null);
  }

  // Translate strategy request into WASM-compatible shape once;
  // we'll reuse it across all 23 backtests.
  let strategySpec: unknown;
  try {
    strategySpec = toStrategyKind(body.strategy);
  } catch (err) {
    await store.setJSON(hash, {
      error: `bad strategy: ${(err as Error).message}`,
      inputs: body,
      computedAt: new Date().toISOString(),
    });
    return new Response(null);
  }

  const allSymbols = ['SPX', ...ALL_EQUITY_SYMBOLS];

  const results: Array<{
    symbol: string;
    category: 'index' | 'broad' | 'sector' | 'anchor';
    result?: WasmResult;
    error?: string;
  }> = [];

  for (const symbol of allSymbols) {
    const bars = barsBySymbol.get(symbol) ?? [];
    const category = categorize(symbol);
    if (bars.length < 2) {
      results.push({
        symbol,
        category,
        error: `not enough bars (${bars.length}) in ${body.dateRange.start}..${body.dateRange.end}`,
      });
      continue;
    }
    const wasmBars: WasmDailyBar[] = bars.map((b) => ({
      date: b.trading_date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: 0,
    }));
    try {
      const result = run_backtest({
        symbol,
        bars: wasmBars,
        strategy: strategySpec,
      }) as WasmResult;
      results.push({ symbol, category, result });
    } catch (err) {
      results.push({
        symbol,
        category,
        error: (err as Error).message ?? String(err),
      });
    }
  }

  // Rank by Sharpe descending. Errors sort last regardless of order.
  const ranked = [...results].sort((a, b) => {
    if (!a.result && !b.result) return a.symbol.localeCompare(b.symbol);
    if (!a.result) return 1;
    if (!b.result) return -1;
    return b.result.sharpe - a.result.sharpe;
  });

  const blob = {
    inputs: body,
    mode: 'scan-all',
    strategy: body.strategy.name,
    dateRange: body.dateRange,
    symbols: ranked.map((r) =>
      r.result
        ? {
            symbol: r.symbol,
            category: r.category,
            bars: r.result.n_bars,
            firstDate: r.result.first_date,
            lastDate: r.result.last_date,
            totalReturn: r.result.total_return,
            annualizedReturn: r.result.annualized_return,
            sharpe: r.result.sharpe,
            maxDrawdown: r.result.max_drawdown,
            hitRate: r.result.hit_rate,
            // Don't include the full equity curve in the scan blob —
            // it's 200-500 points per symbol times 23 symbols = 5-12K
            // points which bloats the result blob and the frontend
            // payload. The dedicated single-strategy / single-symbol
            // backtest is the right surface for the equity-curve
            // view; scan stays summary-table only.
          }
        : {
            symbol: r.symbol,
            category: r.category,
            error: r.error,
          }
    ),
    computedAt: new Date().toISOString(),
    computeMs: Date.now() - startedAt,
  };

  await store.setJSON(hash, blob);
  return new Response(null);
};

function categorize(symbol: string): 'index' | 'broad' | 'sector' | 'anchor' {
  if (symbol === 'SPX') return 'index';
  if (symbol === 'SPY') return 'broad';
  if (SECTORS.includes(symbol)) return 'sector';
  return 'anchor';
}

async function fetchAllBars(
  supabase: SupabaseClient,
  dateRange: { start: string; end: string }
): Promise<Map<string, DailyBarRow[]>> {
  const grouped = new Map<string, DailyBarRow[]>();

  // SPX from daily_volatility_stats (close-only; project into OHLC).
  const spxQuery = await supabase
    .from('daily_volatility_stats')
    .select('trading_date, close')
    .gte('trading_date', dateRange.start)
    .lte('trading_date', dateRange.end)
    .order('trading_date');
  if (spxQuery.error) throw spxQuery.error;
  const spxBars: DailyBarRow[] = (spxQuery.data ?? []).map(
    (r: { trading_date: string; close: number }) => ({
      symbol: 'SPX',
      trading_date: r.trading_date,
      open: r.close,
      high: r.close,
      low: r.close,
      close: r.close,
    })
  );
  grouped.set('SPX', spxBars);

  // Equity/ETF symbols in one IN-clause query from daily_eod.
  const eqQuery = await supabase
    .from('daily_eod')
    .select('symbol, trading_date, open, high, low, close')
    .in('symbol', ALL_EQUITY_SYMBOLS)
    .gte('trading_date', dateRange.start)
    .lte('trading_date', dateRange.end)
    .order('symbol')
    .order('trading_date');
  if (eqQuery.error) throw eqQuery.error;
  for (const row of (eqQuery.data ?? []) as DailyBarRow[]) {
    const list = grouped.get(row.symbol) ?? [];
    list.push(row);
    grouped.set(row.symbol, list);
  }

  return grouped;
}
