//! Buy and hold: always long, no parameters.
//!
//! This is the simplest possible strategy. It exists as the reference
//! benchmark every other strategy is judged against; if a more complex
//! strategy can't beat buy-and-hold on the same universe and date
//! range, the complexity is not earning its keep.

use crate::bars::DailyBar;
use crate::error::BacktestError;

/// Return a position vector of all 1.0 with the same length as `bars`.
/// Errors only if the bar series is empty.
pub fn positions(bars: &[DailyBar]) -> Result<Vec<f64>, BacktestError> {
    if bars.is_empty() {
        return Err(BacktestError::NotEnoughBars { required: 1, given: 0 });
    }
    Ok(vec![1.0; bars.len()])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_positions_are_one() {
        let bars = vec![
            DailyBar::flat("2026-01-02", 100.0),
            DailyBar::flat("2026-01-03", 110.0),
            DailyBar::flat("2026-01-04", 120.0),
        ];
        let p = positions(&bars).unwrap();
        assert_eq!(p, vec![1.0, 1.0, 1.0]);
    }

    #[test]
    fn empty_bars_errors() {
        let r = positions(&[]);
        assert!(matches!(r, Err(BacktestError::NotEnoughBars { required: 1, given: 0 })));
    }
}
