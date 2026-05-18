import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { toStrategyKind } from '../strategy.mts';

// Rust Params field-name parity. The Rust struct definitions in each
// crates/backtest-core/src/strategies/<X>.rs file declare the field
// names that the serde deserializer expects in the wire payload. The
// TS toStrategyKind function in netlify/functions/_lib/strategy.mts
// constructs those wire payloads from the dispatcher's API shape.
// If a Rust struct renames a field but toStrategyKind doesn't follow,
// the WASM call fails at deserialization time with a "missing field"
// error - and the failure would happen ONLY when the user actually
// dispatches a backtest, not at deploy or test time.
//
// This test parses each strategy's Rust file at test time, extracts
// the field names from the `pub struct Params { ... }` block, calls
// toStrategyKind with synthetic params using those exact field names,
// and asserts the wire-format output has the same field names. If
// the Rust file uses a name that toStrategyKind doesn't emit (or vice
// versa), the test fails with a diagnostic naming the strategy.

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const STRATEGIES_DIR = resolve(ROOT, 'crates', 'backtest-core', 'src', 'strategies');

interface StrategyToCheck {
  /** Strategy name as used in STRATEGY_DEFAULTS / toStrategyKind. */
  slug: string;
  /** Rust filename (note rsi_meanreversion has a historical
   *  filename that doesn't quite match the slug; explicit mapping
   *  avoids the parity question here). */
  rustFile: string;
}

// buy_and_hold has no Params struct; excluded from this test.
const STRATEGIES: StrategyToCheck[] = [
  { slug: 'sma_crossover', rustFile: 'sma_crossover.rs' },
  { slug: 'momentum', rustFile: 'momentum.rs' },
  { slug: 'rsi_mean_reversion', rustFile: 'rsi_meanreversion.rs' },
  { slug: 'breakout', rustFile: 'breakout.rs' },
  { slug: 'bollinger_bands', rustFile: 'bollinger_bands.rs' },
];

/**
 * Extract field names from a `pub struct Params { ... }` block.
 * Each field looks like:
 *   /// docstring optional
 *   pub <name>: <type>,
 * The regex captures the field name token after `pub` and before
 * the colon. Skips fields without `pub` (private fields wouldn't
 * be visible to serde anyway).
 */
function extractRustParamFields(rustSource: string): string[] {
  const blockMatch = rustSource.match(
    /pub struct Params \{([\s\S]*?)\n\}/
  );
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

describe.each(STRATEGIES)('Rust Params parity: $slug', ({ slug, rustFile }) => {
  const rustPath = resolve(STRATEGIES_DIR, rustFile);
  const rustSource = readFileSync(rustPath, 'utf8');
  const rustFields = extractRustParamFields(rustSource);

  it('extracted at least 1 field from the Rust Params struct', () => {
    expect(rustFields.length).toBeGreaterThanOrEqual(1);
  });

  it('toStrategyKind produces a wire payload with the same field names', () => {
    // Build a params object using the Rust field names; toStrategyKind
    // will look them up by name via requireNumber. If the TS function
    // uses different keys, requireNumber will throw on the lookup.
    const params: Record<string, number> = {};
    for (const f of rustFields) params[f] = 1.0;
    const wire = toStrategyKind({ name: slug, params }) as Record<
      string,
      Record<string, number>
    >;
    // The wire format is `{ <slug>: { ...fields } }` for variants
    // with payloads. Extract the inner object.
    const payload = wire[slug];
    expect(
      payload,
      `toStrategyKind output for ${slug} should be a tagged-payload object`
    ).toBeDefined();
    const tsFields = Object.keys(payload).sort();
    const rustSorted = [...rustFields].sort();
    expect(
      tsFields,
      `toStrategyKind emits fields ${JSON.stringify(tsFields)} but Rust expects ${JSON.stringify(rustSorted)}`
    ).toEqual(rustSorted);
  });
});
