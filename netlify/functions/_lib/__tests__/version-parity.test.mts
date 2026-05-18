import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Version-parity source-of-truth test. Three places carry the site's
// version string and all three need to agree for the deployed
// catalog to be coherent:
//
//   1. package.json "version" field (the canonical source; what
//      `npm version` would bump and what shows up in dependency
//      manifests).
//   2. netlify/functions/health.mts VERSION constant (returned by
//      GET /api/health for operational monitoring).
//   3. src/layout.ts footer string (rendered as "v0.X.Y" in the
//      chrome of every page).
//
// And one place that mentions the current version in prose:
//
//   4. changelog/index.html lede ("the site is currently v0.X.Y").
//
// Iteration 60 caught all four out of sync (package.json + health.mts
// + layout.ts all at v0.1.2, changelog lede still at v0.1.0 from
// scaffold time). This test moves that discovery to commit time.
//
// The package.json version is the source of truth; the test reads
// it, then asserts the other three places contain that exact string.

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const PACKAGE_JSON_PATH = resolve(ROOT, 'package.json');
const HEALTH_MTS_PATH = resolve(ROOT, 'netlify', 'functions', 'health.mts');
const LAYOUT_TS_PATH = resolve(ROOT, 'src', 'layout.ts');
const CHANGELOG_PATH = resolve(ROOT, 'changelog', 'index.html');
const README_PATH = resolve(ROOT, 'README.md');

interface PackageJson {
  version: string;
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as PackageJson;
}

describe('version parity across package.json, health.mts, layout.ts, and changelog', () => {
  const pkg = readPackageJson();
  const canonicalVersion = pkg.version;

  it('package.json carries a non-empty semver-shaped version string', () => {
    expect(canonicalVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('health.mts VERSION constant matches package.json version', () => {
    const source = readFileSync(HEALTH_MTS_PATH, 'utf8');
    const match = source.match(/const VERSION = '([^']+)';/);
    expect(match, 'health.mts must declare `const VERSION = \'X.Y.Z\';`').not.toBeNull();
    expect(match![1]).toBe(canonicalVersion);
  });

  it('layout.ts footer string includes the current version', () => {
    const source = readFileSync(LAYOUT_TS_PATH, 'utf8');
    // The footer renders `v0.X.Y` after the brand name. The test
    // doesn't assert position; just that the literal "v{version}"
    // appears somewhere in the layout source.
    expect(source).toContain(`v${canonicalVersion}`);
  });

  it('changelog lede claims the current version', () => {
    const source = readFileSync(CHANGELOG_PATH, 'utf8');
    // The lede paragraph says "the site is currently vX.Y.Z (a
    // stable release...)" — just check that "currently v{version}"
    // appears so a future iteration that bumps package.json but
    // forgets the changelog lede gets caught.
    expect(source).toContain(`currently v${canonicalVersion}`);
  });

  it('changelog meta tags claim the current version on every surface', () => {
    // The changelog page has TWO meta tags that mention "Currently
    // vX.Y.Z": meta name="description" (line 8) and meta
    // property="og:description" (line 14). Both must bump in
    // lockstep on a version release. The prior version of this
    // test used String.includes which passes if just one of the
    // two has the bumped version; the iter-151 strengthening
    // counts the occurrences and asserts that every "Currently v"
    // mention uses the canonical version. If a future iter bumps
    // package.json and updates the meta description but forgets
    // og:description, the test fails with the divergent surface
    // pinpointed.
    const source = readFileSync(CHANGELOG_PATH, 'utf8');
    const allMentions = [...source.matchAll(/Currently v(\d+\.\d+\.\d+)/g)];
    expect(
      allMentions.length,
      `expected at least 2 "Currently vX.Y.Z" mentions in changelog/index.html (meta description + og:description) but found ${allMentions.length}`
    ).toBeGreaterThanOrEqual(2);
    for (const m of allMentions) {
      expect(
        m[1],
        `changelog/index.html mention "Currently v${m[1]}" disagrees with package.json version "${canonicalVersion}". All meta surfaces must bump together.`
      ).toBe(canonicalVersion);
    }
  });

  it('README.md status section claims the current version', () => {
    // README opens with a "## Status" section whose first paragraph
    // is "vX.Y.Z. The full content + interactive surface shipped...".
    // The trailing period after the version is part of the prose,
    // so the test asserts the literal "vX.Y.Z." appears.
    const source = readFileSync(README_PATH, 'utf8');
    expect(
      source,
      `expected "v${canonicalVersion}." in README.md`
    ).toContain(`v${canonicalVersion}.`);
  });
});
