import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { STRATEGY_DEFAULTS } from '../strategy.mts';

// Cross-language source-of-truth test. The Rust crate's StrategyKind
// enum (in crates/backtest-core/src/strategies/mod.rs) is the canonical
// catalog of strategies the WASM engine knows how to run. The TS
// dispatcher's STRATEGY_DEFAULTS map (in netlify/functions/_lib/
// strategy.mts) names the same set of strategies for the frontend +
// /api/compare to dispatch against. If the two ever drift (someone
// adds a strategy in Rust without updating the TS catalog, or removes
// one in TS without updating Rust), the next backtest of that
// strategy throws at the wire-format boundary.
//
// This test parses mod.rs at test time, extracts the enum variants,
// snake-cases them, and asserts the resulting set matches the keys of
// STRATEGY_DEFAULTS exactly. The parse is intentionally regex-based +
// brittle so a future refactor of the enum shape (say, moving variants
// into a separate file or wrapping them in a macro) triggers a test
// failure that prompts an update here rather than silently producing
// a wrong assertion.

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const MOD_RS_PATH = resolve(
  ROOT,
  'crates',
  'backtest-core',
  'src',
  'strategies',
  'mod.rs'
);

/**
 * Convert a Rust enum variant name (PascalCase) to the serde snake_case
 * wire format. Matches what `#[serde(rename_all = "snake_case")]` does
 * on the StrategyKind enum: every uppercase letter that follows another
 * character becomes an underscore + lowercase.
 */
function pascalToSnake(s: string): string {
  return s.replace(/(?<!^)([A-Z])/g, '_$1').toLowerCase();
}

/**
 * Extract the variant names from the StrategyKind enum block in mod.rs.
 * The regex looks for `pub enum StrategyKind {` and captures everything
 * up to the matching `}`. Inside that block, each line starts with
 * whitespace + the variant name (possibly followed by a parenthesized
 * payload type) + a trailing comma.
 */
function extractStrategyKindVariants(modRsSource: string): string[] {
  const blockMatch = modRsSource.match(
    /pub enum StrategyKind \{([\s\S]*?)\n\}/
  );
  if (!blockMatch) {
    throw new Error(
      'could not find `pub enum StrategyKind { ... }` block in mod.rs ' +
        '(the regex assumes the standard rustfmt layout; if it has been ' +
        'reformatted, update the regex here)'
    );
  }
  const body = blockMatch[1];
  const variantRe = /^\s+([A-Z][A-Za-z0-9]*)(\(.*\))?,/gm;
  const variants: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = variantRe.exec(body)) !== null) {
    variants.push(m[1]);
  }
  return variants;
}

describe('Rust ↔ TS strategy parity', () => {
  const modRs = readFileSync(MOD_RS_PATH, 'utf8');
  const rustVariants = extractStrategyKindVariants(modRs);
  const rustNames = rustVariants.map(pascalToSnake).sort();
  const tsNames = Object.keys(STRATEGY_DEFAULTS).sort();

  it('mod.rs parser found at least 4 strategies (sanity check)', () => {
    expect(rustVariants.length).toBeGreaterThanOrEqual(4);
  });

  it('every Rust StrategyKind variant has a corresponding entry in STRATEGY_DEFAULTS', () => {
    const missing = rustNames.filter((n) => !tsNames.includes(n));
    expect(missing, `missing in TS: ${missing.join(', ')}`).toEqual([]);
  });

  it('every STRATEGY_DEFAULTS entry has a corresponding Rust StrategyKind variant', () => {
    const missing = tsNames.filter((n) => !rustNames.includes(n));
    expect(missing, `missing in Rust: ${missing.join(', ')}`).toEqual([]);
  });

  it('the two strategy catalogs match exactly', () => {
    expect(tsNames).toEqual(rustNames);
  });
});

describe('serde snake_case rename rule (mirrored in pascalToSnake)', () => {
  it('translates BuyAndHold to buy_and_hold', () => {
    expect(pascalToSnake('BuyAndHold')).toBe('buy_and_hold');
  });

  it('translates RsiMeanReversion to rsi_mean_reversion', () => {
    expect(pascalToSnake('RsiMeanReversion')).toBe('rsi_mean_reversion');
  });

  it('leaves a single-word variant unchanged', () => {
    expect(pascalToSnake('Momentum')).toBe('momentum');
  });

  it('handles BollingerBands correctly', () => {
    expect(pascalToSnake('BollingerBands')).toBe('bollinger_bands');
  });
});
