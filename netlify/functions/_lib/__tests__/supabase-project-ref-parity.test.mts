import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Supabase project ref parity. The site reads bar data from a
// Supabase project whose URL is configured via the SUPABASE_URL
// env var. The .env.example file documents the canonical project
// URL (currently https://tbxhvpoyyyhbvoyefggu.supabase.co); the
// project ref ("tbxhvpoyyyhbvoyefggu") is the subdomain prefix.
//
// The same project ref appears in three user-facing documentation
// surfaces:
//   1. README.md ("project ref tbxhvpoyyyhbvoyefggu")
//   2. docs/architecture.md (in the data-flow diagram)
//   3. chat-system-prompt.mts (SelectBot's grounding text)
//
// If the project is migrated to a different Supabase instance, the
// SUPABASE_URL env var bumps and the live API immediately reads
// from the new project; the three documentation surfaces stay
// stale until someone independently finds and updates each one.
// SelectBot in particular would tell users an obsolete project ref
// when asked about the data layer.
//
// The .env.example file is the parsed source of truth for this
// test rather than a runtime read of SUPABASE_URL (which is not
// set in the test environment); .env.example is committed to the
// repo and is the canonical static record of the expected URL.

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const ENV_EXAMPLE_PATH = resolve(ROOT, '.env.example');
const README_PATH = resolve(ROOT, 'README.md');
const ARCHITECTURE_MD_PATH = resolve(ROOT, 'docs', 'architecture.md');
const CHAT_SYSTEM_PROMPT_PATH = resolve(
  ROOT,
  'netlify',
  'functions',
  '_lib',
  'chat-system-prompt.mts'
);

function extractProjectRef(envExampleSource: string): string | null {
  // .env.example has SUPABASE_URL=https://<ref>.supabase.co; the
  // ref is the leading subdomain of the URL.
  const re = /SUPABASE_URL\s*=\s*https:\/\/([a-z0-9-]+)\.supabase\.co/i;
  const m = envExampleSource.match(re);
  return m ? m[1] : null;
}

const envExample = readFileSync(ENV_EXAMPLE_PATH, 'utf8');
const liveRef = extractProjectRef(envExample);

describe('Supabase project ref parity', () => {
  it('.env.example declares a SUPABASE_URL with a parseable project ref', () => {
    expect(
      liveRef,
      `expected SUPABASE_URL=https://<ref>.supabase.co in .env.example`
    ).not.toBeNull();
  });

  const surfaces: { label: string; path: string }[] = [
    { label: 'README.md', path: README_PATH },
    { label: 'docs/architecture.md', path: ARCHITECTURE_MD_PATH },
    {
      label: 'netlify/functions/_lib/chat-system-prompt.mts',
      path: CHAT_SYSTEM_PROMPT_PATH,
    },
  ];

  it.each(surfaces.map((s) => [s.label, s.path]))(
    'documentation surface %s mentions the live Supabase project ref',
    (label, path) => {
      if (!liveRef) return;
      const source = readFileSync(path, 'utf8');
      expect(
        source.includes(liveRef),
        `${label} does not mention the live SUPABASE_URL project ref "${liveRef}". Update ${label} to reference the current ref or undo the migration in .env.example.`
      ).toBe(true);
    }
  );
});
