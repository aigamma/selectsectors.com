// Frontend entry. Three concerns mounted at page load:
//
//   1. Universe roster — fetched from /api/universe and rendered into
//      the sector + anchor lists in the universe panel AND into the
//      backtest form's symbol <optgroup> elements.
//   2. Rate-limit banner — fetched from /api/rate-status and rendered
//      as "you have N backtests left this hour, M today". No slot is
//      consumed; the read-only endpoint is the right shape for an
//      always-on indicator that lets the user know before clicking
//      Run whether they have allowance left.
//   3. Backtest run — submit handler that POSTs to /api/backtest,
//      handles the three response shapes (ready/cached, queued,
//      429), and on queued, polls /api/result every 1.5 seconds
//      until either a result is ready or the wait exceeds 60 s
//      (the polling timeout is generous because the placeholder
//      strategy is fast but the eventual WASM strategy library will
//      include longer-running scans).

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

interface BacktestResult {
  inputs: unknown;
  bars: number;
  firstDate?: string;
  lastDate?: string;
  totalReturn: number;
  sharpe: number;
  maxDrawdown: number;
  equityCurve?: Array<{ date: string; ret: number; equity: number }>;
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
    strategy: { name: strategyName, params: {} },
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

  // Status was 'queued' — poll /api/result for up to 60 seconds.
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
      // Continue polling on a transient failure.
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

  // Metric cells. Color total return on its sign.
  const totalReturnPct = (result.totalReturn * 100).toFixed(2);
  setTextWithSign('result-total-return', `${totalReturnPct}%`, result.totalReturn);
  setText('result-sharpe', result.sharpe.toFixed(2));
  setText('result-drawdown', `${(result.maxDrawdown * 100).toFixed(2)}%`);
  setText('result-bars', String(result.bars));

  const footnote = result.note
    ? `${result.note}${result.computeMs ? ` · ${result.computeMs} ms backend` : ''}`
    : `computed in ${result.computeMs ?? '?'} ms`;
  setText('result-footnote', footnote);

  // Equity curve as an inline SVG line. Generous width because the
  // chart stretches across the result panel's content box and the
  // SVG uses preserveAspectRatio=none so we drive the aspect ratio
  // from the CSS height.
  renderEquityChart(result.equityCurve ?? []);
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
  curve: Array<{ date: string; equity: number }>
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

  let minEq = curve[0].equity;
  let maxEq = curve[0].equity;
  for (const p of curve) {
    if (p.equity < minEq) minEq = p.equity;
    if (p.equity > maxEq) maxEq = p.equity;
  }
  const range = maxEq - minEq || 1;

  const pts = curve.map((p, i) => {
    const x = padLeft + (i / (curve.length - 1)) * innerW;
    const y = padTop + ((maxEq - p.equity) / range) * innerH;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  // Color the line green if the final equity is above 1.0 (positive
  // total return), coral if below. The baseline 1.0 is the starting
  // equity by construction (buy-and-hold normalized to 1.0).
  const finalEq = curve[curve.length - 1].equity;
  const color = finalEq >= 1.0 ? '#2ecc71' : '#d85a30';

  // Render: a baseline at equity=1.0 plus the equity polyline.
  const baselineY =
    padTop + ((maxEq - 1.0) / range) * innerH;
  svg.innerHTML = `
    <line x1="${padLeft}" y1="${baselineY.toFixed(2)}" x2="${padLeft + innerW}" y2="${baselineY.toFixed(2)}"
          stroke="#1f2530" stroke-width="1" stroke-dasharray="4 4" />
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.6" />
  `;
}

async function init(): Promise<void> {
  setDefaultDateRange();

  const [universe, rateStatus] = await Promise.all([
    loadUniverse(),
    loadRateStatus(),
  ]);

  if (universe) renderUniverseLists(universe);
  if (rateStatus) renderRateBanner(rateStatus);

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
