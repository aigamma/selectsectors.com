//! RSI (Relative Strength Index) mean reversion.
//!
//! Computes Wilder's RSI over a `period`-bar window. Enters long when
//! RSI is below `oversold`; exits to flat when RSI rises above
//! `overbought`. A "fade the dip" strategy that exploits short-term
//! oversold bounces in trending markets and tends to underperform
//! when the trend is broken (RSI dwells in the oversold zone while
//! prices continue to fall).
//!
//! ## Why Wilder's smoothing and not a simple moving average?
//!
//! The RSI formula has two widely-cited variants: Wilder's original
//! recurrence (an EMA-like smoothing of gains and losses with weight
//! 1/period) and a simple-moving-average variant where the average
//! gain and loss are just rolling SMAs of the recent gain and loss
//! series. We use Wilder's because it is the definition in his book
//! "New Concepts in Technical Trading Systems" (1978), and matches
//! the value most charting platforms display under the label "RSI".

use serde::{Deserialize, Serialize};

use crate::bars::DailyBar;
use crate::error::BacktestError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Params {
    /// RSI window length, in bars. Wilder originally suggested 14.
    pub period: usize,
    /// Enter-long threshold. RSI below this triggers entry. Typical
    /// values are 20-30.
    pub oversold: f64,
    /// Exit threshold. RSI above this triggers exit. Typical values
    /// are 65-80. Must be strictly greater than `oversold`.
    pub overbought: f64,
}

pub fn positions(bars: &[DailyBar], params: &Params) -> Result<Vec<f64>, BacktestError> {
    if params.period < 2 {
        return Err(BacktestError::InvalidParam {
            name: "period".into(),
            message: "must be at least 2".into(),
        });
    }
    if !(0.0..=100.0).contains(&params.oversold) {
        return Err(BacktestError::InvalidParam {
            name: "oversold".into(),
            message: "must be in [0, 100]".into(),
        });
    }
    if !(0.0..=100.0).contains(&params.overbought) {
        return Err(BacktestError::InvalidParam {
            name: "overbought".into(),
            message: "must be in [0, 100]".into(),
        });
    }
    if params.oversold >= params.overbought {
        return Err(BacktestError::InvalidParam {
            name: "oversold".into(),
            message: format!(
                "oversold ({}) must be strictly less than overbought ({})",
                params.oversold, params.overbought
            ),
        });
    }
    if bars.len() <= params.period {
        return Err(BacktestError::NotEnoughBars {
            required: params.period + 1,
            given: bars.len(),
        });
    }

    let closes: Vec<f64> = bars.iter().map(|b| b.close).collect();
    let rsi = wilder_rsi(&closes, params.period);

    let mut positions = vec![0.0; bars.len()];
    let mut in_position = false;
    for i in 0..bars.len() {
        if let Some(value) = rsi[i] {
            if !in_position && value < params.oversold {
                in_position = true;
            } else if in_position && value > params.overbought {
                in_position = false;
            }
        }
        positions[i] = if in_position { 1.0 } else { 0.0 };
    }
    Ok(positions)
}

/// Wilder's RSI over a `period`-bar window.
///
/// The recurrence (after seeding):
///   avg_gain_t = (avg_gain_{t-1} * (period - 1) + gain_t) / period
///   avg_loss_t = (avg_loss_{t-1} * (period - 1) + loss_t) / period
///   RS = avg_gain / avg_loss
///   RSI = 100 - 100 / (1 + RS)
///
/// Seed: the average of the first `period` gain/loss observations,
/// which matches the convention in most charting platforms.
pub(crate) fn wilder_rsi(closes: &[f64], period: usize) -> Vec<Option<f64>> {
    let n = closes.len();
    let mut out = vec![None; n];
    if n < period + 1 {
        return out;
    }
    let mut sum_gain = 0.0;
    let mut sum_loss = 0.0;
    for i in 1..=period {
        let diff = closes[i] - closes[i - 1];
        if diff >= 0.0 {
            sum_gain += diff;
        } else {
            sum_loss += -diff;
        }
    }
    let mut avg_gain = sum_gain / period as f64;
    let mut avg_loss = sum_loss / period as f64;
    out[period] = Some(rsi_from_avgs(avg_gain, avg_loss));

    let p_minus_1 = (period - 1) as f64;
    let p = period as f64;
    for i in (period + 1)..n {
        let diff = closes[i] - closes[i - 1];
        let gain = if diff > 0.0 { diff } else { 0.0 };
        let loss = if diff < 0.0 { -diff } else { 0.0 };
        avg_gain = (avg_gain * p_minus_1 + gain) / p;
        avg_loss = (avg_loss * p_minus_1 + loss) / p;
        out[i] = Some(rsi_from_avgs(avg_gain, avg_loss));
    }
    out
}

fn rsi_from_avgs(avg_gain: f64, avg_loss: f64) -> f64 {
    if avg_loss == 0.0 {
        return 100.0;
    }
    let rs = avg_gain / avg_loss;
    100.0 - 100.0 / (1.0 + rs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rsi_at_100_on_pure_uptrend() {
        let closes: Vec<f64> = (1..=20).map(|i| i as f64).collect();
        let rsi = wilder_rsi(&closes, 14);
        assert_eq!(rsi[14], Some(100.0));
    }

    #[test]
    fn rsi_at_zero_on_pure_downtrend() {
        let closes: Vec<f64> = (1..=20).rev().map(|i| i as f64).collect();
        let rsi = wilder_rsi(&closes, 14);
        assert_eq!(rsi[14], Some(0.0));
    }

    #[test]
    fn rejects_inverted_thresholds() {
        let bars = vec![DailyBar::flat("d", 100.0); 30];
        let r = positions(
            &bars,
            &Params { period: 14, oversold: 70.0, overbought: 30.0 },
        );
        assert!(matches!(r, Err(BacktestError::InvalidParam { .. })));
    }

    #[test]
    fn rejects_short_series() {
        let bars = vec![DailyBar::flat("d", 100.0); 10];
        let r = positions(
            &bars,
            &Params { period: 14, oversold: 30.0, overbought: 70.0 },
        );
        assert!(matches!(
            r,
            Err(BacktestError::NotEnoughBars { required: 15, given: 10 })
        ));
    }
}
