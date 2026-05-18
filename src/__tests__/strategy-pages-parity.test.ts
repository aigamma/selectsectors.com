import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { STRATEGY_SPECS } from '../strategy-specs.ts';

// Every strategy in STRATEGY_SPECS needs a matching explainer page
// at /strategies/<kebab-case-name>/index.html. Currently 6 strategies,
// 6 explainer pages. If a future iteration adds a 7th strategy to
// STRATEGY_SPECS but forgets to scaffold the explainer page, the
// /strategies/ catalog renders a row pointing at a 404 URL.
//
// The mapping rule is: snake_case strategy name -> kebab-case URL
// segment. E.g., "rsi_mean_reversion" -> "/strategies/rsi-mean-reversion/index.html".

const ROOT = resolve(__dirname, '..', '..');

function snakeToKebab(s: string): string {
  return s.replace(/_/g, '-');
}

describe('strategy-specs ↔ explainer pages parity', () => {
  const strategyNames = Object.keys(STRATEGY_SPECS).sort();

  it.each(strategyNames)(
    'strategy %s has an explainer page at /strategies/<kebab>/index.html',
    (name) => {
      const kebab = snakeToKebab(name);
      const path = resolve(ROOT, 'strategies', kebab, 'index.html');
      expect(
        existsSync(path),
        `STRATEGY_SPECS has "${name}" but ${path} does not exist`
      ).toBe(true);
    }
  );
});

describe('snakeToKebab helper', () => {
  it('converts single-word names unchanged', () => {
    expect(snakeToKebab('momentum')).toBe('momentum');
  });

  it('converts multi-word names to hyphen-separated', () => {
    expect(snakeToKebab('rsi_mean_reversion')).toBe('rsi-mean-reversion');
  });

  it('handles compound terms', () => {
    expect(snakeToKebab('buy_and_hold')).toBe('buy-and-hold');
    expect(snakeToKebab('sma_crossover')).toBe('sma-crossover');
    expect(snakeToKebab('bollinger_bands')).toBe('bollinger-bands');
  });
});
