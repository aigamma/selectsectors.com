import './style.css';
import { mountSiteShell } from './layout.ts';
import { STRATEGY_SPECS } from './strategy-specs.ts';

// Cross-symbol scan page. One strategy, one date range, 23 backtests
// in a single rate-limit slot. Result is a ranked table only (no
// per-symbol equity curve charts; that's what the single-backtest
// surface is for).
//
// The strategy picker and parameter controls are duplicated from
// src/main.ts (STRATEGY_SPECS) because the scan page is a separate
// entry and there's no shared module yet. A future refactor could
// extract STRATEGY_SPECS into a shared module; for now the
// duplication is small and the cost of getting them out of sync is
// detectable (a frontend-emitted param would be rejected by the
// Rust crate at the WASM boundary, producing a clean error rather
// than silent wrong behavior).

interface RateLimitInfo {
  hourly: { limit: number; used: number; remaining: number; resetAt: number };
  daily: { limit: number; used: number; remaining: number; resetAt: number };
}

interface RateStatusResponse extends RateLimitInfo {
  caps: { hour: number; day: number };
}

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

interface ScanDispatchResponse {
  status: 'ready' | 'queued';
  hash: string;
  cached?: boolean;
  result?: ScanResult;
  rateLimits?: RateLimitInfo;
}

interface ScanErrorResponse {
  error: string;
  reason?: string;
  rateLimits?: RateLimitInfo;
}

interface ResultPollResponse {
  status: 'pending' | 'ready';
  hash: string;
  result?: ScanResult;
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

async function loadRateStatus(): Promise<RateStatusResponse | null> {
  try {
    const res = await fetch('/api/rate-status');
    if (!res.ok) return null;
    return (await res.json()) as RateStatusResponse;
  } catch {
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

  el.innerHTML = `You have <span class="rate-banner-count">${hourRemaining}</span> of ${info.hourly.limit} scans left this hour, and <span class="rate-banner-count">${dayRemaining}</span> of ${info.daily.limit} today.`;
}

function setStatus(message: string, kind: 'info' | 'error' = 'info'): void {
  const el = document.getElementById('status-line');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', kind === 'error');
}

function setRunDisabled(disabled: boolean): void {
  const btn = document.getElementById('run-button') as HTMLButtonElement | null;
  if (btn) btn.disabled = disabled;
}

function setDefaultDateRange(): void {
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

interface ScanRequest {
  strategy: { name: string; params: Record<string, number> };
  dateRange: { start: string; end: string };
}

async function handleSubmit(ev: SubmitEvent): Promise<void> {
  ev.preventDefault();
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

  setRunDisabled(true);
  setStatus('dispatching scan across the universe...');
  hideResultPanel();

  let dispatched: ScanDispatchResponse | ScanErrorResponse;
  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    dispatched = (await res.json()) as ScanDispatchResponse | ScanErrorResponse;
    if (res.status === 429) {
      const err = dispatched as ScanErrorResponse;
      const which = err.reason === 'hour-exceeded' ? 'hour' : 'day';
      setStatus(
        `rate limit exceeded for this ${which}; retry after the banner resets`,
        'error'
      );
      if (err.rateLimits) renderRateBanner(err.rateLimits);
      setRunDisabled(false);
      return;
    }
    if (!res.ok) {
      const err = dispatched as ScanErrorResponse;
      setStatus(`error: ${err.error ?? res.statusText}`, 'error');
      setRunDisabled(false);
      return;
    }
  } catch (err) {
    setStatus(`network error: ${(err as Error).message}`, 'error');
    setRunDisabled(false);
    return;
  }

  const dispatch = dispatched as ScanDispatchResponse;
  if (dispatch.rateLimits) renderRateBanner(dispatch.rateLimits);

  if (dispatch.status === 'ready' && dispatch.result) {
    setStatus(dispatch.cached ? 'cached result returned instantly' : 'scan ready');
    renderResult(dispatch.result);
    setRunDisabled(false);
    return;
  }

  setStatus('queued; scanning 23 symbols...');
  const startT = Date.now();
  const POLL_MS = 1500;
  const TIMEOUT_MS = 120_000;
  while (Date.now() - startT < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    try {
      const pollRes = await fetch(
        `/api/result?hash=${encodeURIComponent(dispatch.hash)}`
      );
      const pollJson = (await pollRes.json()) as ResultPollResponse;
      if (pollJson.status === 'ready' && pollJson.result) {
        setStatus(`done in ${((Date.now() - startT) / 1000).toFixed(1)}s`);
        renderResult(pollJson.result);
        setRunDisabled(false);
        return;
      }
    } catch (err) {
      console.warn('poll failed', err);
    }
  }
  setStatus('timed out waiting for the scan; try again', 'error');
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

function renderResult(result: ScanResult): void {
  showResultPanel();

  if (result.error) {
    setStatus(`scan error: ${result.error}`, 'error');
    return;
  }

  // Build the URL params once per render so each row's link uses the
  // same strategy + date range the scan was run with. The user
  // clicking a row jumps to the homepage with this strategy + the
  // row's symbol pre-filled, and can hit Run to see the per-bar
  // equity curve (which the scan blob deliberately omits to keep
  // payload small).
  const inputs = result.inputs as
    | { strategy?: { name?: string; params?: Record<string, number> } }
    | undefined;
  const strategyName = inputs?.strategy?.name ?? result.strategy;
  const homeBaseUrl = (symbol: string): string => {
    const p = new URLSearchParams();
    p.set('strategy', strategyName);
    p.set('symbol', symbol);
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
              <td>${escape(s.symbol)}</td>
              <td>${escape(cat)}</td>
              <td colspan="6" class="compare-row-error-cell">${escape(s.error)}</td>
            </tr>
          `;
        }
        return `
          <tr class="compare-row">
            <td><a href="${escape(homeBaseUrl(s.symbol))}" class="scan-symbol-link"><strong>${escape(s.symbol)}</strong></a></td>
            <td><span class="scan-category scan-category-${escape(s.category)}">${escape(cat)}</span></td>
            <td class="num ${(s.totalReturn ?? 0) >= 0 ? 'positive' : 'negative'}">${pctFmt(s.totalReturn)}</td>
            <td class="num ${(s.annualizedReturn ?? 0) >= 0 ? 'positive' : 'negative'}">${pctFmt(s.annualizedReturn)}</td>
            <td class="num">${numFmt(s.sharpe)}</td>
            <td class="num">${pctFmt(s.maxDrawdown)}</td>
            <td class="num">${pctFmt(s.hitRate)}</td>
            <td class="num">${s.bars ?? '-'}</td>
          </tr>
        `;
      })
      .join('');
  }

  const footnote = `Strategy: ${escape(result.strategy)} &middot; ${result.symbols.length} symbols &middot; ${escape(result.dateRange.start)} to ${escape(result.dateRange.end)}${result.computeMs ? ` &middot; ${result.computeMs} ms backend` : ''}`;
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
  if (rateStatus) renderRateBanner(rateStatus);

  const form = document.getElementById('scan-form');
  form?.addEventListener('submit', (ev) => {
    handleSubmit(ev as SubmitEvent).catch((err) => {
      console.error('handleSubmit threw', err);
      setStatus(`unexpected error: ${(err as Error).message}`, 'error');
      setRunDisabled(false);
    });
  });
}

init();
