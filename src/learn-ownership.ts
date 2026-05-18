import './style.css';
import { mountSiteShell } from './layout.ts';
// @ts-ignore — Vite ?raw import
import momentumRs from '../crates/backtest-core/src/strategies/momentum.rs?raw';

mountSiteShell('learn');

// Extract just the signature line of the positions function so the
// reader sees the &[DailyBar] borrow shape without scrolling past the
// full strategy body. The full source is on /strategies/momentum/.
function extractSignature(source: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((l) =>
    l.includes('pub fn positions(bars: &[DailyBar]')
  );
  if (start === -1) return source;
  // Grab the signature line plus the next line if the signature
  // wrapped, then stop at the opening brace.
  const sigLines: string[] = [];
  for (let i = start; i < lines.length; i++) {
    sigLines.push(lines[i]);
    if (lines[i].endsWith('{')) break;
  }
  return sigLines.join('\n');
}

const el = document.getElementById('src-momentum-sig');
if (el) el.textContent = extractSignature(momentumRs as unknown as string);
