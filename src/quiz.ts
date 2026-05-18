// Quiz engine. One module that drives every category page.
//
// The pattern:
//   1. Each /quiz/{category}/ page imports its category JSON and the
//      `mountQuiz(category)` function from here.
//   2. `mountQuiz` renders one question at a time, with the option
//      buttons inert until clicked; on click, it reveals the correct
//      answer and the explanation; on "next", it advances to the
//      next question. After the last question, a summary screen
//      shows the score plus a per-question recap.
//   3. Progress is persisted to localStorage under a per-category
//      key so a reload mid-quiz keeps the answers you've given.
//
// The data shape is the contract between the JSON files and this
// engine. Adding a new category is two files: the JSON under
// src/quiz-data/ and an HTML page under quiz/{slug}/ that imports
// the JSON and calls mountQuiz.

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  linkTo?: string;
}

export interface QuizCategory {
  slug: string;
  title: string;
  description: string;
  questions: QuizQuestion[];
}

interface QuizState {
  /** Per-question selected option index, indexed by question.id.
   *  Absent = not yet answered. */
  answers: Record<string, number>;
  /** Current question index in the category.questions array. */
  currentIndex: number;
  /** True once the user has clicked an option for the current question
   *  and is now looking at the explanation. */
  revealed: boolean;
}

const STORAGE_PREFIX = 'selectsectors-quiz:v1:';

function loadState(slug: string): QuizState {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + slug);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as QuizState;
    if (
      !parsed ||
      typeof parsed.currentIndex !== 'number' ||
      typeof parsed.revealed !== 'boolean' ||
      typeof parsed.answers !== 'object' ||
      parsed.answers === null
    ) {
      return freshState();
    }
    return parsed;
  } catch {
    return freshState();
  }
}

function freshState(): QuizState {
  return { answers: {}, currentIndex: 0, revealed: false };
}

function saveState(slug: string, state: QuizState): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + slug, JSON.stringify(state));
  } catch (err) {
    console.warn('quiz: failed to persist state', err);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return c;
    }
  });
}

// Minimal inline markdown: escape HTML, then re-introduce `code` spans.
// The quiz JSON files use single-backtick spans for code references
// like `&[DailyBar]` and `apply_positions_to_bars`. No need for the
// fuller markdown renderer used by the chat panel; quiz copy is
// shorter and editor-controlled.
function renderInline(s: string): string {
  const escaped = escapeHtml(s);
  return escaped.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
}

function renderProgress(state: QuizState, total: number): string {
  const answered = Object.keys(state.answers).length;
  return `<div class="quiz-progress">Question ${Math.min(state.currentIndex + 1, total)} of ${total} &middot; ${answered} answered</div>`;
}

function renderQuestion(
  question: QuizQuestion,
  state: QuizState,
  index: number
): string {
  const selected = state.answers[question.id];
  const revealed = state.revealed && selected !== undefined;
  const correct = question.correctIndex;

  const optionsHtml = question.options
    .map((opt, i) => {
      const cls = ['quiz-option'];
      if (revealed) {
        cls.push('revealed');
        if (i === correct) cls.push('correct');
        if (i === selected && i !== correct) cls.push('incorrect');
      } else if (i === selected) {
        cls.push('selected');
      }
      return `
        <button
          type="button"
          class="${cls.join(' ')}"
          data-option-index="${i}"
          ${revealed ? 'disabled' : ''}
        >
          <span class="quiz-option-letter">${String.fromCharCode(65 + i)}</span>
          <span class="quiz-option-text">${renderInline(opt)}</span>
        </button>
      `;
    })
    .join('');

  const explanationHtml = revealed
    ? `
      <div class="quiz-explanation ${selected === correct ? 'correct' : 'incorrect'}">
        <div class="quiz-explanation-badge">
          ${selected === correct ? 'Correct' : 'Not quite'}
        </div>
        <p>${renderInline(question.explanation)}</p>
        ${
          question.linkTo
            ? `<p class="quiz-explanation-link">More: <a href="${escapeHtml(question.linkTo)}">${escapeHtml(question.linkTo)}</a></p>`
            : ''
        }
      </div>
    `
    : '';

  return `
    <div class="quiz-card">
      <div class="quiz-prompt">${renderInline(question.prompt)}</div>
      <div class="quiz-options">
        ${optionsHtml}
      </div>
      ${explanationHtml}
      <div class="quiz-actions">
        ${
          revealed
            ? `<button type="button" class="quiz-next" data-next-action="${index === undefined ? 'finish' : 'next'}">Next question &rarr;</button>`
            : ''
        }
      </div>
    </div>
  `;
}

function renderSummary(category: QuizCategory, state: QuizState): string {
  const total = category.questions.length;
  let correct = 0;
  for (const q of category.questions) {
    if (state.answers[q.id] === q.correctIndex) correct++;
  }
  const pct = Math.round((correct / total) * 100);
  const recap = category.questions
    .map((q) => {
      const ans = state.answers[q.id];
      const got = ans === q.correctIndex ? 'correct' : 'incorrect';
      const yourPick =
        ans === undefined ? '(skipped)' : q.options[ans] ?? '(?)';
      const rightPick = q.options[q.correctIndex];
      return `
        <li class="quiz-recap-item ${got}">
          <div class="quiz-recap-prompt">${renderInline(q.prompt)}</div>
          ${
            ans === q.correctIndex
              ? `<div class="quiz-recap-answer">${renderInline(rightPick)}</div>`
              : `
                <div class="quiz-recap-answer-wrong">Your pick: ${renderInline(yourPick)}</div>
                <div class="quiz-recap-answer">Correct: ${renderInline(rightPick)}</div>
              `
          }
        </li>
      `;
    })
    .join('');

  return `
    <div class="quiz-summary">
      <div class="quiz-summary-score">
        <div class="quiz-summary-score-headline">${correct} of ${total}</div>
        <div class="quiz-summary-score-pct">${pct}%</div>
      </div>
      <p class="quiz-summary-blurb">
        ${
          pct === 100
            ? "Full marks. SelectBot can't teach you more than you already know about this category. Try a harder one."
            : pct >= 75
              ? "Solid grasp. Re-read the explanations for the questions you missed; they tend to be the ones with subtle distinctions."
              : pct >= 50
                ? "Decent start. Walk through the lessons that the question explanations link to, then retake."
                : 'Plenty of room to grow. Start with the curriculum at /learn/, then come back.'
        }
      </p>
      <h2>Recap</h2>
      <ol class="quiz-recap">${recap}</ol>
      <h2>What's next</h2>
      <ul class="quiz-summary-next">
        <li>
          <strong>Another category.</strong> Five categories total at
          <a href="/quiz/">/quiz/</a>: Rust basics, This site's Rust,
          Quant finance basics, Rust intermediate, WebAssembly
          internals. Progress on each is saved separately.
        </li>
        <li>
          <strong>Read the curriculum.</strong> Six lessons at
          <a href="/learn/">/learn/</a> ground in the same Rust crate
          the questions referenced. The "this-sites-rust" lesson is
          the densest in actual code.
        </li>
        <li>
          <strong>Run a backtest.</strong> The
          <a href="/">homepage backtester</a> runs any of the six
          strategies on any of the 23 symbols. Two backtests per
          hour, free on cache hits.
        </li>
        <li>
          <strong>Ask SelectBot.</strong> Specific follow-ups on a
          question you missed get more useful answers than the
          one-line explanation on the recap above.
        </li>
      </ul>
      <div class="quiz-summary-actions">
        <button type="button" class="quiz-restart">Retake quiz</button>
      </div>
    </div>
  `;
}

export function mountQuiz(category: QuizCategory): void {
  const root = document.getElementById('quiz-root');
  if (!root) {
    console.error('quiz: #quiz-root not found');
    return;
  }

  let state = loadState(category.slug);
  // Clamp currentIndex if the JSON has changed since the last visit
  // (e.g. questions were edited or removed).
  if (state.currentIndex > category.questions.length) {
    state.currentIndex = category.questions.length;
  }

  function render(): void {
    const total = category.questions.length;
    if (state.currentIndex >= total) {
      root!.innerHTML = renderSummary(category, state);
      return;
    }
    const q = category.questions[state.currentIndex];
    root!.innerHTML = `
      ${renderProgress(state, total)}
      ${renderQuestion(q, state, state.currentIndex)}
    `;
  }

  root.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;

    const optionBtn = target.closest<HTMLButtonElement>('.quiz-option');
    if (optionBtn && !optionBtn.disabled) {
      const idx = Number(optionBtn.dataset.optionIndex);
      if (!Number.isFinite(idx)) return;
      const currentQ = category.questions[state.currentIndex];
      state.answers[currentQ.id] = idx;
      state.revealed = true;
      saveState(category.slug, state);
      render();
      return;
    }

    if (target.classList.contains('quiz-next')) {
      state.currentIndex += 1;
      state.revealed = false;
      saveState(category.slug, state);
      render();
      return;
    }

    if (target.classList.contains('quiz-restart')) {
      state = freshState();
      saveState(category.slug, state);
      render();
      return;
    }
  });

  render();
}
