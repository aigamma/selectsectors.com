import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Chat model name parity. The Anthropic model used by /api/chat is
// declared as `const MODEL = '<id>'` in netlify/functions/chat.mts;
// the same model name appears in five documentation surfaces:
//
//   1. api-docs/index.html prose under POST /api/chat
//   2. changelog/index.html SelectBot release notes
//   3. docs/architecture.md SelectBot section
//   4. README.md "SelectBot chatbot (Anthropic SDK with <model>...)"
//   5. chat.mts comment block explaining the model choice (this is
//      part of the same file so we don't pin it against itself; the
//      comment is informative for maintainers and is allowed to
//      mention prior models like claude-opus-4-7 / claude-haiku-4-5
//      as cost-benefit comparisons)
//
// If a future iteration upgrades the model (say claude-sonnet-4-6
// to claude-sonnet-5-0 or claude-opus-4-8), all four documentation
// surfaces need to update in lockstep with the chat.mts constant.
// Without this test, only chat.mts is the operational source of
// truth and the others silently go stale.

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const CHAT_MTS_PATH = resolve(ROOT, 'netlify', 'functions', 'chat.mts');
const API_DOCS_PATH = resolve(ROOT, 'api-docs', 'index.html');
const CHANGELOG_PATH = resolve(ROOT, 'changelog', 'index.html');
const ARCHITECTURE_MD_PATH = resolve(ROOT, 'docs', 'architecture.md');
const README_PATH = resolve(ROOT, 'README.md');

function extractModelConst(source: string): string | null {
  // The MODEL is declared once in chat.mts as: const MODEL = '<id>';
  const re = /const MODEL\s*=\s*['"]([\w-]+)['"]/;
  const m = source.match(re);
  return m ? m[1] : null;
}

const chatSource = readFileSync(CHAT_MTS_PATH, 'utf8');
const liveModel = extractModelConst(chatSource);

describe('chat model name parity', () => {
  it('chat.mts declares a MODEL constant', () => {
    expect(
      liveModel,
      `expected "const MODEL = '...'" in netlify/functions/chat.mts`
    ).not.toBeNull();
  });

  const surfaces: { label: string; path: string }[] = [
    { label: 'api-docs/index.html', path: API_DOCS_PATH },
    { label: 'changelog/index.html', path: CHANGELOG_PATH },
    { label: 'docs/architecture.md', path: ARCHITECTURE_MD_PATH },
    { label: 'README.md', path: README_PATH },
  ];

  it.each(surfaces.map((s) => [s.label, s.path]))(
    'documentation surface %s mentions the live MODEL',
    (label, path) => {
      if (!liveModel) return;
      const source = readFileSync(path, 'utf8');
      expect(
        source.includes(liveModel),
        `${label} does not mention the live chat MODEL "${liveModel}". Update ${label} to reference the current model or undo the model change in chat.mts.`
      ).toBe(true);
    }
  );

  it.each(surfaces.map((s) => [s.label, s.path]))(
    'documentation surface %s does not mention an obsolete model name',
    (label, path) => {
      if (!liveModel) return;
      const source = readFileSync(path, 'utf8');
      // Look for any claude-* model identifier (the SDK's naming
      // pattern). If a surface mentions a model that is NOT the
      // live one, flag it as drift. The chat.mts comment block is
      // exempt from this rule because it intentionally mentions
      // alternative models for cost/quality comparison; the
      // surfaces list does NOT include chat.mts to honor that
      // exemption.
      const allModels = [...source.matchAll(/claude-[a-z]+-\d+(?:-\d+)?/g)].map(
        (m) => m[0]
      );
      const obsolete = allModels.filter((m) => m !== liveModel);
      // Documentation surfaces may also mention non-Anthropic
      // model names or comparative references; the filter above
      // restricts to claude-* shapes only, which is the only
      // operational model class the site uses.
      if (label === 'changelog/index.html') {
        // The changelog by nature describes prior versions; allow
        // it to mention any historical model name (claude-sonnet-4-6
        // might appear alongside claude-sonnet-4-5 if iterations
        // describe an upgrade).
        return;
      }
      expect(
        obsolete,
        `${label} mentions obsolete model name(s): ${obsolete.join(', ')}. The live model is "${liveModel}".`
      ).toEqual([]);
    }
  );
});
