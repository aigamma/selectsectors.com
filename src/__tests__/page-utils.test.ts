import { describe, expect, it } from 'vitest';

import { escapeHtml, formatTimeUntilReset } from '../page-utils.ts';
import type { RateLimitInfo } from '../page-utils.ts';

// page-utils is mostly DOM-coupled (setStatus, renderRateBanner,
// populateSymbolGroup all touch document). The escapeHtml function
// is the one pure-function helper, so it's the only one easy to
// test without a jsdom environment. The rest are exercised by the
// typecheck plus the human-eyeball-it tests during dev.

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
  });

  it('passes through safe characters unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
    expect(escapeHtml('NVDA SPY XLE')).toBe('NVDA SPY XLE');
    expect(escapeHtml('1.23 * 100% = 123')).toBe('1.23 * 100% = 123');
  });

  it('escapes a string with mixed safe and unsafe characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('escapes & first so it does not double-escape the entity prefix', () => {
    // The order matters: if we escaped < before &, then escaping &
    // after would turn the &lt; into &amp;lt;. Test the canonical
    // failure case.
    expect(escapeHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
  });

  it('handles the empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('formatTimeUntilReset', () => {
  // The function reads Date.now() each call. Each test builds a
  // RateLimitInfo whose resetAt is `Date.now() + offsetMs` so the
  // offset is the meaningful quantity regardless of when the test
  // happens to run.
  function makeInfo(hourOffsetMs: number, dayOffsetMs: number): RateLimitInfo {
    const now = Date.now();
    return {
      hourly: { limit: 2, used: 2, remaining: 0, resetAt: now + hourOffsetMs },
      daily: { limit: 5, used: 5, remaining: 0, resetAt: now + dayOffsetMs },
    };
  }

  it('formats sub-hour resets as minutes', () => {
    // 23 minutes from now, hour window.
    const info = makeInfo(23 * 60_000, 24 * 60 * 60_000);
    expect(formatTimeUntilReset(info, 'hour')).toBe('in 23 min');
  });

  it('rounds up partial minutes', () => {
    // 12.5 minutes from now -> ceil to 13.
    const info = makeInfo(12.5 * 60_000, 24 * 60 * 60_000);
    expect(formatTimeUntilReset(info, 'hour')).toBe('in 13 min');
  });

  it('returns "in 0 min" when the reset is already in the past', () => {
    // Resets 5 minutes ago; the Math.max(0, ...) clamp produces 0.
    const info = makeInfo(-5 * 60_000, 24 * 60 * 60_000);
    expect(formatTimeUntilReset(info, 'hour')).toBe('in 0 min');
  });

  it('formats whole-hour resets without the minutes suffix', () => {
    // Exactly 3 hours from now, day window.
    const info = makeInfo(60_000, 3 * 60 * 60_000);
    expect(formatTimeUntilReset(info, 'day')).toBe('in 3 hr');
  });

  it('formats hour+minute resets with both components', () => {
    // 5 hours 12 minutes from now.
    const info = makeInfo(60_000, (5 * 60 + 12) * 60_000);
    expect(formatTimeUntilReset(info, 'day')).toBe('in 5 hr 12 min');
  });

  it('formats day-scale resets as "in N days"', () => {
    // 2 days from now, day window.
    const info = makeInfo(60_000, 2 * 24 * 60 * 60_000);
    expect(formatTimeUntilReset(info, 'day')).toBe('in 2 days');
  });

  it('uses singular "in 1 day" when exactly 24 hours', () => {
    // Exactly 1 day; the function checks `days === 1` for the
    // singular form.
    const info = makeInfo(60_000, 24 * 60 * 60_000);
    expect(formatTimeUntilReset(info, 'day')).toBe('in 1 day');
  });
});
