//! `load_epoch`: a monotonically increasing id, one per successful local
//! model (re)load in this process. Pairs with `effective_settings_digest`
//! (see `inference::skippy::resolver::effective_settings_digest`) -- the
//! epoch tells a reader whether two announcements describe the SAME load
//! (digest comparison is meaningless) or two DIFFERENT loads (a digest
//! change across epochs, with the same `weights_digest`, is
//! `changed_without_saying`).
//!
//! Deliberately process-global rather than per-model: uniqueness across
//! loads is the only property this id needs to provide, and one counter
//! shared by every model this node ever loads is the simplest thing that
//! provides it.

use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_LOAD_EPOCH: AtomicU64 = AtomicU64::new(1);

/// Allocates the next load epoch id. Never returns the same value twice for
/// the life of this process; never decreases.
pub(crate) fn next_load_epoch() -> u64 {
    NEXT_LOAD_EPOCH.fetch_add(1, Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A reload -- a second call to `next_load_epoch` -- always produces a
    /// new, larger id than the one before it.
    #[test]
    fn a_reload_produces_a_new_larger_epoch_id() {
        let first = next_load_epoch();
        let second = next_load_epoch();
        assert!(second > first, "epoch must strictly increase on reload");
    }
}
