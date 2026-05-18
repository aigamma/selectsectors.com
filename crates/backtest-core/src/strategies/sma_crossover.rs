//! Simple moving average crossover.
//!
//! Long when the fast SMA is strictly above the slow SMA; flat
//! otherwise. The textbook trend-following signal and the easiest one
//! to reason about; useful as a stepping stone for understanding the
//! more involved strategies in this crate.
//!
//! ## Why a strictly-greater-than comparison?
//!
//! Two SMAs being exactly equal is degenerate (it happens at the
//! crossover moment itself) and biased only one way. We treat equality
//! as "not yet a long signal" so the position only flips after a clean
//! crossover. This is consistent with how the strategy is typically
//! documented in the academic literature.
//!
//! ## Numerical stability of the rolling-mean recurrence
//!
//! The implementation uses a sliding-window sum that adds the new bar
//! and subtracts the bar leaving the window each step. For 252-bar
//! windows on the closing prices we see (max ~5000 for SPX, max ~1000
//! for the equities), the running-sum precision loss is well below
//! 1e-9 relative error. If we ever extend to multi-thousand-bar
//! windows on series with very different magnitudes, recompute from
//! scratch on each step.

use serde::{Deserialize, Serialize};

use crate::bars::DailyBar;
use crate::error::BacktestError;

/// Two-window-length parameter set.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Params {
    /// Length of the fast SMA window, in bars.
    pub fast: usize,
    /// Length of the slow SMA window, in bars. Must be strictly
    /// greater than `fast`.
    pub slow: usize,
}

pub fn positions(bars: &[DailyBar], params: &Params) -> Result<Vec<f64>, BacktestError> {
    if params.fast == 0 || params.slow == 0 {
        return Err(BacktestError::InvalidParam {
            name: "fast/slow".into(),
            message: "must be positive integers".into(),
        });
    }
    if params.fast >= params.slow {
        return Err(BacktestError::InvalidParam {
            name: "fast".into(),
            message: format!(
                "fast ({}) must be strictly less than slow ({})",
                params.fast, params.slow
            ),
        });
    }
    if bars.len() < params.slow {
        return Err(BacktestError::NotEnoughBars {
            required: params.slow,
            given: bars.len(),
        });
    }

    let closes: Vec<f64> = bars.iter().map(|b| b.close).collect();
    let fast_sma = rolling_mean(&closes, params.fast);
    let slow_sma = rolling_mean(&closes, params.slow);

    let mut positions = Vec::with_capacity(bars.len());
    for i in 0..bars.len() {
        let signal = match (fast_sma[i], slow_sma[i]) {
            (Some(f), Some(s)) if f > s => 1.0,
            _ => 0.0,
        };
        positions.push(signal);
    }
    Ok(positions)
}

/// Sliding-window mean of length `n`. Returns a vec of `Option<f64>`
/// the same length as the input; the first `n-1` entries are `None`
/// because the window can't be filled yet.
pub(crate) fn rolling_mean(xs: &[f64], n: usize) -> Vec<Option<f64>> {
    let mut out = Vec::with_capacity(xs.len());
    let mut sum = 0.0;
    for (i, &x) in xs.iter().enumerate() {
        sum += x;
        if i >= n {
            sum -= xs[i - n];
        }
        if i + 1 >= n {
            out.push(Some(sum / n as f64));
        } else {
            out.push(None);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rolling_mean_three() {
        let xs = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let r = rolling_mean(&xs, 3);
        assert_eq!(r, vec![None, None, Some(2.0), Some(3.0), Some(4.0)]);
    }

    #[test]
    fn rejects_fast_greater_than_slow() {
        let bars = vec![DailyBar::flat("d", 100.0); 100];
        let r = positions(&bars, &Params { fast: 50, slow: 20 });
        assert!(matches!(r, Err(BacktestError::InvalidParam { .. })));
    }

    #[test]
    fn rejects_too_few_bars() {
        let bars = vec![DailyBar::flat("d", 100.0); 5];
        let r = positions(&bars, &Params { fast: 2, slow: 10 });
        assert!(matches!(
            r,
            Err(BacktestError::NotEnoughBars { required: 10, given: 5 })
        ));
    }

    #[test]
    fn crossover_signals_long_when_fast_above_slow() {
        let bars: Vec<DailyBar> = (0..20)
            .map(|i| DailyBar::flat(format!("d{i}"), 100.0 + i as f64))
            .collect();
        let p = positions(&bars, &Params { fast: 2, slow: 5 }).unwrap();
        assert_eq!(p.len(), 20);
        for i in 4..20 {
            assert_eq!(p[i], 1.0, "expected long at bar {i}");
        }
    }
}
