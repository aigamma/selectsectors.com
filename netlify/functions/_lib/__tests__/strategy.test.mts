import { describe, expect, it } from 'vitest';

import { STRATEGY_DEFAULTS, toStrategyKind } from '../strategy.mts';

describe('toStrategyKind', () => {
  it('produces the unit-variant wire format for buy_and_hold', () => {
    expect(toStrategyKind({ name: 'buy_and_hold', params: {} })).toBe(
      'buy_and_hold'
    );
  });

  it('produces the tagged-payload wire format for sma_crossover', () => {
    const result = toStrategyKind({
      name: 'sma_crossover',
      params: { fast: 20, slow: 50 },
    });
    expect(result).toEqual({ sma_crossover: { fast: 20, slow: 50 } });
  });

  it('produces the tagged-payload wire format for rsi_mean_reversion', () => {
    const result = toStrategyKind({
      name: 'rsi_mean_reversion',
      params: { period: 14, oversold: 30, overbought: 70 },
    });
    expect(result).toEqual({
      rsi_mean_reversion: { period: 14, oversold: 30, overbought: 70 },
    });
  });

  it('produces the single-param wire format for momentum', () => {
    expect(
      toStrategyKind({ name: 'momentum', params: { lookback: 60 } })
    ).toEqual({ momentum: { lookback: 60 } });
  });

  it('produces the single-param wire format for breakout', () => {
    expect(
      toStrategyKind({ name: 'breakout', params: { lookback: 20 } })
    ).toEqual({ breakout: { lookback: 20 } });
  });

  it('throws on unknown strategy names', () => {
    expect(() => toStrategyKind({ name: 'nonsense', params: {} })).toThrow(
      /unknown strategy/
    );
  });

  it('throws on missing required parameters', () => {
    expect(() =>
      toStrategyKind({ name: 'sma_crossover', params: { fast: 20 } })
    ).toThrow(/missing or non-finite parameter `slow`/);
  });

  it('throws on non-finite parameter values', () => {
    expect(() =>
      toStrategyKind({
        name: 'sma_crossover',
        params: { fast: 20, slow: NaN },
      })
    ).toThrow(/non-finite parameter `slow`/);
  });

  it('throws on Infinity in parameter values', () => {
    expect(() =>
      toStrategyKind({
        name: 'momentum',
        params: { lookback: Infinity },
      })
    ).toThrow(/non-finite parameter `lookback`/);
  });
});

describe('STRATEGY_DEFAULTS', () => {
  it('exposes a wire-format payload for every strategy', () => {
    expect(STRATEGY_DEFAULTS.buy_and_hold).toBe('buy_and_hold');
    expect(STRATEGY_DEFAULTS.sma_crossover).toEqual({
      sma_crossover: { fast: 20, slow: 50 },
    });
    expect(STRATEGY_DEFAULTS.momentum).toEqual({
      momentum: { lookback: 60 },
    });
    expect(STRATEGY_DEFAULTS.rsi_mean_reversion).toEqual({
      rsi_mean_reversion: { period: 14, oversold: 30, overbought: 70 },
    });
    expect(STRATEGY_DEFAULTS.breakout).toEqual({
      breakout: { lookback: 20 },
    });
  });

  it('every default matches what toStrategyKind would produce for the same params', () => {
    // Round-trip: pass each strategy's default through toStrategyKind
    // and verify we get the same wire format. Locks in the invariant
    // that the two paths into the WASM agree.
    const defaults: Array<{ name: string; params: Record<string, number> }> = [
      { name: 'sma_crossover', params: { fast: 20, slow: 50 } },
      { name: 'momentum', params: { lookback: 60 } },
      { name: 'rsi_mean_reversion', params: { period: 14, oversold: 30, overbought: 70 } },
      { name: 'breakout', params: { lookback: 20 } },
    ];
    for (const d of defaults) {
      const fromKind = toStrategyKind(d);
      const fromDefault = STRATEGY_DEFAULTS[d.name as keyof typeof STRATEGY_DEFAULTS];
      expect(fromKind).toEqual(fromDefault);
    }
  });
});
