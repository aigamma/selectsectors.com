import { describe, expect, it } from 'vitest';

import { STRATEGY_SPECS } from '../strategy-specs.ts';
import { STRATEGY_DEFAULTS } from '../../netlify/functions/_lib/strategy.mts';

// Frontend-vs-backend strategy catalog parity. STRATEGY_SPECS in
// src/strategy-specs.ts is the frontend's source of truth for what
// strategies appear in the form's <select>, what params each has,
// and what the default values look like. STRATEGY_DEFAULTS in
// netlify/functions/_lib/strategy.mts is the backend's source of
// truth for what strategies the /api/compare endpoint dispatches
// and what default wire-format payloads each carries. The two
// must agree on the set of strategies; otherwise (as caught in
// iter 93) a user selects a strategy that exists on the backend
// but is missing in the frontend spec, the form's param container
// stays empty, and submit fails server-side because no params are
// sent.
//
// The rust-ts-parity test already asserts STRATEGY_DEFAULTS keys
// match the Rust StrategyKind enum variants. This test asserts
// STRATEGY_SPECS keys match STRATEGY_DEFAULTS keys; together they
// guarantee Rust enum -> backend catalog -> frontend catalog all
// agree on the set of strategies.

describe('strategy-specs ↔ strategy-defaults parity', () => {
  const frontendKeys = Object.keys(STRATEGY_SPECS).sort();
  const backendKeys = Object.keys(STRATEGY_DEFAULTS).sort();

  it('frontend STRATEGY_SPECS has at least 4 entries (sanity check)', () => {
    expect(frontendKeys.length).toBeGreaterThanOrEqual(4);
  });

  it('every backend STRATEGY_DEFAULTS key has a frontend STRATEGY_SPECS entry', () => {
    const missing = backendKeys.filter((k) => !frontendKeys.includes(k));
    expect(
      missing,
      `missing from frontend STRATEGY_SPECS: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('every frontend STRATEGY_SPECS key has a backend STRATEGY_DEFAULTS entry', () => {
    const missing = frontendKeys.filter((k) => !backendKeys.includes(k));
    expect(
      missing,
      `missing from backend STRATEGY_DEFAULTS: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('the two catalogs name exactly the same set of strategies', () => {
    expect(frontendKeys).toEqual(backendKeys);
  });
});

describe('strategy default-value parity (frontend defaultValue ↔ backend wire payload)', () => {
  // Iter 93's parity test ensures the SETS of strategies match.
  // This describe block extends to the VALUES of the per-strategy
  // defaults: STRATEGY_SPECS[name].params[].defaultValue should equal
  // the corresponding field value in STRATEGY_DEFAULTS[name][name].
  // If they diverge (someone changed an SMA fast default from 20 to
  // 30 in one place but not the other), /api/compare would dispatch
  // SMA with fast=20 while the homepage form would show fast=30,
  // producing different results for what should be the same "default
  // SMA on this symbol" intent. Subtle and easy to miss in review.
  const parameterizedStrategies = Object.keys(STRATEGY_SPECS).filter(
    (name) => STRATEGY_SPECS[name].params.length > 0
  );

  it.each(parameterizedStrategies)(
    'strategy %s defaults match between STRATEGY_SPECS and STRATEGY_DEFAULTS wire payload',
    (name) => {
      // STRATEGY_DEFAULTS shape for parameterized strategies is
      // { name: { name: { ...params } } }. Extract the inner params
      // object via two lookups.
      const backendWire = STRATEGY_DEFAULTS[name as keyof typeof STRATEGY_DEFAULTS] as
        | Record<string, Record<string, number>>
        | string;
      // Skip the unit-variant case (buy_and_hold) defensively even
      // though the filter above excludes it.
      if (typeof backendWire === 'string') return;
      const backendParams = backendWire[name];
      const frontendDefaults = Object.fromEntries(
        STRATEGY_SPECS[name].params.map((p) => [p.key, p.defaultValue])
      );
      expect(
        frontendDefaults,
        `strategy "${name}" defaults differ: frontend=${JSON.stringify(frontendDefaults)} backend=${JSON.stringify(backendParams)}`
      ).toEqual(backendParams);
    }
  );
});
