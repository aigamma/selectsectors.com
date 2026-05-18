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

  it.each(strategyNames)(
    'strategy %s catalog curriculum-title matches STRATEGY_SPECS.name',
    (name) => {
      const kebab = snakeToKebab(name);
      // Find the card for /strategies/<kebab>/ by its href, then
      // look at the next <span class="curriculum-title"> to extract
      // the displayed title. The card structure is consistent across
      // all six cards: <a href="/strategies/<kebab>/"> ... <span
      // class="curriculum-title">TITLE</span> ... </a>. The regex is
      // permissive on whitespace and intermediate spans (<span
      // class="curriculum-num">XX</span>) because they all follow the
      // same indentation pattern across the catalog HTML.
      const cardRe = new RegExp(
        `href="/strategies/${kebab}/?"[\\s\\S]*?<span class="curriculum-title">([^<]+)<\\/span>`
      );
      const m = catalogSource.match(cardRe);
      expect(
        m,
        `catalog has no <span class="curriculum-title"> for /strategies/${kebab}/`
      ).not.toBeNull();
      if (!m) return;
      const displayed = m[1].trim();
      const expected = STRATEGY_SPECS[name].name;
      expect(
        displayed,
        `strategies/index.html shows curriculum-title "${displayed}" for /strategies/${kebab}/ but STRATEGY_SPECS["${name}"].name is "${expected}". Update one or the other so the catalog and the spec agree.`
      ).toBe(expected);
    }
  );
});

describe('strategy-specs ↔ explainer <title> parity', () => {
  const strategyNames = Object.keys(STRATEGY_SPECS).sort();

  it.each(strategyNames)(
    'strategy %s explainer <title> starts with STRATEGY_SPECS.name',
    (name) => {
      const kebab = snakeToKebab(name);
      const path = resolve(ROOT, 'strategies', kebab, 'index.html');
      const source = readFileSync(path, 'utf8');
      const titleRe = /<title>([^<]+)<\/title>/;
      const m = source.match(titleRe);
      expect(
        m,
        `strategies/${kebab}/index.html has no <title> tag`
      ).not.toBeNull();
      if (!m) return;
      const title = m[1].trim();
      const expectedName = STRATEGY_SPECS[name].name;
      // The convention is "<name> · Strategies · Select Sectors"
      // (rendered as the U+00B7 middle-dot character or the HTML
      // entity &middot;). The test asserts the title BEGINS with
      // the strategy's display name; the trailing suffix is a
      // separate convention pinned by the sitemap and SEO surface
      // and is not what this test is about. We also tolerate the
      // &middot; entity vs the literal middot character because
      // the HTML files use the entity form by convention.
      expect(
        title.startsWith(expectedName),
        `strategies/${kebab}/index.html <title> is "${title}" but should start with STRATEGY_SPECS["${name}"].name = "${expectedName}". Update the title tag.`
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
