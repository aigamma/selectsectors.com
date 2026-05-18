import { describe, expect, it } from 'vitest';

import {
  applyWindowResets,
  counterToInfo,
  decideConsume,
  freshCounter,
  HOUR_MS,
  DAY_MS,
  type Counter,
} from '../rate-limit.mts';

describe('freshCounter', () => {
  it('initializes both windows to the given timestamp with zero counts', () => {
    const c = freshCounter(1000);
    expect(c).toEqual({
      hourWindowStart: 1000,
      hourCount: 0,
      dayWindowStart: 1000,
      dayCount: 0,
    });
  });
});

describe('applyWindowResets', () => {
  const base: Counter = {
    hourWindowStart: 1000,
    hourCount: 2,
    dayWindowStart: 1000,
    dayCount: 5,
  };

  it('preserves both counters when neither window has expired', () => {
    const after = applyWindowResets(base, base.hourWindowStart + HOUR_MS - 1);
    expect(after).toEqual(base);
  });

  it('resets the hourly counter when an hour has passed', () => {
    const now = base.hourWindowStart + HOUR_MS;
    const after = applyWindowResets(base, now);
    expect(after.hourCount).toBe(0);
    expect(after.hourWindowStart).toBe(now);
    // Day counter is independent.
    expect(after.dayCount).toBe(base.dayCount);
    expect(after.dayWindowStart).toBe(base.dayWindowStart);
  });

  it('resets the daily counter when a day has passed', () => {
    const now = base.dayWindowStart + DAY_MS;
    const after = applyWindowResets(base, now);
    expect(after.dayCount).toBe(0);
    expect(after.dayWindowStart).toBe(now);
    // Hourly counter also resets at the day boundary because an
    // hour has trivially elapsed too.
    expect(after.hourCount).toBe(0);
  });

  it('uses rolling windows keyed off the first call, not fixed clock boundaries', () => {
    // A counter started at minute 30 should still be limited at minute 89
    // (59 minutes in) because the rolling window hasn't elapsed.
    const t0 = 30 * 60 * 1000;
    const c = freshCounter(t0);
    const incremented = { ...c, hourCount: 2 };
    const after = applyWindowResets(incremented, t0 + HOUR_MS - 1);
    expect(after.hourCount).toBe(2);
    // Just after the hour rolls, the window resets.
    const afterRoll = applyWindowResets(incremented, t0 + HOUR_MS);
    expect(afterRoll.hourCount).toBe(0);
  });
});

describe('counterToInfo', () => {
  it('reports remaining as limit minus used, floored at zero', () => {
    const info = counterToInfo(
      { hourWindowStart: 0, hourCount: 5, dayWindowStart: 0, dayCount: 100 },
      2,
      5
    );
    expect(info.hourly.remaining).toBe(0);
    expect(info.daily.remaining).toBe(0);
  });

  it('computes resetAt as windowStart + window-length', () => {
    const info = counterToInfo(freshCounter(1000), 2, 5);
    expect(info.hourly.resetAt).toBe(1000 + HOUR_MS);
    expect(info.daily.resetAt).toBe(1000 + DAY_MS);
  });
});

describe('decideConsume', () => {
  it('allows when both windows have headroom', () => {
    const c = freshCounter(0);
    const d = decideConsume(c, 2, 5);
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe('ok');
    // Info reflects the post-consume state (used = 1).
    expect(d.info.hourly.used).toBe(1);
    expect(d.info.daily.used).toBe(1);
  });

  it('rejects with hour-exceeded when hourly cap is hit', () => {
    const c: Counter = {
      hourWindowStart: 0,
      hourCount: 2,
      dayWindowStart: 0,
      dayCount: 2,
    };
    const d = decideConsume(c, 2, 5);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('hour-exceeded');
    // Info reflects the pre-consume state since the increment didn't happen.
    expect(d.info.hourly.used).toBe(2);
  });

  it('rejects with day-exceeded when daily cap is hit and hourly has room', () => {
    const c: Counter = {
      hourWindowStart: 0,
      hourCount: 0,
      dayWindowStart: 0,
      dayCount: 5,
    };
    const d = decideConsume(c, 2, 5);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('day-exceeded');
  });

  it('checks hour before day so the more-specific reason wins when both caps are hit', () => {
    const c: Counter = {
      hourWindowStart: 0,
      hourCount: 2,
      dayWindowStart: 0,
      dayCount: 5,
    };
    const d = decideConsume(c, 2, 5);
    expect(d.reason).toBe('hour-exceeded');
  });
});
