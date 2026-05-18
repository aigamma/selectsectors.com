import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

// GitHub repo URL parity. The canonical repo URL
// (https://github.com/aigamma/selectsectors.com) is hardcoded
// in multiple documentation surfaces — the layout.ts footer
// "Source" link, the api-docs page, the changelog, the
// disclaimer, the learn/wasm lesson, and the README clone command.
//
// If a future iteration moves the repo (e.g., to a personal
// account or to a different org), every hardcoded URL needs to
// update or some footer/page-link/clone-command sends the user to
// a 404. Source-of-truth: src/layout.ts is the footer template
// loaded on every page; its href is the "live" link that users
// see in the rendered chrome. Other surfaces should match that
// hostname/owner/repo triple.

const ROOT = resolve(__dirname, '..', '..');
const LAYOUT_PATH = resolve(ROOT, 'src', 'layout.ts');

function shouldSkipDir(name: string): boolean {
  return (
    name === 'node_modules' ||
    name === 'dist' ||
    name === '.git' ||
    name === 'target' ||
    name === 'pkg' ||
    name === '.netlify' ||
    name === 'public' ||
    name === 'crates' ||
    name === '.vscode'
  );
}

function findFiles(dir: string, files: string[]): void {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = resolve(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!shouldSkipDir(entry)) findFiles(full, files);
    } else if (st.isFile()) {
      if (
        entry.endsWith('.html') ||
        entry.endsWith('.md') ||
        entry.endsWith('.ts') ||
        entry.endsWith('.mts')
      ) {
        const rel = relative(ROOT, full).split(sep).join('/');
        // Skip STATUS.md, CLAUDE.md (historical / gitignored),
        // and the test file itself (which references the URL
        // for documentation purposes only).
        if (rel === 'STATUS.md') continue;
        if (rel === 'CLAUDE.md') continue;
        if (rel === 'src/__tests__/github-repo-url-parity.test.ts') continue;
        files.push(full);
      }
    }
  }
}

function extractRepoUrlFromLayout(layoutSource: string): string | null {
  // Match: href="<url>" class="footer-link">Source</a>
  const re = /href="(https:\/\/github\.com\/[\w-]+\/[\w.-]+)"\s+class="footer-link">Source<\/a>/;
  const m = layoutSource.match(re);
  return m ? m[1] : null;
}

const layoutSource = readFileSync(LAYOUT_PATH, 'utf8');
const canonicalRepoUrl = extractRepoUrlFromLayout(layoutSource);

describe('GitHub repo URL parity', () => {
  it('layout.ts declares a parseable Source link', () => {
    expect(
      canonicalRepoUrl,
      `expected href="<url>" class="footer-link">Source</a> in src/layout.ts`
    ).not.toBeNull();
  });

  it('every hardcoded github.com/<owner>/selectsectors* URL matches the canonical repo', () => {
    if (!canonicalRepoUrl) return;

    const allFiles: string[] = [];
    findFiles(ROOT, allFiles);

    interface Mention { file: string; line: number; matched: string; }
    const wrong: Mention[] = [];
    // Match github.com/<owner>/<repo> where <repo> starts with
    // "selectsectors" (so the test only catches self-references,
    // not legitimate cross-references to the aigamma.com sister
    // repo at github.com/aigamma/aigamma.com). The repo portion
    // is captured up to the next path separator, quote, paren,
    // whitespace, comma, or backtick.
    const re = /github\.com\/([\w-]+)\/(selectsectors[\w.-]*)/g;

    for (const file of allFiles) {
      const content = readFileSync(file, 'utf8');
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(lines[i])) !== null) {
          // Strip any trailing punctuation (period, comma) and the
          // ".git" clone-URL suffix; the .git form is the same repo
          // and is the conventional way to write a clone URL.
          let repo = m[2].replace(/[.,;:]+$/, '');
          repo = repo.replace(/\.git$/, '');
          const matched = `github.com/${m[1]}/${repo}`;
          const canonical = canonicalRepoUrl.replace(/^https:\/\//, '');
          if (matched !== canonical) {
            wrong.push({
              file: relative(ROOT, file).split(sep).join('/'),
              line: i + 1,
              matched,
            });
          }
        }
      }
    }

    if (wrong.length > 0) {
      const canonical = canonicalRepoUrl.replace(/^https:\/\//, '');
      const summary = wrong
        .map((m) => `  ${m.file}:${m.line}: matched "${m.matched}" (expected "${canonical}")`)
        .join('\n');
      expect.fail(
        `found ${wrong.length} self-referencing github.com URL(s) that don't match the canonical repo:\n${summary}`
      );
    }
  });
});
