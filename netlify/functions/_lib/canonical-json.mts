// Canonical JSON encoding plus the sha256 hash function the dispatcher
// and background function both use for the backtest cache key.
//
// Lifted out of backtest.mts and backtest-background.mts (both of
// which had copies of the same code) so there's one source of truth
// and one place to test. The motivation: two copies of the
// canonicalize function are two opportunities for the key-ordering
// rules to diverge subtly, which would silently break the cache
// (same inputs produce different hashes, cache never hits).
//
// ## What canonical means here
//
// JSON.stringify preserves the insertion order of an object's keys.
// That means {a:1, b:2} and {b:2, a:1} serialize to different strings,
// even though they represent the same value. Hashing the string gives
// you different hashes for semantically identical objects.
//
// Canonical JSON fixes this by sorting object keys alphabetically
// before stringifying. Arrays preserve order (their order is
// semantically meaningful); primitives and strings use JSON.stringify
// directly. The result is that any two semantically-identical inputs
// produce bitwise-identical strings, which means identical sha256
// hashes, which means the result cache hits properly on re-runs.

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => {
    const v = (value as Record<string, unknown>)[k];
    return JSON.stringify(k) + ':' + canonicalize(v);
  });
  return '{' + parts.join(',') + '}';
}

export async function sha256OfCanonical(value: unknown): Promise<string> {
  const data = new TextEncoder().encode(canonicalize(value));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
