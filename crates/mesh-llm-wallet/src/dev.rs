//! A test wallet with no real funds.
//!
//! `wallet-dev` issues regtest BOLT11 invoices signed by a local node key and
//! settles them through a ledger DIRECTORY that every test node on the
//! machine shares ([`LEDGER_ENV`]). Nothing touches a Lightning network, and
//! the balance is a fixed test figure ([`START_BALANCE_MSAT`]) moved only by
//! the payments in that directory. It is for one-machine tests and demos of
//! the paid path, never for value.
//!
//! It refuses to open unless the regtest switch is on
//! ([`crate::network::REGTEST_ENV`]), and then reports network `regtest`,
//! which is the only network the host accepts in that mode.
//!
//! Ledger layout (JSON, one file per payment hash):
//! - `invoices/<hash>.json`: an invoice a dev wallet issued, with its payee.
//! - `payments/<hash>.json`: the payment of that invoice, created once
//!   (exclusive create), so two payers can never both settle it.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result, bail, ensure};
use async_trait::async_trait;
use bitcoin::secp256k1::{PublicKey, Secp256k1, SecretKey};
use lightning_invoice::{Currency, InvoiceBuilder, PaymentHash, PaymentSecret};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::backend::{OpenedWallet, WalletBackend};
use crate::contract::WalletIdentity;
use crate::invoice::Invoice;
use crate::provider::{Balance, PayError, PaymentStatus, Transaction, WalletProvider};

/// Plugin name the host launches this wallet under.
pub const PLUGIN_NAME: &str = "wallet-dev";

/// The directory the test nodes share as their payment ledger. Required.
pub const LEDGER_ENV: &str = "MESH_LLM_DEV_WALLET_LEDGER";

/// Every dev wallet starts with this test balance (100,000 sat).
pub const START_BALANCE_MSAT: u64 = 100_000_000;

const KEY_FILE: &str = "dev-node-key.hex";
const POLL: Duration = Duration::from_millis(250);

#[derive(Serialize, Deserialize)]
struct InvoiceEntry {
    bolt11: String,
    payee: String,
    amount_msat: Option<u64>,
    created_at_ms: u64,
}

#[derive(Serialize, Deserialize)]
struct PaymentEntry {
    payer: String,
    amount_msat: u64,
    settled_at_ms: u64,
}

pub struct DevBackend;

#[async_trait]
impl WalletBackend for DevBackend {
    fn provider_name(&self) -> &'static str {
        "dev"
    }

    async fn open(&self, directory: &Path) -> Result<OpenedWallet> {
        let ledger = std::env::var(LEDGER_ENV).ok().filter(|v| !v.is_empty());
        open_wallet(
            directory,
            crate::network::regtest_enabled(),
            ledger.map(PathBuf::from),
        )
    }
}

fn open_wallet(directory: &Path, regtest: bool, ledger: Option<PathBuf>) -> Result<OpenedWallet> {
    ensure!(
        regtest,
        "the dev wallet holds no real funds and opens only with {}=1",
        crate::network::REGTEST_ENV
    );
    let ledger =
        ledger.with_context(|| format!("{LEDGER_ENV} must name the shared ledger directory"))?;
    std::fs::create_dir_all(ledger.join("invoices"))?;
    std::fs::create_dir_all(ledger.join("payments"))?;
    std::fs::create_dir_all(directory)?;
    let (secret, created) = load_or_create_key(&directory.join(KEY_FILE))?;
    let wallet_id = PublicKey::from_secret_key(&Secp256k1::new(), &secret).to_string();
    Ok(OpenedWallet {
        identity: WalletIdentity {
            wallet_id: wallet_id.clone(),
            provider: "dev".into(),
            network: crate::network::network_name(true).into(),
        },
        provider: Arc::new(DevProvider {
            secret,
            wallet_id,
            ledger,
        }),
        created,
    })
}

fn random_32() -> Result<[u8; 32]> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|e| anyhow::anyhow!("no randomness: {e}"))?;
    Ok(bytes)
}

fn load_or_create_key(path: &Path) -> Result<(SecretKey, bool)> {
    if let Ok(text) = std::fs::read_to_string(path) {
        let bytes = hex::decode(text.trim()).context("dev wallet key is not hex")?;
        return Ok((
            SecretKey::from_slice(&bytes).context("dev wallet key")?,
            false,
        ));
    }
    let secret = SecretKey::from_slice(&random_32()?).context("dev wallet key")?;
    std::fs::write(path, hex::encode(secret.secret_bytes()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok((secret, true))
}

struct DevProvider {
    secret: SecretKey,
    wallet_id: String,
    ledger: PathBuf,
}

impl DevProvider {
    fn invoice_path(&self, hash: &str) -> PathBuf {
        self.ledger.join("invoices").join(format!("{hash}.json"))
    }

    fn payment_path(&self, hash: &str) -> PathBuf {
        self.ledger.join("payments").join(format!("{hash}.json"))
    }

    fn read_invoice(&self, hash: &str) -> Result<Option<InvoiceEntry>> {
        read_json(&self.invoice_path(hash))
    }

    fn read_payment(&self, hash: &str) -> Result<Option<PaymentEntry>> {
        read_json(&self.payment_path(hash))
    }

    /// This wallet's view of one payment hash, if it takes part in it.
    fn transaction(&self, hash: &str) -> Result<Option<Transaction>> {
        let invoice = self.read_invoice(hash)?;
        let payment = self.read_payment(hash)?;
        let ours_to_receive = invoice.as_ref().is_some_and(|i| i.payee == self.wallet_id);
        let tx = match (invoice, payment) {
            (Some(invoice), Some(payment)) if ours_to_receive => {
                Some(settled(hash, true, &payment, invoice.created_at_ms))
            }
            (_, Some(payment)) if payment.payer == self.wallet_id => {
                Some(settled(hash, false, &payment, payment.settled_at_ms))
            }
            (Some(invoice), None) if ours_to_receive => Some(Transaction {
                id: hash.to_string(),
                payment_hash: Some(hash.to_string()),
                inbound: true,
                amount_msat: invoice.amount_msat.unwrap_or(0),
                fee_msat: 0,
                status: PaymentStatus::Pending,
                claiming: false,
                status_msg: Some("invoice issued".into()),
                created_at_ms: invoice.created_at_ms,
                settled_at_ms: None,
            }),
            _ => None,
        };
        Ok(tx)
    }

    fn all_hashes(&self) -> Result<Vec<String>> {
        let mut hashes = Vec::new();
        for sub in ["invoices", "payments"] {
            for entry in std::fs::read_dir(self.ledger.join(sub))? {
                let name = entry?.file_name().to_string_lossy().into_owned();
                if let Some(hash) = name.strip_suffix(".json")
                    && !hashes.iter().any(|h| h == hash)
                {
                    hashes.push(hash.to_string());
                }
            }
        }
        Ok(hashes)
    }
}

fn settled(hash: &str, inbound: bool, payment: &PaymentEntry, created_at_ms: u64) -> Transaction {
    Transaction {
        id: hash.to_string(),
        payment_hash: Some(hash.to_string()),
        inbound,
        amount_msat: payment.amount_msat,
        fee_msat: 0,
        status: PaymentStatus::Succeeded,
        claiming: false,
        status_msg: Some("settled (dev wallet, no real funds)".into()),
        created_at_ms,
        settled_at_ms: Some(payment.settled_at_ms),
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<Option<T>> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(
            serde_json::from_slice(&bytes).with_context(|| format!("{}", path.display()))?,
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

/// Write a new file whole: to a temporary name, then renamed into place, so a
/// reader never sees half a record.
fn write_new_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let tmp = path.with_extension(format!("tmp-{}", hex::encode(random_32()?)));
    std::fs::write(&tmp, serde_json::to_vec(value)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[async_trait]
impl WalletProvider for DevProvider {
    async fn balance(&self) -> Result<Balance> {
        let mut spendable = START_BALANCE_MSAT;
        for hash in self.all_hashes()? {
            if let Some(tx) = self.transaction(&hash)?
                && tx.status == PaymentStatus::Succeeded
            {
                spendable = if tx.inbound {
                    spendable.saturating_add(tx.amount_msat)
                } else {
                    spendable.saturating_sub(tx.amount_msat)
                };
            }
        }
        Ok(Balance {
            spendable_msat: spendable,
        })
    }

    async fn transactions(&self, limit: usize) -> Result<Vec<Transaction>> {
        ensure!(
            (1..=1000).contains(&limit),
            "transaction limit must be between 1 and 1000"
        );
        let mut txs: Vec<Transaction> = self
            .all_hashes()?
            .iter()
            .filter_map(|hash| self.transaction(hash).transpose())
            .collect::<Result<_>>()?;
        txs.sort_by_key(|tx| std::cmp::Reverse(tx.created_at_ms));
        txs.truncate(limit);
        Ok(txs)
    }

    async fn create_invoice(&self, amount_msat: Option<u64>, expiry_secs: u32) -> Result<Invoice> {
        ensure!(
            amount_msat != Some(0),
            "zero amount invoice is not supported"
        );
        ensure!(expiry_secs > 0, "invoice expiry must be positive");
        let preimage = random_32()?;
        let hash: [u8; 32] = Sha256::digest(preimage).into();
        let builder = InvoiceBuilder::new(Currency::Regtest)
            .description("mesh-llm dev wallet (no real funds)".into())
            .payment_hash(PaymentHash(hash))
            .payment_secret(PaymentSecret(random_32()?))
            .current_timestamp()
            .expiry_time(Duration::from_secs(u64::from(expiry_secs)))
            .min_final_cltv_expiry_delta(144);
        let builder = match amount_msat {
            Some(amount) => builder.amount_milli_satoshis(amount),
            None => builder,
        };
        let bolt11 = builder
            .build_signed(|message| Secp256k1::new().sign_ecdsa_recoverable(message, &self.secret))
            .map_err(|e| anyhow::anyhow!("dev invoice: {e:?}"))?
            .to_string();
        let invoice = Invoice::parse_for(&bolt11, true)?;
        write_new_json(
            &self.invoice_path(&invoice.payment_hash),
            &InvoiceEntry {
                bolt11,
                payee: self.wallet_id.clone(),
                amount_msat,
                created_at_ms: crate::now_ms(),
            },
        )?;
        Ok(invoice)
    }

    async fn pay(
        &self,
        invoice: &Invoice,
        amount_msat: u64,
        max_total_msat: u64,
    ) -> Result<Transaction, PayError> {
        let hash = invoice.payment_hash.as_str();
        // A repeat is a lookup of the existing payment, never a second one.
        if let Some(payment) = self.read_payment(hash).map_err(PayError::NotSubmitted)? {
            if payment.payer == self.wallet_id {
                return Ok(settled(hash, false, &payment, payment.settled_at_ms));
            }
            return Err(PayError::NotSubmitted(anyhow::anyhow!(
                "this invoice was already paid by another wallet"
            )));
        }
        invoice
            .validate_payment_for(amount_msat, crate::now_ms(), true)
            .map_err(PayError::NotSubmitted)?;
        let not_submitted = |why: &str| Err(PayError::NotSubmitted(anyhow::anyhow!("{why}")));
        let Some(entry) = self.read_invoice(hash).map_err(PayError::NotSubmitted)? else {
            return not_submitted("no route: the shared dev ledger has no such invoice");
        };
        if entry.payee == self.wallet_id {
            return not_submitted("cannot pay this wallet's own invoice");
        }
        if amount_msat > max_total_msat {
            return not_submitted("payment exceeds the authorized amount");
        }
        if self
            .balance()
            .await
            .map_err(PayError::NotSubmitted)?
            .spendable_msat
            < amount_msat
        {
            return not_submitted("insufficient dev wallet balance");
        }
        let payment = PaymentEntry {
            payer: self.wallet_id.clone(),
            amount_msat,
            settled_at_ms: crate::now_ms(),
        };
        // Exclusive create: of two payers racing on one invoice, exactly one
        // settles it.
        let path = self.payment_path(hash);
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path);
        match file {
            Ok(file) => {
                serde_json::to_writer(file, &payment).map_err(|e| PayError::Uncertain(e.into()))?;
                Ok(settled(hash, false, &payment, payment.settled_at_ms))
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                // Someone settled it between our check and the create.
                self.pay(invoice, amount_msat, max_total_msat).await
            }
            Err(error) => Err(PayError::NotSubmitted(error.into())),
        }
    }

    async fn lookup(&self, payment_hash: &str) -> Result<Option<Transaction>> {
        self.transaction(payment_hash)
    }

    async fn wait_for_payment(&self, payment_hash: &str) -> Result<Transaction> {
        loop {
            if let Some(tx) = self.transaction(payment_hash)?
                && tx.status != PaymentStatus::Pending
            {
                return Ok(tx);
            }
            tokio::time::sleep(POLL).await;
        }
    }
}

/// Serve the dev wallet's `wallet.v1` capability, like `wallet-lexe`.
pub async fn run_plugin(name: String) -> Result<()> {
    if !crate::network::regtest_enabled() {
        bail!(
            "the dev wallet holds no real funds and runs only with {}=1",
            crate::network::REGTEST_ENV
        );
    }
    mesh_llm_plugin::PluginRuntime::run(crate::plugin_server::wallet_plugin(
        name,
        env!("CARGO_PKG_VERSION"),
        DevBackend,
    ))
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wallets() -> (tempfile::TempDir, DevProvider, DevProvider) {
        let dir = tempfile::tempdir().unwrap();
        let ledger = dir.path().join("ledger");
        let open = |node: &str| {
            let opened = open_wallet(&dir.path().join(node), true, Some(ledger.clone())).unwrap();
            assert_eq!(opened.identity.network, "regtest");
            let secret = load_or_create_key(&dir.path().join(node).join(KEY_FILE))
                .unwrap()
                .0;
            DevProvider {
                secret,
                wallet_id: opened.identity.wallet_id,
                ledger: ledger.clone(),
            }
        };
        let seller = open("seller");
        let buyer = open("buyer");
        (dir, seller, buyer)
    }

    #[test]
    fn the_dev_wallet_never_opens_without_the_regtest_switch() {
        let dir = tempfile::tempdir().unwrap();
        let error = open_wallet(dir.path(), false, Some(dir.path().join("l")))
            .err()
            .expect("refused");
        assert!(
            error.to_string().contains(crate::network::REGTEST_ENV),
            "{error}"
        );
        assert!(
            open_wallet(dir.path(), true, None).is_err(),
            "no shared ledger, no wallet"
        );
    }

    #[tokio::test]
    async fn one_paid_invoice_settles_on_both_sides_and_only_once() {
        let (_dir, seller, buyer) = wallets();
        let invoice = seller.create_invoice(Some(5_000), 600).await.unwrap();
        assert!(invoice.bolt11.starts_with("lnbcrt"), "a regtest invoice");
        let pending = seller.lookup(&invoice.payment_hash).await.unwrap().unwrap();
        assert_eq!(pending.status, PaymentStatus::Pending);
        assert!(pending.inbound);

        let paid = buyer.pay(&invoice, 5_000, 5_000).await.unwrap();
        assert_eq!(paid.status, PaymentStatus::Succeeded);
        assert!(!paid.inbound);
        // A repeat is the same payment, never a second debit.
        buyer.pay(&invoice, 5_000, 5_000).await.unwrap();

        let received = seller
            .wait_for_payment(&invoice.payment_hash)
            .await
            .unwrap();
        assert_eq!(received.status, PaymentStatus::Succeeded);
        assert!(received.inbound);
        assert_eq!(
            buyer.balance().await.unwrap().spendable_msat,
            START_BALANCE_MSAT - 5_000
        );
        assert_eq!(
            seller.balance().await.unwrap().spendable_msat,
            START_BALANCE_MSAT + 5_000
        );
        assert!(
            seller.pay(&invoice, 5_000, 5_000).await.is_err(),
            "own invoice"
        );
    }

    #[tokio::test]
    async fn a_payment_the_budget_does_not_cover_is_not_submitted() {
        let (_dir, seller, buyer) = wallets();
        let invoice = seller.create_invoice(Some(5_000), 600).await.unwrap();
        assert!(matches!(
            buyer.pay(&invoice, 5_000, 4_999).await,
            Err(PayError::NotSubmitted(_))
        ));
        assert!(buyer.lookup(&invoice.payment_hash).await.unwrap().is_none());
    }
}
