import './style.css';
import { mountSiteShell } from './layout.ts';
// @ts-ignore — Vite ?raw import
import errorRs from '../crates/backtest-core/src/error.rs?raw';

mountSiteShell('learn');

const el = document.getElementById('src-error');
if (el) el.textContent = errorRs as unknown as string;
