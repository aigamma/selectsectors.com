//! Backtest math kernels for selectsectors.com.
//!
//! This crate compiles to WebAssembly via `wasm-pack` and is loaded by
//! the Netlify background function at runtime. The function imports
//! the JS glue produced by wasm-pack (`pkg/backtest_core.js`), calls
//! `init()` to instantiate the WASM module, then invokes one of the
//! exported math functions with the strategy params and the daily
//! bar history pulled from Supabase.
//!
//! The crate is deliberately small at the scaffold stage. As
//! strategies come online, each one gets its own typed entry point
//! (e.g., `run_sma_crossover`, `run_volatility_breakout`) returning a
//! `BacktestResult` that the function serializes into the result blob
//! the frontend polls.
//!
//! Design notes:
//!
//! - The Rust ↔ JS boundary uses `serde-wasm-bindgen` so inputs and
//!   outputs are typed `serde::Serialize`/`Deserialize` rather than
//!   ad-hoc `JsValue` shuffling. This keeps the WASM glue typed at
//!   the Rust level and lets the function call the WASM the same way
//!   it would call any other library.
//!
//! - No allocation in hot paths if it can be avoided. The bar
//!   histories are arrays of f64 that we walk in-order; vec allocation
//!   should only happen at result-shaping time.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Debug, Deserialize)]
pub struct BacktestInputs {
    pub symbol: String,
    pub bars: Vec<DailyBar>,
    pub strategy: StrategyParams,
}

#[derive(Debug, Deserialize)]
pub struct DailyBar {
    pub date: String,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: u64,
}

#[derive(Debug, Deserialize)]
pub struct StrategyParams {
    pub name: String,
    pub params: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct BacktestResult {
    pub symbol: String,
    pub n_bars: usize,
    pub total_return: f64,
    pub sharpe: f64,
    pub max_drawdown: f64,
    pub trades: usize,
}

/// Scaffold backtest entry point. Returns a placeholder result whose
/// shape matches what the background function eventually consumes,
/// so the frontend and the function can be wired end-to-end before
/// any real strategy is implemented.
///
/// Replace the body with the dispatched strategy implementation as
/// each strategy comes online.
#[wasm_bindgen]
pub fn run_backtest(input: JsValue) -> Result<JsValue, JsValue> {
    let inputs: BacktestInputs = serde_wasm_bindgen::from_value(input)?;

    let n_bars = inputs.bars.len();
    let total_return = compute_total_return(&inputs.bars);

    let result = BacktestResult {
        symbol: inputs.symbol,
        n_bars,
        total_return,
        sharpe: 0.0,
        max_drawdown: 0.0,
        trades: 0,
    };

    serde_wasm_bindgen::to_value(&result).map_err(Into::into)
}

/// First-bar to last-bar log return. Replaceable; the placeholder
/// stands in for an actual strategy execution until the strategy
/// library lands.
fn compute_total_return(bars: &[DailyBar]) -> f64 {
    if bars.len() < 2 {
        return 0.0;
    }
    let first = bars.first().expect("checked non-empty").close;
    let last = bars.last().expect("checked non-empty").close;
    if first <= 0.0 {
        return 0.0;
    }
    (last / first).ln()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compute_total_return_handles_empty() {
        let bars: Vec<DailyBar> = vec![];
        assert_eq!(compute_total_return(&bars), 0.0);
    }

    #[test]
    fn compute_total_return_handles_two_bars() {
        let bars = vec![
            DailyBar {
                date: "2026-01-02".to_string(),
                open: 100.0,
                high: 100.0,
                low: 100.0,
                close: 100.0,
                volume: 0,
            },
            DailyBar {
                date: "2026-01-03".to_string(),
                open: 110.0,
                high: 110.0,
                low: 110.0,
                close: 110.0,
                volume: 0,
            },
        ];
        let r = compute_total_return(&bars);
        // ln(1.1) ≈ 0.0953101798
        assert!((r - 0.0953101798).abs() < 1e-9);
    }
}
