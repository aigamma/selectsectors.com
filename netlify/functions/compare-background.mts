import type { Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { sha256OfCanonical } from './_lib/canonical-json.mts';
import { STRATEGY_DEFAULTS } from './_lib/strategy.mts';
// @ts-ignore — pkg/ is built by `npm run build:wasm`; resolved at deploy time.
import { run_backtest } from '../../pkg/backtest_core.js';

// Background function for the all-strategies comparison endpoint.
// Fetches bars once, then calls run_backtest five times (one per
// strategy with conventional default parameters) and writes a single
// result blob containing all five results plus a ranking metadata
// block. The frontend renders an overlay chart and a ranked table.
//
// Why "conventional defaults" rather than user-selectable params: the
// point of the comparison view is "what does each strategy class look
// like on this symbol", not "what's the best parameter for SMA on
// this symbol". A parameter sweep is a separate (and more expensive)
// feature that would need its own UI and rate-limit story. Sensible
// defaults give an honest first impression of each strategy class.

interface CompareRequest {
  symbol: string;
  dateRange: { start: string; end: string };
}

interface DailyBarRow {
  trading_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
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
  let body: CompareRequest;
  try {
    body = (await req.json()) as CompareRequest;
  } catch {
    console.error('compare-background: invalid JSON body');
    return new Response('invalid request body', { status: 400 });
  }

  // Mirror the dispatcher's hash-input shape so the cache key matches.
  const hashInput = { mode: 'compare-all', ...body };
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

  let bars: DailyBarRow[];
  try {
    bars = await fetchBars(supabase, body.symbol, body.dateRange);
  } catch (err) {
    await store.setJSON(hash, {
      error: `fetch bars failed: ${(err as Error).message}`,
      inputs: body,
      computedAt: new Date().toISOString(),
    });
    return new Response(null);
  }

  if (bars.length < 2) {
    await store.setJSON(hash, {
      error: `not enough bars (${bars.length}) for ${body.symbol}`,
      inputs: body,
      computedAt: new Date().toISOString(),
    });
    return new Response(null);
  }

  const wasmBars = bars.map((r) => ({
    date: r.trading_date,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: 0,
  }));

  // Run each strategy. Failures are captured per-strategy (e.g., if
  // the bar count is too short for the slow SMA window) so the others
  // still ship in the result. The user sees the per-strategy error
  // alongside the successful results rather than the whole comparison
  // failing because of one outlier.
  const results: Array<{
    strategyName: string;
    result?: WasmResult;
    error?: string;
  }> = [];

  for (const [strategyName, strategySpec] of Object.entries(
    STRATEGY_DEFAULTS
  )) {
    try {
      const result = run_backtest({
        symbol: body.symbol,
        bars: wasmBars,
        strategy: strategySpec,
      }) as WasmResult;
      results.push({ strategyName, result });
    } catch (err) {
      results.push({
        strategyName,
        error: (err as Error).message ?? String(err),
      });
    }
  }

  // Rank successful results by Sharpe (highest first). Failures sort
  // last; they're reported but not part of the ranking.
  const ranked = [...results].sort((a, b) => {
    if (!a.result && !b.result) return 0;
    if (!a.result) return 1;
    if (!b.result) return -1;
    return b.result.sharpe - a.result.sharpe;
  });

  const blob = {
    inputs: body,
    mode: 'compare-all',
    bars: bars.length,
    firstDate: bars[0].trading_date,
    lastDate: bars[bars.length - 1].trading_date,
    strategies: ranked.map((r) =>
      r.result
        ? {
            name: r.strategyName,
            totalReturn: r.result.total_return,
            annualizedReturn: r.result.annualized_return,
            sharpe: r.result.sharpe,
            maxDrawdown: r.result.max_drawdown,
            hitRate: r.result.hit_rate,
            equityCurve: r.result.equity_curve,
          }
        : {
            name: r.strategyName,
            error: r.error,
          }
    ),
    computedAt: new Date().toISOString(),
    computeMs: Date.now() - startedAt,
  };

  await store.setJSON(hash, blob);
  return new Response(null);
};

async function fetchBars(
  supabase: SupabaseClient,
  symbol: string,
  dateRange: { start: string; end: string }
): Promise<DailyBarRow[]> {
  if (symbol.toUpperCase() === 'SPX') {
    const { data, error } = await supabase
      .from('daily_volatility_stats')
      .select('trading_date, close')
      .gte('trading_date', dateRange.start)
      .lte('trading_date', dateRange.end)
      .order('trading_date');
    if (error) throw error;
    return (data ?? []).map((r: { trading_date: string; close: number }) => ({
      trading_date: r.trading_date,
      open: r.close,
      high: r.close,
      low: r.close,
      close: r.close,
    }));
  }

  const { data, error } = await supabase
    .from('daily_eod')
    .select('trading_date, open, high, low, close')
    .eq('symbol', symbol.toUpperCase())
    .gte('trading_date', dateRange.start)
    .lte('trading_date', dateRange.end)
    .order('trading_date');
  if (error) throw error;
  return (data ?? []) as DailyBarRow[];
}
