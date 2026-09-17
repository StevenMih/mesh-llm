//! Ambient twin sampling — [ledger-T11-twins-visible].
//!
//! **Scope, stated plainly.** Before this module, no ambient dual-dispatch
//! ("send the same deterministic request to a second peer automatically")
//! existed anywhere in this codebase — not here, not in the
//! `capsule-emit-mesh` sidecar. `capsule-emit-mesh/twin_selection.py` picks
//! WHICH peer to twin/referee with, but its own docs say cadence "belongs
//! wherever the request loop lives" and is not implemented there;
//! `twin_adjudicator.py` compares two ALREADY-SEALED halves offline and is
//! explicitly "NOT a coordinator." The "1-in-50" figure the ticket cites is
//! a design-note target (`tier3-09-twin-flag-v1.md`'s "~2% of traffic"), not
//! a rate anything currently applies.
//!
//! This module is the decision + bracket-id + peer-selection half of the
//! feature: given a configured rate, decide whether one exchange gets
//! ambiently twinned, pick which SECOND distinct peer (from the caller's own
//! candidate pool) it goes to, and mint the id both twinned exchanges carry
//! so the UI can bracket them. As of [ledger-T11-twins-visible]'s hot-path
//! follow-up, [`should_sample_ambient_twin`], [`mint_twin_bracket_id`], and
//! [`select_twin_target`] are called live from
//! `network::openai::ingress::route_missing_local_model`'s `RemoteMesh`
//! branch, which spawns the actual background second dispatch (see
//! `spawn_ambient_twin_dispatch` there) — this module still performs no I/O
//! itself, it only decides and selects.
//!
//! [`twin_rate_denominator`] remains unwired: the UI-facing "1 in N"
//! disclosure sentence readout is a separate, not-yet-built surface, so it
//! is exercised only by its own unit tests today (see its own
//! `#[allow(dead_code)]` below).

use rand::{Rng, RngExt};

/// Overrides the configured rate for this process. Mirrors the
/// `OTEL_EXPORTER_OTLP_ENDPOINT` env-override pattern in `runtime::survey`:
/// a plain env var, no config-file plumbing, because this is a runtime
/// operational knob (the soak override), not a model-authoring concern.
pub const TWIN_SAMPLE_RATE_ENV: &str = "MESH_LLM_TWIN_SAMPLE_RATE";

/// The rate the ticket says must stay unchanged by default: 1 in 50.
pub const DEFAULT_TWIN_SAMPLE_RATE: f64 = 1.0 / 50.0;

/// The live configured ambient-twin sample rate for this process — env
/// override when present and a valid probability, else
/// [`DEFAULT_TWIN_SAMPLE_RATE`]. This is the one function production code
/// and the UI-facing disclosure sentence must both call; neither may read
/// [`DEFAULT_TWIN_SAMPLE_RATE`] directly and skip the env check, or the
/// disclosure sentence silently stops being "live" the moment someone sets
/// the override.
pub fn configured_twin_sample_rate() -> f64 {
    configured_twin_sample_rate_with_env(|key| std::env::var(key).ok())
}

fn configured_twin_sample_rate_with_env(env: impl Fn(&str) -> Option<String>) -> f64 {
    env(TWIN_SAMPLE_RATE_ENV)
        .and_then(|raw| raw.trim().parse::<f64>().ok())
        .filter(|rate| valid_probability(*rate))
        .unwrap_or(DEFAULT_TWIN_SAMPLE_RATE)
}

fn valid_probability(rate: f64) -> bool {
    rate.is_finite() && (0.0..=1.0).contains(&rate)
}

/// Whether one exchange gets ambiently twinned, given the configured rate.
/// `rate <= 0.0` always returns `false` — the mutant test the ticket asks
/// for (`rate=0 => zero twins`) — and `rate` outside `[0, 1]` is treated as
/// `0.0` rather than panicking or saturating, since a caller should never
/// pass anything but [`configured_twin_sample_rate`]'s already-validated
/// output.
pub fn should_sample_ambient_twin(rate: f64, rng: &mut impl Rng) -> bool {
    valid_probability(rate) && rate > 0.0 && rng.random::<f64>() < rate
}

/// Mints a fresh twin-bracket id, host-side, per [ledger-T11-twins-visible]
/// item 2 — never derived from the sidecar. Both twinned exchanges' envelopes
/// (see [`crate::plugin::openai_exchange::OpenAiExchangeEnvelope::with_twin_bracket_id`])
/// carry the SAME id returned by one call to this function; never call it
/// twice for one bracket.
pub fn mint_twin_bracket_id() -> String {
    format!("twin-{}", uuid::Uuid::new_v4())
}

/// Pick a second, distinct peer for the ambient twin to dispatch to, out of
/// the SAME candidate pool the primary dispatch is about to route through.
///
/// Deterministic, not random: the second distinct candidate in `candidates`
/// order is always the pick (never the first). This is a plain, generic
/// helper — no dependency on `election::InferenceTarget` — so it stays
/// exercised by ordinary unit tests without pulling routing types into this
/// module; the caller in `network::openai::ingress` supplies
/// `election::InferenceTarget` candidates.
///
/// `None` when fewer than two DISTINCT candidates exist — a single-candidate
/// pool (e.g. an explicit `x-mesh-target`) has nothing distinct to twin
/// against, so this must never invent a fallback that dual-dispatches to the
/// same peer twice.
///
/// This does not coordinate with the primary dispatch's own affinity/health
/// based selection, so there is a small chance the primary independently
/// lands on the same peer this function picked — a known, accepted
/// limitation documented at the call site, not a violation of
/// "observe-only" (the twin dispatch still never affects what the primary
/// returns).
pub fn select_twin_target<T: Clone + PartialEq>(candidates: &[T]) -> Option<T> {
    let mut distinct: Vec<&T> = Vec::with_capacity(2);
    for candidate in candidates {
        if !distinct.contains(&candidate) {
            distinct.push(candidate);
        }
        if distinct.len() >= 2 {
            break;
        }
    }
    distinct.get(1).map(|target| (*target).clone())
}

/// The "1 in N" the UI's disclosure sentence reports for a given rate — the
/// live-rate half of the "disclosure sentence uses the live rate, not a
/// constant" test. `None` when the rate can't be expressed as a whole "1 in
/// N" (zero, or a rate so this function never invents a misleading integer;
/// a `None` return means the caller must render no ambient-twin disclosure
/// at all rather than a fabricated N).
#[allow(
    dead_code,
    reason = "UI disclosure sentence readout not yet wired; see module doc"
)]
pub fn twin_rate_denominator(rate: f64) -> Option<u32> {
    if !valid_probability(rate) || rate <= 0.0 {
        return None;
    }
    let denominator = (1.0 / rate).round();
    if !denominator.is_finite() || denominator < 1.0 || denominator > f64::from(u32::MAX) {
        return None;
    }
    Some(denominator as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;
    use rand::rngs::SmallRng;

    #[test]
    fn rate_zero_never_samples_a_twin() {
        // The ticket's own mutant test: rate=0 => zero twins, for every
        // possible RNG draw, not just a lucky one.
        for seed in 0..64u64 {
            let mut rng = SmallRng::seed_from_u64(seed);
            assert!(!should_sample_ambient_twin(0.0, &mut rng));
        }
    }

    #[test]
    fn negative_or_out_of_range_rate_never_samples() {
        let mut rng = SmallRng::seed_from_u64(0);
        assert!(!should_sample_ambient_twin(-0.02, &mut rng));
        assert!(!should_sample_ambient_twin(f64::NAN, &mut rng));
        assert!(!should_sample_ambient_twin(1.5, &mut rng));
    }

    #[test]
    fn rate_one_always_samples() {
        for seed in 0..64u64 {
            let mut rng = SmallRng::seed_from_u64(seed);
            assert!(should_sample_ambient_twin(1.0, &mut rng));
        }
    }

    #[test]
    fn rate_within_range_samples_sometimes_but_not_always() {
        // Not a statistical test -- just proves the function isn't a
        // constant `true`/`false` for a mid-range rate across many draws
        // (would catch e.g. an accidentally-inverted comparison).
        let mut rng = SmallRng::seed_from_u64(7);
        let mut saw_true = false;
        let mut saw_false = false;
        for _ in 0..500 {
            if should_sample_ambient_twin(0.5, &mut rng) {
                saw_true = true;
            } else {
                saw_false = true;
            }
        }
        assert!(saw_true && saw_false);
    }

    #[test]
    fn bracket_ids_are_unique_and_prefixed() {
        let a = mint_twin_bracket_id();
        let b = mint_twin_bracket_id();
        assert_ne!(a, b);
        assert!(a.starts_with("twin-"));
        assert!(b.starts_with("twin-"));
    }

    #[test]
    fn select_twin_target_none_for_empty_or_singleton_pool() {
        assert_eq!(select_twin_target::<&str>(&[]), None);
        assert_eq!(select_twin_target(&["peer-a"]), None);
    }

    #[test]
    fn select_twin_target_none_when_every_candidate_is_the_same_peer() {
        // A single logical peer listed twice (e.g. two health snapshots of
        // the same target) has nothing DISTINCT to twin against.
        assert_eq!(select_twin_target(&["peer-a", "peer-a", "peer-a"]), None);
    }

    #[test]
    fn select_twin_target_picks_the_second_distinct_candidate() {
        assert_eq!(
            select_twin_target(&["peer-a", "peer-b", "peer-c"]),
            Some("peer-b")
        );
    }

    #[test]
    fn select_twin_target_skips_a_duplicate_before_the_second_distinct_peer() {
        assert_eq!(
            select_twin_target(&["peer-a", "peer-a", "peer-b"]),
            Some("peer-b")
        );
    }

    #[test]
    fn select_twin_target_never_returns_the_first_candidate() {
        for seed in 0..32u64 {
            let mut rng = SmallRng::seed_from_u64(seed);
            let mut pool: Vec<u32> = (0..(2 + seed % 5) as u32).collect();
            // Order shouldn't matter to the "never the first" guarantee.
            use rand::seq::SliceRandom;
            pool.shuffle(&mut rng);
            let first = pool[0];
            let picked = select_twin_target(&pool).expect("at least 2 distinct candidates");
            assert_ne!(picked, first);
        }
    }

    #[test]
    fn denominator_matches_the_ticket_default() {
        assert_eq!(twin_rate_denominator(DEFAULT_TWIN_SAMPLE_RATE), Some(50));
    }

    #[test]
    fn denominator_none_for_zero_or_invalid() {
        assert_eq!(twin_rate_denominator(0.0), None);
        assert_eq!(twin_rate_denominator(-1.0), None);
        assert_eq!(twin_rate_denominator(f64::NAN), None);
    }

    #[test]
    fn denominator_soak_override_is_one_in_two() {
        assert_eq!(twin_rate_denominator(0.5), Some(2));
    }

    #[test]
    fn env_override_wins_when_present_and_valid() {
        let rate = configured_twin_sample_rate_with_env(|key| {
            (key == TWIN_SAMPLE_RATE_ENV).then(|| "0.5".to_string())
        });
        assert_eq!(rate, 0.5);
    }

    #[test]
    fn env_override_falls_back_on_garbage() {
        let rate = configured_twin_sample_rate_with_env(|key| {
            (key == TWIN_SAMPLE_RATE_ENV).then(|| "not-a-number".to_string())
        });
        assert_eq!(rate, DEFAULT_TWIN_SAMPLE_RATE);
    }

    #[test]
    fn env_override_falls_back_on_out_of_range() {
        let rate = configured_twin_sample_rate_with_env(|key| {
            (key == TWIN_SAMPLE_RATE_ENV).then(|| "1.5".to_string())
        });
        assert_eq!(rate, DEFAULT_TWIN_SAMPLE_RATE);
    }

    #[test]
    fn absent_env_defaults_to_unchanged_rate() {
        let rate = configured_twin_sample_rate_with_env(|_| None);
        assert_eq!(rate, DEFAULT_TWIN_SAMPLE_RATE);
    }
}
