import './style.css';
import { mountSiteShell } from './layout.ts';

// Source code inlined at build time via Vite's `?raw` import.
// When the Rust source changes, this page's code blocks change on
// the next deploy. There is no separate copy of the source to drift.
// @ts-ignore — Vite resolves `?raw` to a string at build time.
import libRs from '../crates/backtest-core/src/lib.rs?raw';
// @ts-ignore
import strategiesModRs from '../crates/backtest-core/src/strategies/mod.rs?raw';
// @ts-ignore
import smaRs from '../crates/backtest-core/src/strategies/sma_crossover.rs?raw';
// @ts-ignore
import metricsRs from '../crates/backtest-core/src/metrics.rs?raw';

mountSiteShell('learn');

// Fill each <code> placeholder with the corresponding source file.
// Using textContent (not innerHTML) means any < or & in the source
// gets escaped automatically; the browser renders them as literal
// characters instead of trying to parse them as HTML.
function setSource(id: string, content: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = content;
}

setSource('src-lib', libRs as unknown as string);
setSource('src-strategies-mod', strategiesModRs as unknown as string);
setSource('src-sma', smaRs as unknown as string);
setSource('src-metrics', metricsRs as unknown as string);

// The apply_positions_to_bars excerpt is the relevant function from
// strategies/mod.rs. We extract it from the full mod source rather
// than maintaining a separate file so this also stays in sync.
function extractApplyPositions(modSource: string): string {
  const start = modSource.indexOf('pub fn apply_positions_to_bars');
  if (start === -1) return modSource;
  // Find the closing brace of the function by walking braces.
  let depth = 0;
  let i = modSource.indexOf('{', start);
  if (i === -1) return modSource.slice(start);
  for (; i < modSource.length; i++) {
    const c = modSource[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        return modSource.slice(start, i + 1);
      }
    }
  }
  return modSource.slice(start);
}

setSource(
  'src-apply',
  extractApplyPositions(strategiesModRs as unknown as string)
);
