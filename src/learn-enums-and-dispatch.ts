import './style.css';
import { mountSiteShell } from './layout.ts';
// @ts-ignore — Vite ?raw import
import modRs from '../crates/backtest-core/src/strategies/mod.rs?raw';

mountSiteShell('learn');

// Extract just the StrategyKind enum + the impl block so the reader
// sees the dispatch shape without the apply_positions_to_bars body
// or the doc-comment header.
function extractStrategyKind(source: string): string {
  const start = source.indexOf('#[derive');
  if (start === -1) return source;
  // Capture from the first derive (which precedes the enum) through
  // the end of the impl StrategyKind block.
  const implMarker = 'impl StrategyKind';
  const implStart = source.indexOf(implMarker, start);
  if (implStart === -1) return source.slice(start);
  // Find the close of the impl block by walking braces.
  let depth = 0;
  let i = source.indexOf('{', implStart);
  if (i === -1) return source.slice(start);
  for (; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  return source.slice(start, i);
}

const el = document.getElementById('src-strategy-kind');
if (el) el.textContent = extractStrategyKind(modRs as unknown as string);
