import './style.css';
import { mountSiteShell } from './layout.ts';
import { STRATEGY_SPECS } from './strategy-specs.ts';
import {
  copyShareLink,
  escapeHtml,
  formatTimeUntilReset,
  loadRateStatus,
  renderRateBanner,
  renderRateBannerLoadError,
  setButtonDisabled,
  setDefaultDateRange,
  setShareFeedback,
  setStatus as setStatusUtil,
  type RateLimitInfo,
} from './page-utils.ts';
import { dispatchAndPoll } from './dispatch.ts';

// Cross-symbol scan page. One strategy, one date range, 23 backtests
// in a single rate-limit slot. Result is a ranked table only (no
// per-symbol equity curve charts; that's what the single-backtest
// surface is for).
//
// Refactored to use the shared page-utils + dispatch helpers, so the
// page-specific code in this module is just: STRATEGY_SPECS-driven
// form rendering, the request shape, and the result rendering. The
// network plumbing (POST + poll), the rate-banner state, and the
// form helpers (date range default, status line, button disable)
// all live in src/page-utils.ts and src/dispatch.ts.

interface ScanSymbolEntry {
  symbol: string;
  category: 'index' | 'broad' | 'sector' | 'anchor';
  bars?: number;
  firstDate?: string;
  lastDate?: string;
  totalReturn?: number;
  annualizedReturn?: number;
  sharpe?: number;
  maxDrawdown?: number;
  hitRate?: number;
  error?: string;
}

interface ScanResult {
  inputs: unknown;
  mode: 'scan-all';
  strategy: string;
  dateRange: { start: string; end: string };
  symbols: ScanSymbolEntry[];
  error?: string;
  computedAt: string;
  computeMs?: number;
}

const setStatus = (msg: string, kind: 'info' | 'error' = 'info') =>
  setStatusUtil('status-line', msg, kind);
const setRunDisabled = (disabled: boolean) =>
  setButtonDisabled('run-button', disabled);
const showRateBanner = (info: RateLimitInfo) =>
  renderRateBanner('rate-banner', info, 'scans');

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

interface ScanRequest {
  strategy: { name: string; params: Record<string, number> };
  dateRange: { start: string; end: string };
}

let running = false;

// Snapshot of inputs that produced the currently-rendered scan
// result. Used by handleShareClick so the share-link describes the
// actual rendered scan rather than the form's possibly-edited state.
// See main.ts iter-107 commit for full rationale.
let lastRenderedInputs: ScanRequest | null = null;

async function handleSubmit(ev: SubmitEvent): Promise<void> {
  ev.preventDefault();
  // Concurrency guard; see main.ts handleSubmit for rationale.
  if (running) return;
  const form = ev.target as HTMLFormElement;
  const fd = new FormData(form);
  const strategyName = String(fd.get('strategy') ?? 'buy_and_hold');
  const start = String(fd.get('start-date') ?? '');
  const end = String(fd.get('end-date') ?? '');
  if (!start || !end) {
    setStatus('please pick a date range', 'error');
    return;
  }
  if (start > end) {
    setStatus('start date must be on or before end date', 'error');
    return;
  }

  const body: ScanRequest = {
    strategy: { name: strategyName, params: readStrategyParams() },
    dateRange: { start, end },
  };

  running = true;
  setRunDisabled(true);
  setStatus('dispatching scan across the universe...');
  hideResultPanel();
  lastRenderedInputs = null;

  await dispatchAndPoll<ScanResult>({
    endpoint: '/api/scan',
    body,
    pollTimeoutMs: 120_000,
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

function renderResult(result: ScanResult): void {
  showResultPanel();

  if (result.error) {
    setStatus(`scan error: ${result.error}`, 'error');
    return;
  }

  const inputs = result.inputs as
    | { strategy?: { name?: string; params?: Record<string, number> } }
    | undefined;
  const strategyName = inputs?.strategy?.name ?? result.strategy;
  const scanParams = inputs?.strategy?.params ?? {};
  const homeBaseUrl = (symbol: string): string => {
    // Encode the scan's chosen params under p_<key>=<value> so the
    // recipient lands on the homepage with the exact same param
    // values the scan was run with, not the default values. Without
    // this, a scan run with momentum lookback=120 produces row
    // links that pre-fill the homepage form with the default
    // lookback=60, giving the recipient a related-but-different
    // backtest than what the scan row represents.
    const p = new URLSearchParams();
    p.set('strategy', strategyName);
    p.set('symbol', symbol);
    for (const [key, value] of Object.entries(scanParams)) {
      p.set(`p_${key}`, String(value));
    }
    return `/?${p.toString()}`;
  };

  const tbody = document.querySelector<HTMLTableSectionElement>(
    '#scan-table tbody'
  );
  if (tbody) {
    tbody.innerHTML = result.symbols
      .map((s) => {
        const cat = categoryLabel(s.category);
        if (s.error) {
          return `
            <tr class="compare-row compare-row-error">
              <td>${escapeHtml(s.symbol)}</td>
              <td>${escapeHtml(cat)}</td>
              <td colspan="6" class="compare-row-error-cell">${escapeHtml(s.error)}</td>
            </tr>
          `;
        }
        return `
          <tr class="compare-row">
            <td><a href="${escapeHtml(homeBaseUrl(s.symbol))}" class="scan-symbol-link"><strong>${escapeHtml(s.symbol)}</strong></a></td>
            <td><span class="scan-category scan-category-${escapeHtml(s.category)}">${escapeHtml(cat)}</span></td>
            <td class="num ${(s.totalReturn ?? 0) >= 0 ? 'positive' : 'negative'}">${pctFmt(s.totalReturn)}</td>
            <td class="num ${(s.annualizedReturn ?? 0) >= 0 ? 'positive' : 'negative'}">${pctFmt(s.annualizedReturn)}</td>
            <td class="num ${(s.sharpe ?? 0) >= 0 ? 'positive' : 'negative'}">${numFmt(s.sharpe)}</td>
            <td class="num">${pctFmt(s.maxDrawdown)}</td>
            <td class="num">${pctFmt(s.hitRate)}</td>
            <td class="num">${s.bars ?? '-'}</td>
          </tr>
        `;
      })
      .join('');
  }

  const footnote = `Strategy: ${escapeHtml(result.strategy)} &middot; ${result.symbols.length} symbols &middot; ${escapeHtml(result.dateRange.start)} to ${escapeHtml(result.dateRange.end)}${result.computeMs ? ` &middot; ${result.computeMs} ms backend` : ''}`;
  const footnoteEl = document.getElementById('result-footnote');
  if (footnoteEl) footnoteEl.innerHTML = footnote;
}

function categoryLabel(c: ScanSymbolEntry['category']): string {
  switch (c) {
    case 'index':
      return 'Index';
    case 'broad':
      return 'Broad ETF';
    case 'sector':
      return 'Sector ETF';
    case 'anchor':
      return 'Anchor name';
  }
}

function applyQueryParamPrefill(): void {
  // Recipients of a shared /scan/ URL get the form pre-filled with
  // the sender's strategy + per-strategy params + date range. The
  // strategy-params inputs are rendered synchronously by the change
  // handler on the strategy select, so we can copy p_<key>=<value>
  // values right after dispatching the change event.
  const params = new URLSearchParams(window.location.search);
  const strategy = params.get('strategy');
  const start = params.get('start');
  const end = params.get('end');

  if (strategy) {
    const select = document.getElementById('strategy') as HTMLSelectElement | null;
    if (select) {
      const opt = Array.from(select.options).find((o) => o.value === strategy);
      if (opt) {
        select.value = strategy;
        select.dispatchEvent(new Event('change'));
        queueMicrotask(() => {
          for (const [key, value] of params) {
            if (!key.startsWith('p_')) continue;
            const paramKey = key.slice(2);
            const input = document.querySelector<HTMLInputElement>(
              `input[data-param-key="${paramKey}"]`
            );
            if (input) input.value = value;
          }
        });
      } else {
        // Same pattern as main.ts iter 81: surface a non-blocking
        // warning when the URL specifies a strategy that's not in
        // the select's options. Most common cause is a stale
        // bookmark from a deploy that renamed or removed the
        // strategy. The recipient sees the form with the default
        // strategy and the explanation in the status line; date
        // params from the URL still apply so the link is partially
        // recoverable.
        setStatus(
          `unknown strategy "${strategy}" in URL; using default. The strategy may have been renamed or removed since this link was generated.`,
          'error'
        );
      }
    }
  }

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
}

async function handleShareClick(): Promise<void> {
  // Build a /scan/?strategy=...&start=...&end=...&p_<key>=<value>...
  // URL that recipients can open to pre-fill the form. Reads from the
  // lastRenderedInputs snapshot so the URL matches the rendered scan
  // even if the user has edited the form between submit and
  // click-share.
  if (!lastRenderedInputs) {
    setShareFeedback('share-feedback', 'run a scan first', 'error');
    return;
  }

  const url = new URL('/scan/', window.location.origin);
  url.searchParams.set('strategy', lastRenderedInputs.strategy.name);
  url.searchParams.set('start', lastRenderedInputs.dateRange.start);
  url.searchParams.set('end', lastRenderedInputs.dateRange.end);
  for (const [key, value] of Object.entries(lastRenderedInputs.strategy.params)) {
    url.searchParams.set(`p_${key}`, String(value));
  }

  await copyShareLink(url.toString());
}

async function init(): Promise<void> {
  mountSiteShell('scan');
  setDefaultDateRange();

  const strategySelect = document.getElementById('strategy') as HTMLSelectElement | null;
  if (strategySelect) {
    renderStrategyParams(strategySelect.value);
    strategySelect.addEventListener('change', () => {
      renderStrategyParams(strategySelect.value);
    });
  }

  const rateStatus = await loadRateStatus();
  if (rateStatus) {
    showRateBanner(rateStatus);
  } else {
    renderRateBannerLoadError('rate-banner');
  }

  applyQueryParamPrefill();

  const form = document.getElementById('scan-form');
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
