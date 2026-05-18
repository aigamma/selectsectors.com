import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Quiz question-count parity. The /quiz/ section ships five JSON
// files in src/quiz-data/ (one per quiz category), each containing
// an array of question objects keyed by "id". The README and the
// docs/architecture.md both mention the total question count
// across all five files. If a future iteration adds or removes a
// question (the rust-intermediate quiz had a 7th question added
// at some point bringing the total from 36 to 37; this test catches
// the inverse drift where the count stays stated as 36 in the docs
// while a new question lands in the data).
//
// The count is parsed at test time: read every .json in
// src/quiz-data/, accumulate the number of "id" occurrences as a
// proxy for the question count (each question object has exactly
// one top-level "id" field). Then assert the README and the
// architecture doc mention that number.

const ROOT = resolve(__dirname, '..', '..');
const QUIZ_DATA_DIR = resolve(ROOT, 'src', 'quiz-data');
const README_PATH = resolve(ROOT, 'README.md');
const ARCHITECTURE_MD_PATH = resolve(ROOT, 'docs', 'architecture.md');

function countQuestions(): number {
  let total = 0;
  for (const entry of readdirSync(QUIZ_DATA_DIR)) {
    if (!entry.endsWith('.json')) continue;
    const path = resolve(QUIZ_DATA_DIR, entry);
    const data = JSON.parse(readFileSync(path, 'utf8')) as {
      questions: unknown[];
    };
    if (Array.isArray(data.questions)) total += data.questions.length;
  }
  return total;
}

const live = countQuestions();

describe('quiz question-count parity', () => {
  it('found a meaningful number of quiz questions across all JSON files', () => {
    expect(live, `expected >5 quiz questions total; found ${live}`).toBeGreaterThan(5);
  });

  it('README.md mentions the correct total question count', () => {
    const source = readFileSync(README_PATH, 'utf8');
    // Match: "5 quiz categories with N multiple-choice questions"
    // where N is the count we want to verify. Capture N to give a
    // descriptive failure if it diverges.
    const re = /5\s+quiz\s+categories\s+with\s+(\d+)\s+multiple-choice\s+questions/i;
    const m = source.match(re);
    expect(
      m,
      `expected "5 quiz categories with N multiple-choice questions" pattern in README.md`
    ).not.toBeNull();
    if (!m) return;
    expect(
      parseInt(m[1], 10),
      `README.md says ${m[1]} questions but src/quiz-data/ contains ${live}. Update one or the other.`
    ).toBe(live);
  });

  it('docs/architecture.md mentions the correct total question count', () => {
    const source = readFileSync(ARCHITECTURE_MD_PATH, 'utf8');
    // Match: "Five categories (`/quiz/`) with N multiple-choice questions"
    const re = /Five\s+categories[^.]*?(\d+)\s+multiple-choice\s+questions/i;
    const m = source.match(re);
    expect(
      m,
      `expected "Five categories ... N multiple-choice questions" pattern in docs/architecture.md`
    ).not.toBeNull();
    if (!m) return;
    expect(
      parseInt(m[1], 10),
      `docs/architecture.md says ${m[1]} questions but src/quiz-data/ contains ${live}. Update one or the other.`
    ).toBe(live);
  });
});
