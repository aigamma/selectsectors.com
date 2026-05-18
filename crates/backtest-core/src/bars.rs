//! Daily OHLC bar type, mirroring the shape we read from Supabase.
//!
//! The bar type is the lingua franca of every strategy in this crate.
//! Every input to a backtest is a `&[DailyBar]`; every strategy reads
//! it and returns a position vector of the same length.
//!
//! Why `String` for the date and not `chrono::NaiveDate`? Two reasons:
//!
//! 1. **WASM bundle size.** `chrono` adds ~80 KB to the WASM artifact
//!    for a date type we only use for labeling output points on the
//!    equity curve. We never do date arithmetic inside the crate;
//!    the JS caller can do whatever parsing it likes on its side.
//! 2. **Round-trip transparency.** The JSON the JS caller sends and
//!    the JSON the Rust side returns both carry dates as ISO strings.
//!    Keeping the in-memory representation as `String` removes a layer
//!    of parse-then-format round-tripping.
//!
//! If the strategy library ever needs date arithmetic (e.g., to apply
//! a "skip Fridays" filter), that's the moment to switch to a typed
//! date and pay the dependency cost.

use serde::{Deserialize, Serialize};

/// A single end-of-day price bar.
///
/// SPX rows have `open == high == low == close` because the upstream
/// table (`daily_volatility_stats`) only stores the close. The
/// projection-into-flat-bar happens in the background function so the
/// Rust side never has to special-case SPX.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DailyBar {
    pub date: String,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    /// Volume in shares. SPX rows carry 0 here because the underlying
    /// table is index-only with no volume series; equity and ETF rows
    /// carry actual share counts.
    #[serde(default)]
    pub volume: u64,
}

impl DailyBar {
    /// Construct a bar with all four OHLC fields equal to `close`.
    /// Used in unit tests and in the SPX projection in the background
    /// function.
    pub fn flat(date: impl Into<String>, close: f64) -> Self {
        Self {
            date: date.into(),
            open: close,
            high: close,
            low: close,
            close,
            volume: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_sets_all_four_ohlc_fields_equal() {
        let b = DailyBar::flat("2026-01-02", 123.45);
        assert_eq!(b.open, 123.45);
        assert_eq!(b.high, 123.45);
        assert_eq!(b.low, 123.45);
        assert_eq!(b.close, 123.45);
        assert_eq!(b.volume, 0);
    }

    #[test]
    fn deserializes_volume_default_when_missing() {
        let json = r#"{"date":"2026-01-02","open":100,"high":101,"low":99,"close":100.5}"#;
        let b: DailyBar = serde_json::from_str(json).unwrap();
        assert_eq!(b.volume, 0);
    }
}
