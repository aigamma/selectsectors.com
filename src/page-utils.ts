// Frontend page-level utilities shared by the backtest/compare/scan
// pages. Each page used to have its own copy of these helpers; the
// duplication was ~50 lines per page and any change to (say) the
// rate-banner copy or the date-range default had to happen in three
// places. Now they live here.
//
// The helpers are intentionally DOM-coupled (they accept element IDs
// rather than element references) because the pages were written
// that way; refactoring them to take Element parameters would be a
// bigger churn for the same end result.

export interface RateLimitInfo {
  hourly: { limit: number; used: number; remaining: number; resetAt: number };
  daily: { limit: number; used: number; remaining: number; resetAt: number };
}

export interface RateStatusResponse extends RateLimitInfo {
  caps: { hour: number; day: number };
}

/** HTML-escape a string for safe inclusion in innerHTML. */
export function escapeHtml(s: string): string {
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

/** Set the status line text and toggle the error styling. */
export function setStatus(
  elementId: string,
  message: string,
  kind: 'info' | 'error' = 'info'
): void {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', kind === 'error');
}

/** Enable or disable a button by id. No-op if the element isn't present. */
export function setButtonDisabled(elementId: string, disabled: boolean): void {
  const btn = document.getElementById(elementId) as HTMLButtonElement | null;
  if (btn) btn.disabled = disabled;
}

/** Set the form's date range inputs to the past `days` calendar days,
 *  clamped on the right to today and on the left to MIN_DATE.
 *  Used by every page that has a date-range form. */
export function setDefaultDateRange(
  startElementId: string = 'start-date',
  endElementId: string = 'end-date',
  days: number = 365,
  minDate: string = '2022-01-03'
): void {
  const today = new Date();
  const endDate = today.toISOString().slice(0, 10);
  const startDateD = new Date(today);
  startDateD.setUTCDate(startDateD.getUTCDate() - days);
  const startDate = startDateD.toISOString().slice(0, 10);

  const startEl = document.getElementById(startElementId) as HTMLInputElement | null;
  const endEl = document.getElementById(endElementId) as HTMLInputElement | null;
  if (startEl) {
    startEl.value = startDate;
    startEl.min = minDate;
    startEl.max = endDate;
  }
  if (endEl) {
    endEl.value = endDate;
    endEl.min = minDate;
    endEl.max = endDate;
  }
}

/** Read the per-IP rate-limit state from /api/rate-status. Returns
 *  null on network error so the caller can choose to show "unknown"
 *  rather than crash. */
export async function loadRateStatus(): Promise<RateStatusResponse | null> {
  try {
    const res = await fetch('/api/rate-status');
    if (!res.ok) return null;
    return (await res.json()) as RateStatusResponse;
  } catch {
    return null;
  }
}

/** Render the rate banner with the standard "you have N left this
 *  hour, M today" or "no slots left, resets in K min" copy. The
 *  noun parameter lets the caller distinguish between "backtests"
 *  on the homepage vs "comparison runs" on /compare/ vs "scans" on
 *  /scan/ even though all three share the same rate limiter. */
export function renderRateBanner(
  elementId: string,
  info: RateLimitInfo,
  noun: string = 'backtests'
): void {
  const el = document.getElementById(elementId);
  if (!el) return;
  const hourRemaining = info.hourly.remaining;
  const dayRemaining = info.daily.remaining;
  const exhausted = hourRemaining === 0 || dayRemaining === 0;
  el.classList.toggle('exhausted', exhausted);

  if (exhausted) {
    const which = hourRemaining === 0 ? 'hour' : 'day';
    // Use formatTimeUntilReset for the human-readable time
    // formatting (cascades into "in N hr M min" or "in N days" for
    // long resets). The previous implementation hardcoded "in K min"
    // which produced unreadable values like "in 1380 min" when the
    // day window was exhausted and resetting in 23 hours.
    el.innerHTML = `No ${escapeHtml(noun)} left this ${which}. Next slot opens <span class="rate-banner-count">${formatTimeUntilReset(info, which)}</span>.`;
    return;
  }

  el.innerHTML = `You have <span class="rate-banner-count">${hourRemaining}</span> of ${info.hourly.limit} ${escapeHtml(noun)} left this hour, and <span class="rate-banner-count">${dayRemaining}</span> of ${info.daily.limit} today.`;
}

/** Replace the rate-banner's "checking your daily allowance..." with
 *  a graceful failure message when /api/rate-status returns null
 *  (network error, function down). The user can still try a
 *  backtest; the failure here is informational, not blocking. The
 *  exhausted class is deliberately not toggled because a "couldn't
 *  read your counters" state is not the same as a "you have zero
 *  left" state, and rendering them with the same coral styling
 *  would mislead the user about whether they can run a backtest. */
export function renderRateBannerLoadError(elementId: string): void {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.innerHTML =
    'Rate counters unavailable; try a backtest and the response will show your current state.';
}

/** Format the time-until-reset as a human-readable string ("in 23
 *  min", "in 5 hr 12 min", "in 2 days"). Used in the rate-limit
 *  error message on backtest dispatches so the user sees the actual
 *  retry-after time rather than just "retry later". The window
 *  parameter selects which window's resetAt to use. */
export function formatTimeUntilReset(
  info: RateLimitInfo,
  window: 'hour' | 'day'
): string {
  const resetAt = window === 'hour' ? info.hourly.resetAt : info.daily.resetAt;
  const ms = Math.max(0, resetAt - Date.now());
  const totalMin = Math.ceil(ms / 60_000);
  if (totalMin < 60) return `in ${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours < 24) return mins === 0 ? `in ${hours} hr` : `in ${hours} hr ${mins} min`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'in 1 day' : `in ${days} days`;
}

/** Populate an <optgroup> with one <option> per symbol. The element
 *  ID is for the optgroup itself (not its parent select). */
export function populateSymbolGroup(elementId: string, items: string[]): void {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.innerHTML = items
    .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
    .join('');
}

/** Update the share-feedback span next to a Copy share link button.
 *  Three call-sites (homepage main.ts, /compare/ compare.ts, /scan/
 *  scan.ts) had byte-identical copies of this function before this
 *  extraction; centralizing it means a future change to the fade
 *  timing or the error-styling rule lives in one place.
 *
 *  On 'ok' the message shows in the default styling for 2 seconds,
 *  then clears (only if no other message has replaced it in the
 *  meantime, so a quick second click doesn't immediately blank the
 *  span the user is reading). On 'error' the message stays and the
 *  '.error' class flips so the span renders in coral. */
export function setShareFeedback(
  elementId: string,
  message: string,
  kind: 'ok' | 'error'
): void {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', kind === 'error');
  if (kind === 'ok') {
    setTimeout(() => {
      if (el.textContent === message) el.textContent = '';
    }, 2000);
  }
}

/** Copy a URL to the clipboard and update the share-feedback span.
 *  Three call-sites had the same try/catch shape: writeText into
 *  clipboard with a fallback that displays the raw URL in the
 *  feedback span when the Permissions Policy blocks clipboard
 *  access. This helper folds those into one call. */
export async function copyShareLink(
  url: string,
  feedbackElementId: string = 'share-feedback'
): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    setShareFeedback(feedbackElementId, 'copied', 'ok');
  } catch {
    setShareFeedback(feedbackElementId, url, 'error');
  }
}
