import { getStore } from '@netlify/blobs';

// Per-IP rate limiter backed by Netlify Blobs. Two windows:
//
//   - Hourly: cap of HOUR_LIMIT successful backtest dispatches in any
//     rolling 60-minute window keyed off the first call.
//   - Daily: cap of DAY_LIMIT successful backtest dispatches in any
//     rolling 24-hour window keyed off the first call of the day.
//
// Both windows are rolling rather than fixed (e.g., the hour window
// is "60 minutes since the first call in this window" rather than
// "since the top of the hour"); reset happens lazily on the next
// call whose timestamp is past the window's expiry. The trade-off
// vs a fixed-window cron-reset implementation is no boundary spike
// (a user can't burst at :59 and again at :00) at the cost of a
// slightly less predictable reset time. This is the right trade for
// a backtest endpoint where each call is expensive.
//
// Storage: one Netlify Blob per IP under the `rate-limit` store.
// The blob holds the four counters (hour/day window starts + counts)
// as a small JSON object; reads and writes are atomic at the blob
// level, which is sufficient for the load profile (one backtest is
// expected to take ~seconds to minutes, so concurrent calls from a
// single IP are effectively impossible).

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Caps confirmed by Eric on 2026-05-17: 2 backtests/hour and 5/day
// per IP. Both apply; whichever bites first wins. These are not yet
// configurable; bump the constants if the caps need to change.
export const HOUR_LIMIT = 2;
export const DAY_LIMIT = 5;

interface Counter {
  hourWindowStart: number;
  hourCount: number;
  dayWindowStart: number;
  dayCount: number;
}

export interface RateLimitInfo {
  hourly: { limit: number; used: number; remaining: number; resetAt: number };
  daily: { limit: number; used: number; remaining: number; resetAt: number };
}

export interface RateLimitDecision {
  allowed: boolean;
  reason: 'ok' | 'hour-exceeded' | 'day-exceeded';
  info: RateLimitInfo;
}

function freshCounter(now: number): Counter {
  return {
    hourWindowStart: now,
    hourCount: 0,
    dayWindowStart: now,
    dayCount: 0,
  };
}

function applyWindowResets(counter: Counter, now: number): Counter {
  const out = { ...counter };
  if (now - out.hourWindowStart >= HOUR_MS) {
    out.hourWindowStart = now;
    out.hourCount = 0;
  }
  if (now - out.dayWindowStart >= DAY_MS) {
    out.dayWindowStart = now;
    out.dayCount = 0;
  }
  return out;
}

function toInfo(counter: Counter): RateLimitInfo {
  return {
    hourly: {
      limit: HOUR_LIMIT,
      used: counter.hourCount,
      remaining: Math.max(0, HOUR_LIMIT - counter.hourCount),
      resetAt: counter.hourWindowStart + HOUR_MS,
    },
    daily: {
      limit: DAY_LIMIT,
      used: counter.dayCount,
      remaining: Math.max(0, DAY_LIMIT - counter.dayCount),
      resetAt: counter.dayWindowStart + DAY_MS,
    },
  };
}

/// Inspect the current rate-limit state for `ip` without consuming a
/// slot. Use this to render a "you have N backtests left" banner on
/// the frontend before the user even tries a request.
export async function readRateLimit(ip: string): Promise<RateLimitInfo> {
  const store = getStore('rate-limit');
  const now = Date.now();
  const existing = (await store.get(ip, { type: 'json' })) as Counter | null;
  const counter = existing
    ? applyWindowResets(existing, now)
    : freshCounter(now);
  return toInfo(counter);
}

/// Atomically check both limits and, if allowed, consume one slot of
/// each. Returns the decision plus the post-consume info so the
/// caller can echo the updated counters back to the client.
export async function consumeRateLimit(
  ip: string
): Promise<RateLimitDecision> {
  const store = getStore('rate-limit');
  const now = Date.now();
  const existing = (await store.get(ip, { type: 'json' })) as Counter | null;
  let counter = existing
    ? applyWindowResets(existing, now)
    : freshCounter(now);

  if (counter.hourCount >= HOUR_LIMIT) {
    return { allowed: false, reason: 'hour-exceeded', info: toInfo(counter) };
  }
  if (counter.dayCount >= DAY_LIMIT) {
    return { allowed: false, reason: 'day-exceeded', info: toInfo(counter) };
  }

  counter = {
    ...counter,
    hourCount: counter.hourCount + 1,
    dayCount: counter.dayCount + 1,
  };
  await store.setJSON(ip, counter);
  return { allowed: true, reason: 'ok', info: toInfo(counter) };
}
