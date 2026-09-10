//! `effective_settings_digest`: a SHA-256 over the RESOLVED settings that
//! change model output, computed once per model load from `ResolvedSkippyConfig`
//! -- never per request, since every input here is `Reload required` (stable
//! for the life of one load; see the design note cited in the field's doc
//! comment on `ServedModelIdentity`).
//!
//! Scope is deliberately narrow and literal, matching the settings named by
//! the requesting spec, not "every field that might matter":
//!
//! - `model_fit.cache_type_k` / `cache_type_v` -- the RESOLVED KV cache
//!   precision (e.g. "f16", "q4_0"), never the human-facing tier label
//!   ("Saver"/"Quality") that maps onto them.
//! - `model_fit.ctx_size` -- resolved context window, in tokens.
//! - `model_fit.batch` / `model_fit.ubatch` -- resolved prefill batch and
//!   decode micro-batch size.
//! - `model_fit.flash_attention` -- the resolved tri-state policy
//!   (Auto/Disabled/Enabled) actually handed to the backend.
//! - `hardware.gpu_layers` -- resolved GPU layer offload count.
//! - `speculative.mode` -- the resolved speculative-decoding mode switch.
//!   Sub-tuning knobs (draft selection policy, pairing-fault behavior, draft
//!   token bounds) are excluded: verify-based speculative decoding is
//!   designed to be output-equivalent to non-speculative decoding, so only
//!   the mode switch itself is named as output-affecting.
//! - `request_defaults.{temperature,top_p,top_k,min_p,presence_penalty,
//!   frequency_penalty,repeat_penalty,repeat_last_n}` -- the Request Defaults
//!   that parametrize token sampling. Excluded: `max_tokens` (a length cap,
//!   not a sampling parameter), `reasoning_format`/`reasoning_budget`
//!   (reasoning-stream presentation/budget, not sampling).
//!
//! Also excluded, deliberately: `kv_cache_policy` (the tier label the K/V
//! precision fields already capture as resolved values), `safety_margin_gb`
//! / `parallel` / `tuning_profile` / `hardware.device` (memory headroom,
//! concurrency, and hardware placement -- governs speed, not inference
//! quality), every Multimodal setting (not named in the spec; orthogonal to
//! text-generation sampling for the primary served model), and every other
//! `ResolvedSkippyConfig` field not exposed by the settings screen the spec
//! cites as its scope anchor (transport/lifecycle knobs, KV
//! offload/unified/SWA/idle-slot tuning, mmap/mlock/repack/device-placement
//! internals). If that list needs to grow, it is a spec decision, not a
//! coder guess -- see the escalation note on the originating task.

use sha2::{Digest, Sha256};

use super::types::ResolvedSkippyConfig;

/// Computes the digest. Pure and deterministic: the same `ResolvedSkippyConfig`
/// always yields the same digest, and changing any field NOT in the list above
/// never changes it.
pub(crate) fn effective_settings_digest_for(resolved: &ResolvedSkippyConfig) -> String {
    let mut hasher = Sha256::new();
    field(
        &mut hasher,
        "cache_type_k",
        &resolved.model_fit.cache_type_k,
    );
    field(
        &mut hasher,
        "cache_type_v",
        &resolved.model_fit.cache_type_v,
    );
    field(
        &mut hasher,
        "ctx_size",
        &resolved.model_fit.ctx_size.to_string(),
    );
    field(&mut hasher, "batch", &resolved.model_fit.batch.to_string());
    field(
        &mut hasher,
        "ubatch",
        &resolved.model_fit.ubatch.to_string(),
    );
    field(
        &mut hasher,
        "flash_attention",
        &format!("{:?}", resolved.model_fit.flash_attention),
    );
    field(
        &mut hasher,
        "gpu_layers",
        &resolved.hardware.gpu_layers.to_string(),
    );
    field(&mut hasher, "speculative_mode", &resolved.speculative.mode);
    field(
        &mut hasher,
        "temperature",
        &opt_f64(resolved.request_defaults.temperature),
    );
    field(
        &mut hasher,
        "top_p",
        &opt_f64(resolved.request_defaults.top_p),
    );
    field(
        &mut hasher,
        "top_k",
        &opt_i64(resolved.request_defaults.top_k),
    );
    field(
        &mut hasher,
        "min_p",
        &opt_f64(resolved.request_defaults.min_p),
    );
    field(
        &mut hasher,
        "presence_penalty",
        &opt_f64(resolved.request_defaults.presence_penalty),
    );
    field(
        &mut hasher,
        "frequency_penalty",
        &opt_f64(resolved.request_defaults.frequency_penalty),
    );
    field(
        &mut hasher,
        "repeat_penalty",
        &opt_f64(resolved.request_defaults.repeat_penalty),
    );
    field(
        &mut hasher,
        "repeat_last_n",
        &opt_i64(resolved.request_defaults.repeat_last_n),
    );
    hex::encode(hasher.finalize())
}

/// Labeled, newline-delimited fields so two different resolved states never
/// collide onto the same byte string (e.g. batch=5/ubatch=12 vs
/// batch=51/ubatch=2): every value is preceded by its own name and a
/// terminating newline, so a value can never bleed into the next label.
fn field(hasher: &mut Sha256, name: &str, value: &str) {
    hasher.update(name.as_bytes());
    hasher.update(b"=");
    hasher.update(value.as_bytes());
    hasher.update(b"\n");
}

fn opt_f64(value: Option<f64>) -> String {
    match value {
        Some(value) => value.to_string(),
        None => "none".to_string(),
    }
}

fn opt_i64(value: Option<i64>) -> String {
    match value {
        Some(value) => value.to_string(),
        None => "none".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::inference::skippy::resolver::test_support::sample_resolved_skippy_config;

    /// Same resolved config in, same digest out -- required for "does not
    /// recompute per request": a second call with an unchanged config must
    /// be indistinguishable from the first.
    #[test]
    fn same_resolved_config_yields_the_same_digest() {
        let resolved = sample_resolved_skippy_config();
        assert_eq!(
            effective_settings_digest_for(&resolved),
            effective_settings_digest_for(&resolved)
        );
    }

    #[test]
    fn kv_cache_k_precision_change_changes_the_digest() {
        let before = sample_resolved_skippy_config();
        let mut after = before.clone();
        after.model_fit.cache_type_k = "q4_0".to_string();
        assert_ne!(before.model_fit.cache_type_k, after.model_fit.cache_type_k);
        assert_ne!(
            effective_settings_digest_for(&before),
            effective_settings_digest_for(&after)
        );
    }

    #[test]
    fn kv_cache_v_precision_change_changes_the_digest() {
        let before = sample_resolved_skippy_config();
        let mut after = before.clone();
        after.model_fit.cache_type_v = "q4_0".to_string();
        assert_ne!(
            effective_settings_digest_for(&before),
            effective_settings_digest_for(&after)
        );
    }

    #[test]
    fn context_window_change_changes_the_digest() {
        let before = sample_resolved_skippy_config();
        let mut after = before.clone();
        after.model_fit.ctx_size = 2048;
        assert_ne!(
            effective_settings_digest_for(&before),
            effective_settings_digest_for(&after)
        );
    }

    #[test]
    fn batch_and_ubatch_changes_change_the_digest() {
        let before = sample_resolved_skippy_config();

        let mut batch_changed = before.clone();
        batch_changed.model_fit.batch += 1;
        assert_ne!(
            effective_settings_digest_for(&before),
            effective_settings_digest_for(&batch_changed)
        );

        let mut ubatch_changed = before.clone();
        ubatch_changed.model_fit.ubatch += 1;
        assert_ne!(
            effective_settings_digest_for(&before),
            effective_settings_digest_for(&ubatch_changed)
        );
    }

    #[test]
    fn flash_attention_policy_change_changes_the_digest() {
        let before = sample_resolved_skippy_config();
        let mut after = before.clone();
        after.model_fit.flash_attention = match after.model_fit.flash_attention {
            skippy_protocol::FlashAttentionType::Auto => {
                skippy_protocol::FlashAttentionType::Enabled
            }
            _ => skippy_protocol::FlashAttentionType::Auto,
        };
        assert_ne!(
            effective_settings_digest_for(&before),
            effective_settings_digest_for(&after)
        );
    }

    #[test]
    fn gpu_layers_change_changes_the_digest() {
        let before = sample_resolved_skippy_config();
        let mut after = before.clone();
        after.hardware.gpu_layers += 1;
        assert_ne!(
            effective_settings_digest_for(&before),
            effective_settings_digest_for(&after)
        );
    }

    #[test]
    fn speculative_mode_change_changes_the_digest() {
        let before = sample_resolved_skippy_config();
        let mut after = before.clone();
        after.speculative.mode = format!("{}-changed", after.speculative.mode);
        assert_ne!(
            effective_settings_digest_for(&before),
            effective_settings_digest_for(&after)
        );
    }

    #[test]
    fn sampling_request_defaults_changes_change_the_digest() {
        let before = sample_resolved_skippy_config();

        let mut temperature_changed = before.clone();
        temperature_changed.request_defaults.temperature = Some(
            temperature_changed
                .request_defaults
                .temperature
                .unwrap_or(0.7)
                + 0.3,
        );
        assert_ne!(
            effective_settings_digest_for(&before),
            effective_settings_digest_for(&temperature_changed)
        );

        let mut top_p_changed = before.clone();
        top_p_changed.request_defaults.top_p =
            Some(top_p_changed.request_defaults.top_p.unwrap_or(0.9) - 0.1);
        assert_ne!(
            effective_settings_digest_for(&before),
            effective_settings_digest_for(&top_p_changed)
        );
    }

    /// Speculative sub-tuning is deliberately excluded from the digest --
    /// proper (verify-based) speculative decoding is designed to be
    /// output-equivalent to non-speculative decoding, so only the mode
    /// switch is named as output-affecting.
    #[test]
    fn speculative_draft_tuning_does_not_change_the_digest() {
        let before = sample_resolved_skippy_config();
        let mut after = before.clone();
        after.speculative.draft_max_tokens += 1;
        after.speculative.draft_min_tokens += 1;
        after.speculative.pairing_fault = format!("{}-changed", after.speculative.pairing_fault);
        assert_eq!(
            effective_settings_digest_for(&before),
            effective_settings_digest_for(&after)
        );
    }

    /// `max_tokens` is a length cap, not a sampling parameter -- excluded.
    #[test]
    fn max_tokens_change_does_not_change_the_digest() {
        let before = sample_resolved_skippy_config();
        let mut after = before.clone();
        after.request_defaults.max_tokens += 1;
        assert_eq!(
            effective_settings_digest_for(&before),
            effective_settings_digest_for(&after)
        );
    }

    /// Cosmetic / placement-only settings never move the digest: the KV
    /// cache tier LABEL (`kv_cache_policy`), memory safety margin, default
    /// concurrency/tuning-profile knobs, and hardware device placement all
    /// govern speed or presentation, never inference quality.
    #[test]
    fn cosmetic_and_placement_only_settings_do_not_change_the_digest() {
        let before = sample_resolved_skippy_config();
        let mut after = before.clone();
        after.model_fit.kv_cache_policy = format!("{}-changed", after.model_fit.kv_cache_policy);
        after.hardware.device = Some("changed-device".to_string());
        after.throughput.parallel += 1;
        after.throughput.tuning_profile = format!("{}-changed", after.throughput.tuning_profile);
        assert_eq!(
            effective_settings_digest_for(&before),
            effective_settings_digest_for(&after)
        );
    }
}
