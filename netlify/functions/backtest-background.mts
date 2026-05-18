import type { Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { createClient } from '@supabase/supabase-js';

// Background function for long-running backtests. 15-minute wall-
// clock budget vs the 26-second synchronous timeout. Returns 202 to
// the dispatcher immediately and writes the finished result into the
// `backtest-results` Netlify Blob store keyed by the content-hash of
// the inputs. The polling endpoint at `/api/result` reads them back.
//
// At the scaffold stage the strategy execution is a tiny inline TS
// placeholder (first-bar to last-bar log return). The WASM-backed
// engine in `crates/backtest-core` replaces this body once
// `npm run build:wasm` ships the gte-small-sized artifact into the
// function bundle.
//
// Inputs (POST JSON body):
//   - symbol: string
//   - strategy: { name: string, params: Record<string, number> }
//   - dateRange: { start: string, end: string }   ISO dates

interface BacktestRequest {
  symbol: string;
  strategy: { name: string; params: Record<string, number> };
  dateRange: { start: string; end: string };
}

interface DailyBar {
  trading_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export default async (req: Request, _context: Context): Promise<Response> => {
  let body: BacktestRequest;
  try {
    body = (await req.json()) as BacktestRequest;
  } catch {
    console.error('backtest-background: invalid JSON body');
    return new Response('invalid request body', { status: 400 });
  }

  const hash = await sha256OfCanonical(body);
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

  // Fetch bars for the requested symbol. SPX is special: it does not
  // live in daily_eod (which holds equity OHLC), it lives in
  // daily_volatility_stats as a single close column derived from the
  // intraday snapshots downsample. Branch on the symbol name to pick
  // the right table.
  let bars: DailyBar[];
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
      error: `not enough bars (${bars.length}) for ${body.symbol} in [${body.dateRange.start}, ${body.dateRange.end}]`,
      inputs: body,
      computedAt: new Date().toISOString(),
    });
    return new Response(null);
  }

  // Placeholder strategy: log return from first close to last close.
  // The WASM engine will replace this with the strategy library's
  // dispatch once `crates/backtest-core` is wired in.
  const first = bars[0].close;
  const last = bars[bars.length - 1].close;
  const totalReturn = first > 0 ? Math.log(last / first) : 0;

  // Daily simple returns over the bar series. The full P&L curve is
  // useful for the frontend chart even though the placeholder
  // strategy is buy-and-hold.
  const dailyReturns: Array<{ date: string; ret: number; equity: number }> = [];
  let equity = 1.0;
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    const curr = bars[i].close;
    if (prev > 0) {
      const r = (curr - prev) / prev;
      equity *= 1 + r;
      dailyReturns.push({ date: bars[i].trading_date, ret: r, equity });
    }
  }

  // Sharpe (annualized) and max drawdown over the equity curve.
  const returns = dailyReturns.map((d) => d.ret);
  const sharpe = annualizedSharpe(returns);
  const maxDrawdown = computeMaxDrawdown(dailyReturns.map((d) => d.equity));

  const result = {
    inputs: body,
    bars: bars.length,
    firstDate: bars[0].trading_date,
    lastDate: bars[bars.length - 1].trading_date,
    totalReturn,
    sharpe,
    maxDrawdown,
    equityCurve: dailyReturns,
    note: 'scaffold placeholder strategy: buy-and-hold first-bar to last-bar; WASM engine pending',
    computedAt: new Date().toISOString(),
    computeMs: Date.now() - startedAt,
  };

  await store.setJSON(hash, result);
  return new Response(null);
};

async function fetchBars(
  supabase: ReturnType<typeof createClient>,
  symbol: string,
  dateRange: { start: string; end: string }
): Promise<DailyBar[]> {
  if (symbol.toUpperCase() === 'SPX') {
    // daily_volatility_stats has only close, not OHLC. Map the close
    // into all four OHLC fields so the downstream pipeline can treat
    // SPX rows the same shape as equity rows. The high/low/open
    // values will degrade the realism of any strategy that depends
    // on intraday range, but for end-of-day-close-driven strategies
    // (the entire scaffold's scope) this is the correct projection.
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

  // Equity / ETF path: read from daily_eod.
  const { data, error } = await supabase
    .from('daily_eod')
    .select('trading_date, open, high, low, close')
    .eq('symbol', symbol.toUpperCase())
    .gte('trading_date', dateRange.start)
    .lte('trading_date', dateRange.end)
    .order('trading_date');
  if (error) throw error;
  return (data ?? []) as DailyBar[];
}

function annualizedSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  // 252 trading days per year; this is a daily-bar series so the
  // annualization factor is sqrt(252).
  return (mean / std) * Math.sqrt(252);
}

function computeMaxDrawdown(equity: number[]): number {
  let peak = equity[0] ?? 1.0;
  let maxDd = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => {
    const v = (value as Record<string, unknown>)[k];
    return JSON.stringify(k) + ':' + canonicalize(v);
  });
  return '{' + parts.join(',') + '}';
}

async function sha256OfCanonical(value: unknown): Promise<string> {
  const data = new TextEncoder().encode(canonicalize(value));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
