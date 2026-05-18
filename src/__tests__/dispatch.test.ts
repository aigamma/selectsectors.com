import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchAndPoll } from '../dispatch.ts';
import type { RateLimitInfo } from '../page-utils.ts';

// Tests for dispatch.ts, the shared POST-and-poll helper used by the
// homepage backtest, /compare/, and /scan/ pages. The function is the
// only place where the three response shapes (ready/queued/rate-
// limited) and the polling loop live, so a regression here would
// silently break all three rate-limited surfaces. The tests below
// cover the four substantive paths.

interface Captured {
  rateLimits: RateLimitInfo[];
  statuses: { msg: string; kind: 'info' | 'error' }[];
  results: unknown[];
  rateExceededCalls: { reason: string; info: RateLimitInfo }[];
  errors: string[];
}

function makeOpts<TResult>(captured: Captured, endpoint = '/api/backtest') {
  return {
    endpoint,
    body: { symbol: 'SPX', dateRange: { start: '2024-01-01', end: '2025-12-31' } },
    pollTimeoutMs: 2_000,
    pollIntervalMs: 50,
    onRateLimits: (info: RateLimitInfo) => captured.rateLimits.push(info),
    onStatus: (msg: string, kind: 'info' | 'error' = 'info') =>
      captured.statuses.push({ msg, kind }),
    onResult: (result: TResult) => captured.results.push(result),
    onRateExceeded: (reason: string, info: RateLimitInfo) =>
      captured.rateExceededCalls.push({ reason, info }),
    onError: (message: string) => captured.errors.push(message),
  };
}

function fresh(): Captured {
  return {
    rateLimits: [],
    statuses: [],
    results: [],
    rateExceededCalls: [],
    errors: [],
  };
}

const FAKE_INFO: RateLimitInfo = {
  hourly: { limit: 2, used: 1, remaining: 1, resetAt: Date.now() + 3_600_000 },
  daily: { limit: 5, used: 1, remaining: 4, resetAt: Date.now() + 86_400_000 },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dispatchAndPoll - cache-hit path', () => {
  it('calls onResult with the result when status=ready arrives on the POST', async () => {
    const fakeResult = { sharpe: 1.23, totalReturn: 0.18 };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(200, {
        status: 'ready',
        hash: 'abc',
        cached: true,
        result: fakeResult,
        rateLimits: FAKE_INFO,
      })
    );

    const captured = fresh();
    const out = await dispatchAndPoll(makeOpts(captured));

    // out and captured.results both go through JSON.parse so the
    // result is a different reference from fakeResult; use deep
    // equality, not Object.is.
    expect(out).toEqual(fakeResult);
    expect(captured.results).toEqual([fakeResult]);
    expect(captured.rateLimits).toEqual([FAKE_INFO]);
    expect(captured.errors).toEqual([]);
    expect(captured.rateExceededCalls).toEqual([]);
    const cachedStatus = captured.statuses.find((s) =>
      s.msg.includes('cached')
    );
    expect(cachedStatus).toBeDefined();
  });
});

describe('dispatchAndPoll - rate-limited path', () => {
  it('calls onRateExceeded with the reason from a 429 response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(429, {
        error: 'rate limit exceeded',
        reason: 'hour-exceeded',
        rateLimits: FAKE_INFO,
      })
    );

    const captured = fresh();
    const out = await dispatchAndPoll(makeOpts(captured));

    expect(out).toBeNull();
    expect(captured.rateExceededCalls).toEqual([
      { reason: 'hour-exceeded', info: FAKE_INFO },
    ]);
    expect(captured.rateLimits).toEqual([FAKE_INFO]);
    expect(captured.results).toEqual([]);
    expect(captured.errors).toEqual([]);
  });
});

describe('dispatchAndPoll - queued + poll path', () => {
  it('polls /api/result and calls onResult once status flips to ready', async () => {
    const fakeResult = { totalReturn: 0.05 };
    const f = global.fetch as ReturnType<typeof vi.fn>;
    // POST returns 202 queued.
    f.mockResolvedValueOnce(
      jsonResponse(200, {
        status: 'queued',
        hash: 'deadbeef',
        rateLimits: FAKE_INFO,
      })
    );
    // First poll: still pending.
    f.mockResolvedValueOnce(
      jsonResponse(202, { status: 'pending', hash: 'deadbeef' })
    );
    // Second poll: ready.
    f.mockResolvedValueOnce(
      jsonResponse(200, {
        status: 'ready',
        hash: 'deadbeef',
        result: fakeResult,
      })
    );

    const captured = fresh();
    const out = await dispatchAndPoll(makeOpts(captured));

    expect(out).toEqual(fakeResult);
    expect(captured.results).toEqual([fakeResult]);
    expect(captured.rateLimits).toEqual([FAKE_INFO]);
    // 1 POST + 2 polls = 3 fetch calls.
    expect(f).toHaveBeenCalledTimes(3);
    // Status line should have transitioned through the queued message
    // before reaching the done message.
    const queuedIdx = captured.statuses.findIndex((s) =>
      s.msg.includes('queued')
    );
    const doneIdx = captured.statuses.findIndex((s) => s.msg.startsWith('done'));
    expect(queuedIdx).toBeGreaterThanOrEqual(0);
    expect(doneIdx).toBeGreaterThan(queuedIdx);
  });
});

describe('dispatchAndPoll - network failure on POST', () => {
  it('calls onError when the initial POST throws', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('network down')
    );

    const captured = fresh();
    const out = await dispatchAndPoll(makeOpts(captured));

    expect(out).toBeNull();
    expect(captured.errors).toEqual(['network down']);
    expect(captured.results).toEqual([]);
  });
});
