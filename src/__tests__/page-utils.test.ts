import { describe, expect, it } from 'vitest';

import { escapeHtml } from '../page-utils.ts';

// page-utils is mostly DOM-coupled (setStatus, renderRateBanner,
// populateSymbolGroup all touch document). The escapeHtml function
// is the one pure-function helper, so it's the only one easy to
// test without a jsdom environment. The rest are exercised by the
// typecheck plus the human-eyeball-it tests during dev.

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
  });

  it('passes through safe characters unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
    expect(escapeHtml('NVDA SPY XLE')).toBe('NVDA SPY XLE');
    expect(escapeHtml('1.23 * 100% = 123')).toBe('1.23 * 100% = 123');
  });

  it('escapes a string with mixed safe and unsafe characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('escapes & first so it does not double-escape the entity prefix', () => {
    // The order matters: if we escaped < before &, then escaping &
    // after would turn the &lt; into &amp;lt;. Test the canonical
    // failure case.
    expect(escapeHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
  });

  it('handles the empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});
