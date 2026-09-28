use anyhow::{Context, Result, ensure};
use lightning_invoice::Bolt11Invoice;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Serializable invoice information. Always reparse `bolt11` at a trust boundary;
/// peer-supplied hashes, amounts, and expiry fields are not authoritative.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "plugin-server", derive(schemars::JsonSchema))]
pub struct Invoice {
    pub bolt11: String,
    pub payment_hash: String,
    pub payee: String,
    pub amount_msat: Option<u64>,
    pub expires_at_ms: u64,
}

impl Invoice {
    /// Parse and check an invoice for the network this process runs on
    /// ([`crate::network`]): mainnet, or regtest only with the test switch.
    pub fn parse(bolt11: &str) -> Result<Self> {
        Self::parse_for(bolt11, crate::network::regtest_enabled())
    }

    pub(crate) fn parse_for(bolt11: &str, regtest: bool) -> Result<Self> {
        let parsed: Bolt11Invoice = bolt11.parse().context("invalid BOLT11 invoice")?;
        ensure!(
            parsed.currency() == crate::network::expected_currency(regtest),
            "{} invoice required",
            crate::network::network_name(regtest)
        );
        let expires_at_ms = parsed
            .expires_at()
            .context("invoice expiry overflow")?
            .as_millis()
            .try_into()
            .context("invoice expiry overflow")?;
        Ok(Self {
            bolt11: bolt11.to_owned(),
            payment_hash: parsed.payment_hash().to_string(),
            payee: parsed.recover_payee_pub_key().to_string(),
            amount_msat: parsed.amount_milli_satoshis(),
            expires_at_ms,
        })
    }

    pub fn validate_payment(&self, amount_msat: u64, now_ms: u64) -> Result<()> {
        self.validate_payment_for(amount_msat, now_ms, crate::network::regtest_enabled())
    }

    pub(crate) fn validate_payment_for(
        &self,
        amount_msat: u64,
        now_ms: u64,
        regtest: bool,
    ) -> Result<()> {
        ensure!(
            *self == Self::parse_for(&self.bolt11, regtest)?,
            "invoice metadata mismatch"
        );
        ensure!(self.expires_at_ms > now_ms, "invoice has expired");
        ensure!(amount_msat > 0, "payment amount must be positive");
        ensure!(
            self.amount_msat.is_none_or(|amount| amount == amount_msat),
            "invoice amount mismatch"
        );
        Ok(())
    }

    pub fn verifies_preimage(&self, preimage: &[u8; 32]) -> bool {
        hex::encode(Sha256::digest(preimage)) == self.payment_hash
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use bitcoin::secp256k1::{Secp256k1, SecretKey};
    use lightning_invoice::{Currency, InvoiceBuilder, PaymentHash, PaymentSecret};

    /// A signed mainnet test invoice. Shared with other in-crate tests.
    pub(crate) fn sample_invoice(number: u8, amount_msat: u64) -> Invoice {
        let secret = SecretKey::from_slice(&[7; 32]).unwrap();
        let bolt11 = InvoiceBuilder::new(Currency::Bitcoin)
            .description("test".into())
            .payment_hash(PaymentHash([number; 32]))
            .payment_secret(PaymentSecret([42; 32]))
            .current_timestamp()
            .expiry_time(std::time::Duration::from_secs(3600))
            .min_final_cltv_expiry_delta(144)
            .amount_milli_satoshis(amount_msat)
            .build_signed(|hash| Secp256k1::new().sign_ecdsa_recoverable(hash, &secret))
            .unwrap()
            .to_string();
        Invoice::parse(&bolt11).unwrap()
    }

    #[test]
    fn parse_round_trips_metadata() {
        let invoice = sample_invoice(3, 5000);
        assert_eq!(invoice.amount_msat, Some(5000));
        assert_eq!(invoice.payment_hash, hex::encode([3u8; 32]));
        assert!(invoice.validate_payment(5000, crate::now_ms()).is_ok());
        assert!(invoice.validate_payment(4999, crate::now_ms()).is_err());
    }

    /// The regtest switch is exclusive: with it off only mainnet parses, with
    /// it on only regtest does.
    #[test]
    fn each_network_accepts_only_its_own_invoices() {
        let mainnet = sample_invoice(5, 1000).bolt11;
        let secret = SecretKey::from_slice(&[7; 32]).unwrap();
        let regtest = InvoiceBuilder::new(Currency::Regtest)
            .description("test".into())
            .payment_hash(PaymentHash([6; 32]))
            .payment_secret(PaymentSecret([42; 32]))
            .current_timestamp()
            .expiry_time(std::time::Duration::from_secs(3600))
            .min_final_cltv_expiry_delta(144)
            .amount_milli_satoshis(1000)
            .build_signed(|hash| Secp256k1::new().sign_ecdsa_recoverable(hash, &secret))
            .unwrap()
            .to_string();
        assert!(Invoice::parse_for(&mainnet, false).is_ok());
        assert!(Invoice::parse_for(&regtest, false).is_err());
        assert!(Invoice::parse_for(&regtest, true).is_ok());
        assert!(Invoice::parse_for(&mainnet, true).is_err());
    }

    #[test]
    fn tampered_metadata_is_rejected() {
        let mut invoice = sample_invoice(4, 1000);
        invoice.amount_msat = Some(1);
        assert!(invoice.validate_payment(1, crate::now_ms()).is_err());
    }
}
