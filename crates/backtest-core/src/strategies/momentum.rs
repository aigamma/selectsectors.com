//! Time-series momentum.
//!
//! Long when today's close is above the close `lookback` bars ago;
//! flat otherwise. Cheap to compute and surprisingly competitive at
//! horizons in the 60-250-bar range on equity index series — the
//! oldest documented "factor" in modern finance.

use serde::{Deserialize, Serialize};

use crate::bars::DailyBar;
use crate::error::BacktestError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Params {
    /// Number of bars to look back. The position at bar `i` is long if
    /// `close[i] > close[i - lookback]`, flat otherwise.
    pub lookback: usize,
}

pub fn positions(bars: &[DailyBar], params: &Params) -> Result<Vec<f64>, BacktestError> {
    if params.lookback == 0 {
        return Err(BacktestError::InvalidParam {
            name: "lookback".into(),
            message: "must be a positive integer".into(),
        });
    }
    if bars.len() <= params.lookback {
        return Err(BacktestError::NotEnoughBars {
            required: params.lookback + 1,
            given: bars.len(),
        });
    }

    let mut positions = vec![0.0; bars.len()];
    for i in params.lookback..bars.len() {
        if bars[i].close > bars[i - params.lookback].close {
            positions[i] = 1.0;
        }
    }
    Ok(positions)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_on_uptrend() {
        let bars: Vec<DailyBar> = (0..30)
            .map(|i| DailyBar::flat(format!("d{i}"), 100.0 + i as f64))
            .collect();
        let p = positions(&bars, &Params { lookback: 5 }).unwrap();
        for i in 0..5 {
            assert_eq!(p[i], 0.0, "expected pre-window bar {i} to be flat");
        }
        for i in 5..30 {
            assert_eq!(p[i], 1.0, "expected uptrend bar {i} to be long");
        }
    }

    #[test]
    fn flat_on_downtrend() {
        let bars: Vec<DailyBar> = (0..30)
            .map(|i| DailyBar::flat(format!("d{i}"), 130.0 - i as f64))
            .collect();
        let p = positions(&bars, &Params { lookback: 5 }).unwrap();
        for i in 5..30 {
            assert_eq!(p[i], 0.0, "expected downtrend bar {i} to be flat");
        }
    }

    #[test]
    fn rejects_zero_lookback() {
        let bars = vec![DailyBar::flat("d", 100.0); 30];
        let r = positions(&bars, &Params { lookback: 0 });
        assert!(matches!(r, Err(BacktestError::InvalidParam { .. })));
    }
}
