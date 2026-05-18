import { mountSiteShell } from './layout.ts';

// Frontend entry. Six concerns mounted at page load:
//
//   1. Universe roster — fetched from /api/universe and rendered into
//      the sector + anchor lists in the universe panel AND into the
//      backtest form's symbol <optgroup> elements.
//   2. Rate-limit banner — fetched from /api/rate-status and rendered
//      as "you have N backtests left this hour, M today". No slot is
//      consumed; the read-only endpoint is the right shape for an
//      always-on indicator that lets the user know before clicking
//      Run whether they have allowance left.
//   3. Strategy picker — five strategies wired to the WASM engine.
//      Each strategy carries a description and (where applicable) a
//      set of parameter fields with sensible defaults. The params
//      container re-renders whenever the strategy changes; the submit
//      handler reads the fields' current values into the params
//      object on the request body.
//   4. Backtest run — submit handler that POSTs to /api/backtest,
//      handles the three response shapes (ready/cached, queued,
//      429), and on queued, polls /api/result every 1.5 seconds
//      until either a result is ready or the wait exceeds 60 s.
//   5. Result panel — six metric cells (total return, CAGR, sharpe,
//      max drawdown, hit rate, bars) plus an inline SVG equity curve
//      colored by sign of final equity.
//   6. SelectBot — floating chat panel (see src/chat.ts).

interface UniverseResponse {
  sectors: string[];
  anchors: string[];
}

interface RateLimitInfo {
  hourly: { limit: number; used: number; remaining: number; resetAt: number };
  daily: { limit: number; used: number; remaining: number; resetAt: number };
}

interface RateStatusResponse extends RateLimitInfo {
  caps: { hour: number; day: number };
}

interface BacktestDispatchResponse {
  status: 'ready' | 'queued';
  hash: string;
  cached?: boolean;
  result?: BacktestResult;
  rateLimits?: RateLimitInfo;
}

interface BacktestErrorResponse {
  error: string;
  reason?: string;
  rateLimits?: RateLimitInfo;
}

interface EquityPoint {
  date: string;
  ret: number;
  equity: number;
}

interface BenchmarkResult {
  name: string;
  totalReturn: number;
  annualizedReturn: number;
  sharpe: number;
  maxDrawdown: number;
  equityCurve: EquityPoint[];
}

interface BacktestResult {
  inputs: unknown;
  bars: number;
  firstDate?: string;
  lastDate?: string;
  totalReturn: number;
  annualizedReturn?: number;
  sharpe: number;
  maxDrawdown: number;
  hitRate?: number;
  equityCurve?: EquityPoint[];
  benchmark?: BenchmarkResult | null;
  note?: string;
  error?: string;
  computedAt: string;
  computeMs?: number;
}

interface ResultPollResponse {
  status: 'pending' | 'ready';
  hash: string;
  result?: BacktestResult;
}

// Strategy specs. The label, description, and parameter list are the
// frontend's view of what the WASM crate accepts; the Rust crate is
// the source of truth for actual parameter validation, but mirroring
// the parameter list here lets us render usable defaults and saves a
// round-trip on a malformed first request. The keys in `params` MUST
// match the field names in the Rust `Params` struct for each strategy
// (e.g. `fast`/`slow` for `sma_crossover::Params`).
interface StrategyParamSpec {
  key: string;
  label: string;
  defaultValue: number;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}

interface StrategySpec {
  name: string;
  description: string;
  params: StrategyParamSpec[];
}

const STRATEGY_SPECS: Record<string, StrategySpec> = {
  buy_and_hold: {
    name: 'Buy and hold',
    description:
      'Buy on the first bar and hold to the last. The reference benchmark every other strategy is judged against.',
    params: [],
  },
  sma_crossover: {
    name: 'SMA crossover',
    description:
      'Long when the fast simple moving average is above the slow simple moving average; flat otherwise. The textbook trend-following signal.',
    params: [
      { key: 'fast', label: 'Fast window (bars)', defaultValue: 20, min: 2, max: 200, step: 1 },
      { key: 'slow', label: 'Slow window (bars)', defaultValue: 50, min: 3, max: 250, step: 1 },
    ],
  },
  momentum: {
    name: 'Momentum',
    description:
      'Long when today\'s close exceeds the close `lookback` bars ago; flat otherwise. The oldest documented factor in modern finance.',
    params: [
      { key: 'lookback', label: 'Lookback (bars)', defaultValue: 60, min: 2, max: 252, step: 1 },
    ],
  },
  rsi_mean_reversion: {
    name: 'RSI mean reversion',
    description:
      'Long when Wilder\'s RSI dips below the oversold threshold; exits to flat when RSI rises above overbought. A fade-the-dip strategy.',
    params: [
      { key: 'period', label: 'RSI period (bars)', defaultValue: 14, min: 2, max: 100, step: 1 },
      { key: 'oversold', label: 'Oversold threshold', defaultValue: 30, min: 0, max: 50, step: 1 },
      { key: 'overbought', label: 'Overbought threshold', defaultValue: 70, min: 50, max: 100, step: 1 },
    ],
  },
  breakout: {
    name: 'Donchian breakout',
    description:
      'Long when today\'s close is at or above the rolling high of the prior `lookback` bars. The Richard Donchian / Turtle Traders rule.',
    params: [
      { key: 'lookback', label: 'Lookback (bars)', defaultValue: 20, min: 2, max: 200, step: 1 },
    ],
  },
};

async function loadUniverse(): Promise<UniverseResponse | null> {
  try {
    const res = await fetch('/api/universe');
    if (!res.ok) throw new Error(`/api/universe -> ${res.status}`);
    return (await res.json()) as UniverseResponse;
  } catch (err) {
    console.warn('universe fetch failed', err);
    return null;
  }
}

function renderUniverseLists(data: UniverseResponse): void {
  renderList('sector-list', data.sectors);
  renderList('anchor-list', data.anchors);
  populateSymbolGroup('symbol-sectors-group', data.sectors);
  populateSymbolGroup('symbol-anchors-group', data.anchors);
}

function renderList(id: string, items: string[]): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = items.map((s) => `<li>${escape(s)}</li>`).join('');
}

function populateSymbolGroup(id: string, items: string[]): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = items
    .map((s) => `<option value="${escape(s)}">${escape(s)}</option>`)
    .join('');
}

async function loadRateStatus(): Promise<RateStatusResponse | null> {
  try {
    const res = await fetch('/api/rate-status');
    if (!res.ok) throw new Error(`/api/rate-status -> ${res.status}`);
    return (await res.json()) as RateStatusResponse;
  } catch (err) {
    console.warn('rate status fetch failed', err);
    return null;
  }
}

function renderRateBanner(info: RateLimitInfo): void {
  const el = document.getElementById('rate-banner');
  if (!el) return;
  const hourRemaining = info.hourly.remaining;
  const dayRemaining = info.daily.remaining;
  const exhausted = hourRemaining === 0 || dayRemaining === 0;
  el.classList.toggle('exhausted', exhausted);

  if (exhausted) {
    const which = hourRemaining === 0 ? 'hour' : 'day';
    const resetAt =
      which === 'hour' ? info.hourly.resetAt : info.daily.resetAt;
    const minutes = Math.max(1, Math.ceil((resetAt - Date.now()) / 60000));
    el.innerHTML = `No backtests left this ${which}. Next slot opens in <span class="rate-banner-count">${minutes}</span> min.`;
    return;
  }

  el.innerHTML = `You have <span class="rate-banner-count">${hourRemaining}</span> of ${info.hourly.limit} backtests left this hour, and <span class="rate-banner-count">${dayRemaining}</span> of ${info.daily.limit} today.`;
}

function setStatus(message: string, kind: 'info' | 'error' = 'info'): void {
  const el = document.getElementById('status-line');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', kind === 'error');
}

function setRunDisabled(disabled: boolean): void {
  const btn = document.getElementById('run-button') as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = disabled;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return c;
    }
  });
}

function setDefaultDateRange(): void {
  // Default: last 365 calendar days, clamped to today on the right
  // edge. The Supabase shallow-history reality (daily_eod runs only
  // 2024-04-25 onwards as of scaffold) means defaulting to 1 year
  // back is almost always safe; SPX has more history but the form
  // defaults are the same regardless of the symbol the user picks.
  const today = new Date();
  const endDate = today.toISOString().slice(0, 10);
  const startDateD = new Date(today);
  startDateD.setUTCDate(startDateD.getUTCDate() - 365);
  const startDate = startDateD.toISOString().slice(0, 10);

  const startEl = document.getElementById('start-date') as HTMLInputElement | null;
  const endEl = document.getElementById('end-date') as HTMLInputElement | null;
  if (startEl) {
    startEl.value = startDate;
    startEl.min = '2022-01-03';
    startEl.max = endDate;
  }
  if (endEl) {
    endEl.value = endDate;
    endEl.min = '2022-01-03';
    endEl.max = endDate;
  }
}

function renderStrategyParams(strategyName: string): void {
  const spec = STRATEGY_SPECS[strategyName];
  const container = document.getElementById('strategy-params');
  const descEl = document.getElementById('strategy-description');
  if (!container || !spec) return;
  if (descEl) descEl.textContent = spec.description;

  if (spec.params.length === 0) {
    container.innerHTML = '';
    return;
  }

  const cells = spec.params
    .map((p) => {
      const minAttr = p.min !== undefined ? ` min="${p.min}"` : '';
      const maxAttr = p.max !== undefined ? ` max="${p.max}"` : '';
      const stepAttr = p.step !== undefined ? ` step="${p.step}"` : '';
      return `
        <div class="field">
          <label for="param-${escape(p.key)}">${escape(p.label)}</label>
          <input
            type="number"
            id="param-${escape(p.key)}"
            name="param-${escape(p.key)}"
            data-param-key="${escape(p.key)}"
            value="${p.defaultValue}"
            inputmode="decimal"${minAttr}${maxAttr}${stepAttr}
            required
          />
        </div>
      `;
    })
    .join('');
  container.innerHTML = `<div class="strategy-params-grid">${cells}</div>`;
}

function readStrategyParams(): Record<string, number> {
  const container = document.getElementById('strategy-params');
  if (!container) return {};
  const inputs = container.querySelectorAll<HTMLInputElement>('input[data-param-key]');
  const params: Record<string, number> = {};
  inputs.forEach((input) => {
    const key = input.dataset.paramKey;
    if (!key) return;
    const value = Number(input.value);
    if (Number.isFinite(value)) params[key] = value;
  });
  return params;
}

interface BacktestRequest {
  symbol: string;
  strategy: { name: string; params: Record<string, number> };
  dateRange: { start: string; end: string };
}

async function handleSubmit(ev: SubmitEvent): Promise<void> {
  ev.preventDefault();
  const form = ev.target as HTMLFormElement;
  const fd = new FormData(form);
  const symbol = String(fd.get('symbol') ?? '');
  const strategyName = String(fd.get('strategy') ?? 'buy_and_hold');
  const start = String(fd.get('start-date') ?? '');
  const end = String(fd.get('end-date') ?? '');
  if (!symbol || !start || !end) {
    setStatus('please pick a symbol and a date range', 'error');
    return;
  }
  if (start > end) {
    setStatus('start date must be on or before end date', 'error');
    return;
  }

  const body: BacktestRequest = {
    symbol,
    strategy: { name: strategyName, params: readStrategyParams() },
    dateRange: { start, end },
  };

  setRunDisabled(true);
  setStatus('dispatching backtest...');
  hideResultPanel();

  let dispatched: BacktestDispatchResponse | BacktestErrorResponse;
  try {
    const res = await fetch('/api/backtest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    dispatched = (await res.json()) as
      | BacktestDispatchResponse
      | BacktestErrorResponse;
    if (res.status === 429) {
      const err = dispatched as BacktestErrorResponse;
      const which = err.reason === 'hour-exceeded' ? 'hour' : 'day';
      setStatus(`rate limit exceeded for this ${which}; retry after the banner resets`, 'error');
      if (err.rateLimits) renderRateBanner(err.rateLimits);
      setRunDisabled(false);
      return;
    }
    if (!res.ok) {
      const err = dispatched as BacktestErrorResponse;
      setStatus(`error: ${err.error ?? res.statusText}`, 'error');
      setRunDisabled(false);
      return;
    }
  } catch (err) {
    setStatus(`network error: ${(err as Error).message}`, 'error');
    setRunDisabled(false);
    return;
  }

  const dispatch = dispatched as BacktestDispatchResponse;
  if (dispatch.rateLimits) renderRateBanner(dispatch.rateLimits);

  if (dispatch.status === 'ready' && dispatch.result) {
    setStatus(
      dispatch.cached ? 'cached result returned instantly' : 'result ready'
    );
    renderResult(dispatch.result);
    setRunDisabled(false);
    return;
  }

  setStatus('queued; polling for the result...');
  const start_t = Date.now();
  const POLL_MS = 1500;
  const TIMEOUT_MS = 60_000;
  while (Date.now() - start_t < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    try {
      const pollRes = await fetch(
        `/api/result?hash=${encodeURIComponent(dispatch.hash)}`
      );
      const pollJson = (await pollRes.json()) as ResultPollResponse;
      if (pollJson.status === 'ready' && pollJson.result) {
        setStatus(`done in ${((Date.now() - start_t) / 1000).toFixed(1)}s`);
        renderResult(pollJson.result);
        setRunDisabled(false);
        return;
      }
    } catch (err) {
      console.warn('poll failed', err);
    }
  }
  setStatus('timed out waiting for the result; try again', 'error');
  setRunDisabled(false);
}

function hideResultPanel(): void {
  const el = document.getElementById('result-panel');
  if (el) el.hidden = true;
}

function showResultPanel(): void {
  const el = document.getElementById('result-panel');
  if (el) el.hidden = false;
}

function renderResult(result: BacktestResult): void {
  showResultPanel();

  if (result.error) {
    setStatus(`backtest error: ${result.error}`, 'error');
  }

  const totalReturnPct = (result.totalReturn * 100).toFixed(2);
  setTextWithSign('result-total-return', `${totalReturnPct}%`, result.totalReturn);

  if (result.annualizedReturn !== undefined) {
    const cagrPct = (result.annualizedReturn * 100).toFixed(2);
    setTextWithSign('result-cagr', `${cagrPct}%`, result.annualizedReturn);
  } else {
    setText('result-cagr', '-');
  }

  setText('result-sharpe', result.sharpe.toFixed(2));
  setText('result-drawdown', `${(result.maxDrawdown * 100).toFixed(2)}%`);

  if (result.hitRate !== undefined) {
    setText('result-hit-rate', `${(result.hitRate * 100).toFixed(1)}%`);
  } else {
    setText('result-hit-rate', '-');
  }

  setText('result-bars', String(result.bars));

  const footnote = result.note
    ? `${result.note}${result.computeMs ? ` · ${result.computeMs} ms backend` : ''}`
    : `computed in ${result.computeMs ?? '?'} ms`;
  setText('result-footnote', footnote);

  // Surface the strategy-vs-benchmark gap as a small line under the
  // metric cells so the user can see at a glance whether the chosen
  // strategy actually beat buy-and-hold on the same bar series.
  if (result.benchmark) {
    const stratReturn = result.totalReturn;
    const benchReturn = result.benchmark.totalReturn;
    const diff = stratReturn - benchReturn;
    const diffPct = (diff * 100).toFixed(2);
    const sign = diff >= 0 ? '+' : '';
    const summaryText =
      `vs buy-and-hold: ${sign}${diffPct}% (${(benchReturn * 100).toFixed(2)}% benchmark return)`;
    setText('result-benchmark-summary', summaryText);
    const summaryEl = document.getElementById('result-benchmark-summary');
    if (summaryEl) {
      summaryEl.hidden = false;
      summaryEl.classList.remove('positive', 'negative');
      if (diff > 0) summaryEl.classList.add('positive');
      else if (diff < 0) summaryEl.classList.add('negative');
    }
  } else {
    const summaryEl = document.getElementById('result-benchmark-summary');
    if (summaryEl) summaryEl.hidden = true;
  }

  renderEquityChart(
    result.equityCurve ?? [],
    result.benchmark?.equityCurve ?? null
  );
}

function setText(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setTextWithSign(id: string, value: string, signSource: number): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  el.classList.remove('positive', 'negative');
  if (signSource > 0) el.classList.add('positive');
  else if (signSource < 0) el.classList.add('negative');
}

function renderEquityChart(
  curve: Array<{ date: string; equity: number }>,
  benchmarkCurve: Array<{ date: string; equity: number }> | null
): void {
  const svg = document.getElementById('result-chart');
  if (!svg) return;
  if (curve.length < 2) {
    svg.innerHTML = '';
    return;
  }

  const width = 800;
  const height = 240;
  const padTop = 10;
  const padBottom = 10;
  const padLeft = 10;
  const padRight = 10;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  // Compute the y-axis range from both curves together so they share
  // the same scale and the comparison is visually honest.
  let minEq = curve[0].equity;
  let maxEq = curve[0].equity;
  for (const p of curve) {
    if (p.equity < minEq) minEq = p.equity;
    if (p.equity > maxEq) maxEq = p.equity;
  }
  if (benchmarkCurve) {
    for (const p of benchmarkCurve) {
      if (p.equity < minEq) minEq = p.equity;
      if (p.equity > maxEq) maxEq = p.equity;
    }
  }
  // Include the baseline at 1.0 in the range so it's always visible.
  if (1.0 < minEq) minEq = 1.0;
  if (1.0 > maxEq) maxEq = 1.0;
  const range = maxEq - minEq || 1;

  const toPath = (
    points: Array<{ date: string; equity: number }>
  ): string => {
    return points
      .map((p, i) => {
        const x = padLeft + (i / (points.length - 1)) * innerW;
        const y = padTop + ((maxEq - p.equity) / range) * innerH;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  };

  const stratPts = toPath(curve);
  const stratFinal = curve[curve.length - 1].equity;
  const stratColor = stratFinal >= 1.0 ? '#2ecc71' : '#d85a30';
  const baselineY = padTop + ((maxEq - 1.0) / range) * innerH;

  const benchPath =
    benchmarkCurve && benchmarkCurve.length >= 2
      ? toPath(benchmarkCurve)
      : null;

  // Layer order: baseline (back), benchmark (middle), strategy (front).
  // The benchmark uses a subdued accent-blue dashed line so it reads as
  // a reference rather than competing for visual weight with the user's
  // strategy.
  svg.innerHTML = `
    <line x1="${padLeft}" y1="${baselineY.toFixed(2)}" x2="${padLeft + innerW}" y2="${baselineY.toFixed(2)}"
          stroke="#1f2530" stroke-width="1" stroke-dasharray="4 4" />
    ${
      benchPath
        ? `<polyline points="${benchPath}" fill="none" stroke="#4a9eff" stroke-width="1.2" stroke-dasharray="3 3" opacity="0.7" />`
        : ''
    }
    <polyline points="${stratPts}" fill="none" stroke="${stratColor}" stroke-width="1.6" />
  `;
}

function applyQueryParamPrefill(): void {
  // /strategies/{name}/ pages link back to / with `?strategy=<name>`
  // (and optional &symbol=<sym>) so the user can run a backtest on the
  // strategy they were just reading about without retyping anything.
  const params = new URLSearchParams(window.location.search);
  const strategy = params.get('strategy');
  const symbol = params.get('symbol');

  if (strategy) {
    const select = document.getElementById('strategy') as HTMLSelectElement | null;
    if (select && STRATEGY_SPECS[strategy]) {
      select.value = strategy;
      // Fire a synthetic change event so the params container re-renders.
      select.dispatchEvent(new Event('change'));
    }
  }

  if (symbol) {
    const symbolSelect = document.getElementById('symbol') as HTMLSelectElement | null;
    if (symbolSelect) {
      // The symbol picker is populated asynchronously after /api/universe
      // resolves, so retry briefly until the option exists or we time out.
      let tries = 0;
      const tryAssign = () => {
        const opt = Array.from(symbolSelect.options).find(
          (o) => o.value.toUpperCase() === symbol.toUpperCase()
        );
        if (opt) {
          symbolSelect.value = opt.value;
        } else if (tries++ < 20) {
          setTimeout(tryAssign, 100);
        }
      };
      tryAssign();
    }
  }
}

async function init(): Promise<void> {
  mountSiteShell('home');
  setDefaultDateRange();

  const strategySelect = document.getElementById('strategy') as HTMLSelectElement | null;
  if (strategySelect) {
    renderStrategyParams(strategySelect.value);
    strategySelect.addEventListener('change', () => {
      renderStrategyParams(strategySelect.value);
    });
  }

  const [universe, rateStatus] = await Promise.all([
    loadUniverse(),
    loadRateStatus(),
  ]);

  if (universe) renderUniverseLists(universe);
  if (rateStatus) renderRateBanner(rateStatus);

  // Apply ?strategy= and ?symbol= pre-fill after the universe loads so
  // the symbol picker has its options populated by the time we look up
  // the requested symbol.
  applyQueryParamPrefill();

  const form = document.getElementById('backtest-form');
  if (form) {
    form.addEventListener('submit', (ev) => {
      handleSubmit(ev as SubmitEvent).catch((err) => {
        console.error('handleSubmit threw', err);
        setStatus(`unexpected error: ${(err as Error).message}`, 'error');
        setRunDisabled(false);
      });
    });
  }
}

init();
