import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { STRATEGY_SPECS } from '../strategy-specs.ts';

// Strategy "Try it" link prose parity. Each /strategies/<slug>/
// explainer page ends with a "Try it" callout that links to the
// homepage form pre-filled with the strategy's default parameter
// values: e.g., the momentum page has "Run 60-bar momentum on
// NVDA" where 60 = STRATEGY_SPECS.momentum.params[0].defaultValue.
// If a future iteration changes a default (say, momentum lookback
// from 60 to 90), the form pre-fill updates automatically but
// the explainer prose would say "60-bar momentum" while the form
// shows 90, confusing readers about what the default actually is.

const ROOT = resolve(__dirname, '..', '..');

interface ProseCheck {
  /** Strategy slug; used to look up STRATEGY_SPECS and the file path. */
  slug: string;
  /** Path to the explainer HTML file. */
  file: string;
  /** Regex builder that takes the defaults object and returns a
   *  pattern that should match somewhere in the file's HTML. The
   *  pattern names the "Run <prose>" form of the link label. */
  buildPattern: (defaults: Record<string, number>) => RegExp;
}

const CHECKS: ProseCheck[] = [
  {
    slug: 'sma_crossover',
    file: 'strategies/sma-crossover/index.html',
    buildPattern: (d) => new RegExp(`Run\\s+SMA\\s+${d.fast}\\/${d.slow}`),
  },
  {
    slug: 'momentum',
    file: 'strategies/momentum/index.html',
    buildPattern: (d) => new RegExp(`Run\\s+${d.lookback}-bar\\s+momentum`),
  },
  {
    slug: 'breakout',
    file: 'strategies/breakout/index.html',
    buildPattern: (d) => new RegExp(`Run\\s+${d.lookback}-bar\\s+breakout`),
  },
  {
    slug: 'rsi_mean_reversion',
    file: 'strategies/rsi-mean-reversion/index.html',
    buildPattern: (d) =>
      new RegExp(
        `Run\\s+RSI\\s+${d.period},\\s+${d.oversold}\\/${d.overbought}`
      ),
  },
  {
    slug: 'bollinger_bands',
    file: 'strategies/bollinger-bands/index.html',
    buildPattern: (d) =>
      new RegExp(`Run\\s+Bollinger\\s+${d.period},\\s+k=${d.k.toFixed(1)}`),
  },
];

describe('strategy "Try it" link prose parity with STRATEGY_SPECS defaults', () => {
  it.each(CHECKS.map((c) => [c.slug, c]))(
    'strategy %s explainer page "Run ..." link matches STRATEGY_SPECS defaults',
    (_slug, check) => {
      const spec = STRATEGY_SPECS[check.slug];
      expect(
        spec,
        `STRATEGY_SPECS has no entry for "${check.slug}"`
      ).toBeDefined();
      if (!spec) return;
      const defaults: Record<string, number> = {};
      for (const p of spec.params) defaults[p.key] = p.defaultValue;
      const re = check.buildPattern(defaults);
      const html = readFileSync(resolve(ROOT, check.file), 'utf8');
      expect(
        re.test(html),
        `${check.file} does not contain a "Run ..." link matching ${re.toString()} (defaults: ${JSON.stringify(defaults)}). Update the prose to match the STRATEGY_SPECS defaults.`
      ).toBe(true);
    }
  );
});

describe('strategy "Try it" link ?strategy=<slug> param matches the page slug', () => {
  // Every /strategies/<kebab>/ explainer's "Try it" link uses
  // ?strategy=<snake_case_slug>; that slug must kebab-case to the
  // directory name. The drift this catches: a copy-paste error
  // where a new strategy's "Try it" link accidentally points at
  // an old strategy's slug (e.g., the bollinger-bands page links
  // to ?strategy=rsi_mean_reversion).
  const strategyNames = Object.keys(STRATEGY_SPECS);

  it.each(strategyNames)(
    'strategy %s "Try it" link uses the right ?strategy=<slug> param',
    (name) => {
      const kebab = name.replace(/_/g, '-');
      const file = `strategies/${kebab}/index.html`;
      const html = readFileSync(resolve(ROOT, file), 'utf8');
      // Capture every ?strategy=<snake> param in the page and
      // assert all of them name the current page's strategy.
      const re = /\?strategy=([a-z_]+)\b/g;
      const matches = [...html.matchAll(re)];
      expect(
        matches.length,
        `${file} has no ?strategy=<slug> link at all; expected at least one "Try it"-style link`
      ).toBeGreaterThan(0);
      for (const m of matches) {
        expect(
          m[1],
          `${file} has ?strategy=${m[1]} but the page describes strategy "${name}". The link should reference the same strategy as the explainer.`
        ).toBe(name);
      }
    }
  );
});
