import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

// TypeScript source-file path parity. Documentation across the
// site cites specific .ts and .mts source files by relative path
// in prose: e.g., the api-docs page references
// `netlify/functions/_lib/strategy.mts`, the changelog references
// `src/strategy-specs.ts` and `netlify/functions/_lib/universe-
// roster.mts`, the architecture doc references `src/main.ts`. The
// citations live inside <code> or backtick spans (so they read as
// code identifiers, not bare URL references) and should resolve to
// real files in the repo.
//
// This complements:
//   - html-script-entries-parity: pins <script type="module"
//     src="/src/X.ts"> tags to real src/ files. Those aren't
//     "citations" but actual runtime imports.
//   - rust-source-path-parity (iter 172): the equivalent for
//     Rust source paths under crates/backtest-core/src/.
//
// The path-matching regex only picks paths inside <code> tags
// or backtick code spans so the script-tag src attributes are
// not double-counted by both this test and html-script-entries-
// parity.

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
        // Skip the test file itself; the docstring contains
        // example paths that should be treated as documentation,
        // not as live citations.
        if (rel === 'src/__tests__/ts-source-path-parity.test.ts') continue;
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
    // Two citation forms:
    //   <code>path/to/file.ts</code>  or  <code>...</code>
    //   `path/to/file.mts`              or  `...`
    // The path must START with "src/" or "netlify/functions/" so
    // we don't catch random short filenames.
    const re =
      /(?:<code>|`)((?:src|netlify\/functions)\/[a-z_/-]+\.(?:ts|mts))(?:<\/code>|`)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lines[i])) !== null) {
      const key = `${file}|${i}|${m[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push({
        citingFile: relative(ROOT, file).split(sep).join('/'),
        line: i + 1,
        path: m[1],
      });
    }
  }
}

describe('TypeScript source-file path parity', () => {
  it('found at least 3 path citations across the docs', () => {
    expect(
      citations.length,
      `expected several "<code>src/...ts</code>" or "<code>netlify/functions/...mts</code>" citations; found ${citations.length}`
    ).toBeGreaterThan(2);
  });

  it.each(citations.map((c) => [`${c.citingFile}:${c.line}`, c]))(
    '%s cites a real TypeScript source file',
    (_label, c) => {
      const absPath = resolve(ROOT, c.path);
      expect(
        existsSync(absPath),
        `${c.citingFile}:${c.line} cites "${c.path}" but no such file exists. Update the citation or restore the file.`
      ).toBe(true);
    }
  );
});
