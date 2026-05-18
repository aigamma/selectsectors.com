//! Performance metrics computed over a returns series or an equity curve.
//!
//! Every metric here is a pure function of a `&[f64]`. No I/O, no
//! allocation in the hot path. The equity-curve constructor is the
//! only function that allocates, because it has to produce a new vec
//! the caller can keep.
//!
//! ## Annualization
//!
//! Every annualization here assumes a daily-bar series with 252
//! trading days per year. If the data plane ever moves to weekly or
//! monthly bars, the annualization factor needs to change at the call
//! site — there is no flag here to override it because the entire data
//! plane the crate is invoked against is currently daily-only.
//!
//! ## Why no risk-free rate adjustment in Sharpe?
//!
//! The conventional Sharpe formula subtracts a risk-free rate from the
//! mean return before dividing by std dev. We omit that adjustment
//! here because (a) the SOFR-equivalent series is not in our Supabase
//! and (b) for the strategy comparisons this site does, the rf rate
//! is the same constant across every comparison, so subtracting it
//! doesn't change relative rankings. The day we add a "compare to T-
//! bills" feature, we revisit this.

/// US trading days per year. Used to annualize daily Sharpe and to
/// compute CAGR from a daily-bar return series.
pub const TRADING_DAYS_PER_YEAR: f64 = 252.0;

/// Arithmetic mean. Returns 0.0 on an empty slice; that's the
/// degenerate-but-sane answer for our use case where a zero-length
/// strategy degenerates to a zero result.
pub fn mean(xs: &[f64]) -> f64 {
    if xs.is_empty() {
        return 0.0;
    }
    xs.iter().sum::<f64>() / xs.len() as f64
}

/// Sample standard deviation (Bessel's correction: divides by n-1).
/// Returns 0.0 for slices shorter than 2.
pub fn std_dev(xs: &[f64]) -> f64 {
    if xs.len() < 2 {
        return 0.0;
    }
    let m = mean(xs);
    let sum_sq: f64 = xs.iter().map(|x| (x - m).powi(2)).sum();
    (sum_sq / (xs.len() - 1) as f64).sqrt()
}

/// Annualized Sharpe ratio for a daily-bar returns series. No risk-
/// free rate adjustment (see module docs).
pub fn annualized_sharpe(returns: &[f64]) -> f64 {
    let s = std_dev(returns);
    if s == 0.0 {
        return 0.0;
    }
    (mean(returns) / s) * TRADING_DAYS_PER_YEAR.sqrt()
}

/// Maximum peak-to-trough drawdown as a positive fraction. 0.20 means
/// the curve fell 20% from its running peak at the worst point.
pub fn max_drawdown(equity: &[f64]) -> f64 {
    let Some(&first) = equity.first() else {
        return 0.0;
    };
    let mut peak = first;
    let mut max_dd = 0.0_f64;
    for &v in equity {
        if v > peak {
            peak = v;
        }
        if peak > 0.0 {
            let dd = (peak - v) / peak;
            if dd > max_dd {
                max_dd = dd;
            }
        }
    }
    max_dd
}

/// Hit rate: fraction of returns that are strictly positive.
pub fn hit_rate(returns: &[f64]) -> f64 {
    if returns.is_empty() {
        return 0.0;
    }
    let wins = returns.iter().filter(|&&r| r > 0.0).count();
    wins as f64 / returns.len() as f64
}

/// Equity curve from a returns series, starting at 1.0. The output
/// has the same length as the input.
pub fn equity_curve(returns: &[f64]) -> Vec<f64> {
    let mut out = Vec::with_capacity(returns.len());
    let mut eq = 1.0_f64;
    for &r in returns {
        eq *= 1.0 + r;
        out.push(eq);
    }
    out
}

/// Total cumulative return: product of (1 + r_i) minus 1.
pub fn total_return(returns: &[f64]) -> f64 {
    returns.iter().fold(1.0, |acc, r| acc * (1.0 + r)) - 1.0
}

/// CAGR (compound annual growth rate) for a daily-bar return series.
/// Returns 0.0 if the series spans less than one bar.
pub fn cagr(returns: &[f64]) -> f64 {
    if returns.is_empty() {
        return 0.0;
    }
    let total = total_return(returns);
    let years = returns.len() as f64 / TRADING_DAYS_PER_YEAR;
    if years <= 0.0 {
        return 0.0;
    }
    (1.0 + total).powf(1.0 / years) - 1.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mean_of_empty_is_zero() {
        assert_eq!(mean(&[]), 0.0);
    }

    #[test]
    fn mean_of_three_equal_values_is_the_value() {
        assert_eq!(mean(&[7.0, 7.0, 7.0]), 7.0);
    }

    #[test]
    fn std_dev_of_one_value_is_zero() {
        assert_eq!(std_dev(&[42.0]), 0.0);
    }

    #[test]
    fn std_dev_of_simple_series() {
        // Series: 1, 2, 3, 4, 5. Mean = 3. Sample variance = ((4+1+0+1+4)/4) = 2.5.
        // Std = sqrt(2.5) ≈ 1.581139.
        let s = std_dev(&[1.0, 2.0, 3.0, 4.0, 5.0]);
        assert!((s - 1.5811388300841898).abs() < 1e-12);
    }

    #[test]
    fn max_drawdown_zero_on_monotone_equity() {
        let eq = vec![1.0, 1.1, 1.2, 1.3, 1.4];
        assert_eq!(max_drawdown(&eq), 0.0);
    }

    #[test]
    fn max_drawdown_finds_worst_dip() {
        // Rises to 2.0, falls to 1.0, recovers to 2.5. Worst DD is (2-1)/2 = 0.5.
        let eq = vec![1.0, 2.0, 1.5, 1.0, 2.5];
        assert!((max_drawdown(&eq) - 0.5).abs() < 1e-12);
    }

    #[test]
    fn hit_rate_zero_on_all_zero_or_negative_returns() {
        let r = vec![0.0, -0.01, -0.02, 0.0];
        assert_eq!(hit_rate(&r), 0.0);
    }

    #[test]
    fn hit_rate_half_when_alternating() {
        let r = vec![0.01, -0.01, 0.02, -0.02];
        assert_eq!(hit_rate(&r), 0.5);
    }

    #[test]
    fn equity_curve_compounds() {
        let r = vec![0.10, -0.05, 0.10];
        let eq = equity_curve(&r);
        assert!((eq[0] - 1.10).abs() < 1e-12);
        assert!((eq[1] - 1.10 * 0.95).abs() < 1e-12);
        assert!((eq[2] - 1.10 * 0.95 * 1.10).abs() < 1e-12);
    }

    #[test]
    fn total_return_matches_last_equity_minus_one() {
        let r = vec![0.10, -0.05, 0.10];
        let eq = equity_curve(&r);
        let tr = total_return(&r);
        assert!((tr - (eq.last().unwrap() - 1.0)).abs() < 1e-12);
    }

    #[test]
    fn annualized_sharpe_zero_on_all_zero_returns() {
        // A strategy that never enters any position produces a series
        // of zero returns. Sharpe should be 0.0 (not NaN, not infinity)
        // — the "never traded" case is the most common reason a sharpe
        // gets surfaced in practice and the function has to handle it
        // without panicking the result blob.
        let r = vec![0.0; 100];
        assert_eq!(annualized_sharpe(&r), 0.0);
    }

    #[test]
    fn annualized_sharpe_positive_on_consistent_positive_returns() {
        // A series of small varying gains gives a finite, positive
        // sharpe. The exact value depends on the noise pattern; we
        // only check that it is finite and strictly positive.
        let r: Vec<f64> = (0..100)
            .map(|i| 0.001 + 0.0005 * ((i as f64).sin()))
            .collect();
        let s = annualized_sharpe(&r);
        assert!(s.is_finite());
        assert!(s > 0.0, "expected positive sharpe, got {s}");
    }

    #[test]
    fn cagr_of_pure_one_year_double_is_100_percent() {
        // 252 bars each returning some fraction r such that (1+r)^252 = 2.
        // Then CAGR over exactly 1 year of bars should equal 1.0 (100%).
        let one_day_ret = 2.0_f64.powf(1.0 / 252.0) - 1.0;
        let returns = vec![one_day_ret; 252];
        let c = cagr(&returns);
        assert!((c - 1.0).abs() < 1e-9, "expected ~1.0, got {c}");
    }
}
