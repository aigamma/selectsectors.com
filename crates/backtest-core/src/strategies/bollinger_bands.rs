//! Bollinger Bands mean reversion.
//!
//! Computes a rolling SMA and rolling standard deviation of close
//! prices over a `period`-bar window. Constructs the lower band at
//! `SMA - k * std` and the upper band at `SMA + k * std`. Enters long
//! when the close drops below the lower band; exits to flat when the
//! close rises back above the SMA (the centerline).
//!
//! Complement to the RSI mean reversion strategy in this crate. Both
//! fade short-term dips, but they read "oversold" differently: RSI
//! uses the gain-vs-loss balance; Bollinger uses the price-vs-mean
//! distance in units of standard deviation. The two signals overlap
//! in most regimes but diverge meaningfully on noisy series where
//! gain/loss balance is volatile but price dispersion is not (or vice
//! versa).
//!
//! ## Centerline exit, not upper-band exit
//!
//! The strategy exits at the SMA rather than waiting for the upper
//! band because the upper-band exit is much rarer (the bounce has to
//! travel ~2 standard deviations from oversold to overbought) and
//! the in-between period spends most of its time in choppy
//! drawdown. The SMA exit takes the easier half of the bounce; the
//! trade-off is leaving the upper-tail asymmetry on the table.
//! Alternative exit rules are a parameter the strategy could expose
//! in a future revision.
//!
//! ## Standard deviation: population, not sample
//!
//! The std calculation divides by `period`, not `period - 1`. Bollinger
//! Bands historically use the population formula; John Bollinger's
//! own description in Bollinger on Bollinger Bands uses N rather
//! than N-1. This matches what charting platforms render.

use serde::{Deserialize, Serialize};

use crate::bars::DailyBar;
use crate::error::BacktestError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Params {
    /// Rolling-window length in bars. Bollinger's original
    /// recommendation is 20.
    pub period: usize,
    /// Number of standard deviations from the SMA to draw the
    /// bands. Bollinger's original recommendation is 2.0.
    pub k: f64,
}

pub fn positions(bars: &[DailyBar], params: &Params) -> Result<Vec<f64>, BacktestError> {
    if params.period < 2 {
        return Err(BacktestError::InvalidParam {
            name: "period".into(),
            message: "must be at least 2".into(),
        });
    }
    if !params.k.is_finite() || params.k <= 0.0 {
        return Err(BacktestError::InvalidParam {
            name: "k".into(),
            message: "must be a positive finite number".into(),
        });
    }
    if bars.len() < params.period {
        return Err(BacktestError::NotEnoughBars {
            required: params.period,
            given: bars.len(),
        });
    }

    let closes: Vec<f64> = bars.iter().map(|b| b.close).collect();
    let p = params.period as f64;

    let mut positions = vec![0.0; bars.len()];
    let mut in_position = false;

    for i in (params.period - 1)..bars.len() {
        // i+1-period rather than i-period+1 because usize would
        // underflow on the i-period subtract for the first valid i.
        let window = &closes[(i + 1 - params.period)..=i];
        let mean = window.iter().sum::<f64>() / p;
        let variance = window.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / p;
        let std = variance.sqrt();
        let lower = mean - params.k * std;

        if !in_position && closes[i] < lower {
            in_position = true;
        } else if in_position && closes[i] > mean {
            in_position = false;
        }
        positions[i] = if in_position { 1.0 } else { 0.0 };
    }
    Ok(positions)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_period_one() {
        let bars = vec![DailyBar::flat("d", 100.0); 30];
        let r = positions(&bars, &Params { period: 1, k: 2.0 });
        assert!(matches!(r, Err(BacktestError::InvalidParam { .. })));
    }

    #[test]
    fn rejects_negative_k() {
        let bars = vec![DailyBar::flat("d", 100.0); 30];
        let r = positions(&bars, &Params { period: 20, k: -1.0 });
        assert!(matches!(r, Err(BacktestError::InvalidParam { .. })));
    }

    #[test]
    fn rejects_too_few_bars() {
        let bars = vec![DailyBar::flat("d", 100.0); 10];
        let r = positions(&bars, &Params { period: 20, k: 2.0 });
        assert!(matches!(
            r,
            Err(BacktestError::NotEnoughBars { required: 20, given: 10 })
        ));
    }

    #[test]
    fn flat_position_when_all_bars_equal() {
        // Constant-price series: std == 0, so close == lower band and
        // the strict-less-than entry never triggers. Position stays
        // 0.0 throughout.
        let bars = vec![DailyBar::flat("d", 100.0); 30];
        let p = positions(&bars, &Params { period: 20, k: 2.0 }).unwrap();
        assert!(p.iter().all(|&x| x == 0.0));
    }

    #[test]
    fn enters_long_on_band_breach_and_exits_at_mean() {
        // Build a series that's flat at 100 for the first 25 bars,
        // then drops sharply to 80 on bar 25 (well below the lower
        // band given the flat history), then climbs back through
        // the mean on subsequent bars.
        let mut bars: Vec<DailyBar> = (0..30)
            .map(|i| DailyBar::flat(format!("d{i}"), 100.0))
            .collect();
        bars[25].close = 80.0;
        bars[26].close = 85.0;
        bars[27].close = 92.0;
        bars[28].close = 99.0;
        bars[29].close = 105.0;
        let p = positions(&bars, &Params { period: 20, k: 2.0 }).unwrap();

        // Bar 25 closed below the lower band → enter long, so positions[25] = 1.0.
        assert_eq!(p[25], 1.0, "expected long entry at bar 25");
        // Bar 26 still below mean → stay long.
        assert_eq!(p[26], 1.0);
        // Bar 27, 28 still below mean (mean is now lower than 100 since recent bars dragged it down).
        // Bar 29 closes above the (now lower) mean → exit.
        assert_eq!(p[29], 0.0, "expected exit by bar 29");
    }
}
