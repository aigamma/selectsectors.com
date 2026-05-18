import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { CHAT_SYSTEM_PROMPT } from '../chat-system-prompt.mts';

// Chat system prompt Rust function-name parity. The system prompt
// teaches SelectBot to cite real code; specific function names
// from the backtest crate appear inline in backticks: e.g.,
// `apply_positions_to_bars`, `metrics::annualized_sharpe`,
// `sma_crossover::rolling_mean`. If a future iteration renames
// any of these functions in the Rust source, the chat prompt
// would teach SelectBot to cite a function that no longer exists.
//
// The test extracts every backtick-wrapped identifier from the
// prompt that looks like a Rust function reference (either bare
// snake_case or `module::function` style), filters to names that
// look like function names (lowercase first character, no
// leading-capital types), and asserts each one is defined as
// `pub fn <name>` or `pub(crate) fn <name>` somewhere under
// crates/backtest-core/src/.
//
// Names that are NOT functions (like `StrategyKind`, `DailyBar`,
// `Params`, `crates/backtest-core/`) are filtered out by the
// regex itself or by the heuristic that filters leading-capital
// identifiers.

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const CRATE_SRC = resolve(ROOT, 'crates', 'backtest-core', 'src');

function listRustFiles(dir: string, files: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) listRustFiles(full, files);
    else if (st.isFile() && entry.endsWith('.rs')) files.push(full);
  }
}

function extractFunctionNames(rustSource: string): Set<string> {
  // Match `pub fn <name>` and `pub(crate) fn <name>`. The visibility
  // modifier matters: only public functions are referenced from
  // outside the crate, but the chat prompt may also mention
  // pub(crate) functions for instructional purposes.
  const re = /\bpub(?:\(crate\))?\s+fn\s+([a-z_][a-z0-9_]*)/g;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(rustSource)) !== null) {
    names.add(m[1]);
  }
  return names;
}

const rustFiles: string[] = [];
listRustFiles(CRATE_SRC, rustFiles);
const allFunctionNames = new Set<string>();
for (const file of rustFiles) {
  for (const name of extractFunctionNames(readFileSync(file, 'utf8'))) {
    allFunctionNames.add(name);
  }
}

function extractCitedFunctionNames(prompt: string): string[] {
  // Match backtick-wrapped identifiers in the prompt. The prompt
  // uses two shapes:
  //   `bare_function_name`
  //   `module::function_name` (or `module::Type` — we filter
  //      Type-shaped names below)
  // The regex captures everything inside backticks; the post-
  // processing splits on :: and keeps only the trailing identifier,
  // then filters to those that look like function names (start with
  // a lowercase letter, snake_case shape).
  const re = /\\?`([a-zA-Z_:][a-zA-Z0-9_:]*)\\?`/g;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) {
    const cited = m[1];
    // Take the trailing identifier after the last ::
    const trailing = cited.split('::').pop() ?? '';
    // Filter to function-name shape: must start with a lowercase
    // letter, must be snake_case, must not be a single-letter
    // common variable name like `i`, `n`, `x`. We use a length
    // threshold of 4+ chars to filter out short variables, and we
    // require an underscore for compound names (single-word
    // identifiers like "buy_and_hold" are strategy names not
    // function names; this filter is loose by design — false
    // positives on strategy names like buy_and_hold are flagged
    // and would need explicit handling).
    if (!/^[a-z][a-z0-9_]*$/.test(trailing)) continue;
    if (trailing.length < 4) continue;
    names.add(trailing);
  }
  return [...names].sort();
}

const citedNames = extractCitedFunctionNames(CHAT_SYSTEM_PROMPT);

describe('chat system prompt Rust function-name parity', () => {
  it('extracted at least 2 function-shape names from the prompt', () => {
    expect(
      citedNames.length,
      `expected to find some function-shape citations in chat-system-prompt; found ${citedNames.length}`
    ).toBeGreaterThan(1);
  });

  // For each cited name that LOOKS like a function (snake_case,
  // not a strategy slug from STRATEGY_DEFAULTS), assert it exists
  // as a function in the Rust crate. Strategy slugs are pinned by
  // a separate test (universe-roster.test.mts::chat system prompt
  // strategy parity) and live alongside function names in the
  // same backtick-wrapped citations, so we filter them out via
  // an explicit list.
  const STRATEGY_SLUGS = new Set([
    'buy_and_hold',
    'sma_crossover',
    'momentum',
    'rsi_mean_reversion',
    'breakout',
    'bollinger_bands',
  ]);
  // Also filter known non-function citations: struct names
  // (BacktestError etc.), table names (daily_eod), module names
  // that aren't functions (snapshots), Rust keywords, and the
  // Supabase project ref.
  const NON_FUNCTION_KNOWN = new Set([
    'daily_eod',
    'daily_volatility_stats',
    'spx_intraday_bars',
    'snapshots',
    'rate_limit', // module name in path references
    'backtest_core', // crate name
    'rust_basics',
    'this_sites_rust',
    'quant_finance',
    'rust_intermediate',
    'wasm_internals',
    'thiserror', // crate referenced as a comparison
    'wasm_bindgen', // crate
    'serde_wasm_bindgen', // crate
    // Rust keywords cited as syntax markers in the prompt:
    'enum',
    'self',
    'match',
    'trait',
    'impl',
    'struct',
    'async',
    'where',
    'return',
    'crate',
    'super',
    // Supabase project ref (pinned separately by
    // supabase-project-ref-parity):
    'tbxhvpoyyyhbvoyefggu',
  ]);

  const functionCandidates = citedNames.filter(
    (n) => !STRATEGY_SLUGS.has(n) && !NON_FUNCTION_KNOWN.has(n)
  );

  it.each(functionCandidates)(
    'cited identifier "%s" is defined as a function in the Rust crate',
    (name) => {
      expect(
        allFunctionNames.has(name),
        `chat-system-prompt cites "${name}" but no \`pub fn ${name}\` or \`pub(crate) fn ${name}\` is defined under crates/backtest-core/src/. Rename the citation in the prompt or restore the function.`
      ).toBe(true);
    }
  );
});
