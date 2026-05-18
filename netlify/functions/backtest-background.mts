import type { Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// @ts-ignore — pkg/ is built by `npm run build:wasm` and is not in the
// TypeScript tree the typechecker looks at, so the editor and tsc see
// this as a missing module. At runtime, the Netlify bundler picks it
// up because we include it via `included_files` in netlify.toml.
import { run_backtest } from '../../pkg/backtest_core.js';

// Background function for backtests. 15-minute wall-clock budget vs the
// 26-second synchronous timeout on the dispatcher. Returns 202 to the
// dispatcher immediately and writes the finished result into the
// `backtest-results` Netlify Blob store keyed by the content-hash of
// the inputs. The polling endpoint at `/api/result` reads them back.
//
// The math runs in the Rust crate at `crates/backtest-core` compiled
// to WebAssembly via `wasm-pack build --target nodejs`. The wasm-pack
// JS glue (`pkg/backtest_core.js`) does the WASM instantiation at
// module-load time and exposes the `run_backtest` and `strategy_catalog`
// entries; we call `run_backtest` once per request with the bar series
// from Supabase and the strategy params from the request body.
//
// Inputs (POST JSON body):
//   - symbol: string
//   - strategy: { name: string, params: Record<string, number> }
//   - dateRange: { start: string, end: string }   ISO dates

interface StrategyRequest {
  name: string;
  params: Record<string, number>;
}

interface BacktestRequest {
  symbol: string;
  strategy: StrategyRequest;
  dateRange: { start: string; end: string };
}

interface DailyBarRow {
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
      error: `not enough bars (${bars.length}) for ${body.symbol} in [${body.dateRange.start}, ${body.dateRange.end}]`,
      inputs: body,
      computedAt: new Date().toISOString(),
    });
    return new Response(null);
  }

  // Translate the dispatcher's {name, params} into the wire format the
  // Rust crate's StrategyKind enum deserializes. Externally-tagged
  // enums round-trip as `"variant"` for unit variants and
  // `{ "variant": { ...payload } }` for tuple variants — see the
  // strategies::mod docstring in the Rust crate for the contract.
  let strategy: unknown;
  try {
    strategy = toStrategyKind(body.strategy);
  } catch (err) {
    await store.setJSON(hash, {
      error: `bad strategy: ${(err as Error).message}`,
      inputs: body,
      computedAt: new Date().toISOString(),
    });
    return new Response(null);
  }

  const wasmBars: WasmDailyBar[] = bars.map((r) => ({
    date: r.trading_date,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: 0,
  }));

  let wasmResult: WasmResult;
  try {
    wasmResult = run_backtest({
      symbol: body.symbol,
      bars: wasmBars,
      strategy,
    }) as WasmResult;
  } catch (err) {
    await store.setJSON(hash, {
      error: `wasm backtest failed: ${(err as Error).message ?? err}`,
      inputs: body,
      computedAt: new Date().toISOString(),
    });
    return new Response(null);
  }

  const result = {
    inputs: body,
    bars: wasmResult.n_bars,
    firstDate: wasmResult.first_date,
    lastDate: wasmResult.last_date,
    totalReturn: wasmResult.total_return,
    annualizedReturn: wasmResult.annualized_return,
    sharpe: wasmResult.sharpe,
    maxDrawdown: wasmResult.max_drawdown,
    hitRate: wasmResult.hit_rate,
    equityCurve: wasmResult.equity_curve,
    note: `WASM ${wasmResult.strategy} over ${wasmResult.n_bars} bars from ${wasmResult.first_date} to ${wasmResult.last_date}`,
    computedAt: new Date().toISOString(),
    computeMs: Date.now() - startedAt,
  };

  await store.setJSON(hash, result);
  return new Response(null);
};

function toStrategyKind(s: StrategyRequest): unknown {
  switch (s.name) {
    case 'buy_and_hold':
      return 'buy_and_hold';
    case 'sma_crossover':
      return {
        sma_crossover: {
          fast: requireNumber(s.params, 'fast'),
          slow: requireNumber(s.params, 'slow'),
        },
      };
    case 'rsi_mean_reversion':
      return {
        rsi_mean_reversion: {
          period: requireNumber(s.params, 'period'),
          oversold: requireNumber(s.params, 'oversold'),
          overbought: requireNumber(s.params, 'overbought'),
        },
      };
    case 'momentum':
      return { momentum: { lookback: requireNumber(s.params, 'lookback') } };
    case 'breakout':
      return { breakout: { lookback: requireNumber(s.params, 'lookback') } };
    default:
      throw new Error(`unknown strategy name: \`${s.name}\``);
  }
}

function requireNumber(params: Record<string, number>, key: string): number {
  const v = params[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`missing or non-finite parameter \`${key}\``);
  }
  return v;
}

async function fetchBars(
  supabase: SupabaseClient,
  symbol: string,
  dateRange: { start: string; end: string }
): Promise<DailyBarRow[]> {
  if (symbol.toUpperCase() === 'SPX') {
    // daily_volatility_stats only has close. Project into all four OHLC
    // fields so the downstream pipeline treats SPX the same as equity
    // rows. Strategies that depend on intraday range (like breakout
    // on high) lose realism on SPX; for close-driven strategies this
    // projection is the correct degenerate.
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
