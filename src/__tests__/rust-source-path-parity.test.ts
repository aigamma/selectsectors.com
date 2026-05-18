import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

// Rust source-file path parity. Documentation across the site
// cites specific Rust source files by relative path
// (e.g., `crates/backtest-core/src/strategies/sma_crossover.rs`).
// The cited path is shown to users as the location of an
// inlined source snippet ("crates/backtest-core/src/strategies/
// sma_crossover.rs (signature)" captions on /learn/ lessons, the
// "Source" panels on /strategies/<slug>/ explainer pages) and as
// reference text in the chat system prompt's grounding examples.
// If a future iteration renames or moves a Rust file, every
// cited path must update in lockstep or the documentation
// points at a 404 location in the user's mental model of where
// the code lives.
//
// The test walks every .html and .md and .mts file in the repo
// (excluding STATUS.md and CLAUDE.md which describe historical
// state) for matches of the regex
// `crates/backtest-core/src/<path>.rs` and asserts each cited
// path resolves to an actual file in the file system.

const ROOT = resolve(__dirname, '..', '..');

function shouldSkipDir(name: string): boolean {
  return (
    name === 'node_modules' ||
    name === 'dist' ||
    name === '.git' ||
    name === 'target' ||
    name === 'pkg' ||
    name === '.netlify' ||
    name === 'public' ||
    name === '.vscode'
  );
}

function findFiles(dir: string, files: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!shouldSkipDir(entry)) findFiles(full, files);
    } else if (st.isFile()) {
      if (
        entry.endsWith('.html') ||
        entry.endsWith('.md') ||
        entry.endsWith('.mts') ||
        entry.endsWith('.ts')
      ) {
        const rel = relative(ROOT, full).split(sep).join('/');
        if (rel === 'STATUS.md') continue;
        if (rel === 'CLAUDE.md') continue;
        // Skip the test file itself; the docstring above contains
        // example paths that should be treated as documentation,
        // not as live citations.
        if (rel === 'src/__tests__/rust-source-path-parity.test.ts') continue;
        files.push(full);
      }
    }
  }
}

interface Citation {
  citingFile: string;
  line: number;
  path: string;
}

const allFiles: string[] = [];
findFiles(ROOT, allFiles);

const citations: Citation[] = [];
const seen = new Set<string>();
for (const file of allFiles) {
  const content = readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const re = /crates\/backtest-core\/src\/[a-z_/]+\.rs/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lines[i])) !== null) {
      const key = `${file}|${i}|${m[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push({
        citingFile: relative(ROOT, file).split(sep).join('/'),
        line: i + 1,
        path: m[0],
      });
    }
  }
}

describe('Rust source-file path parity', () => {
  it('found at least 5 path citations across the docs', () => {
    expect(
      citations.length,
      `expected to find several "crates/backtest-core/src/.../*.rs" citations; found ${citations.length}`
    ).toBeGreaterThan(4);
  });

  it.each(citations.map((c) => [`${c.citingFile}:${c.line}`, c]))(
    '%s cites a real Rust source file',
    (_label, c) => {
      const absPath = resolve(ROOT, c.path);
      expect(
        existsSync(absPath),
        `${c.citingFile}:${c.line} cites "${c.path}" but no such file exists. Update the citation or restore the file.`
      ).toBe(true);
    }
  );
});
