import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Content-catalogs parity test. For each top-level content section
// (/philosophy/, /learn/), the catalog page (philosophy/index.html
// or learn/index.html) must link to every subdirectory page that
// exists under that section. The previous iterations covered:
//
//   - strategy-pages-parity (iter 94/95): STRATEGY_SPECS ↔
//     /strategies/<kebab>/index.html ↔ strategies/index.html rows
//   - quiz-parity (iter 96): src/quiz-data/<slug>.json ↔
//     src/quiz-<slug>.ts ↔ quiz/<slug>/index.html ↔ quiz/index.html
//     rows + JSON.slug self-consistency
//
// Philosophy and learn have a simpler structure: just subdirectories
// of HTML pages, no separate data file. The catalog landing page
// links to each by hand-written <a href="..."> entries. If someone
// adds a new philosophy/learn/<slug>/ page but forgets to add a
// catalog row, the page becomes unreachable via normal navigation
// (only via the sitemap or direct URL).

const ROOT = resolve(__dirname, '..', '..');

interface Section {
  /** Section name, used for test labels and path resolution. */
  name: 'philosophy' | 'learn';
  /** Filename of the catalog page inside the section dir. */
  catalogFile: string;
}

const SECTIONS: Section[] = [
  { name: 'philosophy', catalogFile: 'index.html' },
  { name: 'learn', catalogFile: 'index.html' },
];

/**
 * List subdirectory slugs under the section dir that have an
 * index.html. Skips the catalog page itself (the section root's
 * index.html doesn't sit in a subdirectory).
 */
function listContentSlugs(section: string): string[] {
  const sectionDir = resolve(ROOT, section);
  return readdirSync(sectionDir)
    .filter((entry) => {
      const path = resolve(sectionDir, entry);
      if (!statSync(path).isDirectory()) return false;
      return existsSync(resolve(path, 'index.html'));
    })
    .sort();
}

for (const section of SECTIONS) {
  describe(`/${section.name}/ catalog ↔ subdirectory pages parity`, () => {
    const slugs = listContentSlugs(section.name);
    const catalogPath = resolve(ROOT, section.name, section.catalogFile);
    const catalogSource = readFileSync(catalogPath, 'utf8');

    it(`found at least 4 subdirectory pages under /${section.name}/ (sanity check)`, () => {
      expect(slugs.length).toBeGreaterThanOrEqual(4);
    });

    it.each(slugs)(
      `/${section.name}/%s/ is linked from the catalog`,
      (slug) => {
        const linkRe = new RegExp(`href="/${section.name}/${slug}/?"`);
        expect(
          linkRe.test(catalogSource),
          `/${section.name}/${slug}/index.html exists but /${section.name}/index.html does not link to it`
        ).toBe(true);
      }
    );
  });
}
