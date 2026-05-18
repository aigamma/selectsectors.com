import './style.css';
import { mountSiteShell } from './layout.ts';
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

// Strategy-comparison page. Mirrors the homepage backtester's flow
// (universe + rate-limit + result-poll) but talks to /api/compare
// (which runs all five strategies in one shot) and renders an
// overlay chart plus a ranked table instead of single-strategy
// metric cells.

interface UniverseResponse {
  sectors: string[];
  anchors: string[];
}

interface EquityPoint {
  date: string;
  ret: number;
  equity: number;
}

interface StrategyComparisonEntry {
  name: string;
  totalReturn?: number;
  annualizedReturn?: number;
  sharpe?: number;
  maxDrawdown?: number;
  hitRate?: number;
  equityCurve?: EquityPoint[];
  error?: string;
}

interface CompareResult {
  inputs: unknown;
  mode: 'compare-all';
  bars: number;
  firstDate?: string;
  lastDate?: string;
  strategies: StrategyComparisonEntry[];
  error?: string;
  computedAt: string;
  computeMs?: number;
}

// Each strategy gets a distinct color so the overlay chart legend can
// disambiguate. Colors picked from the existing palette tokens plus
// one additional accent (purple) chosen for contrast on the bg-page
// dark background.
const STRATEGY_COLORS: Record<string, { color: string; label: string }> = {
  buy_and_hold: { color: '#9aa6b2', label: 'Buy and hold' },
  sma_crossover: { color: '#4a9eff', label: 'SMA crossover' },
  momentum: { color: '#2ecc71', label: 'Momentum' },
  rsi_mean_reversion: { color: '#f0a030', label: 'RSI mean reversion' },
  breakout: { color: '#bb6bd9', label: 'Donchian breakout' },
};

const setStatus = (msg: string, kind: 'info' | 'error' = 'info') =>
  setStatusUtil('status-line', msg, kind);
const setRunDisabled = (disabled: boolean) =>
  setButtonDisabled('run-button', disabled);
const showRateBanner = (info: RateLimitInfo) =>
  renderRateBanner('rate-banner', info, 'comparison runs');

async function loadUniverse(): Promise<UniverseResponse | null> {
  try {
    const res = await fetch('/api/universe');
    if (!res.ok) return null;
    return (await res.json()) as UniverseResponse;
  } catch {
    return null;
  }
}

interface CompareRequest {
  symbol: string;
  dateRange: { start: string; end: string };
}

async function handleSubmit(ev: SubmitEvent): Promise<void> {
  ev.preventDefault();
  const form = ev.target as HTMLFormElement;
  const fd = new FormData(form);
  const symbol = String(fd.get('symbol') ?? '');
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

  const body: CompareRequest = { symbol, dateRange: { start, end } };

  setRunDisabled(true);
  setStatus('dispatching comparison...');
  hideResultPanel();

  await dispatchAndPoll<CompareResult>({
    endpoint: '/api/compare',
    body,
    pollTimeoutMs: 90_000,
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

function pctFmt(value: number | undefined): string {
  if (value === undefined) return '-';
  return `${(value * 100).toFixed(2)}%`;
}

function numFmt(value: number | undefined): string {
  if (value === undefined) return '-';
  return value.toFixed(2);
}

function renderResult(result: CompareResult): void {
  showResultPanel();

  if (result.error) {
    setStatus(`comparison error: ${result.error}`, 'error');
    return;
  }

  const tbody = document.querySelector<HTMLTableSectionElement>(
    '#compare-table tbody'
  );
  if (tbody) {
    tbody.innerHTML = result.strategies
      .map((s) => {
        const meta = STRATEGY_COLORS[s.name] ?? {
          color: '#9aa6b2',
          label: s.name,
        };
        if (s.error) {
          return `
            <tr class="compare-row compare-row-error">
              <td>
                <span class="compare-row-swatch" style="background:${meta.color}"></span>
                ${escapeHtml(meta.label)}
              </td>
              <td colspan="5" class="compare-row-error-cell">${escapeHtml(s.error)}</td>
            </tr>
          `;
        }
        const stratHref = `/strategies/${s.name.replace(/_/g, '-')}/`;
        return `
          <tr class="compare-row">
            <td>
              <span class="compare-row-swatch" style="background:${meta.color}"></span>
              <a href="${escapeHtml(stratHref)}">${escapeHtml(meta.label)}</a>
            </td>
            <td class="num ${(s.totalReturn ?? 0) >= 0 ? 'positive' : 'negative'}">${pctFmt(s.totalReturn)}</td>
            <td class="num ${(s.annualizedReturn ?? 0) >= 0 ? 'positive' : 'negative'}">${pctFmt(s.annualizedReturn)}</td>
            <td class="num">${numFmt(s.sharpe)}</td>
            <td class="num">${pctFmt(s.maxDrawdown)}</td>
            <td class="num">${pctFmt(s.hitRate)}</td>
          </tr>
        `;
      })
      .join('');
  }

  renderOverlayChart(result.strategies);
  renderLegend(result.strategies);

  const footnote = `Five strategies on ${result.bars} bars from ${result.firstDate} to ${result.lastDate}${result.computeMs ? ` &middot; ${result.computeMs} ms backend` : ''}`;
  const footnoteEl = document.getElementById('result-footnote');
  if (footnoteEl) footnoteEl.innerHTML = footnote;
}

function renderOverlayChart(strategies: StrategyComparisonEntry[]): void {
  const svg = document.getElementById('compare-chart');
  if (!svg) return;

  const curves = strategies
    .filter((s) => s.equityCurve && s.equityCurve.length >= 2)
    .map((s) => ({
      name: s.name,
      curve: s.equityCurve as EquityPoint[],
    }));

  if (curves.length === 0) {
    svg.innerHTML = '';
    return;
  }

  const width = 800;
  const height = 280;
  const padTop = 10;
  const padBottom = 10;
  const padLeft = 10;
  const padRight = 10;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  let minEq = Infinity;
  let maxEq = -Infinity;
  for (const { curve } of curves) {
    for (const p of curve) {
      if (p.equity < minEq) minEq = p.equity;
      if (p.equity > maxEq) maxEq = p.equity;
    }
  }
  if (1.0 < minEq) minEq = 1.0;
  if (1.0 > maxEq) maxEq = 1.0;
  const range = maxEq - minEq || 1;

  const baselineY = padTop + ((maxEq - 1.0) / range) * innerH;

  const polylines = curves
    .map(({ name, curve }) => {
      const color = STRATEGY_COLORS[name]?.color ?? '#9aa6b2';
      const pts = curve
        .map((p, i) => {
          const x = padLeft + (i / (curve.length - 1)) * innerW;
          const y = padTop + ((maxEq - p.equity) / range) * innerH;
          return `${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.92" />`;
    })
    .join('');

  svg.innerHTML = `
    <line x1="${padLeft}" y1="${baselineY.toFixed(2)}" x2="${padLeft + innerW}" y2="${baselineY.toFixed(2)}"
          stroke="#1f2530" stroke-width="1" stroke-dasharray="4 4" />
    ${polylines}
  `;
}

function renderLegend(strategies: StrategyComparisonEntry[]): void {
  const el = document.getElementById('compare-chart-legend');
  if (!el) return;
  el.innerHTML = strategies
    .filter((s) => !s.error)
    .map((s) => {
      const meta = STRATEGY_COLORS[s.name] ?? {
        color: '#9aa6b2',
        label: s.name,
      };
      return `<span class="legend-item" style="--swatch-color:${meta.color}">${escapeHtml(meta.label)}</span>`;
    })
    .join('');
}

async function init(): Promise<void> {
  mountSiteShell('compare');
  setDefaultDateRange();

  const [universe, rateStatus] = await Promise.all([
    loadUniverse(),
    loadRateStatus(),
  ]);

  if (universe) {
    populateSymbolGroup('symbol-sectors-group', universe.sectors);
    populateSymbolGroup('symbol-anchors-group', universe.anchors);
  }
  if (rateStatus) showRateBanner(rateStatus);

  const form = document.getElementById('compare-form');
  form?.addEventListener('submit', (ev) => {
    handleSubmit(ev as SubmitEvent).catch((err) => {
      console.error('handleSubmit threw', err);
      setStatus(`unexpected error: ${(err as Error).message}`, 'error');
      setRunDisabled(false);
    });
  });
}

init();
