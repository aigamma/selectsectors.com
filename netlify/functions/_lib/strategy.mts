// Shared strategy plumbing for the function layer.
//
// The Rust crate's StrategyKind enum is the source of truth for what
// the WASM accepts as input. The wire format is externally-tagged
// snake_case JSON: `"buy_and_hold"` for unit variants and
// `{ "sma_crossover": { ... } }` for variants with params. This
// module translates the dispatcher's friendlier {name, params} shape
// (which is what the frontend builds and what the API contract
// documents) into that wire format, plus exports the canonical
// per-strategy defaults used by the /compare/ endpoint and any
// future scan-with-defaults variants.
//
// Lifted here from backtest-background.mts, scan-background.mts, and
// compare-background.mts which each had near-identical copies of the
// translation and/or the defaults map. Centralizing both lives them
// in one place to update when a new strategy lands in the Rust crate.

export interface StrategyRequest {
  name: string;
  params: Record<string, number>;
}

/**
 * Translate the dispatcher's API shape into the Rust crate's serde
 * wire format. Throws on unknown strategy names or missing/non-finite
 * required parameters; callers should catch the error and write a
 * clean error blob rather than letting the throw escape into the
 * background function's runtime.
 */
export function toStrategyKind(s: StrategyRequest): unknown {
  switch (s.name) {
    case 'buy_and_hold':
      return 'buy_and_hold';
    case 'sma_crossover':
      return {
        sma_crossover: {
          fast: requireNumber(s.params, 'fast'),
          slow: requireNumber(s.params, 'slow'),
        },
      };
    case 'rsi_mean_reversion':
      return {
        rsi_mean_reversion: {
          period: requireNumber(s.params, 'period'),
          oversold: requireNumber(s.params, 'oversold'),
          overbought: requireNumber(s.params, 'overbought'),
        },
      };
    case 'momentum':
      return { momentum: { lookback: requireNumber(s.params, 'lookback') } };
    case 'breakout':
      return { breakout: { lookback: requireNumber(s.params, 'lookback') } };
    default:
      throw new Error(`unknown strategy name: \`${s.name}\``);
  }
}

function requireNumber(
  params: Record<string, number>,
  key: string
): number {
  const v = params[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`missing or non-finite parameter \`${key}\``);
  }
  return v;
}

/**
 * Per-strategy default specs in wire format. Used by /api/compare-
 * background to run each strategy with conventional defaults
 * without making the dispatcher require user-specified params for
 * each one. Keys are the StrategyKind variants from the Rust enum;
 * values are the wire-format payload toStrategyKind would produce
 * for that strategy with sensible defaults.
 */
export const STRATEGY_DEFAULTS = {
  buy_and_hold: 'buy_and_hold' as const,
  sma_crossover: { sma_crossover: { fast: 20, slow: 50 } },
  momentum: { momentum: { lookback: 60 } },
  rsi_mean_reversion: {
    rsi_mean_reversion: { period: 14, oversold: 30, overbought: 70 },
  },
  breakout: { breakout: { lookback: 20 } },
};
