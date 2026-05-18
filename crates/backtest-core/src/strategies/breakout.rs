//! Donchian-style breakout.
//!
//! Long when today's close is at or above the rolling high of the
//! prior `lookback` bars; flat otherwise. This is the simplest version
//! of the "trade the new high" idea Richard Donchian popularized in
//! the 1960s and that Richard Dennis later codified for the Turtle
//! Traders in the 1980s.
//!
//! ## Implementation notes
//!
//! - The lookback window excludes the current bar: `bars[i - lookback..i]`.
//!   Including the current bar would let it set its own breakout
//!   threshold (a self-fulfilling no-op).
//! - We compare against the rolling *high*, not the rolling close,
//!   because the breakout idea is "today's close exceeds the historical
//!   ceiling". A series of doji bars with high == close == low collapses
//!   to "close exceeds prior high", which is the same thing.

use serde::{Deserialize, Serialize};

use crate::bars::DailyBar;
use crate::error::BacktestError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Params {
    /// Number of prior bars to compute the rolling high over. Must be
    /// at least 2 (a 1-bar lookback degenerates to "today closes above
    /// yesterday's high" which is a single-bar momentum signal, not a
    /// breakout).
    pub lookback: usize,
}

pub fn positions(bars: &[DailyBar], params: &Params) -> Result<Vec<f64>, BacktestError> {
    if params.lookback < 2 {
        return Err(BacktestError::InvalidParam {
            name: "lookback".into(),
            message: "must be at least 2".into(),
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
        let window_high = bars[i - params.lookback..i]
            .iter()
            .map(|b| b.high)
            .fold(f64::NEG_INFINITY, f64::max);
        if bars[i].close >= window_high {
            positions[i] = 1.0;
        }
    }
    Ok(positions)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_when_close_breaks_above_rolling_high() {
        let mut bars: Vec<DailyBar> = (0..20)
            .map(|i| DailyBar::flat(format!("d{i}"), 100.0))
            .collect();
        // The 15th bar pokes its high up to 105 but closes at 100.
        bars[15].high = 105.0;
        bars[15].close = 100.0;
        // The 16th bar closes at 110, breaking above the 105 prior high.
        bars[16].close = 110.0;
        bars[16].high = 110.0;
        let p = positions(&bars, &Params { lookback: 10 }).unwrap();
        assert_eq!(p[16], 1.0);
    }

    #[test]
    fn flat_when_no_breakout() {
        // All bars at the same level — never breaks above the prior
        // high (which equals the current close, but the strategy is
        // a strict-greater-or-equal so we get 1.0 from bar `lookback`
        // onward whenever close == window_high. Use a slightly
        // declining series to be sure.
        let bars: Vec<DailyBar> = (0..20)
            .map(|i| DailyBar::flat(format!("d{i}"), 100.0 - i as f64 * 0.1))
            .collect();
        let p = positions(&bars, &Params { lookback: 5 }).unwrap();
        for i in 5..20 {
            assert_eq!(p[i], 0.0, "expected flat at bar {i}");
        }
    }

    #[test]
    fn rejects_lookback_one() {
        let bars = vec![DailyBar::flat("d", 100.0); 20];
        let r = positions(&bars, &Params { lookback: 1 });
        assert!(matches!(r, Err(BacktestError::InvalidParam { .. })));
    }
}
