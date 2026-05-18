import './style.css';
import { mountSiteShell } from './layout.ts';
import { mountQuiz, type QuizCategory } from './quiz.ts';
import categoryData from './quiz-data/this-sites-rust.json';

mountSiteShell('quiz');
mountQuiz(categoryData as QuizCategory);

const titleEl = document.getElementById('quiz-title');
const descEl = document.getElementById('quiz-description');
if (titleEl) titleEl.textContent = categoryData.title;
if (descEl) descEl.textContent = categoryData.description;
