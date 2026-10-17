//! The Service History (`service_history/1`, PRD-SERVICE-EVIDENCE §2, M2):
//! one versioned projection that embeds the `history_card/1` artifact
//! unchanged and declares which further members it carries.
//!
//! **The derivation.** Unregistered, and named on the wire by the digest of
//! its definition document (`derivations/service-history-1.json`,
//! [`DEFINITION_DIGEST`]). The token `service_history/1` is the document's
//! `name`, never a request's `derivation`: a request naming it is refused
//! `derivation_unsupported`. The subject is `full_history`.
//!
//! **The artifact** is one object, as its RFC 8785 octets:
//! `projection` (the definition digest), `subject`, `anchor`, `declared`
//! (the members it carries, sorted), `history_card`, `history_card_digest`
//! and, when declared, `served_summary`. A member is present exactly when it
//! is declared, and no other key appears. This node always declares both
//! members, so the bytes depend only on (subject, anchor, definition): the
//! same for every requester (R-15).
//!
//! - `history_card` is the `history_card/1` artifact this node serves for
//!   the same subject and anchor, as a JSON value. RFC 8785 is
//!   compositional, so its canonical octets are the direct artifact's octets,
//!   and `history_card_digest` is their SHA-256 (PRD T6).
//! - `served_summary` is the direct `served_summary/1` artifact
//!   (`crate::served_summary`), as a JSON value.
//!
//! **Answered** under the served summary's coverage rule: an `expected_pin`
//! naming this node's latest checkpoint. A requester learns that pin from a
//! direct `history_card/1` request under `min_freshness`. `min_freshness`
//! here is `policy_declined`, an older pin `coverage_unsatisfiable`. It is
//! Standard History (`share_standard_history`), and when either member cannot
//! be built the whole projection is refused, never served with a member
//! dropped (`crate::evidence_answer`).
//!
//! **Verified** by [`verify`]. The card is bound by the envelope's signed
//! `artifact_digest`, which covers these octets; there is no second
//! envelope. Its content is checked by [`verify_card_content`], a line for
//! line port of the checks `capsule-emit-evidence-request` 0.0.4 runs on a
//! `history_card/1` answer and keeps private: every checkpoint signed by the
//! responder, the list starting at the stream's first checkpoint and ending
//! at the anchor, each consistency proof, and the witness receipts. A test
//! holds it to that crate's verdicts. A requester that needs the card as a
//! standalone -00 artifact asks for `history_card/1` under the same pin and
//! compares its digest with `history_card_digest`.
//!
//! **Rendered** by [`render`]: every count with its unit, every model,
//! quantization and weights-digest figure as what the provider states, and
//! nothing that reads continuity, a signature or a receipt as execution
//! (PRD R-1, R-6, T5).

use std::collections::BTreeMap;

use capsule_emit_evidence_request::answer::{
    subject_json, ReceiptCheck, ReceiptStatus, VerifyError, MAX_RECORDS,
};
use capsule_emit_evidence_request::jcs;
use capsule_emit_evidence_request::registry::{is_digest, Reason, DERIVATION_HISTORY_CARD};
use capsule_emit_evidence_request::request::{Coverage, Derivation, Request, Subject};
use cll::checkpoint::CheckpointRecord;
use cll::mmr::{verify_consistency, ConsistencyProof, Hash};
use ed25519_dalek::{Signature, VerifyingKey};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

/// The derivation's name, as its definition document states it.
#[cfg(test)]
pub const DERIVATION_NAME: &str = "service_history/1";

/// The definition document, as published beside this crate. Only its
/// digest is used at run time; a test pins one to the other.
#[cfg(test)]
pub const DEFINITION_DOCUMENT: &str = include_str!("../derivations/service-history-1.json");

/// SHA-256 over the RFC 8785 bytes of [`DEFINITION_DOCUMENT`]: the
/// derivation's name on the wire, and the artifact's `projection`.
pub const DEFINITION_DIGEST: &str =
    "6f8d6d058322b909e249e49bbeaae921abcff63b828c36c41202c75e392ba834";

/// The keys every artifact carries, whatever it declares.
const FIXED_KEYS: [&str; 5] = [
    "anchor",
    "declared",
    "history_card_digest",
    "projection",
    "subject",
];

/// The definition's members, in order, and whether each is required.
const MEMBERS: [(&str, bool); 2] = [("history_card", true), ("served_summary", false)];

/// The members this verifier checks.
const CHECKED_HERE: [&str; 2] = ["history_card", "served_summary"];

/// Whether `derivation` names this one.
pub fn is_derivation(derivation: Option<&Derivation>) -> bool {
    matches!(derivation, Some(Derivation::Digest(d)) if d == DEFINITION_DIGEST)
}

// ---------------------------------------------------------------------
// Responder
// ---------------------------------------------------------------------

/// The artifact, as RFC 8785 text: `card` is the direct `history_card/1`
/// artifact's octets for `subject` under `anchor`, and `summary` the
/// served-summary artifact (`None` only in the mutant that drops it).
/// `policy_declined` when the card's octets are not its own canonical form,
/// so the embedded card could not be the direct one.
pub(crate) fn artifact(
    card: &[u8],
    summary: Option<Value>,
    subject: &Subject,
    anchor: &str,
) -> Result<String, Reason> {
    let mut card_value: Value = serde_json::from_slice(card).map_err(|_| Reason::PolicyDeclined)?;
    if jcs::to_string(&card_value)
        .map_err(|_| Reason::PolicyDeclined)?
        .as_bytes()
        != card
    {
        return Err(Reason::PolicyDeclined);
    }
    // Deliberately broken in one CI build: the card is rebuilt from its
    // checkpoint list, without the consistency proofs.
    if cfg!(feature = "mutant-service-history-card-rebuilt") {
        if let Some(history) = card_value.get_mut("history").and_then(Value::as_array_mut) {
            for entry in history {
                entry["consistency_from_previous"] = Value::Null;
            }
        }
    }
    let card_text = jcs::to_string(&card_value).map_err(|_| Reason::PolicyDeclined)?;
    let mut declared = vec!["history_card"];
    let mut out = Map::new();
    out.insert("projection".into(), json!(DEFINITION_DIGEST));
    out.insert("subject".into(), subject_json(subject));
    out.insert("anchor".into(), json!(anchor));
    out.insert(
        "history_card_digest".into(),
        json!(hex::encode(Sha256::digest(card_text.as_bytes()))),
    );
    out.insert("history_card".into(), card_value);
    if let Some(summary) = summary {
        declared.push("served_summary");
        out.insert("served_summary".into(), summary);
    }
    declared.sort_unstable();
    out.insert("declared".into(), json!(declared));
    jcs::to_string(&Value::Object(out)).map_err(|_| Reason::PolicyDeclined)
}

// ---------------------------------------------------------------------
// Verifier
// ---------------------------------------------------------------------

/// What one verified answer establishes.
#[derive(Clone, Debug, PartialEq)]
pub struct Verified {
    /// The anchor checkpoint's digest.
    pub anchor: String,
    /// Each declared member: `"checked"`, or `"not_checked"` for one this
    /// verifier does not implement.
    pub members: BTreeMap<String, &'static str>,
    /// The card's checkpoints, oldest first, each signed by the responder.
    pub checkpoints: usize,
    /// Every witness receipt the card's checkpoints carry, as checked.
    pub receipts: Vec<ReceiptCheck>,
    /// The embedded served summary's `served_summary` value, when checked.
    pub served_summary: Option<Value>,
}

impl Verified {
    /// The requester's result: counts per unit, nothing summed across
    /// members, and the History as text ([`render`]).
    pub fn to_json(&self) -> Value {
        let count =
            |status: ReceiptStatus| self.receipts.iter().filter(|r| r.status == status).count();
        json!({
            "state": "artifact",
            "anchor": self.anchor,
            "members": self.members,
            "checkpoints": self.checkpoints,
            "witness_receipts": {
                "verified": count(ReceiptStatus::Verified),
                "no_key": count(ReceiptStatus::NoKey),
                "stub": count(ReceiptStatus::Stub),
            },
            "lines": render(self),
        })
    }
}

/// Check a Service History answer (`envelope`, `artifact`, `material` as
/// received) to the request `req` (digest `digest`, as sent) against the
/// responder's `key`. `witness_key` is the requester's key for a witness,
/// by its URL.
pub fn verify(
    envelope: &Value,
    artifact: &[u8],
    material: &[u8],
    req: &Request,
    digest: &str,
    key: &VerifyingKey,
    witness_key: &dyn Fn(&str) -> Option<VerifyingKey>,
) -> Result<Verified, String> {
    verify_with(
        envelope,
        artifact,
        material,
        req,
        digest,
        key,
        witness_key,
        &CHECKED_HERE,
    )
}

/// [`verify`], for a verifier that checks only the members in `checked`.
#[allow(clippy::too_many_arguments)]
fn verify_with(
    envelope: &Value,
    artifact: &[u8],
    material: &[u8],
    req: &Request,
    digest: &str,
    key: &VerifyingKey,
    witness_key: &dyn Fn(&str) -> Option<VerifyingKey>,
    checked: &[&str],
) -> Result<Verified, String> {
    let fail = |why: &str| why.to_string();
    if !is_derivation(req.derivation.as_ref()) {
        return Err(fail("the request sent does not name this derivation"));
    }
    let anchor =
        crate::evidence_answer::verify_envelope(envelope, artifact, digest, key).map_err(fail)?;
    let cp =
        crate::evidence_answer::verify_anchor_checkpoint(material, &anchor, key).map_err(fail)?;
    match &req.coverage {
        Coverage::ExpectedPin(pin) if *pin == anchor => {}
        _ => return Err(fail("the anchor does not satisfy the requested coverage")),
    }
    let art: Value =
        serde_json::from_slice(artifact).map_err(|_| fail("the artifact is malformed"))?;
    let art = art
        .as_object()
        .ok_or_else(|| fail("the artifact is malformed"))?;
    let subject = subject_json(&req.subject);
    if art.get("projection").and_then(Value::as_str) != Some(DEFINITION_DIGEST)
        || art.get("subject") != Some(&subject)
        || art.get("anchor").and_then(Value::as_str) != Some(anchor.as_str())
    {
        return Err(fail(
            "the artifact is not for the requested subject or derivation",
        ));
    }

    // Declared means present, and nothing else is.
    let declared: Vec<&str> = art
        .get("declared")
        .and_then(Value::as_array)
        .and_then(|d| d.iter().map(Value::as_str).collect::<Option<Vec<_>>>())
        .ok_or_else(|| fail("the declared members are malformed"))?;
    if declared.windows(2).any(|w| w[0] >= w[1])
        || declared
            .iter()
            .any(|d| !MEMBERS.iter().any(|(name, _)| name == d))
        || MEMBERS
            .iter()
            .any(|(name, required)| *required && !declared.contains(name))
    {
        return Err(fail("the declared members are malformed"));
    }
    let mut expected: Vec<&str> = FIXED_KEYS
        .iter()
        .copied()
        .chain(declared.iter().copied())
        .collect();
    expected.sort_unstable();
    let mut keys: Vec<&str> = art.keys().map(String::as_str).collect();
    keys.sort_unstable();
    if keys != expected {
        return Err(fail("the artifact's members are not the ones it declares"));
    }

    let mut verified = Verified {
        anchor: anchor.clone(),
        members: BTreeMap::new(),
        checkpoints: 0,
        receipts: Vec::new(),
        served_summary: None,
    };
    for member in &declared {
        if !checked.contains(member) {
            verified.members.insert(member.to_string(), "not_checked");
            continue;
        }
        match *member {
            "history_card" => {
                let card = &art["history_card"];
                let text = jcs::to_string(card).map_err(|_| fail("the card is malformed"))?;
                if art.get("history_card_digest").and_then(Value::as_str)
                    != Some(hex::encode(Sha256::digest(text.as_bytes())).as_str())
                {
                    return Err(fail("the card does not match history_card_digest"));
                }
                if card.get("subject") != Some(&subject) {
                    return Err(fail("the card is not for the requested subject"));
                }
                let (checkpoints, receipts) =
                    verify_card_content(card, &cp, key, witness_key).map_err(|e| e.to_string())?;
                verified.checkpoints = checkpoints.len();
                verified.receipts = receipts;
            }
            "served_summary" => {
                let summary = &art["served_summary"];
                if !crate::evidence_answer::served_summary_artifact_matches(
                    summary,
                    &req.subject,
                    &anchor,
                ) || summary.get("evidence_stream").and_then(Value::as_str)
                    != Some(cp.log_id.as_str())
                {
                    return Err(fail(
                        "the served summary is not for this subject and anchor",
                    ));
                }
                verified.served_summary = summary.get("served_summary").cloned();
            }
            _ => unreachable!("every member checked here has a check"),
        }
        verified.members.insert(member.to_string(), "checked");
    }
    Ok(verified)
}

/// The content of a `history_card/1` artifact, checked against its anchor
/// checkpoint `anchor` (already the responder's, and the one named) and the
/// responder's `key`: the checks `answer::verify` makes of a card, without
/// the envelope, ported from `capsule-emit-evidence-request` 0.0.4
/// (`answer.rs`: steps 2, 3 and 5, `verify_history`,
/// `verify_checkpoint_list`, `check_receipts`, `signed_by`), with its
/// errors. Returns the checkpoints, oldest first, and every receipt.
pub fn verify_card_content(
    card: &Value,
    anchor: &CheckpointRecord,
    key: &VerifyingKey,
    witness_key: &dyn Fn(&str) -> Option<VerifyingKey>,
) -> Result<(Vec<CheckpointRecord>, Vec<ReceiptCheck>), VerifyError> {
    let art = card.as_object().ok_or(VerifyError::ArtifactMalformed)?;
    if art.get("anchor").and_then(Value::as_str) != Some(anchor.digest().as_str()) {
        return Err(VerifyError::ArtifactMalformed);
    }
    if art.get("derivation").and_then(Value::as_str) != Some(DERIVATION_HISTORY_CARD) {
        return Err(VerifyError::WrongSubject);
    }
    if art.get("evidence_stream").and_then(Value::as_str) != Some(anchor.log_id.as_str()) {
        return Err(VerifyError::ArtifactMalformed);
    }
    let history = art
        .get("history")
        .and_then(Value::as_array)
        .ok_or(VerifyError::ArtifactMalformed)?;
    if history.len() as u64 > MAX_RECORDS {
        return Err(VerifyError::TooLarge);
    }
    let checkpoints = verify_history(history, anchor, key)?;
    let receipts = check_receipts(anchor, &checkpoints, witness_key)?;
    Ok((checkpoints, receipts))
}

fn verify_history(
    history: &[Value],
    anchor: &CheckpointRecord,
    key: &VerifyingKey,
) -> Result<Vec<CheckpointRecord>, VerifyError> {
    let list: Vec<Value> = history
        .iter()
        .map(|e| e.get("checkpoint").cloned().unwrap_or(Value::Null))
        .collect();
    let checkpoints = verify_checkpoint_list(&list, anchor, key)?;
    for (i, entry) in history.iter().enumerate() {
        let proof = entry
            .get("consistency_from_previous")
            .ok_or(VerifyError::CheckpointChain)?;
        match i.checked_sub(1).map(|p| &checkpoints[p]) {
            None if proof.is_null() => {}
            None => return Err(VerifyError::CheckpointChain),
            Some(prev) => {
                let cur = &checkpoints[i];
                let proof = consistency_from_json(proof).ok_or(VerifyError::CheckpointChain)?;
                let (ra, rb) = (parse_hash(&prev.root), parse_hash(&cur.root));
                let (Some(ra), Some(rb)) = (ra, rb) else {
                    return Err(VerifyError::CheckpointChain);
                };
                if !verify_consistency(&ra, prev.mmr_size, &rb, cur.mmr_size, &proof) {
                    return Err(VerifyError::CheckpointChain);
                }
            }
        }
    }
    Ok(checkpoints)
}

fn verify_checkpoint_list(
    list: &[Value],
    anchor: &CheckpointRecord,
    key: &VerifyingKey,
) -> Result<Vec<CheckpointRecord>, VerifyError> {
    let checkpoints = list
        .iter()
        .map(|v| checkpoint_from_json(v).filter(|cp| signed_by(cp, key)))
        .collect::<Option<Vec<_>>>()
        .ok_or(VerifyError::CheckpointChain)?;
    let (Some(first), Some(last)) = (checkpoints.first(), checkpoints.last()) else {
        return Err(VerifyError::CheckpointChain);
    };
    // The list starts at the stream's genesis, so no prefix can be left out.
    if first.prev_size != 0 || !first.prev_root.is_empty() {
        return Err(VerifyError::CheckpointChain);
    }
    if last != anchor {
        return Err(VerifyError::CheckpointChain);
    }
    for pair in checkpoints.windows(2) {
        let (prev, next) = (&pair[0], &pair[1]);
        if next.mmr_size <= prev.mmr_size
            || next.prev_size != prev.mmr_size
            || next.prev_root != prev.root
            || next.log_id != prev.log_id
        {
            return Err(VerifyError::CheckpointChain);
        }
    }
    Ok(checkpoints)
}

fn check_receipts(
    anchor: &CheckpointRecord,
    checkpoints: &[CheckpointRecord],
    witness_key: &dyn Fn(&str) -> Option<VerifyingKey>,
) -> Result<Vec<ReceiptCheck>, VerifyError> {
    use base64::Engine as _;
    use capsule_emit_evidence_request::receipt;
    let mut seen = std::collections::BTreeSet::new();
    let mut out = Vec::new();
    for cp in checkpoints.iter().chain(std::iter::once(anchor)) {
        let digest = cp.digest();
        if !seen.insert(digest.clone()) {
            continue;
        }
        let digest_bytes = hex::decode(&digest).map_err(|_| VerifyError::CheckpointChain)?;
        let entry: [u8; 32] = Sha256::digest(&digest_bytes).into();
        for w in &cp.witnesses {
            let check = |status| ReceiptCheck {
                checkpoint_digest: digest.clone(),
                ts_url: w.ts_url.clone(),
                status,
            };
            if w.is_stub {
                out.push(check(ReceiptStatus::Stub));
                continue;
            }
            if w.entry_hash != hex::encode(entry) {
                return Err(VerifyError::ReceiptBinding);
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&w.receipt_b64)
                .map_err(|_| VerifyError::ReceiptMalformed)?;
            match witness_key(&w.ts_url) {
                Some(key) => match receipt::verify(&bytes, &entry, &key) {
                    Ok(()) => out.push(check(ReceiptStatus::Verified)),
                    Err(receipt::ReceiptError::Malformed(_)) => {
                        return Err(VerifyError::ReceiptMalformed)
                    }
                    Err(receipt::ReceiptError::NotForThisLeaf) => {
                        return Err(VerifyError::ReceiptBinding)
                    }
                },
                None => {
                    receipt::check_form(&bytes).map_err(|_| VerifyError::ReceiptMalformed)?;
                    out.push(check(ReceiptStatus::NoKey));
                }
            }
        }
    }
    Ok(out)
}

/// Whether `cp` is signed by `key` (its `key_id` is that key, and the
/// signature over its digest verifies strictly).
fn signed_by(cp: &CheckpointRecord, key: &VerifyingKey) -> bool {
    cp.key_id == hex::encode(key.to_bytes())
        && decode_signature(&cp.signature)
            .is_some_and(|sig| key.verify_strict(cp.digest().as_bytes(), &sig).is_ok())
}

fn decode_signature(s: &str) -> Option<Signature> {
    let bytes: [u8; 64] = hex::decode(s).ok()?.try_into().ok()?;
    Some(Signature::from_bytes(&bytes))
}

fn parse_hash(s: &str) -> Option<Hash> {
    if !is_digest(s) {
        return None;
    }
    hex::decode(s).ok()?.try_into().ok()
}

fn checkpoint_from_json(v: &Value) -> Option<CheckpointRecord> {
    serde_json::from_value(v.clone()).ok()
}

fn consistency_from_json(v: &Value) -> Option<ConsistencyProof> {
    let witness = v
        .get("witness")?
        .as_array()?
        .iter()
        .map(strings)
        .collect::<Option<Vec<_>>>()?;
    Some(ConsistencyProof {
        v: u32::try_from(v.get("v")?.as_u64()?).ok()?,
        kind: v.get("kind")?.as_str()?.to_string(),
        size_a: v.get("size_a")?.as_u64()?,
        size_b: v.get("size_b")?.as_u64()?,
        old_peaks: strings(v.get("old_peaks")?)?,
        witness,
        new_peaks: strings(v.get("new_peaks")?)?,
    })
}

fn strings(v: &Value) -> Option<Vec<String>> {
    v.as_array()?
        .iter()
        .map(|s| s.as_str().map(str::to_string))
        .collect()
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

/// The words a rendered History never uses: continuity, a signature or a
/// receipt is never execution, and nothing ranks a node (PRD T5, §4).
#[cfg(test)]
pub const DENY_LIST: [&str; 8] = [
    "model executed",
    "verified model",
    "ran on",
    "attested",
    "score",
    "rating",
    "rank",
    "reputation",
];

/// The verified History as lines of text: each count with its unit, each
/// claim the host reported as what the provider states.
pub fn render(v: &Verified) -> Vec<String> {
    let mut lines = vec![
        format!("Service History, anchored at checkpoint {}", v.anchor),
        format!(
            "{} checkpoints: this log's own continuity, which says nothing about what was computed",
            v.checkpoints
        ),
    ];
    let verified = v
        .receipts
        .iter()
        .filter(|r| r.status == ReceiptStatus::Verified)
        .count();
    lines.push(if v.receipts.is_empty() {
        "witness receipts: no witness named".to_string()
    } else {
        format!(
            "witness receipts checked: {verified} of {} (a later rewrite of this log is detectable)",
            v.receipts.len()
        )
    });
    for (member, status) in &v.members {
        if *status == "not_checked" {
            lines.push(format!("{member}: carried, not checked by this verifier"));
        }
    }
    if let Some(summary) = &v.served_summary {
        let by_model = summary
            .pointer("/derivation/by_model")
            .and_then(Value::as_object);
        for (model, m) in by_model.into_iter().flatten() {
            let figure = |k: &str| m.get(k).map_or("unknown".to_string(), plain);
            lines.push(format!("model, as the provider states it: {model}"));
            lines.push(format!(
                "  served exchanges: {} ({} completed, {} failed)",
                figure("served"),
                figure("completed"),
                figure("failed")
            ));
            let quantizations: Vec<String> = m
                .get("quantizations")
                .and_then(Value::as_array)
                .map(|q| q.iter().map(plain).collect())
                .unwrap_or_default();
            if !quantizations.is_empty() {
                lines.push(format!(
                    "  quantization, as the provider states it: {}",
                    quantizations.join(", ")
                ));
            }
            let weights = |k: &str| {
                m.pointer(&format!("/weights_digest/{k}"))
                    .map_or("unknown".to_string(), plain)
            };
            lines.push(format!(
                "  weights digest, as the provider states it: present in {} served exchanges, absent in {}",
                weights("present"),
                weights("absent")
            ));
        }
        if let Some(n) = summary.pointer("/adjudications_received/value") {
            lines.push(format!(
                "referee verdicts received about this node's served exchanges (self-held): {}",
                plain(n)
            ));
        }
        if let Some(n) = summary.pointer("/selection/covered_entries") {
            lines.push(format!("records covered: {}", plain(n)));
        }
    }
    lines
}

/// A JSON value as text: a string without its quotes.
fn plain(v: &Value) -> String {
    v.as_str().map_or_else(|| v.to_string(), str::to_string)
}

#[cfg(test)]
mod tests;
