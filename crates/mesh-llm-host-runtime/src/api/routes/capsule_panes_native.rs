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
//! provenance data has landed yet), the Pane-A rungs' structural
//! defaults (`freshness`/`runtime_binding`/`tee_citation`/
//! `hardware_inventory` = `"absent"`, `log_integrity` =
//! `"present-unverified"` -- `verify_ok is None` reads as "present, not
//! yet independently verified", never a fabricated PASS/FAIL), exchange
//! grouping (`exchange_key_for`), and role labelling (`label_role`,
//! `source_log = "plugin"`, whose own default-by-source table already
//! says a plugin-written record is always this node acting as the
//! serving PROVIDER -- `capsule_mesh_view.py:81-83`).
//!
//! **[ledger-T3-vocabulary-and-states] retirement, native reader only:**
//! Pane A's `cross_party` cell and Pane B's per-row cross-party cell used
//! to carry the `rung`/`unilateral_fallback` ladder word (still live in
//! `capsule_accountability_tab.py`/`peer_accountability_tab.py` upstream,
//! matching `f0e3af6`'s note that Pane A/B were explicitly out of that
//! task's scope). This demo runs native/sidecar-DOWN, so THIS reader is
//! where a stranger reading the raw pane JSON would actually see the
//! retired word -- both cells now emit the same five-state property-map
//! shape (`state`/`text`, `state` one of `PASS`/`FAIL`/`NOT_PRESENT`/
//! `NOT_CHECKED`/`INCONCLUSIVE`) Pane C's `properties` map already uses,
//! always `NOT_PRESENT` here (no counterparty identity data exists on a
//! plugin-written record yet -- the same honest absence the old rung
//! value encoded, in the current vocabulary). This is a deliberate,
//! documented non-parity divergence from the Python reference (which
//! hasn't migrated Pane A/B yet) -- not a byte-for-byte port gap.
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
/// `peer_accountability_tab.CELL_PRESENT`.
const CELL_PRESENT: &str = "present";
/// Five-state property map (`PaneCRow.properties`'s wire vocabulary,
/// `assurance-tone.ts`'s `CHIP_TONE`/`CHIP_LABEL` keys) -- what Pane A's
/// `cross_party` cell and Pane B's per-row cross-party cell render now
/// instead of the retired `rung`/`unilateral_fallback` ladder word
/// ([ledger-T3-vocabulary-and-states]).
const STATE_NOT_PRESENT: &str = "NOT_PRESENT";
/// The honest text for "no counterparty identity data exists on a
/// plugin-written record yet" -- the same fact the old `unilateral_fallback`
/// rung value encoded, worded in the current vocabulary.
const NO_COUNTERPARTY_EVIDENCE_TEXT: &str = "no counterparty evidence for this record";
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

/// Reads `<ledger_dir>/checkpoints.jsonl` (co-located with `capsules.jsonl`,
/// written by the plugin's checkpoint cadence via `cll::store` -- one JSON
/// object per line, the same on-disk shape `accountability_pane_routes.py`
/// reads for its own card face) and builds Pane A's `card`.
///
/// The count is the number of real checkpoint lines on disk: 0 when the file
/// is absent or empty -- which `integrity-view.ts` renders as "no checkpoint
/// yet", the honest empty state, never a fabricated registration. When at
/// least one checkpoint exists, the latest one's `timestamp` becomes
/// `registered_no_later_than` and its `witnesses` (the external receipts, or
/// an honest `[]` for a self-checkpointed node) are surfaced -- exactly the
/// fields the Integrity view reads off `card`. `build_pane_a` hardcoded
/// `card: null` before this, so a real on-disk checkpoint never showed.
fn read_checkpoint_card(ledger_dir: &Path) -> Value {
    let path = ledger_dir.join("checkpoints.jsonl");
    let checkpoints: Vec<Value> = match std::fs::read_to_string(&path) {
        Ok(text) => text
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .collect(),
        Err(_) => Vec::new(),
    };
    let mut card = json!({ "checkpoint_count": checkpoints.len() });
    if let Some(latest) = checkpoints.last() {
        if let Some(ts) = latest.get("timestamp").and_then(Value::as_str) {
            card["registered_no_later_than"] = json!(ts);
        }
        card["witnesses"] = latest
            .get("witnesses")
            .cloned()
            .unwrap_or_else(|| json!([]));
        if let Some(root) = latest.get("root").and_then(Value::as_str) {
            card["latest_root"] = json!(root);
        }
        if let Some(size) = latest.get("mmr_size") {
            card["latest_mmr_size"] = size.clone();
        }
    }
    card
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

/// [ledger-T11b-twin-bracket] the id shared by BOTH halves of an ambient
/// twin comparison, forwarded verbatim by the capsule-producer plugin off
/// the terminal envelope's own `twin_bracket_id` -- rides alongside
/// `exchange_id` under `x-mesh-poc-v1.serving_provenance` (the sibling
/// convention `exchange_key_for` already reads). `None` on every record
/// that wasn't ambiently twinned (the overwhelming majority) -- never a
/// fabricated bracket.
fn twin_bracket_id(record: &Value) -> Option<&str> {
    poc_block(record)
        .and_then(|poc| poc.pointer("/serving_provenance/twin_bracket_id"))
        .and_then(Value::as_str)
}

/// `[mesh-e9e10-pieces-2-4]` piece 3: the join key piece 1
/// (`admission-policy::lifecycle_channel::peer_capsule_id_for_seal`) already
/// threads onto a `RemoteMesh` record -- `serving_provenance.peer_capsule_id`
/// is only ever non-null when `peer_capsule_id_provenance` is the literal
/// `"peer_asserted"` (never `self_minted`/`unknown`, the mislabeling guard's
/// whole point). `None` here means "nothing this node knows how to fetch",
/// never a guess.
fn peer_fetch_join_key(record: &Value) -> Option<(&str, &str)> {
    let sp = poc_block(record)?.get("serving_provenance")?;
    if sp.get("peer_capsule_id_provenance").and_then(Value::as_str) != Some("peer_asserted") {
        return None;
    }
    let capsule_id = sp
        .get("peer_capsule_id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())?;
    let peer_id = sp
        .get("served_by_node_id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty() && *id != "unknown")?;
    Some((capsule_id, peer_id))
}

/// Pane C row `theirs` cell (`capsule_exchange_tab`'s own field). `NOT_CHECKED`
/// -- not `absent` -- the moment a real peer-asserted join key exists: the
/// peer half is KNOWN to be fetchable (`ledger-fetch/1`, piece 2's
/// `mesh_ledger_fetch` plugin tool, already reachable at
/// `POST /api/plugins/admission-policy/tools/mesh_ledger_fetch`), only
/// unverified until the browser's own recompute actually runs one -- this
/// route never fetches, verifies, or fabricates a verdict itself.
fn theirs_cell(record: &Value) -> Value {
    match peer_fetch_join_key(record) {
        Some((capsule_id, peer_id)) => json!({
            "state": NOT_CHECKED,
            "text": "peer capsule known -- fetch to recompute",
            "capsule_id": capsule_id,
            "peer_id": peer_id,
        }),
        None => json!({
            "state": STATE_ABSENT,
            "text": "none (unilateral)",
            "capsule_id": Value::Null,
        }),
    }
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
pub(super) fn build_pane_a(records: &[Value], card: Value) -> Value {
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
                    // [ledger-T3-vocabulary-and-states]: five-state property
                    // map, not the retired rung ladder -- see module docs.
                    "cross_party": {
                        "state": STATE_NOT_PRESENT,
                        "text": NO_COUNTERPARTY_EVIDENCE_TEXT,
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
        "card": card,
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
        // [ledger-T3-vocabulary-and-states]: five-state property map, not
        // the retired rung ladder -- see module docs. Fork UI types
        // (`sidecarTypes.ts`'s `PaneBRow`) still name this cell `rung`;
        // that rename is `[ledger-batch1-integrate]`'s job, not this one's.
        "cross_party": {
            "state": STATE_NOT_PRESENT,
            "text": NO_COUNTERPARTY_EVIDENCE_TEXT,
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
            "theirs": theirs_cell(record),
            // Whether a real peer join key exists does not yet change
            // `unilateral` -- that flag (and the `confirmed`/tone semantics
            // it feeds, `exchange-ledger.ts`) is earned only once the
            // browser has actually fetched and recomputed the peer half,
            // which is not this route's job; NOT_CHECKED is the honest
            // "known but unverified" middle state.
            "unilateral": true,
            "timestamp": record.get("timestamp").cloned().unwrap_or(Value::Null),
            // [ledger-T11b-twin-bracket] -- absent (never null) on every
            // untwinned row; the UI's `twinBracketId` derivation already
            // treats a missing key the same as an explicit `null`.
            "twin_bracket_id": twin_bracket_id(record),
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
        "pane-a" => Some(build_pane_a(&records, read_checkpoint_card(ledger_dir))),
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
    /// the same values from the Python side) -- not a guess. Exception:
    /// `cross_party` -- [ledger-T3-vocabulary-and-states] retired the rung
    /// ladder from THIS reader only, so it now diverges from the (still
    /// unmigrated) Python reference by design; see module docs.
    #[test]
    fn pane_a_matches_the_python_reference_on_a_plugin_shaped_fixture() {
        let records = vec![fixture_record(
            "cap-1",
            "2026-09-01T00:00:00Z",
            "req-1",
            None,
        )];
        let pane = build_pane_a(&records, json!({ "checkpoint_count": 0 }));
        assert_eq!(pane["witness_checkpoint_supplied"], json!(false));
        assert_eq!(pane["operator"], json!("capsule-emit-mesh-poc-demo"));
        let row = &pane["rows"][0];
        assert_eq!(row["capsule_id"], json!("cap-1"));
        assert_eq!(row["verify_ok"], Value::Null);
        assert_eq!(row["model_claimed"], json!("local model"));
        assert_eq!(row["hardware_claimed"], Value::Null);
        assert_eq!(row["rungs"]["freshness"]["state"], json!("absent"));
        assert_eq!(row["rungs"]["cross_party"]["state"], json!("NOT_PRESENT"));
        assert_eq!(
            row["rungs"]["cross_party"]["text"],
            json!(NO_COUNTERPARTY_EVIDENCE_TEXT)
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

    /// [ledger-T3-vocabulary-and-states]: `cross_party` diverges from the
    /// (still unmigrated) Python reference by design -- see module docs and
    /// the Pane A test above.
    #[test]
    fn pane_b_cells_match_the_python_reference_on_a_plugin_shaped_fixture() {
        let records = vec![
            fixture_record("cap-1", "2026-09-01T00:00:00Z", "req-1", None),
            fixture_record("cap-2", "2026-09-02T00:00:00Z", "req-2", Some("cap-1")),
        ];
        let pane = build_pane_b(&records);
        let row = &pane["rows"][0];
        assert_eq!(row["cross_party"]["state"], json!("NOT_PRESENT"));
        assert_eq!(
            row["cross_party"]["text"],
            json!(NO_COUNTERPARTY_EVIDENCE_TEXT)
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
        // Untwinned rows (the overwhelming majority) carry no bracket.
        assert_eq!(pane["rows"][0]["twin_bracket_id"], Value::Null);
    }

    /// [ledger-T11b-twin-bracket] a record whose `capsule-producer` plugin
    /// forwarded a `twin_bracket_id` off the terminal envelope surfaces that
    /// SAME id on its Pane C row, at the sibling JSON path `exchange_id`
    /// already lives at (`x-mesh-poc-v1.serving_provenance`). MUTANT: drop
    /// the `twin_bracket_id(record)` read in `build_pane_c_list` and this
    /// assertion goes red.
    #[test]
    fn pane_c_row_carries_the_plugin_forwarded_twin_bracket_id() {
        let mut record = fixture_record("cap-1", "2026-09-01T00:00:00Z", "req-1", None);
        record["model_attestation"]["compute_attestation"]["x-mesh-poc-v1"] = json!({
            "serving_provenance": { "exchange_id": "exch-real", "twin_bracket_id": "twin-abc123" }
        });
        let pane = build_pane_c_list(&[record]);
        assert_eq!(pane["rows"][0]["twin_bracket_id"], json!("twin-abc123"));
    }

    /// `[mesh-e9e10-pieces-2-4]` piece 3, positive: a record carrying a real
    /// `peer_asserted` join key (piece 1) surfaces `theirs.state ==
    /// NOT_CHECKED` (known + fetchable, not absent) with the exact
    /// capsule_id/peer_id the browser needs to drive `mesh_ledger_fetch`
    /// (piece 2). MUTANT: drop the `theirs_cell(record)` read in
    /// `build_pane_c_list` and this assertion goes red.
    #[test]
    fn pane_c_row_surfaces_a_real_peer_asserted_join_key_as_not_checked() {
        let mut record = fixture_record("cap-1", "2026-09-01T00:00:00Z", "req-1", None);
        record["model_attestation"]["compute_attestation"]["x-mesh-poc-v1"] = json!({
            "serving_provenance": {
                "peer_capsule_id": "peer-cap-987",
                "peer_capsule_id_provenance": "peer_asserted",
                "served_by_node_id": "peer-node-3",
            }
        });
        let pane = build_pane_c_list(&[record]);
        let theirs = &pane["rows"][0]["theirs"];
        assert_eq!(theirs["state"], json!(NOT_CHECKED));
        assert_eq!(theirs["capsule_id"], json!("peer-cap-987"));
        assert_eq!(theirs["peer_id"], json!("peer-node-3"));
    }

    /// (negative, R4 other half) `self_minted` is THIS node's own marker,
    /// never a peer's claim (the exact mislabeling piece 1's
    /// `peer_capsule_id_for_seal` guard exists to prevent) -- must stay
    /// `absent`, never surfaced as fetchable.
    #[test]
    fn pane_c_row_never_surfaces_a_self_minted_capsule_id_as_theirs() {
        let mut record = fixture_record("cap-1", "2026-09-01T00:00:00Z", "req-1", None);
        record["model_attestation"]["compute_attestation"]["x-mesh-poc-v1"] = json!({
            "serving_provenance": {
                "peer_capsule_id": "not-actually-a-peer-id",
                "peer_capsule_id_provenance": "self_minted",
                "served_by_node_id": "peer-node-3",
            }
        });
        let pane = build_pane_c_list(&[record]);
        assert_eq!(pane["rows"][0]["theirs"]["state"], json!(STATE_ABSENT));
        assert_eq!(pane["rows"][0]["theirs"]["capsule_id"], Value::Null);
    }

    /// (negative) A real `peer_asserted` capsule_id with no identifiable
    /// `served_by_node_id` (still `"unknown"`, the honest default) has
    /// nowhere to fetch FROM -- `absent`, not a join key naming no peer.
    #[test]
    fn pane_c_row_never_surfaces_a_join_key_with_no_identifiable_peer() {
        let mut record = fixture_record("cap-1", "2026-09-01T00:00:00Z", "req-1", None);
        record["model_attestation"]["compute_attestation"]["x-mesh-poc-v1"] = json!({
            "serving_provenance": {
                "peer_capsule_id": "peer-cap-987",
                "peer_capsule_id_provenance": "peer_asserted",
                "served_by_node_id": "unknown",
            }
        });
        let pane = build_pane_c_list(&[record]);
        assert_eq!(pane["rows"][0]["theirs"]["state"], json!(STATE_ABSENT));
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

    // -----------------------------------------------------------------
    // Retired vocabulary gate [ledger-T3-vocabulary-and-states] -- same
    // discipline as capsule-emit-mesh's `f0e3af6` Pane C gate
    // (`tests/test_accountability_pane_routes.py`'s
    // `_assert_no_retired_vocabulary`), ported to this reader's own
    // fixtures since it's the surface that actually emits raw JSON
    // strangers can read (native/sidecar-DOWN is the demo's real path).
    // -----------------------------------------------------------------

    const RETIRED_PANE_VOCABULARY: &[&str] = &["rung", "unilateral_fallback"];

    /// Whole-word containment: `haystack` carries `word` as a standalone
    /// token (its own key/segment, or delimited by `_`/`-` on both sides),
    /// never a mere substring. Distinguishes the retired `rung` ladder
    /// token from `rungs` -- the current, sanctioned plural container name
    /// for a row's five checks (see this module's own doc comment,
    /// "the Pane-A rungs' structural defaults") -- which contains `rung`
    /// as a substring but is not a reappearance of the retired vocabulary.
    fn contains_retired_word(haystack: &str, word: &str) -> bool {
        haystack.split(['_', '-']).any(|segment| segment == word)
    }

    /// Pins the exact boundary this gate depends on: `rungs` (the current,
    /// sanctioned container key) must never trip the retired-word check
    /// that `rung` (the actual retired token, alone or `_`/`-` delimited)
    /// must always trip. Before this fix, a plain `.contains("rung")`
    /// substring check made `pane_a_json_never_carries_retired_rung_vocabulary`
    /// fail unconditionally the moment `build_pane_a` emitted its own
    /// `"rungs"` key -- MUTANT: reverting `contains_retired_word` to
    /// `haystack.contains(word)` turns this red on the `"rungs"` case.
    #[test]
    fn contains_retired_word_distinguishes_rungs_from_the_retired_rung_token() {
        assert!(
            !contains_retired_word("rungs", "rung"),
            "current, sanctioned plural key must not match"
        );
        assert!(
            contains_retired_word("rung", "rung"),
            "the exact retired token must still match"
        );
        assert!(
            contains_retired_word("rung_state", "rung"),
            "an underscore-delimited retired token must still match"
        );
        assert!(
            contains_retired_word("cross_party_rung", "rung"),
            "a trailing underscore-delimited retired token must still match"
        );
        assert!(
            !contains_retired_word("unilateral_fallbacks", "unilateral_fallback"),
            "a hypothetical pluralized current key must not match either"
        );
    }

    fn assert_no_retired_vocabulary(value: &Value, path: &str) {
        match value {
            Value::Object(map) => {
                for (key, sub) in map {
                    let lowered_key = key.to_lowercase();
                    for word in RETIRED_PANE_VOCABULARY {
                        assert!(
                            !contains_retired_word(&lowered_key, word),
                            "{path}.{key} carries retired vocabulary {word:?}"
                        );
                    }
                    assert_no_retired_vocabulary(sub, &format!("{path}.{key}"));
                }
            }
            Value::Array(items) => {
                for (index, item) in items.iter().enumerate() {
                    assert_no_retired_vocabulary(item, &format!("{path}[{index}]"));
                }
            }
            Value::String(text) => {
                let lowered = text.to_lowercase();
                for word in RETIRED_PANE_VOCABULARY {
                    assert!(
                        !lowered.contains(word),
                        "{path} carries retired vocabulary {word:?}: {text:?}"
                    );
                }
            }
            _ => {}
        }
    }

    /// The seeded record here has no cross-party evidence -- exactly the
    /// shape that used to grade `unilateral_fallback` -- so this fixture is
    /// a real mutant catch, not a vacuous pass.
    #[test]
    fn pane_a_json_never_carries_retired_rung_vocabulary() {
        let records = vec![fixture_record(
            "cap-1",
            "2026-09-01T00:00:00Z",
            "req-1",
            None,
        )];
        assert_no_retired_vocabulary(&build_pane_a(&records, json!({ "checkpoint_count": 0 })), "$");
    }

    /// [mesh-closed-on-frozen-base] Integrity checkpoint wiring: `build_pane_a`
    /// hardcoded `card: null`, so a real on-disk checkpoint never reached the
    /// Integrity view (which reads `card.checkpoint_count`). The card must now
    /// report the honest count from `<ledger_dir>/checkpoints.jsonl` -- 0 when
    /// absent (rendered "no checkpoint yet", never fabricated), the real count
    /// + latest registration time when present.
    #[test]
    fn pane_a_card_reports_real_checkpoints_and_honest_zero_when_absent() {
        // Absent file -> honest zero, no registration timestamp.
        let empty = tempfile::tempdir().unwrap();
        let zero = read_checkpoint_card(empty.path());
        assert_eq!(zero["checkpoint_count"], json!(0));
        assert!(zero.get("registered_no_later_than").is_none());
        // The pane threads the honest zero through, so the UI reads "no
        // checkpoint yet" -- a real mutant catch: reverting to `card: null`
        // would make `pane["card"]["checkpoint_count"]` null, not 0.
        assert_eq!(build_pane_a(&[], zero)["card"]["checkpoint_count"], json!(0));

        // Two real checkpoint lines -> count 2 + the LATEST timestamp + its
        // witnesses (the on-disk shape written by the cadence).
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("checkpoints.jsonl"),
            "{\"kind\":\"mmr_checkpoint\",\"mmr_size\":3,\"root\":\"aa\",\"timestamp\":\"2026-09-03T07:23:31Z\",\"witnesses\":[]}\n\
             {\"kind\":\"mmr_checkpoint\",\"mmr_size\":7,\"root\":\"bb\",\"timestamp\":\"2026-09-03T07:28:00Z\",\"witnesses\":[{\"ts_url\":\"https://witness.example\"}]}\n",
        )
        .unwrap();
        let card = read_checkpoint_card(dir.path());
        assert_eq!(card["checkpoint_count"], json!(2));
        assert_eq!(card["registered_no_later_than"], json!("2026-09-03T07:28:00Z"));
        assert_eq!(card["latest_root"], json!("bb"));
        assert_eq!(card["latest_mmr_size"], json!(7));
        assert_eq!(card["witnesses"].as_array().unwrap().len(), 1);
        assert_eq!(build_pane_a(&[], card)["card"]["checkpoint_count"], json!(2));
    }

    #[test]
    fn pane_b_json_never_carries_retired_rung_vocabulary() {
        let records = vec![
            fixture_record("cap-1", "2026-09-01T00:00:00Z", "req-1", None),
            fixture_record("cap-2", "2026-09-02T00:00:00Z", "req-2", Some("cap-1")),
        ];
        assert_no_retired_vocabulary(&build_pane_b(&records), "$");
    }
}
