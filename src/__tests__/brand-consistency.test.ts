import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

// Brand consistency test. CLAUDE.md "Locked-in design decisions"
// section pins the brand convention:
//
//   "Brand. AI Gamma everywhere; never AI Gamma LLC or any
//    variant with corporate suffix."
//
// Variants to forbid:
//   - "AI Gamma LLC"
//   - "AI Gamma Inc"
//   - "AI Gamma Corp"
//   - "AI gamma" (lowercase 'g'; the canonical form is title case)
//   - "AIGamma" (no space)
//   - "Ai Gamma" (title-case 'A' but lowercase 'i' is wrong)
//
// The canonical form is "AI Gamma" with both letters of "AI"
// capitalized and a single space separator. The brand appears on
// every page (in the header "AI Gamma" external-nav link, in the
// footer "AI Gamma · Select Sectors · v0.1.4" meta, in many
// JSON-LD Organization blocks). This test catches an accidental
// typo or corporate-suffix addition before it lands in commit.

const ROOT = resolve(__dirname, '..', '..');

const FORBIDDEN_VARIANTS = [
  'AI Gamma LLC',
  'AI Gamma Inc',
  'AI Gamma Inc.',
  'AI Gamma Corp',
  'AI Gamma Corp.',
  'AI Gamma Ltd',
  'AI Gamma Ltd.',
  'Ai Gamma',
  'AIGamma',
];

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
        entry.endsWith('.ts') ||
        entry.endsWith('.mts') ||
        entry.endsWith('.css')
      ) {
        const rel = relative(ROOT, full).split(sep).join('/');
        // CLAUDE.md mentions the rule itself; skip so the rule
        // text doesn't trip its own test.
        if (rel === 'CLAUDE.md') continue;
        if (rel === 'STATUS.md') continue;
        // Skip this test file: its docstring enumerates the
        // forbidden variants for documentation purposes.
        if (rel === 'src/__tests__/brand-consistency.test.ts') continue;
        files.push(full);
      }
    }
  }
}

interface Violation {
  file: string;
  line: number;
  variant: string;
  excerpt: string;
}

const allFiles: string[] = [];
findFiles(ROOT, allFiles);

const violations: Violation[] = [];
for (const file of allFiles) {
  const content = readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const variant of FORBIDDEN_VARIANTS) {
      const idx = lines[i].indexOf(variant);
      if (idx >= 0) {
        violations.push({
          file: relative(ROOT, file).split(sep).join('/'),
          line: i + 1,
          variant,
          excerpt: lines[i].slice(Math.max(0, idx - 20), idx + 40),
        });
      }
    }
  }
}

describe('brand consistency: "AI Gamma" everywhere, no corporate suffix or typo variants', () => {
  it('finds no forbidden brand variants in any scanned file', () => {
    if (violations.length > 0) {
      const summary = violations
        .map(
          (v) =>
            `  ${v.file}:${v.line}: matched "${v.variant}" - ...${v.excerpt}...`
        )
        .join('\n');
      expect.fail(
        `found ${violations.length} brand variant violation(s). The canonical brand is "AI Gamma" (no corporate suffix).\n${summary}`
      );
    }
  });
});
