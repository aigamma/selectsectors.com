//! Strategy library and dispatch.
//!
//! Each strategy lives in its own submodule and exposes a single
//! `positions(bars, params) -> Result<Vec<f64>, BacktestError>` function.
//! [`StrategyKind`] is the externally-tagged enum the JSON caller uses
//! to pick which strategy runs and pass its parameters.
//!
//! ## Position vector convention
//!
//! Every `positions` function returns a vector of the same length as
//! its input bar series. The value at index `i` is the strategy's
//! desired exposure as of the close of bar `i`:
//!
//! - `1.0` means fully long.
//! - `0.0` means flat (no exposure).
//! - `-1.0` means fully short. (None of the current strategies short.)
//!
//! ## No-lookahead guarantee
//!
//! The realized-return engine [`apply_positions_to_bars`] lags the
//! position vector by one bar before computing P&L: the exposure set
//! at the close of bar `i` is what earns the price change from bar
//! `i` to bar `i+1`. A strategy is free to look at bar `i`'s close
//! when deciding `positions[i]` (the close is realized at end-of-day,
//! after all), but it cannot reach forward to bar `i+1`'s price to
//! decide anything about exposure at bar `i`. This guarantee is
//! enforced at the engine level so individual strategies cannot
//! accidentally cheat.

pub mod bollinger_bands;
pub mod breakout;
pub mod buy_and_hold;
pub mod momentum;
pub mod rsi_meanreversion;
pub mod sma_crossover;

use serde::{Deserialize, Serialize};

use crate::bars::DailyBar;
use crate::error::BacktestError;

/// Per-strategy parameter envelope. The variant selects which strategy
/// runs; the inner payload carries strategy-specific settings.
///
/// Externally tagged serialization (the default for `serde` enums) so
/// the JSON wire format is e.g.:
///
/// ```json
/// { "sma_crossover": { "fast": 20, "slow": 50 } }
/// ```
///
/// or for parameter-free strategies:
///
/// ```json
/// "buy_and_hold"
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StrategyKind {
    BuyAndHold,
    SmaCrossover(sma_crossover::Params),
    RsiMeanReversion(rsi_meanreversion::Params),
    Momentum(momentum::Params),
    Breakout(breakout::Params),
    BollingerBands(bollinger_bands::Params),
}

impl StrategyKind {
    /// Canonical name for this strategy. Used in result blobs and in
    /// the frontend's strategy picker. Matches serde's rename_all
    /// = "snake_case" output exactly, so callers can use the name
    /// returned here as the dispatcher input without further
    /// transformation.
    pub fn name(&self) -> &'static str {
        match self {
            Self::BuyAndHold => "buy_and_hold",
            Self::SmaCrossover(_) => "sma_crossover",
            Self::RsiMeanReversion(_) => "rsi_mean_reversion",
            Self::Momentum(_) => "momentum",
            Self::Breakout(_) => "breakout",
            Self::BollingerBands(_) => "bollinger_bands",
        }
    }

    /// Generate the position vector for the given bar series.
    pub fn positions(&self, bars: &[DailyBar]) -> Result<Vec<f64>, BacktestError> {
        match self {
            Self::BuyAndHold => buy_and_hold::positions(bars),
            Self::SmaCrossover(p) => sma_crossover::positions(bars, p),
            Self::RsiMeanReversion(p) => rsi_meanreversion::positions(bars, p),
            Self::Momentum(p) => momentum::positions(bars, p),
            Self::Breakout(p) => breakout::positions(bars, p),
            Self::BollingerBands(p) => bollinger_bands::positions(bars, p),
        }
    }
}

/// Apply a position vector to a bar series, producing daily realized
/// returns. The position at the close of bar `i` determines the
/// exposure during bar `i+1`. The output length is `bars.len() - 1`.
///
/// The lag-by-one is the source of the no-lookahead guarantee
/// described in the module docs.
pub fn apply_positions_to_bars(bars: &[DailyBar], positions: &[f64]) -> Vec<f64> {
    if bars.len() < 2 {
        return Vec::new();
    }
    let n = bars.len() - 1;
    let mut returns = Vec::with_capacity(n);
    for i in 1..bars.len() {
        let prev = bars[i - 1].close;
        let curr = bars[i].close;
        if prev <= 0.0 {
            returns.push(0.0);
            continue;
        }
        let bar_return = (curr - prev) / prev;
        let exposure = positions[i - 1];
        returns.push(exposure * bar_return);
    }
    returns
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_positions_lags_by_one_bar() {
        // Bars: 100 -> 110 -> 121. Returns: 0.10, 0.10.
        // Positions: 1.0 at bars 0..1, 0.0 at bar 2.
        // Realized returns are positions[i-1] * bar_return[i]:
        //   i=1: positions[0] * 0.10 = 0.10
        //   i=2: positions[1] * 0.10 = 0.10
        let bars = vec![
            DailyBar::flat("d0", 100.0),
            DailyBar::flat("d1", 110.0),
            DailyBar::flat("d2", 121.0),
        ];
        let positions = vec![1.0, 1.0, 0.0];
        let r = apply_positions_to_bars(&bars, &positions);
        assert_eq!(r.len(), 2);
        assert!((r[0] - 0.10).abs() < 1e-12);
        assert!((r[1] - 0.10).abs() < 1e-12);
    }

    #[test]
    fn apply_positions_returns_empty_for_too_short_bars() {
        let bars = vec![DailyBar::flat("d0", 100.0)];
        assert!(apply_positions_to_bars(&bars, &[1.0]).is_empty());
    }
}
