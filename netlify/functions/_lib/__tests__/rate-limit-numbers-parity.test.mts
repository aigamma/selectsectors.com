import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { backtestLimiter, chatLimiter } from '../rate-limit.mts';

// Rate-limit numbers parity. The actual per-IP caps live in
// netlify/functions/_lib/rate-limit.mts as the configured options
// on backtestLimiter and chatLimiter (currently hour=2, day=5 for
// backtests; hour=30, day=100 for chat). The same numbers appear
// in four documentation surfaces:
//
//   1. api-docs/index.html prose, line ~45:
//      "backtest at 2/hour and 5/day; chat at 30/hour and 100/day"
//   2. api-docs/index.html JSON example for GET /api/health:
//      "backtest": { "hour": 2, "day": 5 },
//      "chat":     { "hour": 30, "day": 100 }
//   3. README.md prose, line ~22-23:
//      "Rate-limited at 30 messages/hour and 100/day per IP"
//      (this is the chat cap; the backtest cap appears later)
//   4. README.md prose, line ~106-107:
//      "2 backtests/hour AND 5 backtests/day"
//
// If a future change adjusts the live caps (e.g., chat is bumped
// from 30/hour to 60/hour because the chat usage is dominated by
// short bursts in a single session), all four surfaces need to be
// updated in lockstep. This test pins them all to the live values.

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const API_DOCS_PATH = resolve(ROOT, 'api-docs', 'index.html');
const README_PATH = resolve(ROOT, 'README.md');
const CHAT_SYSTEM_PROMPT_PATH = resolve(
  ROOT,
  'netlify',
  'functions',
  '_lib',
  'chat-system-prompt.mts'
);

const liveBacktestHour = backtestLimiter.limits.hour;
const liveBacktestDay = backtestLimiter.limits.day;
const liveChatHour = chatLimiter.limits.hour;
const liveChatDay = chatLimiter.limits.day;

function stripTags(html: string): string {
  // Cheap inline tag stripper: removes <tag> and </tag> markup so the
  // prose-pattern regexes can match across <strong> emphasis without
  // having to encode every possible markup variation.
  return html.replace(/<[^>]+>/g, '');
}

describe('rate-limit numbers parity', () => {
  const apiDocs = readFileSync(API_DOCS_PATH, 'utf8');
  const apiDocsText = stripTags(apiDocs);
  const readme = readFileSync(README_PATH, 'utf8');

  it('api-docs prose mentions the correct backtest + chat caps', () => {
    // Match the prose: "backtest at 2/hour and 5/day; chat at 30/hour and 100/day"
    // The two limits are extracted as separate capture groups so a
    // failure pinpoints which number is wrong. The match runs on
    // the tag-stripped text so <strong>backtest</strong> reads as
    // plain "backtest".
    const re =
      /backtest.{0,15}?(\d+)\/hour and (\d+)\/day;\s*chat.{0,15}?(\d+)\/hour and (\d+)\/day/i;
    const m = apiDocsText.match(re);
    expect(
      m,
      'expected api-docs/index.html to contain the prose pattern "backtest at N/hour and M/day; chat at P/hour and Q/day"'
    ).not.toBeNull();
    if (!m) return;
    expect(parseInt(m[1], 10)).toBe(liveBacktestHour);
    expect(parseInt(m[2], 10)).toBe(liveBacktestDay);
    expect(parseInt(m[3], 10)).toBe(liveChatHour);
    expect(parseInt(m[4], 10)).toBe(liveChatDay);
  });

  it('api-docs JSON example mentions the correct backtest caps', () => {
    // Match: "backtest": { "hour": 2, "day": 5 }
    const re = /"backtest":\s*\{\s*"hour":\s*(\d+),\s*"day":\s*(\d+)\s*\}/;
    const m = apiDocs.match(re);
    expect(m, 'expected api-docs JSON example to declare "backtest": {hour,day}').not.toBeNull();
    if (!m) return;
    expect(parseInt(m[1], 10)).toBe(liveBacktestHour);
    expect(parseInt(m[2], 10)).toBe(liveBacktestDay);
  });

  it('api-docs JSON example mentions the correct chat caps', () => {
    // Match: "chat": { "hour": 30, "day": 100 }
    const re = /"chat":\s*\{\s*"hour":\s*(\d+),\s*"day":\s*(\d+)\s*\}/;
    const m = apiDocs.match(re);
    expect(m, 'expected api-docs JSON example to declare "chat": {hour,day}').not.toBeNull();
    if (!m) return;
    expect(parseInt(m[1], 10)).toBe(liveChatHour);
    expect(parseInt(m[2], 10)).toBe(liveChatDay);
  });

  it('README.md mentions the correct backtest cap', () => {
    // Match: "2 backtests/hour AND 5 backtests/day" with case-insensitive
    // "and" since the README uses "AND" in caps.
    const re = /(\d+)\s+backtests?\/hour\s+AND\s+(\d+)\s+backtests?\/day/i;
    const m = readme.match(re);
    expect(
      m,
      'expected README.md to contain "N backtests/hour AND M backtests/day"'
    ).not.toBeNull();
    if (!m) return;
    expect(parseInt(m[1], 10)).toBe(liveBacktestHour);
    expect(parseInt(m[2], 10)).toBe(liveBacktestDay);
  });

  it('README.md mentions the correct chat cap', () => {
    // Match: "Rate-limited at 30 messages/hour and 100/day per IP"
    const re = /(\d+)\s+messages?\/hour\s+and\s+(\d+)\/day/i;
    const m = readme.match(re);
    expect(
      m,
      'expected README.md to contain "N messages/hour and M/day"'
    ).not.toBeNull();
    if (!m) return;
    expect(parseInt(m[1], 10)).toBe(liveChatHour);
    expect(parseInt(m[2], 10)).toBe(liveChatDay);
  });

  it('chat-system-prompt.mts mentions the correct backtest + chat caps', () => {
    // The system prompt instructs SelectBot to know the rate limits
    // so it can answer "how many backtests do I have left?" without
    // hitting the live API. Pattern at line ~62:
    //   "2 backtests/hour and 5 backtests/day per IP for the
    //    backtester; 30 chat messages/hour and 100/day per IP for
    //    SelectBot."
    // Both pairs of numbers are captured in one regex so the failure
    // pinpoints which surface needs updating.
    const prompt = readFileSync(CHAT_SYSTEM_PROMPT_PATH, 'utf8');
    const re =
      /(\d+)\s+backtests?\/hour\s+and\s+(\d+)\s+backtests?\/day.{0,80}?(\d+)\s+chat\s+messages?\/hour\s+and\s+(\d+)\/day/is;
    const m = prompt.match(re);
    expect(
      m,
      'expected chat-system-prompt.mts to contain "N backtests/hour and M backtests/day ... P chat messages/hour and Q/day"'
    ).not.toBeNull();
    if (!m) return;
    expect(parseInt(m[1], 10)).toBe(liveBacktestHour);
    expect(parseInt(m[2], 10)).toBe(liveBacktestDay);
    expect(parseInt(m[3], 10)).toBe(liveChatHour);
    expect(parseInt(m[4], 10)).toBe(liveChatDay);
  });
});
