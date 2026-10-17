//! `service_history/1` (PRD T5, T6), against ledgers built in-process.

use super::*;
use crate::evidence_answer::{answer, split_wire, Outcome, Responder};
use crate::evidence_request_parity::{
    announced_keys, corpus_checkpoints, corpus_ledger, sealed, write_jsonl, NODE_KEY_SEED,
    RESPONDER_NODE,
};
use crate::requester_auth::{Keys, ReplayCache};
use capsule_emit_evidence_request::answer as er_answer;
use capsule_emit_evidence_request::digest::request_digest;
use capsule_emit_evidence_request::refusal;
use capsule_emit_evidence_request::request;
use ed25519_dalek::{Signer, SigningKey};

const NOW: &str = "2026-09-29T00:00:00Z";

fn node_key() -> SigningKey {
    SigningKey::from_bytes(&NODE_KEY_SEED)
}

/// A ledger directory: the corpus with `records` in place of its leaves
/// 8.., all under its first checkpoint.
fn node_with(records: &[Value]) -> (tempfile::TempDir, Vec<CheckpointRecord>) {
    let mut ledger = corpus_ledger();
    for (i, record) in records.iter().enumerate() {
        ledger[8 + i] = record.clone();
    }
    let dir = tempfile::tempdir().unwrap();
    write_jsonl(&dir.path().join("capsules.jsonl"), &ledger);
    let cps = corpus_checkpoints(&ledger, &node_key());
    let lines: Vec<Value> = cps
        .iter()
        .map(|cp| serde_json::to_value(cp).unwrap())
        .collect();
    write_jsonl(&dir.path().join("checkpoints.jsonl"), &lines);
    (dir, cps)
}

fn ask_as(dir: &std::path::Path, bytes: &[u8], share_standard_history: bool) -> Outcome {
    let key = node_key();
    let announced = announced_keys();
    answer(
        bytes,
        &Responder {
            ledger_dir: dir,
            signing_key: &key,
            now: NOW,
            history_segments: "counterparties",
            share_standard_history,
            share_exchange_corroboration: false,
            keys: Keys {
                announced: &announced,
                configured: None,
            },
            replay: &ReplayCache::default(),
            node_id: Some(RESPONDER_NODE),
        },
    )
}

/// Asked with Standard History shared: these tests are about the
/// projection, not who may have it.
fn ask(dir: &std::path::Path, bytes: &[u8]) -> Outcome {
    ask_as(dir, bytes, true)
}

fn request_for(derivation: &str, coverage: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "subject": {"full_history": null},
        "coverage": coverage,
        "derivation": derivation,
    }))
    .unwrap()
}

fn latest_pin(cps: &[CheckpointRecord]) -> Value {
    json!({"expected_pin": cps.last().unwrap().digest()})
}

fn wire_of(outcome: Outcome) -> Value {
    match outcome {
        Outcome::Answered { wire, .. } => wire,
        other => panic!("not answered: {other:?}"),
    }
}

fn refused(outcome: &Outcome) -> Option<Reason> {
    match outcome {
        Outcome::Refused { reason, .. } => Some(*reason),
        _ => None,
    }
}

fn artifact_of(wire: &Value) -> Value {
    serde_json::from_str(wire["artifact"].as_str().unwrap()).unwrap()
}

fn verified(sent: &[u8], wire: &Value) -> Result<Verified, String> {
    let req = request::parse_json(sent).unwrap();
    let (envelope, artifact, material) = split_wire(wire).unwrap();
    verify(
        envelope,
        artifact,
        material,
        &req,
        &request_digest(sent),
        &node_key().verifying_key(),
        &|_| None,
    )
}

/// `wire` with its artifact replaced by `artifact` and the envelope signed
/// again over it by the node key: what a responder that built a different
/// artifact would have sent.
fn resigned(wire: &Value, artifact: &Value) -> Value {
    let text = jcs::to_string(artifact).unwrap();
    let mut envelope = wire["envelope"].clone();
    envelope["artifact_digest"] = json!(hex::encode(Sha256::digest(text.as_bytes())));
    let body = jcs::to_string(&json!({
        "request_digest": envelope["request_digest"],
        "anchor": envelope["anchor"],
        "artifact_digest": envelope["artifact_digest"],
        "issued_at": envelope["issued_at"],
    }))
    .unwrap();
    envelope["sig"] = json!(hex::encode(node_key().sign(body.as_bytes()).to_bytes()));
    json!({"artifact": text, "material": wire["material"], "envelope": envelope})
}

// ----- the definition -----

#[test]
fn the_definition_digest_is_the_digest_of_the_definition_file() {
    let document: Value = serde_json::from_str(DEFINITION_DOCUMENT).unwrap();
    assert_eq!(document["name"], json!(DERIVATION_NAME));
    let bytes = jcs::to_string(&document).unwrap();
    assert_eq!(
        hex::encode(Sha256::digest(bytes.as_bytes())),
        DEFINITION_DIGEST
    );
    let members = document["members"].as_array().unwrap();
    let declared: Vec<(&str, bool)> = members
        .iter()
        .map(|m| {
            (
                m["name"].as_str().unwrap(),
                m["required"].as_bool().unwrap(),
            )
        })
        .collect();
    assert_eq!(declared, MEMBERS);
    // `reads` is the ordered union of the members' reads.
    let mut union: Vec<&Value> = Vec::new();
    for read in members.iter().flat_map(|m| m["reads"].as_array().unwrap()) {
        if !union.contains(&read) {
            union.push(read);
        }
    }
    let reads: Vec<&Value> = document["reads"].as_array().unwrap().iter().collect();
    assert_eq!(reads, union);
    let excludes = document["excludes"].as_array().unwrap();
    for named in ["requester identity", "per-recipient release state"] {
        assert!(
            excludes.iter().any(|e| e.as_str() == Some(named)),
            "{named}"
        );
    }
}

/// The served-summary entry names the served summary's own definition, and
/// declares the same record reads.
#[test]
fn the_served_summary_entry_names_the_served_summary_definition() {
    let document: Value = serde_json::from_str(DEFINITION_DOCUMENT).unwrap();
    let entry = &document["members"][1];
    assert_eq!(entry["name"], json!("served_summary"));
    assert_eq!(
        entry["derivation"],
        json!(crate::served_summary::SERVED_SUMMARY_DEFINITION_DIGEST)
    );
    assert_eq!(
        document["members"][0]["derivation"],
        json!(DERIVATION_HISTORY_CARD)
    );
    let summary: Value = serde_json::from_str(crate::served_summary::DEFINITION_DOCUMENT).unwrap();
    let records = |reads: &Value| -> std::collections::BTreeSet<String> {
        reads
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .filter(|r| r.starts_with("record: "))
            .map(str::to_string)
            .collect()
    };
    assert_eq!(records(&entry["reads"]), records(&summary["reads"]));
    assert_eq!(records(&entry["reads"]).len(), 13);
}

// ----- T6 -----

/// PRD T6: the embedded card is byte-identical to the direct `history_card/1`
/// answer for the same subject and anchor, its digest is
/// `history_card_digest`, and the direct answer verifies under -00.
#[test]
fn the_embedded_card_is_the_direct_card() {
    let (dir, cps) = node_with(&[]);
    let sent = request_for(DEFINITION_DIGEST, latest_pin(&cps));
    let history = artifact_of(&wire_of(ask(dir.path(), &sent)));
    let direct_sent = request_for(DERIVATION_HISTORY_CARD, latest_pin(&cps));
    let direct = wire_of(ask(dir.path(), &direct_sent));
    let direct_bytes = direct["artifact"].as_str().unwrap();
    assert_eq!(
        jcs::to_string(&history["history_card"]).unwrap(),
        direct_bytes
    );
    assert_eq!(
        history["history_card_digest"],
        json!(hex::encode(Sha256::digest(direct_bytes.as_bytes())))
    );
    let (envelope, artifact, material) = split_wire(&direct).unwrap();
    er_answer::verify(
        envelope,
        artifact,
        material,
        &request::parse_json(&direct_sent).unwrap(),
        &request_digest(&direct_sent),
        &node_key().verifying_key(),
        &crate::evidence_log::record_digest,
        &|_| None,
    )
    .unwrap();
    let v = verified(&sent, &wire_of(ask(dir.path(), &sent))).unwrap();
    assert_eq!(v.checkpoints, cps.len());
    assert_eq!(
        v.members.values().copied().collect::<Vec<_>>(),
        ["checked", "checked"]
    );
}

/// The card the -00 crate verifies, and how the port judges it, with every
/// tamper of the card's content: the two must agree on each (the port is a
/// port, not a second implementation).
#[test]
fn the_card_content_check_agrees_with_the_crate_on_every_fixture() {
    let (dir, cps) = node_with(&[]);
    let sent = request_for(DERIVATION_HISTORY_CARD, latest_pin(&cps));
    let direct = wire_of(ask(dir.path(), &sent));
    let card = artifact_of(&direct);
    let req = request::parse_json(&sent).unwrap();
    let digest = request_digest(&sent);
    let key = node_key().verifying_key();
    let anchor = cps.last().unwrap();

    let mut fixtures: Vec<(&str, Value)> = vec![("as served", card.clone())];
    let mut tamper = |name: &'static str, f: &dyn Fn(&mut Value)| {
        let mut c = card.clone();
        f(&mut c);
        fixtures.push((name, c));
    };
    tamper("a checkpoint's signature", &|c| {
        c["history"][0]["checkpoint"]["signature"] = json!("00".repeat(64));
    });
    tamper("a consistency proof", &|c| {
        c["history"][1]["consistency_from_previous"]["old_peaks"][0] = json!("ab".repeat(32));
    });
    tamper("a missing consistency proof", &|c| {
        c["history"][1]["consistency_from_previous"] = Value::Null;
    });
    tamper("the first checkpoint dropped", &|c| {
        c["history"].as_array_mut().unwrap().remove(0);
    });
    tamper("the checkpoints reordered", &|c| {
        c["history"].as_array_mut().unwrap().swap(0, 1);
    });
    tamper("the anchor not last", &|c| {
        c["history"].as_array_mut().unwrap().pop();
    });
    tamper("a receipt for another checkpoint", &|c| {
        let w = &mut c["history"][1]["checkpoint"]["witnesses"][0];
        w["is_stub"] = json!(false);
        w["entry_hash"] = json!("cd".repeat(32));
    });
    tamper("another derivation", &|c| {
        c["derivation"] = json!("checkpoints");
    });
    tamper("another stream", &|c| {
        c["evidence_stream"] = json!("another-log");
    });
    assert_eq!(fixtures.len(), 10);

    for (name, fixture) in &fixtures {
        let wire = resigned(&direct, fixture);
        let (envelope, artifact, material) = split_wire(&wire).unwrap();
        let crate_verdict = er_answer::verify(
            envelope,
            artifact,
            material,
            &req,
            &digest,
            &key,
            &crate::evidence_log::record_digest,
            &|_| None,
        )
        .map(|v| (v.checkpoints, v.receipts));
        let port_verdict = verify_card_content(fixture, anchor, &key, &|_| None);
        assert_eq!(port_verdict, crate_verdict, "{name}");
        if *name != "as served" {
            assert!(port_verdict.is_err(), "{name}");
        }
    }
}

// ----- answered and refused -----

#[test]
fn the_same_projection_goes_to_every_requester() {
    let (dir, cps) = node_with(&[]);
    let mut artifacts = Vec::new();
    for nonce in ["aa".repeat(16), "bb".repeat(16)] {
        let sent = serde_json::to_vec(&json!({
            "subject": {"full_history": null},
            "coverage": latest_pin(&cps),
            "derivation": DEFINITION_DIGEST,
            "nonce": nonce,
        }))
        .unwrap();
        let wire = wire_of(ask(dir.path(), &sent));
        verified(&sent, &wire).unwrap();
        artifacts.push(wire["artifact"].clone());
    }
    assert_eq!(artifacts[0], artifacts[1]);
}

#[test]
fn every_case_the_definition_refuses_is_refused() {
    let (dir, cps) = node_with(&[]);
    let older = json!({"expected_pin": cps[0].digest()});
    let cases: Vec<(&str, Vec<u8>, bool, Reason)> = vec![
        (
            "the name as a token",
            request_for(DERIVATION_NAME, latest_pin(&cps)),
            true,
            Reason::DerivationUnsupported,
        ),
        (
            "the fold's digest",
            request_for(crate::served_summary::DEFINITION_DIGEST, latest_pin(&cps)),
            true,
            Reason::DerivationUnsupported,
        ),
        (
            "another subject",
            serde_json::to_vec(&json!({"subject": {"checkpoints": null},
                "coverage": latest_pin(&cps), "derivation": DEFINITION_DIGEST}))
            .unwrap(),
            true,
            Reason::NoSuchSubject,
        ),
        (
            "min_freshness",
            request_for(DEFINITION_DIGEST, json!({"min_freshness": 1})),
            true,
            Reason::PolicyDeclined,
        ),
        // The served summary cannot be built under an older anchor, so the
        // projection is refused whole, never served without it.
        (
            "an older pin",
            request_for(DEFINITION_DIGEST, older),
            true,
            Reason::CoverageUnsatisfiable,
        ),
        (
            "Standard History not shared, asked unsigned",
            request_for(DEFINITION_DIGEST, latest_pin(&cps)),
            false,
            Reason::PolicyDeclined,
        ),
    ];
    for (name, sent, share, reason) in cases {
        let outcome = ask_as(dir.path(), &sent, share);
        assert_eq!(refused(&outcome), Some(reason), "{name}");
        let Outcome::Refused { wire, .. } = &outcome else {
            unreachable!()
        };
        assert_eq!(
            refusal::verify_for(wire, &node_key().verifying_key(), &request_digest(&sent)),
            Ok(reason),
            "{name}: signed and bound to the request"
        );
    }
}

/// The served summary is asked for by its definition digest or the legacy
/// token, and names the digest either way.
#[test]
fn the_served_summary_names_its_definition_digest_however_asked() {
    let (dir, cps) = node_with(&[]);
    for derivation in [
        crate::served_summary::SERVED_SUMMARY_DEFINITION_DIGEST,
        crate::served_summary::SERVED_SUMMARY_DERIVATION_TOKEN,
    ] {
        let sent = request_for(derivation, latest_pin(&cps));
        let wire = wire_of(ask(dir.path(), &sent));
        assert_eq!(
            artifact_of(&wire)["derivation"],
            json!(crate::served_summary::SERVED_SUMMARY_DEFINITION_DIGEST),
            "{derivation}"
        );
        let v = crate::evidence_answer::verify_response(
            &sent,
            &wire,
            &node_key().verifying_key(),
            &BTreeMap::new(),
        );
        assert_eq!(v["state"], json!("artifact"), "{derivation}: {v}");
    }
}

// ----- the verifier -----

#[test]
fn an_artifact_that_breaks_a_rule_of_the_definition_is_not_evidence() {
    let (dir, cps) = node_with(&[]);
    let sent = request_for(DEFINITION_DIGEST, latest_pin(&cps));
    let wire = wire_of(ask(dir.path(), &sent));
    let art = artifact_of(&wire);
    let mut cases: Vec<(&str, Value)> = Vec::new();
    let mut case = |name: &'static str, f: &dyn Fn(&mut Value)| {
        let mut a = art.clone();
        f(&mut a);
        cases.push((name, a));
    };
    case("an undeclared member", &|a| {
        a["extra"] = json!(1);
    });
    case("a declared member missing", &|a| {
        a.as_object_mut().unwrap().remove("served_summary");
    });
    case("the required member undeclared", &|a| {
        a["declared"] = json!(["served_summary"]);
        a.as_object_mut().unwrap().remove("history_card");
    });
    case("declared out of order", &|a| {
        a["declared"] = json!(["served_summary", "history_card"]);
    });
    case("a member the definition does not have", &|a| {
        a["declared"] = json!(["history_card", "peer_halves", "served_summary"]);
        a["peer_halves"] = json!({});
    });
    case("another projection", &|a| {
        a["projection"] = json!("ab".repeat(32));
    });
    case("a card that is not the digest's", &|a| {
        a["history_card_digest"] = json!("ab".repeat(32));
    });
    case("a summary for another anchor", &|a| {
        a["served_summary"]["anchor"] = json!("ab".repeat(32));
    });
    for (name, tampered) in cases {
        assert!(
            verified(&sent, &resigned(&wire, &tampered)).is_err(),
            "{name}"
        );
    }
    assert!(verified(&sent, &wire).is_ok());
}

/// A declared member this verifier does not implement is reported as not
/// checked, never failed or dropped, and the card is still checked.
#[test]
fn a_member_this_verifier_does_not_implement_is_not_checked() {
    let (dir, cps) = node_with(&[]);
    let sent = request_for(DEFINITION_DIGEST, latest_pin(&cps));
    let wire = wire_of(ask(dir.path(), &sent));
    let req = request::parse_json(&sent).unwrap();
    let (envelope, artifact, material) = split_wire(&wire).unwrap();
    let v = verify_with(
        envelope,
        artifact,
        material,
        &req,
        &request_digest(&sent),
        &node_key().verifying_key(),
        &|_| None,
        &["history_card"],
    )
    .unwrap();
    assert_eq!(v.members["history_card"], "checked");
    assert_eq!(v.members["served_summary"], "not_checked");
    assert_eq!(v.checkpoints, cps.len());
    assert!(render(&v)
        .iter()
        .any(|l| l == "served_summary: carried, not checked by this verifier"));
}

// ----- T5 -----

/// A served record claiming `weights` for `model`, answering with `answer`.
fn served_claiming(model: &str, weights: &str, answer: &str, i: usize) -> Value {
    sealed(json!({
        "action_type": "inference",
        "effect": {"status": "confirmed",
                   "response_digest": hex::encode(Sha256::digest(answer.as_bytes()))},
        "model_attestation": {"compute_attestation": {"x-mesh-poc-v1": {
            "role": "served",
            "latency_ms": "40",
            "temperature": 0,
            "exchange": i,
            "serving_provenance": {"model_canonical_ref": model, "quantization": "q8_0",
                                   "weights_digest": weights},
        }}},
    }))
}

fn denied_in(lines: &[String]) -> Vec<String> {
    lines
        .iter()
        .filter(|l| {
            let l = l.to_lowercase();
            DENY_LIST.iter().any(|d| l.contains(d))
        })
        .cloned()
        .collect()
}

/// PRD T5: two nodes claim the same weights digest and answer the same
/// temperature-0 request differently. Each History states the model and the
/// weights digest as what that provider states, and nothing in either says
/// or implies that it ran them.
#[test]
fn the_same_claimed_weights_with_different_answers_stay_what_each_provider_states() {
    let weights = "ee".repeat(32);
    let mut rendered = Vec::new();
    for answer_text in ["the answer is 4", "the answer is 5"] {
        let records: Vec<Value> = (0..5)
            .map(|i| served_claiming("model-w", &weights, answer_text, i))
            .collect();
        let (dir, cps) = node_with(&records);
        let sent = request_for(DEFINITION_DIGEST, latest_pin(&cps));
        let v = verified(&sent, &wire_of(ask(dir.path(), &sent))).unwrap();
        let lines = render(&v);
        assert_eq!(denied_in(&lines), Vec::<String>::new());
        assert!(lines
            .iter()
            .any(|l| l == "model, as the provider states it: model-w"));
        assert!(lines.iter().any(|l| l.starts_with(
            "  weights digest, as the provider states it: present in 5 served exchanges"
        )));
        assert!(lines
            .iter()
            .any(|l| l == "  quantization, as the provider states it: q8_0"));
        // The result the requester gets carries the same lines.
        assert_eq!(v.to_json()["lines"], json!(lines));
        rendered.push(lines);
    }
    // The two Histories differ only where the anchors and counts do; neither
    // asserts what was computed.
    for lines in &rendered {
        assert!(lines.iter().all(|l| !l.to_lowercase().contains("executed")));
    }
}

/// Every line a corpus History renders passes the deny-list, and every count
/// names its unit.
#[test]
fn a_rendered_history_names_each_unit_and_uses_no_denied_word() {
    let (dir, cps) = node_with(&[]);
    let sent = request_for(DEFINITION_DIGEST, latest_pin(&cps));
    let v = verified(&sent, &wire_of(ask(dir.path(), &sent))).unwrap();
    let lines = render(&v);
    assert_eq!(denied_in(&lines), Vec::<String>::new());
    for needle in [
        "checkpoints: this log's own continuity",
        "witness receipts checked: 0 of 1",
        "served exchanges",
        "referee verdicts received about this node's served exchanges (self-held)",
        "records covered",
    ] {
        assert!(lines.iter().any(|l| l.contains(needle)), "{needle}");
    }
}
