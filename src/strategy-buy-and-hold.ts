import './style.css';
import { mountSiteShell } from './layout.ts';
import { mountStrategySource } from './strategy-page.ts';
// @ts-ignore — Vite ?raw import
import source from '../crates/backtest-core/src/strategies/buy_and_hold.rs?raw';

mountSiteShell('strategies');
mountStrategySource('strategy-source', source as unknown as string);
