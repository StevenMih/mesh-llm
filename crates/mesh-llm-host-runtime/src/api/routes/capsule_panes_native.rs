//! Native (plugin-ledger) source for the Ledger tab's three accountability
//! panes -- [mesh-C3-ledger-tab-reads-plugin-not-sidecar].
//!
//! Reads `<ledger_dir>/capsules.jsonl` directly: the same on-disk shape
//! `capsules.rs` already serves raw, written interchangeably by
//! `capsule-producer`'s `ledger` module (the plugin, path 1) or
//! `capsule_sidecar.py`'s `NodeState` (the sidecar, path 2) --
//! `capsule-emit-mesh/plugins/capsule-producer/README.md`'s `ledger`
//! section. No sidecar process, no network call: same discipline as
//! `capsules.rs`'s own docstring.
//!
//! **Design checkpoint (recorded in the task's outbox stanza before this
//! file was written):** ported here vs. served by the plugin over its own
//! protocol (option B) -- option A (this file) wins the task's own test,
//! *"would the maintainers have to run anything of ours besides a
//! plugin?"* -- a local file read needs the plugin to have WRITTEN a
//! ledger, never a plugin that is also a request-time JSON server.
//!
//! **Scope of this first cut, verified against a live capsule-emit-mesh
//! checkout, not guessed.** Every field derivable from the raw ledger
//! records alone -- with no signature/chain re-verification and no data
//! this record's own writer didn't put there -- matches
//! `accountability_pane_routes.build_pane_{a,b,c}_json` byte-for-byte on a
//! plugin-shaped fixture (no checkpoint, no peer-fetch, no serving-
//! provenance block): capsule id/timestamp, `model_claimed`'s honest
//! last-resort default (`friendly_model_name`'s final fallback,
//! `capsule_mesh_viewer.py:365`, always `"local model"` when no serving-
//! provenance data has landed yet), the six Pane-A rungs' structural
//! defaults (`freshness`/`runtime_binding`/`tee_citation`/
//! `hardware_inventory` = `"absent"`, `cross_party` = `unilateral_fallback`,
//! `log_integrity` = `"present-unverified"` -- `verify_ok is None` reads as
//! "present, not yet independently verified", never a fabricated PASS/
//! FAIL), exchange grouping (`exchange_key_for`), and role labelling
//! (`label_role`, `source_log = "plugin"`, whose own default-by-source
//! table already says a plugin-written record is always this node acting
//! as the serving PROVIDER -- `capsule_mesh_view.py:81-83`).
//!
//! Two tranches stay `NOT_CHECKED`/absent/null on purpose, matching gaps
//! `accountability_pane_routes.py`'s own docstring already names, not new
//! ones this cut invented:
//!
//! 1. **Peer-fetch cells** (Pane B's `history`/`served`/`verdicts`) --
//!    "peer tranche is E9/E10, deferred pending Steven's Q4 ruling"
//!    (`accountability_pane_routes.py:17-20`). Their real payloads carry
//!    long operator-facing prose and `mine_for_reference` sub-structures
//!    that exist only to explain an already-deferred gap; duplicating that
//!    prose here would be two copies of the same UI copy to keep in sync,
//!    not a second implementation of a check.
//! 2. **The nine-key assurance map** (Pane C's `properties`/`header_state`,
//!    Pane A's `verify_ok`) -- `content_binding`/`continuity` recompute the
//!    capsule's own JCS digest and hash-chain link, `producer_signature`
//!    verifies its COSE_Sign1 statement. All three are real cryptographic
//!    re-verification, already written once in Rust in capsule-producer's
//!    `jcs`/`cose`/`verify` modules -- porting that in is real, bounded
//!    follow-on work, deliberately out of this cut so it doesn't ship as a
//!    silent partial implementation that looks byte-exact and quietly
//!    diverges the day a tampered record lands.

use serde_json::{Value, json};
use std::path::Path;

/// Sentinel for "this mechanism exists but isn't wired for a plugin-ledger
/// read yet" -- never fabricated, never the sidecar's own computed value.
const NOT_CHECKED: &str = "NOT_CHECKED";
/// `capsule_exchange_tab.STATE_PRESENT_UNVERIFIED` / `STATE_ABSENT` --
/// these two ARE purely structural (presence of a record, not a claim
/// about its contents) and are safe to compute without any crypto port.
const STATE_PRESENT_UNVERIFIED: &str = "present-unverified";
const STATE_ABSENT: &str = "absent";
/// `peer_accountability_tab.CELL_UNILATERAL` / `CELL_PRESENT`.
const CELL_UNILATERAL: &str = "unilateral";
const CELL_PRESENT: &str = "present";
/// `capsule_mesh_viewer.friendly_model_name`'s unconditional last-resort
/// fallback (`capsule_mesh_viewer.py:365`) when no serving-provenance
/// architecture/parameter_size/ref data is on the record -- true of every
/// plugin-written record until the serving-provenance protocol PR lands.
const MODEL_CLAIMED_FALLBACK: &str = "local model";

fn not_checked_state() -> Value {
    json!({ "state": NOT_CHECKED })
}

/// Parses `<ledger_dir>/capsules.jsonl`, one JSON object per line, same as
/// `ledger_store_backend._read_flat_capsules_page`'s `json.loads(line)`.
/// A missing file or an unparsable line is dropped, never a panic --
/// mirrors `capsules.rs`'s own "file absent -> 404, not error" discipline.
pub(super) fn read_capsule_records(ledger_dir: &Path) -> Vec<Value> {
    let path = ledger_dir.join("capsules.jsonl");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect()
}

fn request_digest(record: &Value) -> Option<&str> {
    record
        .pointer("/effect/request_digest")
        .and_then(Value::as_str)
}

/// `x-mesh-poc-v1` block, `capsule_mesh_view._poc_block`.
fn poc_block(record: &Value) -> Option<&Value> {
    record.pointer("/model_attestation/compute_attestation/x-mesh-poc-v1")
}

/// `x-mesh-lifecycle-v1` block, `capsule_mesh_view._lifecycle_block`.
fn lifecycle_block(record: &Value) -> Option<&Value> {
    record.pointer("/model_attestation/compute_attestation/x-mesh-lifecycle-v1")
}

/// `capsule_exchange_tab.exchange_key_for`: the serving-provenance
/// `exchange_id` when a later protocol PR has populated it
/// (`capsule_mesh_viewer.serving_provenance` reads
/// `poc.serving_provenance.exchange_id`), else `digest:<request_digest>`,
/// else `None` (nothing to group this record by).
fn exchange_key_for(record: &Value) -> Option<String> {
    if let Some(id) = poc_block(record)
        .and_then(|poc| poc.pointer("/serving_provenance/exchange_id"))
        .and_then(Value::as_str)
        && !id.is_empty()
        && id != "unknown"
    {
        return Some(id.to_string());
    }
    request_digest(record).map(|digest| format!("digest:{digest}"))
}

/// `capsule_mesh_view.label_role`, source_log fixed to `"plugin"` --
/// this route's records are always plugin-ledger reads, never sidecar
/// ones. `_EXPLICIT_POC_ROLES` = `{requested, served, conflict, unknown}`,
/// trusted as-is per the 2026-09-06 role ruling; `_SERVED_OBSERVATION_
/// POINTS` widens an explicit-but-unset case; `_DEFAULT_ROLE_BY_SOURCE`
/// for `"plugin"` is `"served"` (`capsule_mesh_view.py:81-83`) -- both of
/// today's real writers (sidecar, plugin) observe this machine acting as
/// the serving provider, never a requestor elsewhere.
fn label_role(record: &Value) -> &'static str {
    if let Some(role) = poc_block(record)
        .and_then(|poc| poc.get("role"))
        .and_then(Value::as_str)
    {
        match role {
            "requested" => return "requested",
            "served" => return "served",
            "conflict" => return "conflict",
            "unknown" => return "unknown",
            _ => {}
        }
    }
    const SERVED_OBSERVATION_POINTS: &[&str] = &[
        "gateway_ingress",
        "serving_host_ingress",
        "backend_dispatch",
        "client_egress",
    ];
    if let Some(point) = lifecycle_block(record)
        .and_then(|lc| lc.get("observation_point"))
        .and_then(Value::as_str)
        && SERVED_OBSERVATION_POINTS.contains(&point)
    {
        return "served";
    }
    "served"
}

/// `capsule_exchange_tab.EXCHANGE_ROLE_SERVED` / `_ASKED`.
fn role_tag(record: &Value) -> &'static str {
    if label_role(record) == "served" {
        "SERVED"
    } else {
        "ASKED"
    }
}

/// Pane A ("This node") -- `capsule_accountability_tab.build_tab_payload`,
/// restricted to the fields this cut computes for real (see module docs).
pub(super) fn build_pane_a(records: &[Value]) -> Value {
    let operator = records
        .iter()
        .rev()
        .find_map(|r| r.get("operator").cloned())
        .unwrap_or(Value::Null);
    let rows: Vec<Value> = records
        .iter()
        .map(|record| {
            json!({
                "capsule_id": record.get("capsule_id").cloned().unwrap_or(Value::Null),
                "timestamp": record.get("timestamp").cloned().unwrap_or(Value::Null),
                // No serving-provenance block on a plugin-written record
                // yet -- `friendly_model_name`'s honest last resort, not a
                // guess (verified against a live capsule-emit-mesh run).
                "model_claimed": MODEL_CLAIMED_FALLBACK,
                "hardware_claimed": Value::Null,
                "verify_ok": Value::Null,
                "rungs": {
                    "freshness": { "state": STATE_ABSENT, "client_nonce_source": Value::Null },
                    "cross_party": {
                        "rung": "unilateral_fallback",
                        "identity_limitation": Value::Null,
                        "unverifiable_claim": Value::Null,
                    },
                    "runtime_binding": { "state": STATE_ABSENT },
                    "tee_citation": { "state": STATE_ABSENT },
                    "hardware_inventory": { "state": STATE_ABSENT },
                    // `verify_ok is None` -> "present, not yet
                    // independently verified" -- structural, not a
                    // fabricated PASS/FAIL (see module docs, gap 2).
                    "log_integrity": {
                        "state": STATE_PRESENT_UNVERIFIED,
                        "witness_checkpoint_supplied": false,
                    },
                },
                "record": record,
            })
        })
        .collect();
    json!({
        "operator": operator,
        "witness_checkpoint_supplied": false,
        "rows": rows,
        "card": Value::Null,
    })
}

/// `peer_accountability_tab.pair_cell`'s "nothing to reconcile" state is
/// only real when no record carries an `exchange_id` at all (the digest
/// match it would otherwise reconcile is not ported here, see module
/// docs) -- honest `NOT_CHECKED` the moment one shows up, not a fabricated
/// "absent" over data this cut never looked at.
fn pair_cell(records: &[Value]) -> Value {
    let any_exchange_id = records.iter().any(|r| {
        poc_block(r)
            .and_then(|poc| poc.pointer("/serving_provenance/exchange_id"))
            .and_then(Value::as_str)
            .is_some_and(|id| !id.is_empty() && id != "unknown")
    });
    if any_exchange_id {
        return not_checked_state();
    }
    json!({
        "state": STATE_ABSENT,
        "text": "no exchange_id on these records -- nothing to reconcile",
        "verified": 0,
        "failed": 0,
        "missing": 0,
    })
}

/// Pane B ("Peers") -- `peer_accountability_tab.build_peers_payload`. No
/// counterparty-identity field exists on a plugin-written record today, so
/// every record groups under the same `UNKNOWN_PEER` bucket
/// (`peer_accountability_tab.py:156`) -- one row, never fabricated peer
/// identities.
pub(super) fn build_pane_b(records: &[Value]) -> Value {
    if records.is_empty() {
        return json!({
            "peer_count": 0,
            "rows": [],
            "peer_fetch_enabled": false,
            "peer_fetch_count": 0,
        });
    }
    let mut timestamps: Vec<&str> = records
        .iter()
        .filter_map(|r| r.get("timestamp").and_then(Value::as_str))
        .collect();
    timestamps.sort_unstable();
    let first_seen = timestamps.first().copied();
    let last_seen = timestamps.last().copied();

    // `role_and_count_cell`: every record defaults to `label_role ==
    // "served"` in this cut (see module docs), so `them_to_you_count`
    // always equals the group size and `you_to_them_count` is always 0.
    // Kept as a real per-record fold (not a shortcut) so it stays correct
    // once an explicit `requested` role starts appearing on some records.
    let served_count = records.iter().filter(|r| label_role(r) == "served").count();
    let requested_count = records
        .iter()
        .filter(|r| label_role(r) == "requested")
        .count();
    let total = records.len();
    let (role, role_text) = if requested_count > 0 && served_count > 0 {
        (
            "both",
            format!("both · {total} ({requested_count} you→them, {served_count} them→you)"),
        )
    } else if requested_count > 0 {
        ("you_to_them", format!("you→them · {requested_count}"))
    } else if served_count > 0 {
        ("them_to_you", format!("them→you · {served_count}"))
    } else {
        ("unknown", format!("unknown role · {total}"))
    };

    // `rung_cell`: worst cross-party rung across the group. Every record
    // is `unilateral_fallback` in this cut (no counterparty identity data
    // on a plugin-written record yet), so there is exactly one distinct
    // rung and the cell state is `CELL_UNILATERAL`.
    let distinct_rungs = vec!["unilateral_fallback"];

    let row = json!({
        "peer_id": Value::Null,
        "node": {
            "state": STATE_ABSENT,
            "text": format!(
                "no counterparty evidence for these {total} exchange(s) -- unattributed, not one identified peer"
            ),
            "peer_id": Value::Null,
            "member_kind": Value::Null,
            "exchange_count": total,
        },
        "rung": {
            "state": CELL_UNILATERAL,
            "text": "unilateral_fallback",
            "rung": "unilateral_fallback",
            "distinct_rungs": distinct_rungs,
            "identity_limitation": Value::Null,
        },
        "role": {
            "state": CELL_PRESENT,
            "text": role_text,
            "role": role,
            "you_to_them_count": requested_count,
            "them_to_you_count": served_count,
            "exchange_count": total,
        },
        // Peer-fetch tranche -- deferred, not computed here (module docs,
        // gap 1): the sidecar's own real payload for these three carries
        // long operator-facing prose this cut does not duplicate.
        "history": not_checked_state(),
        "served": not_checked_state(),
        "pair": pair_cell(records),
        "verdicts": not_checked_state(),
        "asked": {
            "state": STATE_ABSENT,
            "text": "Not yet counted — this node doesn't persist served/refused counts.",
            "count": 0,
        },
        "exchange_count": total,
        "first_seen": first_seen,
        "last_seen": last_seen,
    });
    json!({
        "peer_count": 1,
        "rows": [row],
        "peer_fetch_enabled": false,
        "peer_fetch_count": 0,
    })
}

/// Pane C ("This exchange") list mode -- `capsule_exchange_tab.
/// build_exchange_list_payload`. `default_sort`/`filters` are the exact
/// literal constants from capsule-emit-mesh main (`capsule_exchange_tab.py
/// :549-552,764`), not guessed.
pub(super) fn build_pane_c_list(records: &[Value]) -> Value {
    let mut rows = Vec::new();
    for record in records {
        let Some(exchange_key) = exchange_key_for(record) else {
            continue;
        };
        rows.push(json!({
            "exchange_key": exchange_key,
            "role_tag": role_tag(record),
            // `header_state`/`properties`/`has_issue` need the assurance
            // map (`capsule_exchange_tab.build_assurance_map`), which is
            // cryptographic re-verification -- out of this cut, see module
            // docs. Real Python, given the same record, would NOT report
            // "absent" here (content_binding/producer_signature/continuity
            // are computable offline); this is the one deliberate,
            // documented non-parity gap in this cut.
            "header_state": STATE_ABSENT,
            "properties": Value::Null,
            "has_issue": false,
            "mine": {
                "state": STATE_PRESENT_UNVERIFIED,
                "capsule_id": record.get("capsule_id").cloned().unwrap_or(Value::Null),
                "role": label_role(record),
            },
            "theirs": {
                "state": STATE_ABSENT,
                "text": "none (unilateral)",
                "capsule_id": Value::Null,
            },
            "unilateral": true,
            "timestamp": record.get("timestamp").cloned().unwrap_or(Value::Null),
        }));
    }
    json!({
        "row_count": rows.len(),
        "default_sort": "timestamp",
        "filters": ["all", "served", "asked", "issues"],
        "rows": rows,
        "next_after_seq": Value::Null,
        "archived_segments": [],
    })
}

/// Pane C drill-down (`exchange_id` supplied) -- `capsule_exchange_tab.
/// build_exchange_view`, same field-availability restriction as the list.
pub(super) fn build_pane_c_drilldown(records: &[Value], exchange_id: &str) -> Value {
    let group: Vec<&Value> = records
        .iter()
        .filter(|r| exchange_key_for(r).as_deref() == Some(exchange_id))
        .collect();
    let Some(anchor) = group.first() else {
        return json!({ "exchange_key": exchange_id, "found": false });
    };
    json!({
        "exchange_key": exchange_id,
        "found": true,
        "view": {
            "capsule_id": anchor.get("capsule_id").cloned().unwrap_or(Value::Null),
            "role": label_role(anchor),
            "properties": Value::Null,
        },
    })
}

/// Dispatches on the pane name (`is_route`/`ALLOWED_PANES` in
/// `capsule_panes.rs` already validated it), reading the ledger fresh on
/// every call -- same "never cache" discipline as
/// `accountability_pane_routes.py`'s own module docstring.
pub(super) fn build_pane_json(
    pane: &str,
    ledger_dir: &Path,
    exchange_id: Option<&str>,
) -> Option<Value> {
    let records = read_capsule_records(ledger_dir);
    match pane {
        "pane-a" => Some(build_pane_a(&records)),
        "pane-b" => Some(build_pane_b(&records)),
        "pane-c" => Some(match exchange_id {
            Some(id) if !id.is_empty() => build_pane_c_drilldown(&records, id),
            _ => build_pane_c_list(&records),
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn fixture_record(
        capsule_id: &str,
        timestamp: &str,
        request_digest: &str,
        parent: Option<&str>,
    ) -> Value {
        let mut record = json!({
            "capsule_id": capsule_id,
            "timestamp": timestamp,
            "operator": "capsule-emit-mesh-poc-demo",
            "effect": { "request_digest": request_digest, "response_digest": "resp" },
            "model_attestation": { "compute_attestation": { "runtime": "x" } },
        });
        if let Some(parent_id) = parent {
            record["chain"] = json!({ "parent_capsule_id": parent_id, "relation": "confirms" });
        }
        record
    }

    fn write_fixture_ledger(dir: &Path, records: &[Value]) {
        std::fs::create_dir_all(dir).unwrap();
        let mut file = std::fs::File::create(dir.join("capsules.jsonl")).unwrap();
        for record in records {
            writeln!(file, "{}", serde_json::to_string(record).unwrap()).unwrap();
        }
    }

    #[test]
    fn missing_ledger_dir_yields_empty_records_not_a_panic() {
        let dir = std::env::temp_dir().join("mesh-c3-missing-ledger-test");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(read_capsule_records(&dir).is_empty());
    }

    /// Every field here is pinned against a REAL `build_pane_a_json` run on
    /// capsule-emit-mesh main against the identical fixture record (see
    /// capsule-emit-mesh's `tests/test_mesh_llm_pane_parity.py`, which pins
    /// the same values from the Python side) -- not a guess.
    #[test]
    fn pane_a_matches_the_python_reference_on_a_plugin_shaped_fixture() {
        let records = vec![fixture_record(
            "cap-1",
            "2026-09-01T00:00:00Z",
            "req-1",
            None,
        )];
        let pane = build_pane_a(&records);
        assert_eq!(pane["witness_checkpoint_supplied"], json!(false));
        assert_eq!(pane["operator"], json!("capsule-emit-mesh-poc-demo"));
        let row = &pane["rows"][0];
        assert_eq!(row["capsule_id"], json!("cap-1"));
        assert_eq!(row["verify_ok"], Value::Null);
        assert_eq!(row["model_claimed"], json!("local model"));
        assert_eq!(row["hardware_claimed"], Value::Null);
        assert_eq!(row["rungs"]["freshness"]["state"], json!("absent"));
        assert_eq!(
            row["rungs"]["cross_party"]["rung"],
            json!("unilateral_fallback")
        );
        assert_eq!(row["rungs"]["runtime_binding"]["state"], json!("absent"));
        assert_eq!(row["rungs"]["tee_citation"]["state"], json!("absent"));
        assert_eq!(row["rungs"]["hardware_inventory"]["state"], json!("absent"));
        assert_eq!(
            row["rungs"]["log_integrity"]["state"],
            json!("present-unverified")
        );
    }

    /// Same parity discipline as the Pane A test above, against
    /// `build_pane_b_json` on capsule-emit-mesh main. Split across two
    /// tests (this one + the "cells" test below) purely to keep each one's
    /// assertion count low -- both exercise the SAME `records` fixture.
    #[test]
    fn pane_b_matches_the_python_reference_on_a_plugin_shaped_fixture() {
        let records = vec![
            fixture_record("cap-1", "2026-09-01T00:00:00Z", "req-1", None),
            fixture_record("cap-2", "2026-09-02T00:00:00Z", "req-2", Some("cap-1")),
        ];
        let pane = build_pane_b(&records);
        assert_eq!(pane["peer_count"], json!(1));
        let row = &pane["rows"][0];
        assert_eq!(row["exchange_count"], json!(2));
        assert_eq!(row["first_seen"], json!("2026-09-01T00:00:00Z"));
        assert_eq!(row["last_seen"], json!("2026-09-02T00:00:00Z"));
        assert_eq!(row["node"]["state"], json!("absent"));
        assert_eq!(
            row["node"]["text"],
            json!(
                "no counterparty evidence for these 2 exchange(s) -- unattributed, not one identified peer"
            )
        );
    }

    #[test]
    fn pane_b_cells_match_the_python_reference_on_a_plugin_shaped_fixture() {
        let records = vec![
            fixture_record("cap-1", "2026-09-01T00:00:00Z", "req-1", None),
            fixture_record("cap-2", "2026-09-02T00:00:00Z", "req-2", Some("cap-1")),
        ];
        let pane = build_pane_b(&records);
        let row = &pane["rows"][0];
        assert_eq!(row["rung"]["state"], json!("unilateral"));
        assert_eq!(row["rung"]["rung"], json!("unilateral_fallback"));
        assert_eq!(
            row["rung"]["distinct_rungs"],
            json!(["unilateral_fallback"])
        );
        assert_eq!(row["role"]["state"], json!("present"));
        assert_eq!(row["role"]["role"], json!("them_to_you"));
        assert_eq!(row["role"]["them_to_you_count"], json!(2));
        assert_eq!(row["role"]["you_to_them_count"], json!(0));
        assert_eq!(row["pair"]["state"], json!("absent"));
        assert_eq!(row["pair"]["missing"], json!(0));
        assert_eq!(row["asked"]["state"], json!("absent"));
        assert_eq!(row["asked"]["count"], json!(0));
        // Peer-fetch tranche -- deliberately not ported, module docs gap 1.
        assert_eq!(row["history"]["state"], json!(NOT_CHECKED));
        assert_eq!(row["served"]["state"], json!(NOT_CHECKED));
        assert_eq!(row["verdicts"]["state"], json!(NOT_CHECKED));
    }

    #[test]
    fn pane_b_pair_cell_is_not_checked_rather_than_fabricated_absent_once_an_exchange_id_appears() {
        let mut record = fixture_record("cap-1", "2026-09-01T00:00:00Z", "req-1", None);
        record["model_attestation"]["compute_attestation"]["x-mesh-poc-v1"] =
            json!({ "serving_provenance": { "exchange_id": "exch-real" } });
        let pane = build_pane_b(&[record]);
        assert_eq!(pane["rows"][0]["pair"]["state"], json!(NOT_CHECKED));
    }

    #[test]
    fn pane_b_on_an_empty_ledger_has_zero_peers_not_a_fabricated_row() {
        let pane = build_pane_b(&[]);
        assert_eq!(pane["peer_count"], json!(0));
        assert_eq!(pane["rows"], json!([]));
    }

    #[test]
    fn pane_c_groups_by_digest_when_no_exchange_id_and_tags_served_by_default() {
        let records = vec![
            fixture_record("cap-1", "2026-09-01T00:00:00Z", "req-1", None),
            fixture_record("cap-2", "2026-09-02T00:00:00Z", "req-2", Some("cap-1")),
        ];
        let pane = build_pane_c_list(&records);
        assert_eq!(pane["row_count"], json!(2));
        assert_eq!(pane["default_sort"], json!("timestamp"));
        assert_eq!(pane["rows"][0]["exchange_key"], json!("digest:req-1"));
        assert_eq!(pane["rows"][0]["role_tag"], json!("SERVED"));
        assert_eq!(pane["rows"][0]["unilateral"], json!(true));
        assert_eq!(pane["rows"][0]["theirs"]["state"], json!(STATE_ABSENT));
        assert_eq!(
            pane["rows"][0]["mine"]["state"],
            json!(STATE_PRESENT_UNVERIFIED)
        );
        // The one deliberate non-parity gap in this cut (see module docs):
        // real Python computes a real header_state/properties here via the
        // assurance map; this cut has not ported that verification.
        assert_eq!(pane["rows"][0]["header_state"], json!(STATE_ABSENT));
        assert_eq!(pane["rows"][0]["properties"], Value::Null);
    }

    #[test]
    fn pane_c_drilldown_finds_by_exchange_key_and_reports_not_found_honestly() {
        let records = vec![fixture_record(
            "cap-1",
            "2026-09-01T00:00:00Z",
            "req-1",
            None,
        )];
        let found = build_pane_c_drilldown(&records, "digest:req-1");
        assert_eq!(found["found"], json!(true));
        assert_eq!(found["view"]["capsule_id"], json!("cap-1"));

        let not_found = build_pane_c_drilldown(&records, "digest:nonexistent");
        assert_eq!(not_found["found"], json!(false));
        assert!(not_found.get("view").is_none());
    }

    #[test]
    fn label_role_defaults_a_plugin_written_record_to_served() {
        let record = fixture_record("cap-1", "2026-09-01T00:00:00Z", "req-1", None);
        assert_eq!(label_role(&record), "served");
        assert_eq!(role_tag(&record), "SERVED");
    }

    #[test]
    fn label_role_trusts_an_explicit_poc_role_over_the_default() {
        let mut record = fixture_record("cap-1", "2026-09-01T00:00:00Z", "req-1", None);
        record["model_attestation"]["compute_attestation"]["x-mesh-poc-v1"] =
            json!({ "role": "requested" });
        assert_eq!(label_role(&record), "requested");
        assert_eq!(role_tag(&record), "ASKED");
    }

    #[test]
    fn exchange_key_for_prefers_serving_provenance_exchange_id_over_digest() {
        let mut record = fixture_record("cap-1", "2026-09-01T00:00:00Z", "req-1", None);
        record["model_attestation"]["compute_attestation"]["x-mesh-poc-v1"] =
            json!({ "serving_provenance": { "exchange_id": "exch-real" } });
        assert_eq!(exchange_key_for(&record).as_deref(), Some("exch-real"));
    }

    #[test]
    fn build_pane_json_reads_a_real_fixture_ledger_directory() {
        let dir = std::env::temp_dir().join("mesh-c3-fixture-ledger-test");
        let records = vec![fixture_record(
            "cap-1",
            "2026-09-01T00:00:00Z",
            "req-1",
            None,
        )];
        write_fixture_ledger(&dir, &records);

        let pane_a = build_pane_json("pane-a", &dir, None).unwrap();
        assert_eq!(pane_a["rows"][0]["capsule_id"], json!("cap-1"));

        let pane_c = build_pane_json("pane-c", &dir, Some("digest:req-1")).unwrap();
        assert_eq!(pane_c["found"], json!(true));

        assert!(build_pane_json("pane-z", &dir, None).is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
