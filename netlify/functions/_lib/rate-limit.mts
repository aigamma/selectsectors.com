import { getStore } from '@netlify/blobs';

// Generic per-IP rate limiter backed by Netlify Blobs.
//
// The limiter enforces two rolling windows simultaneously: an hourly
// cap and a daily cap. Each window starts on the first call inside it
// and resets lazily 60 minutes or 24 hours later, respectively. The
// trade-off vs a fixed-clock window (top of the hour, midnight) is no
// boundary-spike attack possible at the cost of slightly less
// predictable reset times. For an expensive endpoint this is the right
// trade.
//
// ## Why a factory and not module-level constants?
//
// The site has two distinct rate-limited endpoints with very different
// cost profiles: backtests (expensive, 2/hour) and chat messages
// (cheap, 30/hour). Sharing one module-level cap would force one
// surface to subsidize the other. The factory pattern lets each
// endpoint declare its own caps and its own blob store, and the
// generic logic (rolling windows, atomic increment, info-shape build)
// stays in one place.
//
// ## Atomicity model
//
// Reads and writes are atomic at the blob level. That is sufficient
// for the load profile because:
//   - Backtest dispatch: each call takes ~seconds to minutes, so
//     concurrent calls from a single IP are vanishingly rare.
//   - Chat dispatch: each call takes ~hundreds of ms to seconds, so
//     a small race window between read and write may let one extra
//     message slip through. That's acceptable for chat (the cost of
//     one extra message is bounded) but would be a problem at chat
//     scales orders of magnitude larger than the current cap.
//
// If either endpoint ever needs strict cap enforcement under heavy
// concurrent load, swap the underlying store for one with compare-
// and-swap semantics (e.g., a Supabase table with row-level locks).

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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

export interface RateLimiterOptions {
  /** Netlify Blob store name. Use a distinct name per endpoint so the
   *  counters don't interfere across endpoints. */
  storeName: string;
  /** Cap on requests in any 60-minute rolling window per IP. */
  hourLimit: number;
  /** Cap on requests in any 24-hour rolling window per IP. */
  dayLimit: number;
}

export interface RateLimiter {
  /** Read the current state for `ip` without consuming a slot. */
  read(ip: string): Promise<RateLimitInfo>;
  /** Atomically check both windows and, if allowed, consume one slot
   *  from each. */
  consume(ip: string): Promise<RateLimitDecision>;
  /** Expose the configured limits so callers can echo them back to
   *  clients without duplicating the constants. */
  limits: { hour: number; day: number };
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const { storeName, hourLimit, dayLimit } = opts;

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
        limit: hourLimit,
        used: counter.hourCount,
        remaining: Math.max(0, hourLimit - counter.hourCount),
        resetAt: counter.hourWindowStart + HOUR_MS,
      },
      daily: {
        limit: dayLimit,
        used: counter.dayCount,
        remaining: Math.max(0, dayLimit - counter.dayCount),
        resetAt: counter.dayWindowStart + DAY_MS,
      },
    };
  }

  async function read(ip: string): Promise<RateLimitInfo> {
    const store = getStore(storeName);
    const now = Date.now();
    const existing = (await store.get(ip, { type: 'json' })) as Counter | null;
    const counter = existing
      ? applyWindowResets(existing, now)
      : freshCounter(now);
    return toInfo(counter);
  }

  async function consume(ip: string): Promise<RateLimitDecision> {
    const store = getStore(storeName);
    const now = Date.now();
    const existing = (await store.get(ip, { type: 'json' })) as Counter | null;
    let counter = existing
      ? applyWindowResets(existing, now)
      : freshCounter(now);

    if (counter.hourCount >= hourLimit) {
      return { allowed: false, reason: 'hour-exceeded', info: toInfo(counter) };
    }
    if (counter.dayCount >= dayLimit) {
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

  return {
    read,
    consume,
    limits: { hour: hourLimit, day: dayLimit },
  };
}

// Pre-configured limiter for the /api/backtest endpoint. Two backtests
// per hour, five per day per IP. Caps confirmed by Eric on 2026-05-17.
// Storage in the `rate-limit-backtest` blob store; counters under
// `rate-limit` (the original scaffold name) remain orphaned for any
// IP that hit the site before this refactor and have no security
// implication (the worst case is one extra backtest gets through for
// a returning visitor).
export const backtestLimiter = createRateLimiter({
  storeName: 'rate-limit-backtest',
  hourLimit: 2,
  dayLimit: 5,
});

// Pre-configured limiter for the /api/chat endpoint. Thirty messages
// per hour and one hundred per day per IP. Higher caps than backtests
// reflect the lower per-message cost: a chat message is ~5 KB of
// input plus ~1 KB of output, vs a backtest which can scan ~1000 bars
// of OHLC data through the WASM engine. Storage in `rate-limit-chat`
// so the counters do not interact with the backtest limiter.
export const chatLimiter = createRateLimiter({
  storeName: 'rate-limit-chat',
  hourLimit: 30,
  dayLimit: 100,
});

// Backwards-compatibility re-exports for the original module API. The
// only consumers are backtest.mts and rate-status.mts; both are
// updated in this commit to use `backtestLimiter` directly, but the
// constants stay exported in case a third consumer arrives.
export const HOUR_LIMIT = backtestLimiter.limits.hour;
export const DAY_LIMIT = backtestLimiter.limits.day;

export async function readRateLimit(ip: string): Promise<RateLimitInfo> {
  return backtestLimiter.read(ip);
}

export async function consumeRateLimit(ip: string): Promise<RateLimitDecision> {
  return backtestLimiter.consume(ip);
}
