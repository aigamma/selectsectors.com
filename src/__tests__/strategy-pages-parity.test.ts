import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { STRATEGY_SPECS } from '../strategy-specs.ts';

// Every strategy in STRATEGY_SPECS needs a matching explainer page
// at /strategies/<kebab-case-name>/index.html. Currently 6 strategies,
// 6 explainer pages. If a future iteration adds a 7th strategy to
// STRATEGY_SPECS but forgets to scaffold the explainer page, the
// /strategies/ catalog renders a row pointing at a 404 URL.
//
// AND every strategy in STRATEGY_SPECS needs a row in strategies/
// index.html's catalog — otherwise a user reaching the catalog
// page wouldn't see the strategy at all (the explainer would
// exist but be unreachable via normal navigation).
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

describe('strategy-specs ↔ catalog rows parity', () => {
  const strategyNames = Object.keys(STRATEGY_SPECS).sort();
  const catalogPath = resolve(ROOT, 'strategies', 'index.html');
  const catalogSource = readFileSync(catalogPath, 'utf8');

  it.each(strategyNames)(
    'strategy %s is linked from strategies/index.html catalog',
    (name) => {
      const kebab = snakeToKebab(name);
      // Match either /strategies/<kebab>/ or /strategies/<kebab>
      // (with or without trailing slash) in any href in the catalog.
      const linkRe = new RegExp(
        `href="/strategies/${kebab}/?"`
      );
      expect(
        linkRe.test(catalogSource),
        `STRATEGY_SPECS has "${name}" but strategies/index.html does not link to /strategies/${kebab}/`
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
