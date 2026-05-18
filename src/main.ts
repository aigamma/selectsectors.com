import { mountSiteShell } from './layout.ts';
import { STRATEGY_SPECS } from './strategy-specs.ts';
import {
  escapeHtml,
  loadRateStatus,
  populateSymbolGroup,
  renderRateBanner,
  setButtonDisabled,
  setDefaultDateRange,
  setStatus as setStatusUtil,
  type RateLimitInfo,
} from './page-utils.ts';
import { dispatchAndPoll } from './dispatch.ts';

// Homepage frontend entry. Six concerns mounted at page load:
//
//   1. Universe roster — fetched from /api/universe and rendered into
//      the sector + anchor lists in the universe panel AND into the
//      backtest form's symbol <optgroup> elements.
//   2. Rate-limit banner — fetched from /api/rate-status and rendered
//      as "you have N backtests left this hour, M today" via the
//      shared page-utils renderer.
//   3. Strategy picker — six strategies wired to the WASM engine,
//      driven by the shared STRATEGY_SPECS catalog. The params
//      container re-renders whenever the strategy changes.
//   4. Backtest run — submit handler that POSTs to /api/backtest via
//      the shared dispatchAndPoll helper. The shared helper handles
//      the three response shapes (ready/cached, queued, 429) and the
//      poll loop; this module supplies the page-specific callbacks.
//   5. Result panel — six metric cells (total return, CAGR, sharpe,
//      max drawdown, hit rate, bars) plus the benchmark overlay chart
//      that compares the chosen strategy against buy-and-hold on the
//      same bar series.
//   6. SelectBot — floating chat panel (see src/chat.ts).

interface UniverseResponse {
  sectors: string[];
  anchors: string[];
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

const setStatus = (msg: string, kind: 'info' | 'error' = 'info') =>
  setStatusUtil('status-line', msg, kind);
const setRunDisabled = (disabled: boolean) =>
  setButtonDisabled('run-button', disabled);
const showRateBanner = (info: RateLimitInfo) =>
  renderRateBanner('rate-banner', info, 'backtests');

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
  el.innerHTML = items.map((s) => `<li>${escapeHtml(s)}</li>`).join('');
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
          <label for="param-${escapeHtml(p.key)}">${escapeHtml(p.label)}</label>
          <input
            type="number"
            id="param-${escapeHtml(p.key)}"
            name="param-${escapeHtml(p.key)}"
            data-param-key="${escapeHtml(p.key)}"
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

  await dispatchAndPoll<BacktestResult>({
    endpoint: '/api/backtest',
    body,
    pollTimeoutMs: 60_000,
    onRateLimits: showRateBanner,
    onStatus: setStatus,
    onResult: (result) => renderResult(result),
    onRateExceeded: (reason) => {
      const which = reason === 'hour-exceeded' ? 'hour' : 'day';
      setStatus(
        `rate limit exceeded for this ${which}; retry after the banner resets`,
        'error'
      );
    },
    onError: (message) => setStatus(`error: ${message}`, 'error'),
  });

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
  // /strategies/{name}/ and /scan/ link back to / with `?strategy=<name>`
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
  if (rateStatus) showRateBanner(rateStatus);

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

  const shareBtn = document.getElementById('share-button');
  shareBtn?.addEventListener('click', () => {
    handleShareClick().catch((err) => {
      console.warn('share failed', err);
      setShareFeedback('clipboard unavailable', 'error');
    });
  });
}

async function handleShareClick(): Promise<void> {
  // Build a URL that, when opened, pre-fills the homepage form with
  // the current input values. The recipient hits Run to reproduce
  // the same backtest; cache-hit returns instantly without consuming
  // a rate-limit slot for them.
  const symbolEl = document.getElementById('symbol') as HTMLSelectElement | null;
  const strategyEl = document.getElementById('strategy') as HTMLSelectElement | null;
  const startEl = document.getElementById('start-date') as HTMLInputElement | null;
  const endEl = document.getElementById('end-date') as HTMLInputElement | null;
  if (!symbolEl?.value || !strategyEl?.value || !startEl?.value || !endEl?.value) {
    setShareFeedback('fill in the form first', 'error');
    return;
  }

  const url = new URL(window.location.origin);
  url.searchParams.set('strategy', strategyEl.value);
  url.searchParams.set('symbol', symbolEl.value);
  url.searchParams.set('start', startEl.value);
  url.searchParams.set('end', endEl.value);

  try {
    await navigator.clipboard.writeText(url.toString());
    setShareFeedback('copied', 'ok');
  } catch {
    setShareFeedback(url.toString(), 'error');
  }
}

function setShareFeedback(message: string, kind: 'ok' | 'error'): void {
  const el = document.getElementById('share-feedback');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', kind === 'error');
  if (kind === 'ok') {
    setTimeout(() => {
      if (el.textContent === message) el.textContent = '';
    }, 2000);
  }
}

init();
