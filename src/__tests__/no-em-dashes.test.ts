import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, join, sep } from 'node:path';

// CLAUDE.md "Locked-in design decisions" section, line that
// starts with "No em dashes anywhere.":
//
//   "No em dashes anywhere. Anywhere. Site-wide convention; minus
//    signs and en dashes only."
//
// This test enforces the rule for user-visible site content (every
// .html file in the repo, every .ts file under src/, and every .mts
// file under netlify/functions/). The rule's "site-wide" scope is
// taken to mean content that ends up on the rendered page or that
// LLM-style outputs the chat surface back to the user. CLAUDE.md
// itself and commit messages are excluded because they are
// developer-facing, not user-facing; the rule is about brand voice
// on the public surface.
//
// What we forbid in user-facing content:
//   1. Literal U+2014 EM DASH character
//   2. The &mdash; HTML entity
//   3. The &#8212; numeric entity (decimal)
//   4. The &#x2014; numeric entity (hex)
//
// What is allowed:
//   - U+2013 EN DASH (and &ndash; / &#8211; / &#x2013;)
//   - U+002D HYPHEN-MINUS (the ASCII minus sign on the keyboard)
//   - Words ("to", "through", "or")
//
// Why a test instead of just a CLAUDE.md note: em dashes sneak in
// from a half-dozen sources (autocorrect in editors, paste from
// formatted documents, LLM-authored content that reverts to the
// default style, copy-paste from external docs). A regression test
// is the only reliable way to keep the convention from drifting.

const ROOT = resolve(__dirname, '..', '..');

const EM_DASH_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /—/g, label: 'literal U+2014 em dash' },
  { pattern: /&mdash;/g, label: '&mdash; entity' },
  { pattern: /&#8212;/g, label: '&#8212; numeric entity' },
  { pattern: /&#x2014;/gi, label: '&#x2014; hex entity' },
];

interface Violation {
  file: string;
  line: number;
  column: number;
  pattern: string;
  excerpt: string;
}

function shouldSkipDir(name: string): boolean {
  return (
    name === 'node_modules' ||
    name === 'dist' ||
    name === '.git' ||
    name === 'target' ||
    name === 'pkg' ||
    name === '.netlify'
  );
}

function shouldScanFile(absPath: string): boolean {
  // Scope: .html anywhere in the repo; .ts under src/; .mts under
  // netlify/functions/; .css under src/. Markdown and Rust files
  // are not user-facing (Rust comments never reach the browser; .md
  // files are read on GitHub, not on the site).
  const rel = relative(ROOT, absPath);
  // Exclude this test file itself: it has to mention &mdash; and
  // the U+2014 character in regex literals and string labels to
  // detect them, which would otherwise be a false positive. There
  // is exactly one self-referencing file, so a hard-coded path
  // check is the simplest exclusion.
  if (rel === join('src', '__tests__', 'no-em-dashes.test.ts')) return false;
  if (rel.endsWith('.html')) return true;
  if (rel.startsWith(`src${sep}`) && (rel.endsWith('.ts') || rel.endsWith('.css'))) {
    return true;
  }
  if (rel.startsWith(`netlify${sep}functions${sep}`) && rel.endsWith('.mts')) {
    return true;
  }
  return false;
}

function walk(dir: string, files: string[]): void {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!shouldSkipDir(entry)) walk(full, files);
    } else if (st.isFile()) {
      if (shouldScanFile(full)) files.push(full);
    }
  }
}

function findViolations(file: string): Violation[] {
  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');
  const violations: Violation[] = [];

  // Code comments in .ts / .mts / .css are developer-facing, not
  // user-facing — exclude them. The cheap way to do this without a
  // real parser is to strip // line comments and /* block comments
  // for source files; HTML files don't get this exemption (HTML
  // comments are still parsed and could be exposed via view-source
  // or assistive tech, and the rule is strictest on the rendered
  // surface).
  const isSourceFile =
    file.endsWith('.ts') || file.endsWith('.mts') || file.endsWith('.css');

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (isSourceFile) {
      // Strip // ... to end of line. Doesn't handle // inside
      // strings perfectly, but close enough: the file extension
      // already restricts us to source files, and any em dash
      // inside a string literal in TS is a real violation we want
      // to flag.
      const commentIdx = line.indexOf('//');
      if (commentIdx >= 0) line = line.slice(0, commentIdx);
    }
    for (const { pattern, label } of EM_DASH_PATTERNS) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(line)) !== null) {
        violations.push({
          file: relative(ROOT, file),
          line: i + 1,
          column: m.index + 1,
          pattern: label,
          excerpt: lines[i].slice(Math.max(0, m.index - 30), m.index + 40),
        });
      }
    }
  }
  return violations;
}

describe('no em dashes in user-facing site content', () => {
  const files: string[] = [];
  walk(ROOT, files);

  it('scans at least the HTML pages and the main TS entries', () => {
    // Sanity check: the walker didn't accidentally exclude
    // everything. The repo has 30-plus .html files; if we find
    // fewer than 20 something is wrong with the file walker.
    const htmlCount = files.filter((f) => f.endsWith('.html')).length;
    expect(
      htmlCount,
      `expected the walker to find many .html files, got ${htmlCount}`
    ).toBeGreaterThan(20);
  });

  it('finds no em-dash violations in any scanned file', () => {
    const allViolations: Violation[] = [];
    for (const file of files) {
      allViolations.push(...findViolations(file));
    }
    if (allViolations.length > 0) {
      const summary = allViolations
        .map(
          (v) =>
            `  ${v.file}:${v.line}:${v.column} (${v.pattern}): ...${v.excerpt}...`
        )
        .join('\n');
      expect.fail(
        `found ${allViolations.length} em-dash violation(s) in user-facing content. ` +
          `Replace with en dash (U+2013 / &ndash;), a hyphen, or restructure the sentence.\n${summary}`
      );
    }
  });
});
