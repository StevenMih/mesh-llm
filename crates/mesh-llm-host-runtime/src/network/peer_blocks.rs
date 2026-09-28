//! Peers this node's operator chose to stop routing to.
//!
//! Local only, like `target_health`: never gossiped, never shared. A shared
//! blocklist would let any peer get an honest one excluded with fabricated
//! reports. A block lasts seven days or until the operator undoes it, and
//! survives a restart (`peer_blocks.json` in the identity state directory).
//!
//! Each block and unblock is also sealed as a record on this node's chain by
//! the capsule plugin (`mesh_local_routing_choice`). That record names the peer
//! only by [`peer_commitment`]; the salt is generated and kept here, before the
//! seal is asked for, so only this store can say which peer a record means, and
//! a seal whose answer never came back can still be matched later.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

use iroh::EndpointId;
use mesh_llm_routing::{InferenceTarget, ModelTargets};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const FILE_NAME: &str = "peer_blocks.json";
pub(crate) const TIMED_BLOCK_MS: u64 = 7 * 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RoutingChange {
    Block,
    Unblock,
}

/// How long a new block lasts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum BlockLength {
    SevenDays,
    UntilUndone,
}

/// The sealed record of one block or unblock, as the plugin returned it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct SealedChoice {
    pub(crate) capsule_id: String,
    pub(crate) peer_commitment: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ActiveBlock {
    pub(crate) blocked_at_ms: u64,
    /// `None` = until the operator undoes it.
    pub(crate) until_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ChoiceEntry {
    /// Unique within this store; how a sealed record finds its choice.
    pub(crate) id: u64,
    pub(crate) change: RoutingChange,
    pub(crate) peer: String,
    pub(crate) at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) until_ms: Option<u64>,
    /// Hex of the 32-byte salt the record's commitment uses.
    pub(crate) salt: String,
    /// `None` until the plugin confirms the seal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) record: Option<SealedChoice>,
}

impl ChoiceEntry {
    /// The commitment this choice's record must carry.
    pub(crate) fn expected_commitment(&self) -> Option<String> {
        let salt: [u8; 32] = hex::decode(&self.salt).ok()?.try_into().ok()?;
        Some(peer_commitment(&self.peer, &salt))
    }
}

/// `sha256(salt || peer)`, where `peer` is the endpoint id as lowercase hex
/// text (the bytes of the string, not the decoded key). Must agree with
/// `capsule_producer::capsule::peer_commitment` in capsule-emit-mesh; both
/// pin the same vector (`commitment_matches_the_plugin_vector`).
pub(crate) fn peer_commitment(peer_hex: &str, salt: &[u8; 32]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(salt);
    hasher.update(peer_hex.as_bytes());
    hex::encode(hasher.finalize())
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Store {
    #[serde(default)]
    next_id: u64,
    /// Keyed by the peer's endpoint id, lowercase hex.
    #[serde(default)]
    blocks: BTreeMap<String, ActiveBlock>,
    /// Every block and unblock, oldest first.
    #[serde(default)]
    choices: Vec<ChoiceEntry>,
}

impl Store {
    fn prune(&mut self, now_ms: u64) {
        self.blocks
            .retain(|_, block| block.until_ms.is_none_or(|until| now_ms < until));
    }

    fn push_choice(
        &mut self,
        change: RoutingChange,
        peer: String,
        at_ms: u64,
        until_ms: Option<u64>,
    ) -> ChoiceEntry {
        let entry = ChoiceEntry {
            id: self.next_id,
            change,
            peer,
            at_ms,
            until_ms,
            salt: hex::encode(rand::random::<[u8; 32]>()),
            record: None,
        };
        self.next_id += 1;
        self.choices.push(entry.clone());
        entry
    }
}

/// Shared handle to the block store. Clones share state.
#[derive(Clone, Debug)]
pub(crate) struct PeerBlocks {
    /// Read by routing on every request; swapped whole after a write is saved.
    store: Arc<RwLock<Store>>,
    /// Serialises writers across build-save-swap, so a slow disk never holds
    /// the lock routing reads.
    writer: Arc<Mutex<()>>,
    /// Held by the API across change -> seal -> attach, so seals reach the
    /// chain in the order the operator made the changes.
    change_order: Arc<tokio::sync::Mutex<()>>,
    /// `None` keeps the store in memory only (tests, or no state directory).
    directory: Option<PathBuf>,
}

pub(crate) fn peer_key(peer: &EndpointId) -> String {
    hex::encode(peer.as_bytes())
}

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

impl PeerBlocks {
    fn with_store(store: Store, directory: Option<PathBuf>) -> Self {
        Self {
            store: Arc::new(RwLock::new(store)),
            writer: Arc::default(),
            change_order: Arc::default(),
            directory,
        }
    }

    pub(crate) fn in_memory() -> Self {
        Self::with_store(Store::default(), None)
    }

    /// A missing file is an empty store. An unreadable one is set aside as
    /// `peer_blocks.json.corrupt-<ms>` (never overwritten) and routing
    /// carries on with no blocks: a bad file must never stop routing.
    pub(crate) fn load(directory: &Path) -> Self {
        let path = directory.join(FILE_NAME);
        let store = match std::fs::read(&path) {
            Err(_) => Store::default(),
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|error| {
                let aside = path.with_extension(format!("json.corrupt-{}", now_ms()));
                tracing::warn!(
                    "peer blocks: {} is unreadable ({error}); moved to {} and starting empty",
                    path.display(),
                    aside.display()
                );
                if let Err(error) = std::fs::rename(&path, &aside) {
                    tracing::warn!("peer blocks: could not set the unreadable file aside: {error}");
                }
                Store::default()
            }),
        };
        Self::with_store(store, Some(directory.to_path_buf()))
    }

    /// The store for this node's identity, or an in-memory one when the
    /// identity state directory cannot be resolved.
    pub(crate) fn for_this_node() -> Self {
        match crate::mesh::identity_state_dir() {
            Ok(directory) => Self::load(&directory),
            Err(error) => {
                tracing::warn!(
                    "peer blocks: no state directory ({error}); blocks will not persist"
                );
                Self::in_memory()
            }
        }
    }

    pub(crate) fn change_order(&self) -> &tokio::sync::Mutex<()> {
        &self.change_order
    }

    fn save(&self, store: &Store) -> std::io::Result<()> {
        let Some(directory) = &self.directory else {
            return Ok(());
        };
        std::fs::create_dir_all(directory)?;
        let path = directory.join(FILE_NAME);
        let temp = path.with_extension("json.tmp");
        std::fs::write(&temp, serde_json::to_vec_pretty(store)?)?;
        std::fs::rename(temp, path)
    }

    fn read(&self) -> std::sync::RwLockReadGuard<'_, Store> {
        self.store
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Build the next store from the current one, save it, and only then make
    /// it the one routing reads. A failed save changes nothing.
    fn update<T>(&self, change: impl FnOnce(&mut Store) -> T) -> std::io::Result<T> {
        let _writer = self
            .writer
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut next = self.read().clone();
        let out = change(&mut next);
        self.save(&next)?;
        *self
            .store
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = next;
        Ok(out)
    }

    pub(crate) fn is_blocked(&self, peer: &EndpointId, now_ms: u64) -> bool {
        self.read()
            .blocks
            .get(&peer_key(peer))
            .is_some_and(|block| block.until_ms.is_none_or(|until| now_ms < until))
    }

    /// Drop blocked peers from a live host list.
    pub(crate) fn retain_unblocked(&self, hosts: &mut Vec<EndpointId>, now_ms: u64) {
        hosts.retain(|host| !self.is_blocked(host, now_ms));
    }

    /// Drop blocked remote targets from a routing snapshot. Local targets are
    /// never affected.
    pub(crate) fn without_blocked(&self, targets: &ModelTargets, now_ms: u64) -> ModelTargets {
        let mut filtered = targets.clone();
        for hosts in filtered.targets.values_mut() {
            hosts.retain(|target| {
                !matches!(target, InferenceTarget::Remote(peer) if self.is_blocked(peer, now_ms))
            });
        }
        filtered
    }

    /// Start blocking `peer`. Returns the recorded choice, whose salt the
    /// plugin seals with.
    pub(crate) fn block(
        &self,
        peer: &EndpointId,
        length: BlockLength,
        now_ms: u64,
    ) -> std::io::Result<ChoiceEntry> {
        let until_ms = match length {
            BlockLength::SevenDays => Some(now_ms.saturating_add(TIMED_BLOCK_MS)),
            BlockLength::UntilUndone => None,
        };
        self.update(|store| {
            store.prune(now_ms);
            store.blocks.insert(
                peer_key(peer),
                ActiveBlock {
                    blocked_at_ms: now_ms,
                    until_ms,
                },
            );
            store.push_choice(RoutingChange::Block, peer_key(peer), now_ms, until_ms)
        })
    }

    /// Stop blocking `peer`. `Ok(None)` when it was not blocked (nothing to
    /// undo, nothing recorded).
    pub(crate) fn unblock(
        &self,
        peer: &EndpointId,
        now_ms: u64,
    ) -> std::io::Result<Option<ChoiceEntry>> {
        if !self.is_blocked(peer, now_ms) {
            return Ok(None);
        }
        self.update(|store| {
            store.prune(now_ms);
            store.blocks.remove(&peer_key(peer))?;
            Some(store.push_choice(RoutingChange::Unblock, peer_key(peer), now_ms, None))
        })
    }

    /// Attach the sealed record to the choice with `id`.
    pub(crate) fn attach_record(&self, id: u64, record: SealedChoice) -> std::io::Result<()> {
        self.update(|store| {
            if let Some(stored) = store.choices.iter_mut().find(|stored| stored.id == id) {
                stored.record = Some(record);
            }
        })
    }

    /// Active blocks and every recorded choice, for the console.
    pub(crate) fn snapshot(
        &self,
        now_ms: u64,
    ) -> (BTreeMap<String, ActiveBlock>, Vec<ChoiceEntry>) {
        let mut store = self.read().clone();
        store.prune(now_ms);
        (store.blocks, store.choices)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peer() -> EndpointId {
        iroh::SecretKey::generate().public()
    }

    #[test]
    fn timed_block_holds_for_seven_days_then_lapses() {
        let blocks = PeerBlocks::in_memory();
        let bad = peer();
        blocks.block(&bad, BlockLength::SevenDays, 1_000).unwrap();
        assert!(blocks.is_blocked(&bad, 1_000));
        assert!(blocks.is_blocked(&bad, 1_000 + TIMED_BLOCK_MS - 1));
        assert!(!blocks.is_blocked(&bad, 1_000 + TIMED_BLOCK_MS));
        assert!(!blocks.is_blocked(&peer(), 1_000));
        assert!(
            blocks.snapshot(1_000 + TIMED_BLOCK_MS).0.is_empty(),
            "a lapsed block is not listed"
        );
    }

    #[test]
    fn until_undone_holds_until_unblocked_and_records_both_choices_with_distinct_ids_and_salts() {
        let blocks = PeerBlocks::in_memory();
        let bad = peer();
        let block = blocks.block(&bad, BlockLength::UntilUndone, 5).unwrap();
        assert!(blocks.is_blocked(&bad, u64::MAX - 1));
        let undone = blocks.unblock(&bad, 5).unwrap().expect("was blocked");
        assert_eq!(undone.change, RoutingChange::Unblock);
        assert!(!blocks.is_blocked(&bad, 10));
        assert_eq!(
            blocks.unblock(&bad, 11).unwrap(),
            None,
            "nothing left to undo"
        );
        assert_ne!(block.id, undone.id, "same millisecond, still two choices");
        assert_ne!(block.salt, undone.salt);
        let (_, choices) = blocks.snapshot(12);
        let changes: Vec<_> = choices.iter().map(|c| c.change).collect();
        assert_eq!(changes, vec![RoutingChange::Block, RoutingChange::Unblock]);
    }

    #[test]
    fn routing_snapshot_drops_blocked_remote_targets_only() {
        let blocks = PeerBlocks::in_memory();
        let (bad, good) = (peer(), peer());
        blocks.block(&bad, BlockLength::UntilUndone, 0).unwrap();
        let mut targets = ModelTargets::default();
        targets.targets.insert(
            "qwen".into(),
            vec![
                InferenceTarget::Remote(bad),
                InferenceTarget::Local(9337),
                InferenceTarget::Remote(good),
            ],
        );
        let filtered = blocks.without_blocked(&targets, 1);
        assert_eq!(
            filtered.candidates("qwen"),
            vec![InferenceTarget::Local(9337), InferenceTarget::Remote(good)]
        );
        let mut hosts = vec![bad, good];
        blocks.retain_unblocked(&mut hosts, 1);
        assert_eq!(hosts, vec![good]);
    }

    #[test]
    fn survives_reload_and_keeps_the_sealed_record_by_id() {
        let directory = tempfile::tempdir().unwrap();
        let bad = peer();
        let blocks = PeerBlocks::load(directory.path());
        let entry = blocks.block(&bad, BlockLength::UntilUndone, 3).unwrap();
        let record = SealedChoice {
            capsule_id: "c".repeat(64),
            peer_commitment: entry.expected_commitment().unwrap(),
        };
        blocks.attach_record(entry.id, record.clone()).unwrap();

        let reloaded = PeerBlocks::load(directory.path());
        assert!(reloaded.is_blocked(&bad, 4));
        let (_, choices) = reloaded.snapshot(4);
        assert_eq!(choices[0].record.as_ref(), Some(&record));
        assert_eq!(choices[0].salt, entry.salt);
    }

    #[test]
    fn a_failed_save_changes_nothing_in_force() {
        let directory = tempfile::tempdir().unwrap();
        // A file where the directory should be: every save fails.
        let not_a_dir = directory.path().join("blocked");
        std::fs::write(&not_a_dir, b"").unwrap();
        let blocks = PeerBlocks::load(&not_a_dir);
        let bad = peer();
        assert!(blocks.block(&bad, BlockLength::UntilUndone, 0).is_err());
        assert!(
            !blocks.is_blocked(&bad, 1),
            "an unsaved block is never enforced"
        );
        assert!(blocks.snapshot(1).1.is_empty(), "and never listed");
    }

    #[test]
    fn an_unreadable_file_is_set_aside_not_overwritten() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join(FILE_NAME), b"not json").unwrap();
        let blocks = PeerBlocks::load(directory.path());
        assert!(blocks.snapshot(0).1.is_empty());
        let aside: Vec<_> = std::fs::read_dir(directory.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().contains(".corrupt-"))
            .collect();
        assert_eq!(aside.len(), 1, "the unreadable file is kept");
        assert_eq!(std::fs::read(aside[0].path()).unwrap(), b"not json");
    }

    /// Cross-implementation vector: capsule-emit-mesh's
    /// `capsule_producer::capsule::peer_commitment` pins the same inputs and
    /// output (`commitment_matches_the_host_vector`); the value was computed
    /// independently with Python's hashlib.
    #[test]
    fn commitment_matches_the_plugin_vector() {
        let peer = "a70d3967bea3b22fa48a28f77c5d2b3764fc8bd5204a82c09ff8430f3f2a0a00";
        assert_eq!(
            peer_commitment(peer, &[7u8; 32]),
            "265aff057ebdeba261253f6ce9d8eea274ef65bab0aadfbf99a5ddb2facd7e74"
        );
    }
}
