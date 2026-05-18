import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { STRATEGY_SPECS } from '../strategy-specs.ts';

// Strategy <option> list parity. The home page backtester form
// (index.html) and the /scan/ form both ship a hardcoded list of
// <option value="..."> elements for the strategy <select>, one per
// strategy in the catalog. The catalog is STRATEGY_SPECS in
// src/strategy-specs.ts. If a future iteration adds a 7th strategy
// to STRATEGY_SPECS (e.g., bollinger_bands_long_short or
// pairs_trade), both hardcoded option lists need a matching
// <option> entry; otherwise the form silently omits the new
// strategy from the dropdown and users can never select it.
//
// strategy-pages-parity (iter 94/95) already pins STRATEGY_SPECS to
// the /strategies/<slug>/index.html explainer pages and to the
// strategies/index.html catalog page; this test covers the
// remaining two surfaces that hardcode the strategy list as form
// <option> elements.
//
// /compare/ does NOT have a per-strategy <option> list because
// /compare/ runs all strategies automatically (the user picks one
// symbol, not one strategy), so it is intentionally excluded from
// this test.

const ROOT = resolve(__dirname, '..', '..');

interface FormSource {
  /** Display label used in test names. */
  label: string;
  /** Path relative to repo root. */
  file: string;
  /** ID of the <select> element to scan; the test only considers
   *  <option> elements inside this select. */
  selectId: string;
}

const FORMS: FormSource[] = [
  { label: 'index.html backtester strategy <select>', file: 'index.html', selectId: 'strategy' },
  { label: 'scan/index.html scan strategy <select>', file: 'scan/index.html', selectId: 'strategy' },
];

function extractStrategyOptions(html: string, selectId: string): string[] {
  // Match <select id="<id>" ...> then capture everything until the
  // closing </select>. Then extract every <option value="..."> within.
  const selectRe = new RegExp(
    `<select\\s+id="${selectId}"[^>]*>([\\s\\S]*?)<\\/select>`,
    'i'
  );
  const m = html.match(selectRe);
  if (!m) return [];
  const block = m[1];
  const valueRe = /<option\s+value="([^"]+)"/gi;
  const out: string[] = [];
  let vm: RegExpExecArray | null;
  while ((vm = valueRe.exec(block)) !== null) {
    // Skip the placeholder option (value=""), if any.
    if (vm[1] === '') continue;
    out.push(vm[1]);
  }
  return out;
}

const strategyNames = Object.keys(STRATEGY_SPECS).sort();

for (const form of FORMS) {
  describe(`${form.label} parity with STRATEGY_SPECS`, () => {
    const html = readFileSync(resolve(ROOT, form.file), 'utf8');
    const options = extractStrategyOptions(html, form.selectId);
    const optionSet = new Set(options);

    it(`form has at least 4 strategy <option> entries`, () => {
      expect(options.length).toBeGreaterThanOrEqual(4);
    });

    it.each(strategyNames)(
      'STRATEGY_SPECS key "%s" has a matching <option> in the form',
      (name) => {
        expect(
          optionSet.has(name),
          `STRATEGY_SPECS has "${name}" but ${form.file} has no <option value="${name}"> in its <select id="${form.selectId}">. Add the option so the strategy is selectable.`
        ).toBe(true);
      }
    );

    it.each(options.map((o) => [o]))(
      'form <option value="%s"> has a matching STRATEGY_SPECS entry',
      (name) => {
        expect(
          name in STRATEGY_SPECS,
          `${form.file} has <option value="${name}"> but STRATEGY_SPECS has no entry for it. Remove the option or add the spec.`
        ).toBe(true);
      }
    );
  });
}
