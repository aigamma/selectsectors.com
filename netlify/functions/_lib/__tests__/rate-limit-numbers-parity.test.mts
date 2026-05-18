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
const DISCLAIMER_PATH = resolve(ROOT, 'disclaimer', 'index.html');

const NUMBER_TO_WORD: Record<number, string> = {
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
  20: 'twenty',
  30: 'thirty',
  40: 'forty',
  50: 'fifty',
  60: 'sixty',
  70: 'seventy',
  80: 'eighty',
  90: 'ninety',
  100: 'one hundred',
};

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

  it('disclaimer page mentions the correct backtest caps in word form', () => {
    // The disclaimer page describes the rate limits in plain prose
    // for the legal/user-facing surface: "two runs per hour, five
    // per day per IP". This is the sixth surface where the rate-
    // limit numbers appear (after api-docs prose, api-docs JSON
    // example, README backtest, README chat, chat-system-prompt).
    // The disclaimer uses WORD-FORM rather than digit-form, so the
    // regex matches against NUMBER_TO_WORD[hourLimit] and
    // NUMBER_TO_WORD[dayLimit]. Currently "two runs per hour, five
    // per day" matches hourLimit=2 + dayLimit=5.
    const html = readFileSync(DISCLAIMER_PATH, 'utf8');
    const hourWord = NUMBER_TO_WORD[liveBacktestHour];
    const dayWord = NUMBER_TO_WORD[liveBacktestDay];
    expect(
      hourWord && dayWord,
      `NUMBER_TO_WORD missing entry for ${liveBacktestHour} or ${liveBacktestDay}; extend the table`
    ).toBeTruthy();
    const re = new RegExp(
      `${hourWord}\\s+runs?\\s+per\\s+hour,?\\s*${dayWord}\\s+per\\s+day`,
      'i'
    );
    expect(
      re.test(html),
      `expected disclaimer/index.html to contain prose like "${hourWord} runs per hour, ${dayWord} per day" matching live caps ${liveBacktestHour}/${liveBacktestDay}`
    ).toBe(true);
  });

  it('disclaimer page mentions the correct chat caps in word form', () => {
    // "thirty messages per hour, one hundred per day per IP"
    const html = readFileSync(DISCLAIMER_PATH, 'utf8');
    const hourWord = NUMBER_TO_WORD[liveChatHour];
    const dayWord = NUMBER_TO_WORD[liveChatDay];
    expect(
      hourWord && dayWord,
      `NUMBER_TO_WORD missing entry for ${liveChatHour} or ${liveChatDay}; extend the table`
    ).toBeTruthy();
    const re = new RegExp(
      `${hourWord}\\s+messages?\\s+per\\s+hour,?\\s*${dayWord}\\s+per\\s+day`,
      'i'
    );
    expect(
      re.test(html),
      `expected disclaimer/index.html to contain prose like "${hourWord} messages per hour, ${dayWord} per day" matching live caps ${liveChatHour}/${liveChatDay}`
    ).toBe(true);
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
