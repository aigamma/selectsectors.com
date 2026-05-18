import './style.css';
import { mountSiteShell } from './layout.ts';
import {
  copyShareLink,
  escapeHtml,
  formatTimeUntilReset,
  loadRateStatus,
  populateSymbolGroup,
  renderRateBanner,
  renderRateBannerLoadError,
  setButtonDisabled,
  setDefaultDateRange,
  setShareFeedback,
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
  bollinger_bands: { color: '#5dd3c5', label: 'Bollinger Bands' },
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

let running = false;

// Snapshot of inputs that produced the currently-rendered result.
// Used by handleShareClick so the share-link describes the actual
// rendered comparison rather than the form's possibly-edited state.
// See main.ts iter-107 commit for full rationale.
let lastRenderedInputs: CompareRequest | null = null;

async function handleSubmit(ev: SubmitEvent): Promise<void> {
  ev.preventDefault();
  // Concurrency guard; see main.ts handleSubmit for rationale.
  if (running) return;
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

  running = true;
  setRunDisabled(true);
  setStatus('dispatching comparison...');
  hideResultPanel();
  lastRenderedInputs = null;

  await dispatchAndPoll<CompareResult>({
    endpoint: '/api/compare',
    body,
    pollTimeoutMs: 90_000,
    onRateLimits: showRateBanner,
    onStatus: setStatus,
    onResult: (result) => {
      lastRenderedInputs = body;
      renderResult(result);
    },
    onRateExceeded: (reason, info) => {
      const which = reason === 'hour-exceeded' ? 'hour' : 'day';
      const reset = info ? `; resets ${formatTimeUntilReset(info, which)}` : '';
      setStatus(`rate limit exceeded for this ${which}${reset}`, 'error');
    },
    onError: (message) => setStatus(`error: ${message}`, 'error'),
  });

  setRunDisabled(false);
  running = false;
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
            <td class="num ${(s.sharpe ?? 0) >= 0 ? 'positive' : 'negative'}">${numFmt(s.sharpe)}</td>
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

function applyQueryParamPrefill(): void {
  // Recipients of a shared /compare/ URL get the form pre-filled with
  // the sender's symbol + date range. The symbol picker is populated
  // asynchronously from /api/universe so the assign retries briefly
  // until the option exists or we time out at ~2s.
  const params = new URLSearchParams(window.location.search);
  const symbol = params.get('symbol');
  const start = params.get('start');
  const end = params.get('end');

  if (start) {
    const startEl = document.getElementById(
      'start-date'
    ) as HTMLInputElement | null;
    if (startEl) startEl.value = start;
  }
  if (end) {
    const endEl = document.getElementById(
      'end-date'
    ) as HTMLInputElement | null;
    if (endEl) endEl.value = end;
  }
  if (symbol) {
    const symbolSelect = document.getElementById(
      'symbol'
    ) as HTMLSelectElement | null;
    if (symbolSelect) {
      // Symbol option appears asynchronously after the universe load
      // resolves. After ~2 s of retries we surface a warning the same
      // way the homepage does, since the unselected picker would
      // otherwise leave the recipient unsure why their link didn't
      // pre-fill.
      let tries = 0;
      const tryAssign = () => {
        const opt = Array.from(symbolSelect.options).find(
          (o) => o.value.toUpperCase() === symbol.toUpperCase()
        );
        if (opt) {
          symbolSelect.value = opt.value;
        } else if (tries++ < 20) {
          setTimeout(tryAssign, 100);
        } else {
          setStatus(
            `unknown symbol "${symbol}" in URL; not in the current universe. The symbol may have been rotated out of the roster since this link was generated.`,
            'error'
          );
        }
      };
      tryAssign();
    }
  }
}

async function handleShareClick(): Promise<void> {
  // Build a /compare/?symbol=...&start=...&end=... URL that recipients
  // can open to pre-fill the form. Reads from the lastRenderedInputs
  // snapshot so the URL matches the rendered comparison even if the
  // user has edited the form between submit and click-share.
  if (!lastRenderedInputs) {
    setShareFeedback('share-feedback', 'run a comparison first', 'error');
    return;
  }

  const url = new URL('/compare/', window.location.origin);
  url.searchParams.set('symbol', lastRenderedInputs.symbol);
  url.searchParams.set('start', lastRenderedInputs.dateRange.start);
  url.searchParams.set('end', lastRenderedInputs.dateRange.end);

  await copyShareLink(url.toString());
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
  } else {
    // Without the universe, the symbol picker has only the static SPX
    // option from the HTML and no SPDR sector or anchor options. The
    // user can technically still submit with SPX but the form is much
    // less useful. Tell them directly rather than letting them stare
    // at an empty picker.
    setStatus(
      'failed to load the symbol roster from /api/universe; refresh to retry, or pick SPX which is hardcoded in the form',
      'error'
    );
  }
  if (rateStatus) {
    showRateBanner(rateStatus);
  } else {
    renderRateBannerLoadError('rate-banner');
  }

  applyQueryParamPrefill();

  const form = document.getElementById('compare-form');
  form?.addEventListener('submit', (ev) => {
    handleSubmit(ev as SubmitEvent).catch((err) => {
      console.error('handleSubmit threw', err);
      setStatus(`unexpected error: ${(err as Error).message}`, 'error');
      setRunDisabled(false);
      running = false;
    });
  });

  const shareBtn = document.getElementById('share-button');
  shareBtn?.addEventListener('click', () => {
    handleShareClick().catch((err) => {
      console.error('handleShareClick threw', err);
      setShareFeedback('share-feedback', (err as Error).message, 'error');
    });
  });
}

init();
