import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { CHAT_SYSTEM_PROMPT } from '../chat-system-prompt.mts';
import {
  SECTORS,
  ANCHORS,
  ALL_SYMBOLS,
} from '../universe-roster.mts';
import { STRATEGY_DEFAULTS } from '../strategy.mts';

// Chat system prompt numbers parity. The prompt makes several
// hardcoded cardinality claims about the site that must stay in
// sync with the live state if SelectBot is to answer factually:
//
//   - "the 23-symbol universe" / "Twenty-three symbols total" / "all 23 symbols"
//     -> ALL_SYMBOLS.length
//   - "the eleven SPDR sector ETFs"           -> SECTORS.length
//   - "the eleven anchor single names"        -> ANCHORS.length
//   - "all six strategies"                    -> Object.keys(STRATEGY_DEFAULTS).length
//   - "six Rust curriculum lessons"           -> learn/* subdirs
//   - "five interactive quiz categories"      -> quiz/* subdirs
//   - "five backtesting-philosophy primers"   -> philosophy/* subdirs
//   - "nine endpoints under /api/"            -> non-background .mts files
//                                                in netlify/functions/
//
// Existing tests cover the universe-roster counts directly (the
// SECTORS/ANCHORS/ALL_SYMBOLS lengths) but do not verify that the
// prompt's prose mentions the right numbers; that's the gap this
// file fills. If a future iteration adds a 7th strategy or a 6th
// quiz category or moves the API surface to 10 endpoints, the
// prompt grounding text would silently go stale and SelectBot
// would tell users a smaller catalog than what's live.

const ROOT = resolve(__dirname, '..', '..', '..', '..');

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
  11: 'eleven',
  12: 'twelve',
};

function countSubdirPages(dir: string): number {
  const sectionDir = resolve(ROOT, dir);
  return readdirSync(sectionDir).filter((entry) => {
    const p = resolve(sectionDir, entry);
    if (!statSync(p).isDirectory()) return false;
    return existsSync(resolve(p, 'index.html'));
  }).length;
}

function countUserCallableFunctions(): number {
  const dir = resolve(ROOT, 'netlify', 'functions');
  return readdirSync(dir).filter((entry) => {
    if (!entry.endsWith('.mts')) return false;
    if (entry.endsWith('-background.mts')) return false;
    return true;
  }).length;
}

interface ClaimCheck {
  label: string;
  /** Live cardinality the prompt should reference. */
  liveCount: number;
  /** Regex (with %WORD% / %NUM% placeholders) that must match. */
  pattern: (word: string, num: number) => RegExp;
}

const CHECKS: ClaimCheck[] = [
  {
    label: 'universe symbol count ("23-symbol")',
    liveCount: ALL_SYMBOLS.length,
    pattern: (_word, num) => new RegExp(`\\b${num}-symbol\\b`),
  },
  {
    label: 'universe symbol total ("Twenty-three symbols total")',
    liveCount: ALL_SYMBOLS.length,
    pattern: (word) => {
      // Word-form with the first letter title-cased. NUMBER_TO_WORD
      // returns lowercase ("twenty-three"); the prompt prose uses
      // "Twenty-three" with leading capital. Case-insensitive match.
      return new RegExp(`\\b${word}\\s+symbols\\s+total\\b`, 'i');
    },
  },
  {
    label: 'scan-all-symbols phrase ("all 23 symbols")',
    liveCount: ALL_SYMBOLS.length,
    pattern: (_word, num) =>
      new RegExp(`\\ball\\s+${num}\\s+symbols\\b`),
  },
  {
    label: 'SPDR sector count ("eleven SPDR sector ETFs")',
    liveCount: SECTORS.length,
    pattern: (word) => new RegExp(`\\b${word}\\s+SPDR\\s+sector\\b`, 'i'),
  },
  {
    label: 'anchor single name count ("eleven anchor single names")',
    liveCount: ANCHORS.length,
    pattern: (word) => new RegExp(`\\b${word}\\s+anchor\\s+single\\s+names?\\b`, 'i'),
  },
  {
    label: 'strategies count ("all six strategies")',
    liveCount: Object.keys(STRATEGY_DEFAULTS).length,
    pattern: (word) => new RegExp(`\\b${word}\\s+strateg(?:y|ies)\\b`, 'i'),
  },
  {
    label: 'Rust curriculum lesson count ("six Rust curriculum lessons")',
    liveCount: countSubdirPages('learn'),
    pattern: (word) => new RegExp(`\\b${word}\\s+Rust\\s+curriculum\\s+lessons?\\b`, 'i'),
  },
  {
    label: 'quiz category count ("five interactive quiz categories")',
    liveCount: countSubdirPages('quiz'),
    pattern: (word) =>
      new RegExp(`\\b${word}\\s+(?:interactive\\s+)?quiz\\s+categor(?:y|ies)\\b`, 'i'),
  },
  {
    label: 'philosophy primer count ("five backtesting-philosophy primers")',
    liveCount: countSubdirPages('philosophy'),
    pattern: (word) =>
      new RegExp(`\\b${word}\\s+backtesting-philosophy\\s+primers?\\b`, 'i'),
  },
  {
    label: 'API endpoint count ("nine endpoints under /api/")',
    liveCount: countUserCallableFunctions(),
    pattern: (word) =>
      new RegExp(`\\b${word}\\s+endpoints?\\s+under\\s+\\/api\\/`, 'i'),
  },
];

describe('chat system prompt numbers parity', () => {
  it.each(CHECKS.map((c) => [c.label, c]))(
    'prompt claim "%s" matches the live cardinality',
    (_label, check) => {
      // word may be undefined for live counts outside 1-12 (e.g.,
      // the 23-symbol universe count); the check's pattern function
      // is responsible for not using `word` when it's undefined.
      // The fallback `?? ''` keeps the test machinery alive even
      // when only the digit form is needed.
      const word = NUMBER_TO_WORD[check.liveCount] ?? '';
      const re = check.pattern(word, check.liveCount);
      expect(
        re.test(CHAT_SYSTEM_PROMPT),
        `chat system prompt does not match expected pattern for "${check.label}": ` +
          `expected ${re.toString()} (live count = ${check.liveCount}, word = "${word}"). ` +
          `Either update the prompt prose to use the new count, or undo whatever change altered the live count.`
      ).toBe(true);
    }
  );
});

// Slug enumeration parity. The prompt explicitly lists every quiz
// category and every philosophy primer by its human-readable name.
// If a future iteration renames a directory slug (or adds a new
// page in either section), the prompt must be updated to match;
// otherwise the bot enumerates a stale list and tells users about
// a different catalog than what's live. Each pair below maps the
// directory slug to the prose fragment the prompt is expected to
// contain. Philosophy slugs map cleanly via kebab-to-space, but
// quiz slugs use human-friendlier prose ("wasm-internals" appears
// as "WebAssembly internals" in the prompt; "quant-finance" appears
// as "Quant finance basics"), so the mapping is hardcoded explicitly.

const QUIZ_SLUG_PROSE: Record<string, string> = {
  'rust-basics': 'Rust basics',
  'this-sites-rust': "This site's Rust",
  'quant-finance': 'Quant finance basics',
  'rust-intermediate': 'Rust intermediate',
  'wasm-internals': 'WebAssembly internals',
};

const PHILOSOPHY_SLUG_PROSE: Record<string, string> = {
  overfitting: 'overfitting',
  'survivorship-bias': 'survivorship bias',
  'lookahead-bias': 'lookahead bias',
  'backtest-vs-live': 'backtest vs live',
  regimes: 'regimes',
};

function listSubdirSlugs(dir: string): string[] {
  const sectionDir = resolve(ROOT, dir);
  return readdirSync(sectionDir)
    .filter((entry) => {
      const p = resolve(sectionDir, entry);
      if (!statSync(p).isDirectory()) return false;
      return existsSync(resolve(p, 'index.html'));
    })
    .sort();
}

describe('chat system prompt /quiz/ slug enumeration parity', () => {
  const slugs = listSubdirSlugs('quiz');

  it.each(slugs.map((s) => [s]))(
    'quiz slug %s has a mapped prose name in QUIZ_SLUG_PROSE and the prompt mentions it',
    (slug) => {
      const prose = QUIZ_SLUG_PROSE[slug];
      expect(
        prose,
        `quiz/${slug}/index.html exists but QUIZ_SLUG_PROSE has no mapping. Add { '${slug}': '<prose name>' } and ensure the chat-system-prompt mentions that prose name in the /quiz/ enumeration.`
      ).toBeDefined();
      if (!prose) return;
      expect(
        CHAT_SYSTEM_PROMPT.includes(prose),
        `chat-system-prompt does not contain the prose "${prose}" expected for /quiz/${slug}/. Update the prompt's quiz enumeration.`
      ).toBe(true);
    }
  );
});

// Strategy signature parity. The prompt lists each strategy with
// its parameter signature in {brace} notation (e.g., `sma_crossover`
// { fast, slow }, `rsi_mean_reversion` { period, oversold,
// overbought }). The signature names must match the Rust Params
// struct fields one-to-one or SelectBot teaches users the wrong
// parameter names. The rust-params-parity test already pins the
// Rust Params struct fields to the toStrategyKind wire-format, but
// not to the prompt's prose enumeration; this fills that gap.

interface StrategyToCheck {
  slug: string;
  rustFile: string;
}

const STRATEGIES_WITH_PARAMS: StrategyToCheck[] = [
  { slug: 'sma_crossover', rustFile: 'sma_crossover.rs' },
  { slug: 'momentum', rustFile: 'momentum.rs' },
  // rsi_meanreversion.rs is the actual filename (no underscore
  // between "mean" and "reversion") because the original Rust
  // module was named that way; the public strategy slug is the
  // serde rename_all-derived snake_case form rsi_mean_reversion.
  { slug: 'rsi_mean_reversion', rustFile: 'rsi_meanreversion.rs' },
  { slug: 'breakout', rustFile: 'breakout.rs' },
  { slug: 'bollinger_bands', rustFile: 'bollinger_bands.rs' },
];

const STRATEGIES_DIR = resolve(ROOT, 'crates', 'backtest-core', 'src', 'strategies');

function extractRustParamFields(rustSource: string): string[] {
  const blockMatch = rustSource.match(/pub struct Params \{([\s\S]*?)\n\}/);
  if (!blockMatch) return [];
  const body = blockMatch[1];
  const fieldRe = /^\s+pub\s+([a-z_][a-z0-9_]*)\s*:/gm;
  const fields: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = fieldRe.exec(body)) !== null) {
    fields.push(m[1]);
  }
  return fields;
}

function extractPromptSignatureFields(
  promptSource: string,
  slug: string
): string[] | null {
  // Match: `<slug>` { field1, field2, ... } or `<slug>` { ... }:
  // The brace block immediately follows the backquoted slug. The
  // fields are comma-separated identifiers; capture the brace
  // contents and split on commas.
  const re = new RegExp(`\\\`${slug}\\\`\\s*\\{([^}]*)\\}`);
  const m = promptSource.match(re);
  if (!m) return null;
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

describe('chat system prompt strategy signature parity', () => {
  it.each(STRATEGIES_WITH_PARAMS.map((s) => [s.slug, s]))(
    'strategy %s prompt signature matches the Rust Params struct fields',
    (_slug, strat) => {
      const rustPath = resolve(STRATEGIES_DIR, strat.rustFile);
      const rustSource = readFileSync(rustPath, 'utf8');
      const rustFields = extractRustParamFields(rustSource).sort();
      const promptFields = extractPromptSignatureFields(
        CHAT_SYSTEM_PROMPT,
        strat.slug
      );
      expect(
        promptFields,
        `chat-system-prompt has no signature line for \`${strat.slug}\` { ... }`
      ).not.toBeNull();
      if (!promptFields) return;
      expect(
        promptFields.sort(),
        `prompt signature for ${strat.slug} is ${JSON.stringify(promptFields)} but Rust Params has ${JSON.stringify(rustFields)}`
      ).toEqual(rustFields);
    }
  );
});

describe('chat system prompt /philosophy/ slug enumeration parity', () => {
  const slugs = listSubdirSlugs('philosophy');

  it.each(slugs.map((s) => [s]))(
    'philosophy slug %s has a mapped prose name in PHILOSOPHY_SLUG_PROSE and the prompt mentions it',
    (slug) => {
      const prose = PHILOSOPHY_SLUG_PROSE[slug];
      expect(
        prose,
        `philosophy/${slug}/index.html exists but PHILOSOPHY_SLUG_PROSE has no mapping. Add { '${slug}': '<prose name>' } and ensure the chat-system-prompt mentions that prose name in the /philosophy/ enumeration.`
      ).toBeDefined();
      if (!prose) return;
      expect(
        CHAT_SYSTEM_PROMPT.includes(prose),
        `chat-system-prompt does not contain the prose "${prose}" expected for /philosophy/${slug}/. Update the prompt's philosophy enumeration.`
      ).toBe(true);
    }
  );
});
