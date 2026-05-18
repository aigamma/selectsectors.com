//! Error type returned by every fallible function in this crate.
//!
//! ## Why a hand-rolled enum instead of `thiserror`?
//!
//! The crate compiles to WebAssembly and ships inside a Netlify
//! function bundle. Every dependency costs bytes; `thiserror` would
//! add ~60 KB of expanded macro output for a four-variant enum that we
//! can write by hand in fifty lines. The trade-off shifts as the error
//! surface grows; if we ever pass ten variants, `thiserror` becomes
//! the right pick and this comment becomes the migration prompt.
//!
//! ## Why no `From<io::Error>` etc.?
//!
//! The WASM target has no filesystem, no network, no OS clock. All the
//! `std::io::Error` paths in normal Rust crates are dead code here. We
//! only need to represent errors that can actually arise inside a
//! purely-functional backtest: bad inputs, parameter violations, and
//! an unknown strategy name from the JS caller.

use std::fmt;

/// Every error a backtest run can return.
#[derive(Debug, Clone, PartialEq)]
pub enum BacktestError {
    /// The bar series is too short for the chosen strategy and parameters.
    /// For example, a 50-bar SMA needs at least 50 bars to compute the first value.
    NotEnoughBars { required: usize, given: usize },

    /// A parameter is outside its valid range.
    InvalidParam { name: String, message: String },

    /// The strategy name is not in the dispatch table. Only emitted from
    /// the JS-side deserializer; the Rust enum itself is exhaustive.
    UnknownStrategy(String),

    /// The input shape could not be deserialized.
    BadInput(String),
}

impl fmt::Display for BacktestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotEnoughBars { required, given } => write!(
                f,
                "not enough bars: strategy requires at least {required} but only {given} were provided"
            ),
            Self::InvalidParam { name, message } => {
                write!(f, "invalid parameter `{name}`: {message}")
            }
            Self::UnknownStrategy(name) => write!(f, "unknown strategy: `{name}`"),
            Self::BadInput(msg) => write!(f, "bad input: {msg}"),
        }
    }
}

impl std::error::Error for BacktestError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_reads_as_a_sentence() {
        let e = BacktestError::NotEnoughBars { required: 50, given: 12 };
        assert_eq!(
            e.to_string(),
            "not enough bars: strategy requires at least 50 but only 12 were provided"
        );
    }
}
