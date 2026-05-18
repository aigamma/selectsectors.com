// Strategy spec catalog for the frontend. Single source of truth for
// the per-strategy UI metadata (label, description, parameter fields
// with defaults and min/max bounds) that the homepage backtester form,
// the /scan/ form, and any future strategy-form-bearing page consume.
//
// Why this lives in TS and not in the Rust crate: the field names
// match the Rust Params struct fields one-for-one (so the JSON the
// form builds is bitwise identical to what the WASM deserializer
// expects), but the human-facing metadata (label, description,
// suggested default, suggested range) is presentation concern that
// doesn't belong in the math kernel. Adding a new strategy means:
// (1) a new file in crates/backtest-core/src/strategies/, (2) a new
// variant in StrategyKind, (3) a new entry here, (4) a new branch in
// _lib/strategy.mts's toStrategyKind. The Rust crate is the
// authority on what's accepted; this module is the authority on how
// it's presented in the UI.

export interface StrategyParamSpec {
  /** Field name on the Rust crate's Params struct; must match exactly. */
  key: string;
  /** Human-readable label rendered above the input. */
  label: string;
  /** Initial value of the form input. */
  defaultValue: number;
  /** HTML5 input min/max/step constraints; the WASM-side validation
   *  is still the source of truth for cross-field constraints (e.g.,
   *  RSI oversold strictly less than overbought) which can't be
   *  expressed in single-field HTML5 attributes. */
  min?: number;
  max?: number;
  step?: number;
}

export interface StrategySpec {
  /** Human-readable name shown in the strategy <select> dropdown. */
  name: string;
  /** One-sentence description shown below the dropdown in the field-hint slot. */
  description: string;
  /** Per-parameter spec, in display order. Empty for parameter-free strategies. */
  params: StrategyParamSpec[];
}

export const STRATEGY_SPECS: Record<string, StrategySpec> = {
  buy_and_hold: {
    name: 'Buy and hold',
    description:
      'Buy on the first bar and hold to the last. The reference benchmark every other strategy is judged against.',
    params: [],
  },
  sma_crossover: {
    name: 'SMA crossover',
    description:
      'Long when the fast simple moving average is above the slow simple moving average; flat otherwise. The textbook trend-following signal.',
    params: [
      { key: 'fast', label: 'Fast window (bars)', defaultValue: 20, min: 2, max: 200, step: 1 },
      { key: 'slow', label: 'Slow window (bars)', defaultValue: 50, min: 3, max: 250, step: 1 },
    ],
  },
  momentum: {
    name: 'Momentum',
    description:
      "Long when today's close exceeds the close `lookback` bars ago; flat otherwise. Documented by Jegadeesh and Titman (1993) and now one of the most-cited factors in academic finance.",
    params: [
      { key: 'lookback', label: 'Lookback (bars)', defaultValue: 60, min: 2, max: 252, step: 1 },
    ],
  },
  rsi_mean_reversion: {
    name: 'RSI mean reversion',
    description:
      "Long when Wilder's RSI dips below the oversold threshold; exits to flat when RSI rises above overbought. A fade-the-dip strategy.",
    params: [
      { key: 'period', label: 'RSI period (bars)', defaultValue: 14, min: 2, max: 100, step: 1 },
      { key: 'oversold', label: 'Oversold threshold', defaultValue: 30, min: 0, max: 50, step: 1 },
      { key: 'overbought', label: 'Overbought threshold', defaultValue: 70, min: 50, max: 100, step: 1 },
    ],
  },
  breakout: {
    name: 'Donchian breakout',
    description:
      "Long when today's close is at or above the rolling high of the prior `lookback` bars. The Richard Donchian / Turtle Traders rule.",
    params: [
      { key: 'lookback', label: 'Lookback (bars)', defaultValue: 20, min: 2, max: 200, step: 1 },
    ],
  },
  bollinger_bands: {
    name: 'Bollinger Bands mean reversion',
    description:
      "Long when the close drops below SMA − k × std over a `period`-bar window; exits at the SMA centerline. A dispersion-based fade-the-dip, complementary to RSI mean reversion.",
    params: [
      { key: 'period', label: 'Period (bars)', defaultValue: 20, min: 2, max: 200, step: 1 },
      { key: 'k', label: 'k (std multiplier)', defaultValue: 2.0, min: 0.5, max: 4, step: 0.1 },
    ],
  },
};
