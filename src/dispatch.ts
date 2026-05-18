// Generic POST-and-poll dispatcher for the three rate-limited backtest
// endpoints (/api/backtest, /api/compare, /api/scan). All three follow
// the same shape:
//
//   1. POST to the endpoint with a JSON body.
//   2. Response is one of:
//      - { status: 'ready', result, cached?, rateLimits? }
//      - { status: 'queued', hash, rateLimits }
//      - 429 { error, reason, rateLimits }
//      - 4xx/5xx { error }
//   3. On 'queued', poll /api/result?hash= every 1.5s until the blob
//      exists or the timeout expires.
//
// This module encapsulates that flow as a single typed function that
// each page wires its render and status-update callbacks into. Pages
// retain control over result rendering (which is page-specific) but
// share the network plumbing.

import type { RateLimitInfo } from './page-utils.ts';

export interface DispatchOptions<TResult> {
  endpoint: string;
  body: unknown;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;

  onRateLimits: (info: RateLimitInfo) => void;
  onStatus: (message: string, kind?: 'info' | 'error') => void;
  onResult: (result: TResult) => void;
  onRateExceeded: (reason: string, info: RateLimitInfo) => void;
  onError: (message: string) => void;
}

interface DispatchResponse<TResult> {
  status: 'ready' | 'queued';
  hash: string;
  cached?: boolean;
  result?: TResult;
  rateLimits?: RateLimitInfo;
}

interface DispatchErrorResponse {
  error: string;
  reason?: string;
  rateLimits?: RateLimitInfo;
}

interface ResultPollResponse<TResult> {
  status: 'pending' | 'ready';
  hash: string;
  result?: TResult;
}

/**
 * POST `body` to `endpoint`, handle the three response shapes, and on
 * 'queued' poll /api/result until the result lands or the timeout
 * expires. Calls the appropriate callback for each outcome. Returns
 * the result on success, null on any failure path (the appropriate
 * callback will have already fired).
 */
export async function dispatchAndPoll<TResult>(
  opts: DispatchOptions<TResult>
): Promise<TResult | null> {
  const pollTimeoutMs = opts.pollTimeoutMs ?? 60_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 1500;

  let dispatched: DispatchResponse<TResult> | DispatchErrorResponse;
  try {
    const res = await fetch(opts.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opts.body),
    });
    dispatched = (await res.json()) as
      | DispatchResponse<TResult>
      | DispatchErrorResponse;
    if (res.status === 429) {
      const err = dispatched as DispatchErrorResponse;
      if (err.rateLimits) opts.onRateLimits(err.rateLimits);
      opts.onRateExceeded(err.reason ?? 'unknown', err.rateLimits as RateLimitInfo);
      return null;
    }
    if (!res.ok) {
      const err = dispatched as DispatchErrorResponse;
      opts.onError(err.error ?? res.statusText);
      return null;
    }
  } catch (err) {
    opts.onError((err as Error).message);
    return null;
  }

  const dispatch = dispatched as DispatchResponse<TResult>;
  if (dispatch.rateLimits) opts.onRateLimits(dispatch.rateLimits);

  if (dispatch.status === 'ready' && dispatch.result) {
    opts.onStatus(
      dispatch.cached ? 'cached result returned instantly' : 'result ready'
    );
    opts.onResult(dispatch.result);
    return dispatch.result;
  }

  opts.onStatus('queued; polling for the result...');
  const startT = Date.now();
  while (Date.now() - startT < pollTimeoutMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    try {
      const pollRes = await fetch(
        `/api/result?hash=${encodeURIComponent(dispatch.hash)}`
      );
      const pollJson = (await pollRes.json()) as ResultPollResponse<TResult>;
      if (pollJson.status === 'ready' && pollJson.result) {
        opts.onStatus(`done in ${((Date.now() - startT) / 1000).toFixed(1)}s`);
        opts.onResult(pollJson.result);
        return pollJson.result;
      }
    } catch (err) {
      console.warn('poll failed', err);
      // Continue polling on transient failure.
    }
  }
  opts.onStatus('timed out waiting for the result; try again', 'error');
  return null;
}
