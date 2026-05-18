import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { resolve } from 'node:path';

// JSON validity test. Every <script type="application/ld+json"> block
// across every HTML file in the repo must parse as valid JSON, and
// every <pre><code> block inside /api-docs/ that looks like a JSON
// example must also parse. This catches a real class of bug: a typo
// in a structured-data block (mis-escaped quote, trailing comma,
// missing curly brace) silently breaks the schema.org consumer's
// parser without breaking the page render, and a typo in an API-docs
// example silently misleads a developer copying the example into
// their integration code.
//
// The page-level JSON-LD blocks were added by add-article-jsonld,
// add-breadcrumbs, and the inline copies in each HTML file; the
// api-docs examples are hand-edited. Both surfaces drift over time
// without immediate visual feedback, so an automated check is the
// right place to put the integrity guarantee.
//
// JSON-with-comment caveat: the api-docs examples sometimes carry
// /* ... entries ... */ ellipsis comments inside an array to mark
// where a long list was elided. Those are NOT valid JSON. The test
// strips JS-style block comments before parsing so the trailing
// /* */ ellipses don't trip the parser; the substantive shape of
// the example is still validated.

const ROOT = resolve(__dirname, '..', '..');
const EXCLUDED_DIRS = ['node_modules', 'dist', '.netlify', '.git', 'pkg', 'scratch'];

function isExcluded(p: string): boolean {
  return EXCLUDED_DIRS.some(
    (d) => p.includes(`${d}/`) || p.includes(`${d}\\`)
  );
}

async function listHtmlFiles(): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of glob('**/*.html')) {
    const abs = resolve(ROOT, entry);
    if (isExcluded(abs)) continue;
    out.push(abs);
  }
  return out;
}

function extractJsonLdBlocks(html: string): string[] {
  // Match <script type="application/ld+json"> ... </script> with
  // possible attribute order variations. The capture group is the
  // raw text between the script tags.
  const re = /<script\b[^>]*\btype="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    blocks.push(m[1].trim());
  }
  return blocks;
}

function extractJsonCodeBlocks(html: string): string[] {
  // Match <pre><code>...</code></pre>. Only return blocks whose
  // first non-whitespace char is { (object) or [ (array) so we skip
  // the strategy-catalog block and the curl command in api-docs.
  const re = /<pre><code>([\s\S]*?)<\/code><\/pre>/g;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const body = m[1].trim();
    const first = body.charAt(0);
    if (first === '{' || first === '[') {
      blocks.push(body);
    }
  }
  return blocks;
}

function stripBlockComments(s: string): string {
  // Strip /* ... */ block comments so /* ... entries ... */ ellipses
  // inside JSON arrays don't break the parser. JSON itself doesn't
  // allow comments; these are documentation hints.
  return s.replace(/\/\*[\s\S]*?\*\//g, '');
}

function unescapeHtmlEntities(s: string): string {
  // The api-docs examples use HTML entities for & < > inside the
  // <code> blocks so the browser renders them as literal characters.
  // Reverse that before JSON.parse so the parser sees the actual
  // JSON text.
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripAngleBracketPlaceholders(s: string): string {
  // The api-docs uses <placeholder> tokens (like <git sha>, <hex>,
  // <ms>, <n>) as visual placeholders for runtime values. These
  // aren't valid JSON; replace them with type-appropriate sentinels
  // so the structural validity check can still proceed. Order matters:
  // first match the quoted-string placeholders (which include the
  // wrapping double-quotes) so the quotes are absorbed by the replace
  // and we don't end up with ""placeholder"" doubled strings, then
  // match the bare-numeric placeholders.
  return s
    .replace(/"<hex>"/g, '"placeholder"')
    .replace(/"<sha256 hex[^>]*>"/g, '"placeholder"')
    .replace(/"<git sha>"/g, '"placeholder"')
    .replace(/"<netlify deploy id>"/g, '"placeholder"')
    .replace(/<ms>/g, '0')
    .replace(/<n>/g, '0');
}

const allFiles = await listHtmlFiles();

interface BlockSource {
  file: string;
  kind: 'jsonld' | 'apidocs';
  index: number;
  raw: string;
}

const allBlocks: BlockSource[] = [];

for (const file of allFiles) {
  const html = readFileSync(file, 'utf8');
  const rel = file.replace(ROOT + '\\', '').replace(ROOT + '/', '');

  const jsonLdBlocks = extractJsonLdBlocks(html);
  jsonLdBlocks.forEach((block, idx) => {
    allBlocks.push({ file: rel, kind: 'jsonld', index: idx, raw: block });
  });

  if (rel.startsWith('api-docs')) {
    const codeBlocks = extractJsonCodeBlocks(html);
    codeBlocks.forEach((block, idx) => {
      allBlocks.push({ file: rel, kind: 'apidocs', index: idx, raw: block });
    });
  }
}

describe('JSON-LD validity (every <script type="application/ld+json"> block parses)', () => {
  const jsonLdBlocks = allBlocks.filter((b) => b.kind === 'jsonld');

  it('found at least 10 JSON-LD blocks (sanity check)', () => {
    expect(jsonLdBlocks.length).toBeGreaterThanOrEqual(10);
  });

  it.each(jsonLdBlocks)('$file block $index parses', ({ raw, file, index }) => {
    try {
      JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `${file} JSON-LD block ${index} failed to parse: ${(e as Error).message}\n` +
          `Block content (first 200 chars): ${raw.slice(0, 200)}`
      );
    }
  });
});

describe('api-docs JSON example validity (every <pre><code>{...}</code></pre> block parses)', () => {
  const apidocsBlocks = allBlocks.filter((b) => b.kind === 'apidocs');

  it('found at least 5 api-docs JSON example blocks (sanity check)', () => {
    expect(apidocsBlocks.length).toBeGreaterThanOrEqual(5);
  });

  it.each(apidocsBlocks)('api-docs example $index parses', ({ raw, index }) => {
    const cleaned = stripBlockComments(
      stripAngleBracketPlaceholders(unescapeHtmlEntities(raw))
    );
    try {
      JSON.parse(cleaned);
    } catch (e) {
      throw new Error(
        `api-docs JSON example ${index} failed to parse: ${(e as Error).message}\n` +
          `Cleaned content (first 200 chars): ${cleaned.slice(0, 200)}`
      );
    }
  });
});
