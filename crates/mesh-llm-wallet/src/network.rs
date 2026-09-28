//! Which Bitcoin network paid inference runs on.
//!
//! Mainnet, always, unless the operator sets [`REGTEST_ENV`] to `1`. That
//! switch is for tests and demos with no real funds: it makes regtest the
//! ONLY accepted network (invoices and wallets alike), so a test invoice can
//! never reach a real wallet and a real invoice never reaches a test one.

/// Set to `1` to run paid inference on regtest (no real funds). Off by
/// default; any other value, or unset, is mainnet.
pub const REGTEST_ENV: &str = "MESH_LLM_PAYMENTS_REGTEST";

/// Whether the regtest switch is on for this process.
pub fn regtest_enabled() -> bool {
    std::env::var(REGTEST_ENV).is_ok_and(|value| value == "1")
}

/// The network name a wallet must report: `"regtest"` with the switch on,
/// else `"mainnet"`.
pub fn expected_network() -> &'static str {
    network_name(regtest_enabled())
}

pub(crate) fn network_name(regtest: bool) -> &'static str {
    if regtest { "regtest" } else { "mainnet" }
}

pub(crate) fn expected_currency(regtest: bool) -> lightning_invoice::Currency {
    if regtest {
        lightning_invoice::Currency::Regtest
    } else {
        lightning_invoice::Currency::Bitcoin
    }
}
