import { describe, expect, it } from 'vitest';

import { canonicalize, sha256OfCanonical } from '../canonical-json.mts';

describe('canonicalize', () => {
  it('passes through primitives unchanged', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(false)).toBe('false');
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize(3.14)).toBe('3.14');
    expect(canonicalize('hello')).toBe('"hello"');
  });

  it('preserves array order', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('sorts object keys alphabetically', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('produces identical strings for semantically-equal objects with different key orders', () => {
    const a = canonicalize({ symbol: 'SPX', strategy: 'buy_and_hold' });
    const b = canonicalize({ strategy: 'buy_and_hold', symbol: 'SPX' });
    expect(a).toBe(b);
  });

  it('handles nested objects recursively', () => {
    const result = canonicalize({
      strategy: { name: 'sma_crossover', params: { slow: 50, fast: 20 } },
      symbol: 'XLE',
    });
    expect(result).toBe(
      '{"strategy":{"name":"sma_crossover","params":{"fast":20,"slow":50}},"symbol":"XLE"}'
    );
  });

  it('escapes strings via JSON.stringify', () => {
    expect(canonicalize('hello "world"')).toBe('"hello \\"world\\""');
  });
});

describe('sha256OfCanonical', () => {
  it('returns a 64-character lowercase hex string', async () => {
    const hash = await sha256OfCanonical({ a: 1 });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns identical hashes for semantically-equal objects', async () => {
    const h1 = await sha256OfCanonical({ symbol: 'SPX', strategy: 'buy_and_hold' });
    const h2 = await sha256OfCanonical({ strategy: 'buy_and_hold', symbol: 'SPX' });
    expect(h1).toBe(h2);
  });

  it('returns different hashes for different inputs', async () => {
    const h1 = await sha256OfCanonical({ symbol: 'SPX' });
    const h2 = await sha256OfCanonical({ symbol: 'SPY' });
    expect(h1).not.toBe(h2);
  });

  it('returns the canonical sha256 of an empty object', async () => {
    // sha256 of `{}` (canonical empty object) is a fixed known value.
    const hash = await sha256OfCanonical({});
    expect(hash).toBe(
      '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'
    );
  });
});
