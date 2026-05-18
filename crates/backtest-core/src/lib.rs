//! Backtest math kernels for selectsectors.com.
//!
//! Compiled to WebAssembly via `wasm-pack build --target nodejs`. The
//! Netlify background function imports the JS glue produced by wasm-
//! pack (`pkg/backtest_core.js`) and calls [`run_backtest`] with the
//! strategy params and the daily-bar history pulled from Supabase.
//!
//! ## Module map
//!
//! - [`bars`]: the input bar type, mirroring the Supabase rows we read.
//! - [`metrics`]: pure functions over returns and equity series
//!   (Sharpe, drawdown, hit rate, CAGR).
//! - [`strategies`]: the strategy library. Each strategy lives in its
//!   own submodule and implements `positions(bars, params) -> Vec<f64>`.
//!   [`strategies::StrategyKind`] is the JSON-tagged enum used for
//!   dispatch from the JS side.
//! - [`error`]: error types returned from any failing path.
//!
//! ## Two entry points
//!
//! - [`run_backtest_inner`]: a pure-Rust function. Useful in tests and
//!   any pure-Rust caller (the desktop backtester might link to this
//!   crate directly later).
//! - [`run_backtest`]: the `#[wasm_bindgen]` entry point that takes a
//!   JS value, deserializes it into [`BacktestInputs`], runs the inner
//!   function, and serializes the result back. Errors are stringified
//!   into `JsValue` so the JS caller sees a useful message.

pub mod bars;
pub mod error;
pub mod metrics;
pub mod strategies;

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::bars::DailyBar;
use crate::error::BacktestError;
use crate::strategies::{apply_positions_to_bars, StrategyKind};

#[derive(Debug, Deserialize)]
pub struct BacktestInputs {
    pub symbol: String,
    pub bars: Vec<DailyBar>,
    pub strategy: StrategyKind,
}

#[derive(Debug, Serialize)]
pub struct EquityPoint {
    pub date: String,
    pub ret: f64,
    pub equity: f64,
}

#[derive(Debug, Serialize)]
pub struct BacktestResult {
    pub symbol: String,
    pub strategy: String,
    pub n_bars: usize,
    pub first_date: String,
    pub last_date: String,
    pub total_return: f64,
    pub annualized_return: f64,
    pub sharpe: f64,
    pub max_drawdown: f64,
    pub hit_rate: f64,
    pub equity_curve: Vec<EquityPoint>,
}

/// Pure-Rust entry point. Used by the unit tests below and by the
/// `#[wasm_bindgen]` entry point.
pub fn run_backtest_inner(inputs: BacktestInputs) -> Result<BacktestResult, BacktestError> {
    if inputs.bars.len() < 2 {
        return Err(BacktestError::NotEnoughBars {
            required: 2,
            given: inputs.bars.len(),
        });
    }
    let strategy_name = inputs.strategy.name();
    let positions = inputs.strategy.positions(&inputs.bars)?;
    let returns = apply_positions_to_bars(&inputs.bars, &positions);

    let equity = metrics::equity_curve(&returns);
    let equity_curve: Vec<EquityPoint> = returns
        .iter()
        .zip(equity.iter())
        .enumerate()
        .map(|(i, (&ret, &eq))| EquityPoint {
            date: inputs.bars[i + 1].date.clone(),
            ret,
            equity: eq,
        })
        .collect();

    Ok(BacktestResult {
        symbol: inputs.symbol,
        strategy: strategy_name.to_string(),
        n_bars: inputs.bars.len(),
        first_date: inputs.bars[0].date.clone(),
        last_date: inputs.bars[inputs.bars.len() - 1].date.clone(),
        total_return: metrics::total_return(&returns),
        annualized_return: metrics::cagr(&returns),
        sharpe: metrics::annualized_sharpe(&returns),
        max_drawdown: metrics::max_drawdown(&equity),
        hit_rate: metrics::hit_rate(&returns),
        equity_curve,
    })
}

/// WASM entry point. Marshals input via `serde-wasm-bindgen` so the JS
/// side just passes a plain object matching [`BacktestInputs`].
#[wasm_bindgen]
pub fn run_backtest(input: JsValue) -> Result<JsValue, JsValue> {
    let inputs: BacktestInputs = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("bad input: {e}")))?;
    let result = run_backtest_inner(inputs).map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsValue::from_str(&format!("serialize: {e}")))
}

/// List of strategy names this WASM module knows about. Useful so the
/// frontend's strategy picker doesn't hardcode the list.
#[wasm_bindgen]
pub fn strategy_catalog() -> JsValue {
    let names = vec![
        "buy_and_hold",
        "sma_crossover",
        "rsi_meanreversion",
        "momentum",
        "breakout",
    ];
    serde_wasm_bindgen::to_value(&names).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::strategies::{momentum, rsi_meanreversion, sma_crossover};

    fn rising_bars(n: usize) -> Vec<DailyBar> {
        (0..n)
            .map(|i| {
                DailyBar::flat(format!("2026-01-{:02}", (i % 28) + 1), 100.0 + i as f64)
            })
            .collect()
    }

    #[test]
    fn buy_and_hold_on_rising_market_has_positive_return() {
        let bars = rising_bars(20);
        let inputs = BacktestInputs {
            symbol: "TEST".to_string(),
            bars,
            strategy: StrategyKind::BuyAndHold,
        };
        let r = run_backtest_inner(inputs).unwrap();
        assert!(r.total_return > 0.0);
        assert_eq!(r.n_bars, 20);
        assert_eq!(r.strategy, "buy_and_hold");
        assert_eq!(r.equity_curve.len(), 19);
    }

    #[test]
    fn sma_crossover_runs_on_rising_market() {
        let bars = rising_bars(50);
        let inputs = BacktestInputs {
            symbol: "TEST".to_string(),
            bars,
            strategy: StrategyKind::SmaCrossover(sma_crossover::Params { fast: 5, slow: 20 }),
        };
        let r = run_backtest_inner(inputs).unwrap();
        // Strictly rising prices and fast > slow from bar 19 onward
        // means the strategy is long for most of the series; total
        // return should be non-negative.
        assert!(r.total_return >= 0.0);
        assert_eq!(r.strategy, "sma_crossover");
    }

    #[test]
    fn momentum_runs_on_rising_market() {
        let bars = rising_bars(30);
        let inputs = BacktestInputs {
            symbol: "TEST".to_string(),
            bars,
            strategy: StrategyKind::Momentum(momentum::Params { lookback: 5 }),
        };
        let r = run_backtest_inner(inputs).unwrap();
        assert!(r.total_return > 0.0);
    }

    #[test]
    fn rsi_runs_on_rising_market() {
        let bars = rising_bars(40);
        let inputs = BacktestInputs {
            symbol: "TEST".to_string(),
            bars,
            strategy: StrategyKind::RsiMeanReversion(rsi_meanreversion::Params {
                period: 14,
                oversold: 30.0,
                overbought: 70.0,
            }),
        };
        // RSI mean-reversion on a pure uptrend never enters (RSI stays
        // at 100), so total return should be exactly zero (no exposure
        // ever realized).
        let r = run_backtest_inner(inputs).unwrap();
        assert_eq!(r.total_return, 0.0);
    }

    #[test]
    fn strategy_kind_serializes_as_externally_tagged() {
        let k = StrategyKind::SmaCrossover(sma_crossover::Params { fast: 5, slow: 20 });
        let json = serde_json::to_string(&k).unwrap();
        assert!(json.contains("\"sma_crossover\""));
        assert!(json.contains("\"fast\":5"));
        assert!(json.contains("\"slow\":20"));
    }
}
