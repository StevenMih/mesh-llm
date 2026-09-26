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
use std::collections::HashMap;
use std::path::Path;

/// Sentinel for "this mechanism exists but isn't wired for a plugin-ledger
/// read yet" -- never fabricated, never the sidecar's own computed value.
const NOT_CHECKED: &str = "NOT_CHECKED";
/// `capsule_exchange_tab.STATE_PRESENT_UNVERIFIED` / `STATE_ABSENT` --
/// these two ARE purely structural (presence of a record, not a claim
/// about its contents) and are safe to compute without any crypto port.
const STATE_PRESENT_UNVERIFIED: &str = "present-unverified";
const STATE_ABSENT: &str = "absent";
/// `capsule_exchange_tab.STATE_VERIFIED` / `STATE_FAILED` -- the two
/// terminal outcomes of the structural `digest_match_grade`: both digest
/// fields present and byte-equal (`VERIFIED`), or one field disagrees
/// (`FAILED`). Both are STRUCTURAL (string equality of two fields both
/// halves already carry), not a crypto claim -- the same discipline that
/// already lets this reader compute `present-unverified`/`absent`. The
/// crypto CLOSED predicate (signature-ok + capsule_id recompute) still
/// lives in the ONE gate (`exchange-row-state.ts::deriveRightCellState`);
/// this reader only supplies the digests-equal INPUT that gate reads.
const STATE_VERIFIED: &str = "verified";
const STATE_FAILED: &str = "failed";
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

fn response_digest(record: &Value) -> Option<&str> {
    record
        .pointer("/effect/response_digest")
        .and_then(Value::as_str)
}

/// `record_push.RECEIVED_PROVENANCE_FILENAME` -- the co-located sibling of
/// `capsules.jsonl` (same convention as `checkpoints.jsonl`) the record-push
/// door appends ONE line to per successfully identity-verified received push
/// (`record_push._append_provenance`): `{capsule_id, received_from, via,
/// received_at, signature_ok}`. Per `record_push`'s own module doc this file
/// is *"the ONLY fact the pane's local-sibling CLOSED gate
/// (`exchange-row-state.ts`) trusts to treat a locally-held capsule as a
/// verified counterparty half"* -- so this reader NEVER treats a ledger
/// record as a counterparty half unless its `capsule_id` has a line here
/// carrying the provenance triple and `signature_ok: true`.
const RECEIVED_PROVENANCE_FILENAME: &str = "received-provenance.jsonl";

/// The provenance triple (+ `signature_ok`) the door recorded for one
/// received foreign sibling. The door already verified the signature against
/// the announced peer key BEFORE writing this line (`record_push`'s door:
/// `key_id` matches `announced_key_for(sender_peer_id)` AND
/// `verify_capsule_signature` passes, else the push is refused and NO line is
/// written) -- so `signature_ok` here is the door's recorded verdict, read,
/// never a second signature check in this route (which the module docstring's
/// gap 2 deliberately does not port).
pub(super) struct ReceivedProvenance {
    received_from: String,
    via: String,
    received_at: String,
    signature_ok: bool,
}

/// Reads `<ledger_dir>/received-provenance.jsonl` into a
/// `capsule_id -> ReceivedProvenance` map. A missing file yields an empty map
/// (the overwhelmingly common case: this node has received no push yet, so no
/// row can close on a local sibling -- honest, never fabricated). Only lines
/// carrying a non-empty `received_from` AND `signature_ok: true` are kept: the
/// provenance rule (a self-sealed capsule, or one without `received_from`,
/// never closes) is enforced HERE, at the door of what counts as a
/// counterparty half, exactly as `record_push` writes it.
fn read_received_provenance(ledger_dir: &Path) -> HashMap<String, ReceivedProvenance> {
    let path = ledger_dir.join(RECEIVED_PROVENANCE_FILENAME);
    let Ok(text) = std::fs::read_to_string(&path) else {
        return HashMap::new();
    };
    let mut map = HashMap::new();
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(capsule_id) = entry.get("capsule_id").and_then(Value::as_str) else {
            continue;
        };
        let received_from = entry
            .get("received_from")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty());
        // The provenance rule: no `received_from`, or `signature_ok` not
        // literally true, means the door never treated this as a verified
        // received half -- so neither does this reader.
        let (Some(received_from), Some(true)) =
            (received_from, entry.get("signature_ok").and_then(Value::as_bool))
        else {
            continue;
        };
        map.insert(
            capsule_id.to_string(),
            ReceivedProvenance {
                received_from: received_from.to_string(),
                via: entry
                    .get("via")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                received_at: entry
                    .get("received_at")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                signature_ok: true,
            },
        );
    }
    map
}

/// `capsule_exchange_tab.digest_match_grade`, the STRUCTURAL half of it: the
/// two halves' `effect.request_digest`/`effect.response_digest` compared
/// field-by-field. `verified` only when BOTH fields are present on BOTH halves
/// and every field agrees; `failed` the instant one field disagrees (one
/// broken field makes the pair untrustworthy -- never averaged away, matching
/// the Python's `any_failed` rule); `present-unverified` when a field is
/// missing but none disagree. This is pure byte-equality of fields both
/// halves already carry -- the `digestsCiteOurHalf` INPUT the ONE gate reads,
/// not a second copy of the CLOSED predicate. A `failed` here is exactly what
/// the gate renders CONTRADICTED; a `verified` here (with the door's
/// `signature_ok`) is what it renders CLOSED.
fn digest_match_state(mine: &Value, theirs: &Value) -> &'static str {
    let mut any_failed = false;
    let mut any_absent = false;
    for (a, b) in [
        (request_digest(mine), request_digest(theirs)),
        (response_digest(mine), response_digest(theirs)),
    ] {
        match (a, b) {
            (Some(a), Some(b)) if a == b => {}
            (Some(_), Some(_)) => any_failed = true,
            _ => any_absent = true,
        }
    }
    if any_failed {
        STATE_FAILED
    } else if any_absent {
        STATE_PRESENT_UNVERIFIED
    } else {
        STATE_VERIFIED
    }
}

/// `x-mesh-poc-v1` block, `capsule_mesh_view._poc_block`.
fn poc_block(record: &Value) -> Option<&Value> {
    record.pointer("/model_attestation/compute_attestation/x-mesh-poc-v1")
}

/// `x-mesh-lifecycle-v1` block, `capsule_mesh_view._lifecycle_block`.
fn lifecycle_block(record: &Value) -> Option<&Value> {
    record.pointer("/model_attestation/compute_attestation/x-mesh-lifecycle-v1")
}

/// The exchange grouping key -- the join order matches
/// `served_request_join.py`'s own CORRELATION FALLBACK
/// (`exchange_id` -> `request_digest` -> `twin_bracket_id`), but reduced to
/// the ONE key that survives a cross-node exchange.
///
/// `exchange_id` is **host-minted**: each host mints its OWN id for the same
/// real exchange, so two cross-node halves that attest the identical exchange
/// routinely carry DIFFERENT `exchange_id` values (M4 `914b61c1…` vs M3
/// `82777e20…`), while both independently compute the SAME `request_digest`
/// over the same wire bytes. Keying on `exchange_id` therefore split the two
/// halves of one cross-node exchange into two rows that could never reconcile
/// -- the empirical "6 OPEN rows instead of 3 CLOSED pairs" finding. So the
/// digest is preferred whenever a record carries one: `digest:<request_digest>`
/// groups both halves as one exchange. This subsumes the same-node case (two
/// records of one exchange share a `request_digest` too) and correctly SPLITS
/// the CONFLICTING case `served_request_join.py` refuses to join (an equal
/// host-minted `exchange_id` but a different `request_digest` -- two different
/// requests the wire bytes contradict, which distinct digest keys keep apart).
/// Falls back to the host-minted `exchange_id` only when a record carries no
/// `request_digest` at all (e.g. a plugin-served stub with no digested body),
/// and `None` when neither exists (nothing to group this record by).
fn exchange_key_for(record: &Value) -> Option<String> {
    if let Some(digest) = request_digest(record) {
        return Some(format!("digest:{digest}"));
    }
    poc_block(record)
        .and_then(|poc| poc.pointer("/serving_provenance/exchange_id"))
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty() && *id != "unknown")
        .map(str::to_string)
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

/// First `n` chars of an id (char-safe, mirrors Python's `[:n]` slice on the
/// ascii node/ref ids this handles).
fn short_id(id: &str, n: usize) -> String {
    id.chars().take(n).collect()
}

/// Best-effort counterparty peer label from a record's OWN fields, mirroring
/// `capsule_mesh_view.label_counterparty` (the Python reference this reader
/// pins against). `None` is the honest "unattributed" -- no field resolves to
/// a DISTINCT peer -- never a fabricated identity.
///
/// The key case the earlier single-bucket reader missed: a `RemoteMesh`
/// requester-side record carries `role: "requested"` (the dispatch-derived
/// role -- `capsule_emit.rs` doc: "RemoteMesh means this node routed to a
/// peer") and names the remote server in `served_by_node_id`. That server IS
/// the counterparty, so a peer this node DEALT WITH -- the count does not wait
/// on CLOSED (CLOSED is about holding their half, a separate state).
fn counterparty_peer_label(record: &Value) -> Option<String> {
    let poc = poc_block(record)?;
    // Tier 1: bilateral attestation (strongest -- a signed request digest).
    if let Some(cross_party) = poc.get("cross_party") {
        if let Some(r) = cross_party
            .get("initiator_ref")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            return Some(format!("initiator:{}", short_id(r, 12)));
        }
        if let Some(r) = cross_party
            .get("counterparty_ref")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            return Some(format!("counterparty:{}", short_id(r, 12)));
        }
    }
    let sp = poc.get("serving_provenance");
    if let Some(sp) = sp {
        // Tier 2: served_by_node_id is the REMOTE peer when this node requested.
        if let Some(served_by) = sp
            .get("served_by_node_id")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty() && *s != "unknown")
        {
            if poc.get("role").and_then(Value::as_str) == Some("requested") {
                return Some(format!("node:{}", short_id(served_by, 16)));
            }
        }
        // Tier 3: requesting_party -- who originated, when this node served.
        if let Some(rp) = sp
            .get("requesting_party")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty() && *s != "unknown")
        {
            return Some(format!("node:{}", short_id(rp, 16)));
        }
    }
    None
}

fn seen_range(records: &[Value]) -> (Option<&str>, Option<&str>) {
    let mut timestamps: Vec<&str> = records
        .iter()
        .filter_map(|r| r.get("timestamp").and_then(Value::as_str))
        .collect();
    timestamps.sort_unstable();
    (timestamps.first().copied(), timestamps.last().copied())
}

/// One "Nodes you have dealt with" row: a NAMED counterparty (`label`) this
/// node exchanged with, `exchange_count` real. Its half being unheld is a
/// STATE ("their half not held") the CLOSED path fills -- it is never a reason
/// to omit the peer or show a zero count.
fn dealt_with_row(
    label: &str,
    records: &[Value],
    siblings_by_key: &HashMap<String, Vec<CorrelatedSibling<'_>>>,
    received_provenance: &HashMap<String, ReceivedProvenance>,
) -> Value {
    let (first_seen, last_seen) = seen_range(records);
    let total = records.len();
    let confirmed_siblings =
        confirmed_siblings_for(records, siblings_by_key, received_provenance);
    let served_count = records.iter().filter(|r| label_role(r) == "served").count();
    let requested_count = records
        .iter()
        .filter(|r| label_role(r) == "requested")
        .count();
    // A half this peer pushed and the door verified IS held now. The node/
    // cross_party text stops asserting the flat "their half not held" the
    // moment a provenance-carrying sibling correlates -- the gate decides
    // CLOSED, but the presence of a held half is a structural fact stated here.
    let held_half_count = confirmed_siblings.len();
    let half_state = if held_half_count > 0 {
        format!("their half held (received by push) for {held_half_count} of {total}")
    } else {
        "their half not held".to_string()
    };
    json!({
        "peer_id": label,
        "node": {
            "state": CELL_PRESENT,
            "text": format!("dealt with {label} in {total} exchange(s) — {half_state}"),
            "peer_id": label,
            "member_kind": Value::Null,
            "exchange_count": total,
        },
        // Counterparty IS present (this node's own record names the peer);
        // their sealed half is `present-unverified` -- not the false
        // `NOT_PRESENT` the unattributed bucket carries.
        "cross_party": {
            "state": STATE_PRESENT_UNVERIFIED,
            "text": format!("counterparty {label} named by this node's own record — {half_state}"),
            "peer_id": label,
        },
        "role": {
            "state": CELL_PRESENT,
            "text": format!("you→them · {requested_count} (them→you · {served_count})"),
            "role": if requested_count > 0 { "you_to_them" } else { "them_to_you" },
            "you_to_them_count": requested_count,
            "them_to_you_count": served_count,
            "exchange_count": total,
        },
        "history": not_checked_state(),
        "served": not_checked_state(),
        "pair": pair_cell(records),
        // [mesh-closed-on-frozen-base] The two gate inputs, per correlated
        // push-primary sibling -- the TS view runs each through the ONE gate
        // (`deriveRightCellState`) and counts CLOSED. Empty when no foreign
        // half correlates: the gate reads that as "not confirmed", honest.
        "confirmed_siblings": confirmed_siblings,
        "verdicts": not_checked_state(),
        "asked": {
            "state": STATE_ABSENT,
            "text": "Not yet counted — this node doesn't persist served/refused counts.",
            "count": 0,
        },
        "exchange_count": total,
        "first_seen": first_seen,
        "last_seen": last_seen,
    })
}

/// The honest residual: records that name NO distinct counterparty. Unchanged
/// from the prior reader -- one unattributed row, never a fabricated peer and
/// never counted as "dealt with · 0".
fn unattributed_row(
    records: &[Value],
    siblings_by_key: &HashMap<String, Vec<CorrelatedSibling<'_>>>,
    received_provenance: &HashMap<String, ReceivedProvenance>,
) -> Value {
    let (first_seen, last_seen) = seen_range(records);
    let confirmed_siblings =
        confirmed_siblings_for(records, siblings_by_key, received_provenance);
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
    json!({
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
        "history": not_checked_state(),
        "served": not_checked_state(),
        "pair": pair_cell(records),
        // Supplied for parity with dealt-with rows; an unattributed residual has
        // no named peer, so the Peers list filters it out before the gate reads
        // this -- present and honest (empty unless a sibling correlates) rather
        // than absent.
        "confirmed_siblings": confirmed_siblings,
        "verdicts": not_checked_state(),
        "asked": {
            "state": STATE_ABSENT,
            "text": "Not yet counted — this node doesn't persist served/refused counts.",
            "count": 0,
        },
        "exchange_count": total,
        "first_seen": first_seen,
        "last_seen": last_seen,
    })
}

/// Pane B ("Peers") -- `peer_accountability_tab.build_peers_payload`. Records
/// that name a distinct counterparty (`counterparty_peer_label`, mirroring
/// `capsule_mesh_view.label_counterparty`) each become a "dealt with" peer row;
/// the rest fall to ONE honest unattributed residual. A served peer this
/// node's own record names counts as dealt-with NOW -- "their half not held"
/// is a state, never a fabricated zero; an unknown counterparty is unattributed,
/// never a false "dealt with · 0".
///
/// **[mesh-closed-on-frozen-base] "Confirmed by the other side" routes through
/// the ONE gate, same as Pane C.** Pane B used to gate its confirmed/MATCH
/// columns on a browser peer-fetch of the peer's whole chain (`history` cell) --
/// a SECOND CLOSED predicate, distinct from Pane C's push-primary one-gate path.
/// This now SUPPLIES each dealt-with row the SAME two gate inputs Pane C
/// supplies: for every one of this node's own records that a provenance-carrying
/// foreign sibling correlates with (by `exchange_key_for`, the ONE correlator,
/// digest-first), a `confirmed_siblings` entry carrying the door's recorded
/// `signature_ok` + the structural `digest_match` state. The TS view
/// (`peer-row-view.ts`) runs each entry through `deriveRightCellState` -- the
/// ONE gate -- and counts CLOSED, never a fetch-gated predicate. No second
/// predicate here; correlation feeds the gate, it never bypasses it. A peer with
/// no correlated sibling supplies an empty list, which the gate reads as "not
/// confirmed" -- honest, never a fabricated zero.
pub(super) fn build_pane_b(
    records: &[Value],
    received_provenance: &HashMap<String, ReceivedProvenance>,
) -> Value {
    if records.is_empty() {
        return json!({
            "peer_count": 0,
            "rows": [],
            "peer_fetch_enabled": false,
            "peer_fetch_count": 0,
        });
    }
    // The received siblings, keyed by their correlator (`exchange_key_for`), so
    // a peer's own record can find the foreign half that closes it -- the SAME
    // digest-first correlator Pane C groups on, never a peer-label match.
    let siblings_by_key = received_siblings_by_key(records, received_provenance);
    // BTreeMap: deterministic (sorted) peer ordering; attributed peers first,
    // the unattributed residual last -- so an all-unattributed ledger yields
    // exactly the prior single-row output (rows[0] == the residual).
    let mut by_peer: std::collections::BTreeMap<String, Vec<Value>> = std::collections::BTreeMap::new();
    let mut unattributed: Vec<Value> = Vec::new();
    for record in records {
        match counterparty_peer_label(record) {
            Some(label) => by_peer.entry(label).or_default().push(record.clone()),
            None => unattributed.push(record.clone()),
        }
    }
    let mut rows: Vec<Value> = by_peer
        .iter()
        .map(|(label, group)| dealt_with_row(label, group, &siblings_by_key, received_provenance))
        .collect();
    if !unattributed.is_empty() {
        rows.push(unattributed_row(
            &unattributed,
            &siblings_by_key,
            received_provenance,
        ));
    }
    json!({
        "peer_count": rows.len(),
        "rows": rows,
        "peer_fetch_enabled": false,
        "peer_fetch_count": 0,
    })
}

/// One correlated foreign half held locally: its `exchange_key_for` correlator,
/// its own record (for the structural `digest_match` against `mine`), and the
/// door's provenance. This is the native-ledger equivalent of the `theirs`
/// half Pane C splits out -- the ONLY records treated as a counterparty half
/// are those carrying a `received-provenance.jsonl` line (the provenance rule,
/// enforced by `received_provenance.contains_key`).
struct CorrelatedSibling<'a> {
    record: &'a Value,
    provenance: &'a ReceivedProvenance,
}

/// Indexes every received (provenance-carrying) foreign sibling by its
/// `exchange_key_for` correlator, so a peer's own record can look up the half
/// that closes it. Mirrors Pane C's `is_received_sibling` split, but keyed for
/// per-peer lookup instead of folded into one row. A capsule with no provenance
/// line is NEVER indexed -- the provenance rule holds identically here.
fn received_siblings_by_key<'a>(
    records: &'a [Value],
    received_provenance: &'a HashMap<String, ReceivedProvenance>,
) -> HashMap<String, Vec<CorrelatedSibling<'a>>> {
    let mut map: HashMap<String, Vec<CorrelatedSibling<'a>>> = HashMap::new();
    for record in records {
        let Some(capsule_id) = record.get("capsule_id").and_then(Value::as_str) else {
            continue;
        };
        let Some(provenance) = received_provenance.get(capsule_id) else {
            continue;
        };
        let Some(key) = exchange_key_for(record) else {
            continue;
        };
        map.entry(key)
            .or_default()
            .push(CorrelatedSibling { record, provenance });
    }
    map
}

/// The `confirmed_siblings` array a peer row supplies to the ONE gate: for each
/// of this node's OWN records (never a received sibling itself) whose
/// `exchange_key_for` a provenance-carrying foreign half shares, one entry of
/// exactly the two inputs `deriveRightCellState` reads -- the door's recorded
/// `signature_ok` (via a `theirs`-shaped cell) and the structural
/// `digest_match` state. The gate, not this route, turns `verified` +
/// `signature_ok` into CLOSED and `failed` into CONTRADICTED. A record that is
/// itself a received sibling is skipped (it is a counterparty half, not one of
/// this node's asked halves to be confirmed).
fn confirmed_siblings_for(
    peer_records: &[Value],
    siblings_by_key: &HashMap<String, Vec<CorrelatedSibling<'_>>>,
    received_provenance: &HashMap<String, ReceivedProvenance>,
) -> Vec<Value> {
    let mut out = Vec::new();
    for mine in peer_records {
        let is_received = mine
            .get("capsule_id")
            .and_then(Value::as_str)
            .is_some_and(|id| received_provenance.contains_key(id));
        if is_received {
            continue;
        }
        let Some(key) = exchange_key_for(mine) else {
            continue;
        };
        let Some(siblings) = siblings_by_key.get(&key) else {
            continue;
        };
        for sibling in siblings {
            out.push(json!({
                "theirs": theirs_sibling_cell(sibling.record, sibling.provenance),
                "digest_match": { "state": digest_match_state(mine, sibling.record) },
            }));
        }
    }
    out
}

/// The `theirs` cell when a real, provenance-carrying foreign SIBLING is held
/// locally -- `build_exchange_row._side`'s present branch
/// (`{state: present-unverified, capsule_id, role}`), plus the door's
/// provenance triple (`received_from`/`via`/`received_at`/`signature_ok`) so
/// the ONE gate (`exchange-row-state.ts::deriveRightCellState`) has the
/// `signatureOk` input it reads to close a locally-held counterparty half.
/// `state` is `present-unverified` (a real record, not yet crypto-checked in
/// THIS route -- gap 2), exactly `mine`'s own state; the CLOSED/CONTRADICTED
/// DECISION is the gate's, from this cell's provenance + the row's
/// `digest_match`, never a second predicate here.
fn theirs_sibling_cell(sibling: &Value, provenance: &ReceivedProvenance) -> Value {
    json!({
        "state": STATE_PRESENT_UNVERIFIED,
        "capsule_id": sibling.get("capsule_id").cloned().unwrap_or(Value::Null),
        "role": label_role(sibling),
        "received_from": provenance.received_from,
        "via": provenance.via,
        "received_at": provenance.received_at,
        "signature_ok": provenance.signature_ok,
    })
}

/// Pane C ("This exchange") list mode -- `capsule_exchange_tab.
/// build_exchange_list_payload` + `group_exchanges` + `build_exchange_row`.
/// `default_sort`/`filters` are the exact literal constants from
/// capsule-emit-mesh main (`capsule_exchange_tab.py:549-552,764`), not guessed.
///
/// **[mesh-closed-on-frozen-base] Route through the ONE gate; drop the
/// `unilateral: true` hardcode.** This used to emit one row PER record with a
/// hardcoded `unilateral: true`, gating CLOSED on a later browser peer-fetch
/// -- a SECOND CLOSED predicate the one-gate rule forbids. It now mirrors
/// Python `group_exchanges`: group every record sharing an `exchange_key_for`
/// (the ONE correlator, digest-first) into ONE row, split into `mine` (this
/// node's own capsules) and `theirs` (a foreign SIBLING held locally, proven
/// by a `received-provenance.jsonl` line -- the provenance rule). `unilateral`
/// is the STRUCTURAL fact `theirs is None`, never a crypto claim. When a
/// provenance-carrying sibling IS correlated, its cell + the row's structural
/// `digest_match` are SUPPLIED to the ONE gate (`deriveRightCellState`), which
/// alone decides CLOSED (`signatureOk && digestsCiteOurHalf`) vs CONTRADICTED
/// (digests differ) -- this route adds no second predicate and no exchange_id
/// grouping. A sibling with no provenance line (self-sealed, or refused at the
/// door) never fills `theirs`, so its row stays unilateral/OPEN: correlation
/// feeds the gate, it never bypasses it.
pub(super) fn build_pane_c_list(
    records: &[Value],
    received_provenance: &HashMap<String, ReceivedProvenance>,
) -> Value {
    // One pass, ledger order preserved: the first record of each exchange_key
    // seeds a row in encounter order; later halves of the same exchange fold
    // into that same row (never a second row -- the "6 rows not 3 pairs" bug).
    let mut order: Vec<String> = Vec::new();
    let mut groups: HashMap<String, Vec<&Value>> = HashMap::new();
    for record in records {
        let Some(exchange_key) = exchange_key_for(record) else {
            continue;
        };
        if !groups.contains_key(&exchange_key) {
            order.push(exchange_key.clone());
        }
        groups.entry(exchange_key).or_default().push(record);
    }

    let is_received_sibling =
        |record: &Value| -> bool {
            record
                .get("capsule_id")
                .and_then(Value::as_str)
                .is_some_and(|id| received_provenance.contains_key(id))
        };

    let mut rows = Vec::new();
    for exchange_key in order {
        let group = &groups[&exchange_key];
        // A sibling this node RECEIVED (has a provenance line) is `theirs`;
        // everything else in the group is `mine` (self-sealed here). This is
        // the native-ledger equivalent of Python's `my_ids` split -- a single
        // `capsules.jsonl` instead of two lists, so provenance is the honest
        // discriminator of which half came from a counterparty.
        let mine = group.iter().copied().find(|r| !is_received_sibling(r));
        let theirs_sibling = group.iter().copied().find(|r| is_received_sibling(r));
        // The row anchors on the local half when there is one; a received
        // sibling with no local half of its own still renders (its own column
        // filled), matching `build_exchange_row`'s `anchor = mine or theirs`.
        let anchor = mine.or(theirs_sibling).unwrap_or(group[0]);

        let mine_cell = match mine {
            Some(record) => json!({
                "state": STATE_PRESENT_UNVERIFIED,
                "capsule_id": record.get("capsule_id").cloned().unwrap_or(Value::Null),
                "role": label_role(record),
            }),
            // `build_exchange_row._side`'s mine-absent branch.
            None => json!({
                "state": STATE_ABSENT,
                "text": "none — received without a commitment",
                "capsule_id": Value::Null,
            }),
        };

        // `theirs`: a provenance-carrying local sibling fills it (the
        // push-primary CLOSED path). With no such sibling, fall back to the
        // record's own peer-asserted join key (`theirs_cell`, the DEFERRED
        // browser-fetch path) -- out of THIS path's CLOSED scope, unchanged.
        let (theirs_cell_value, unilateral) = match theirs_sibling {
            Some(sibling) => {
                let provenance = &received_provenance[sibling
                    .get("capsule_id")
                    .and_then(Value::as_str)
                    .expect("received sibling always carries a capsule_id")];
                (theirs_sibling_cell(sibling, provenance), false)
            }
            None => (theirs_cell(anchor), true),
        };

        // `digest_match`: the STRUCTURAL `digestsCiteOurHalf` INPUT the ONE
        // gate reads -- `verified` only reachable when BOTH halves are present
        // (a correlated pair). A lone half is `absent` (nothing to reconcile),
        // never a fabricated match. A `failed` here is what the gate renders
        // CONTRADICTED.
        let digest_match = match (mine, theirs_sibling) {
            (Some(mine), Some(theirs)) => json!({ "state": digest_match_state(mine, theirs) }),
            _ => json!({ "state": STATE_ABSENT }),
        };

        rows.push(json!({
            "exchange_key": exchange_key,
            "role_tag": role_tag(anchor),
            // `header_state`/`properties`/`has_issue` need the nine-key
            // assurance map (`build_assurance_map`), which is cryptographic
            // re-verification -- out of this cut (module docs gap 2). The
            // structural `digest_match` below is supplied separately as the
            // gate's `digestsCiteOurHalf` input; it is NOT the crypto header.
            "header_state": STATE_ABSENT,
            "properties": Value::Null,
            "has_issue": false,
            "mine": mine_cell,
            "theirs": theirs_cell_value,
            // The STRUCTURAL double-entry fact: a provenance-carrying foreign
            // sibling is correlated into this exchange (`theirs is None`
            // otherwise) -- never a crypto claim, never a hardcode.
            "unilateral": unilateral,
            // Supplied to the ONE gate (`deriveRightCellState`) as the
            // `digestsCiteOurHalf` input; the gate, not this route, turns
            // `verified` + `signature_ok` into CLOSED and `failed` into
            // CONTRADICTED.
            "digest_match": digest_match,
            "timestamp": anchor.get("timestamp").cloned().unwrap_or(Value::Null),
            // [ledger-T11b-twin-bracket] -- absent (never null) on every
            // untwinned row; the UI's `twinBracketId` derivation already
            // treats a missing key the same as an explicit `null`.
            "twin_bracket_id": twin_bracket_id(anchor),
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
        "pane-b" => Some(build_pane_b(&records, &read_received_provenance(ledger_dir))),
        "pane-c" => Some(match exchange_id {
            Some(id) if !id.is_empty() => build_pane_c_drilldown(&records, id),
            _ => build_pane_c_list(&records, &read_received_provenance(ledger_dir)),
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

    /// The empty received-provenance map -- this node has received no push, so
    /// no local sibling can close a row. The overwhelmingly common case, and
    /// the one every pre-existing Pane C test asserts against (a plugin-written
    /// ledger with only this node's own halves).
    fn no_provenance() -> HashMap<String, ReceivedProvenance> {
        HashMap::new()
    }

    /// One `received-provenance.jsonl` line's worth of state, `signature_ok`
    /// true (the door only ever writes a line after signature verification --
    /// `record_push._append_provenance`).
    fn provenance_for(
        capsule_id: &str,
        received_from: &str,
    ) -> (String, ReceivedProvenance) {
        (
            capsule_id.to_string(),
            ReceivedProvenance {
                received_from: received_from.to_string(),
                via: "push".to_string(),
                received_at: "2026-09-25T00:00:01Z".to_string(),
                signature_ok: true,
            },
        )
    }

    /// A cross-node mesh half -- same shape as capsule-emit-mesh's
    /// `test_pane_fires_on_pushed_sibling._mesh_half`: an explicit role +
    /// request/response digests + its OWN host-minted `exchange_id` under
    /// `x-mesh-poc-v1.serving_provenance`. Two halves of one exchange share the
    /// digests but carry DIFFERENT `exchange_id`s (the cross-node reality that
    /// broke exchange_id grouping).
    fn mesh_half(
        capsule_id: &str,
        role: &str,
        request_digest: &str,
        response_digest: &str,
        exchange_id: &str,
    ) -> Value {
        json!({
            "capsule_id": capsule_id,
            "timestamp": "2026-09-25T00:00:00Z",
            "operator": "op",
            "effect": { "request_digest": request_digest, "response_digest": response_digest },
            "model_attestation": { "compute_attestation": { "x-mesh-poc-v1": {
                "role": role,
                "serving_provenance": { "exchange_id": exchange_id, "served_by_node_id": "m3", "requesting_party": "m4" },
            } } },
        })
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
        let pane = build_pane_b(&records, &no_provenance());
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
        let pane = build_pane_b(&records, &no_provenance());
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
        let pane = build_pane_b(&[record], &no_provenance());
        assert_eq!(pane["rows"][0]["pair"]["state"], json!(NOT_CHECKED));
    }

    #[test]
    fn pane_b_on_an_empty_ledger_has_zero_peers_not_a_fabricated_row() {
        let pane = build_pane_b(&[], &no_provenance());
        assert_eq!(pane["peer_count"], json!(0));
        assert_eq!(pane["rows"], json!([]));
    }

    /// A `RemoteMesh` requester-side record (role `"requested"`,
    /// `served_by_node_id` naming the remote server) counts as a peer this
    /// node DEALT WITH -- named, "their half not held" -- NOT "advertised but
    /// unused · dealt with 0". The count does not wait on CLOSED. MUTANT: if
    /// `build_pane_b` reverts to the single unattributed bucket, `peer_id` goes
    /// null and `dealt with 0` returns -- this assertion goes red.
    #[test]
    fn pane_b_attributes_a_served_remote_peer_as_dealt_with_not_a_false_zero() {
        let mut record = fixture_record("cap-r1", "2026-09-01T00:00:00Z", "req-1", None);
        record["model_attestation"]["compute_attestation"]["x-mesh-poc-v1"] = json!({
            "role": "requested",
            "serving_provenance": {
                "served_by_node_id": "16b1362a8ebf00119abc",
                "dispatch_path": "remote_mesh"
            }
        });
        let pane = build_pane_b(&[record], &no_provenance());
        assert_eq!(pane["peer_count"], json!(1));
        let row = &pane["rows"][0];
        // node:<served_by[:16]>, mirroring capsule_mesh_view.label_counterparty.
        assert_eq!(row["peer_id"], json!("node:16b1362a8ebf0011"));
        assert_eq!(row["node"]["state"], json!("present"));
        assert_eq!(row["cross_party"]["state"], json!("present-unverified"));
        assert_eq!(row["role"]["you_to_them_count"], json!(1));
        assert_eq!(row["exchange_count"], json!(1));
    }

    /// A record with no attributable counterparty stays UNATTRIBUTED -- a
    /// residual row with `peer_id: null`, never a fabricated peer -- and an
    /// attributed peer plus an unattributed record yield two honest rows
    /// (attributed first, residual last).
    #[test]
    fn pane_b_keeps_unattributed_records_honest_alongside_a_named_peer() {
        let mut attributed = fixture_record("cap-a", "2026-09-01T00:00:00Z", "req-a", None);
        attributed["model_attestation"]["compute_attestation"]["x-mesh-poc-v1"] = json!({
            "role": "requested",
            "serving_provenance": { "served_by_node_id": "peerXYZ0123456789ab" }
        });
        let plain = fixture_record("cap-b", "2026-09-02T00:00:00Z", "req-b", None);
        let pane = build_pane_b(&[attributed, plain], &no_provenance());
        assert_eq!(pane["peer_count"], json!(2));
        assert_eq!(pane["rows"][0]["peer_id"], json!("node:peerXYZ012345678"));
        assert_eq!(pane["rows"][1]["peer_id"], Value::Null);
        assert_eq!(pane["rows"][1]["node"]["state"], json!("absent"));
    }

    // -----------------------------------------------------------------
    // [mesh-closed-on-frozen-base] Pane B routes "confirmed by the other
    // side" through the SAME ONE gate Pane C uses: a dealt-with peer row
    // SUPPLIES `confirmed_siblings`, each carrying the door's `signature_ok`
    // (via a `theirs`-shaped cell) + the structural `digest_match` -- the two
    // inputs `exchange-row-state.ts::deriveRightCellState` reads to render
    // CLOSED. These mirror the Pane C sibling tests above; the CLOSED/
    // CONTRADICTED DECISION stays the gate's, never a second fetch-gated
    // predicate here (the `history`/`pair` peer-fetch tranche is untouched).
    // -----------------------------------------------------------------

    /// A peer this node asked, whose served half arrived by push (a
    /// provenance line, `signature_ok: true`) and correlates by digest, gets
    /// ONE `confirmed_siblings` entry with `signature_ok: true` and a
    /// `verified` `digest_match` -- exactly the two gate inputs the TS view
    /// runs through the ONE gate to count as confirmed/clean. MUTANT: revert
    /// Pane B to no `confirmed_siblings` and this goes red.
    #[test]
    fn pane_b_supplies_a_confirmed_sibling_for_a_correlated_pushed_half() {
        let local = mesh_half("a".repeat(64).as_str(), "requested", "d".repeat(64).as_str(), "e".repeat(64).as_str(), "m4-914b61c1");
        let foreign = mesh_half("b".repeat(64).as_str(), "served", "d".repeat(64).as_str(), "e".repeat(64).as_str(), "m3-82777e20");
        let provenance: HashMap<String, ReceivedProvenance> =
            [provenance_for("b".repeat(64).as_str(), "m3")].into_iter().collect();

        let pane = build_pane_b(&[local, foreign], &provenance);

        // The local half (role requested, served_by_node_id m3) attributes the
        // peer; the foreign served half is its counterparty half, not a second
        // peer row.
        let row = pane["rows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["peer_id"] == json!("node:m3"))
            .expect("the asked peer is attributed");
        let siblings = row["confirmed_siblings"].as_array().unwrap();
        assert_eq!(siblings.len(), 1);
        assert_eq!(siblings[0]["theirs"]["signature_ok"], json!(true));
        assert_eq!(siblings[0]["theirs"]["received_from"], json!("m3"));
        assert_eq!(siblings[0]["digest_match"]["state"], json!(STATE_VERIFIED));
        // The half IS held now -- the node text stops asserting "not held".
        assert!(
            row["node"]["text"]
                .as_str()
                .unwrap()
                .contains("their half held")
        );
    }

    /// A peer with only this node's own half (no pushed sibling, no
    /// provenance) supplies an EMPTY `confirmed_siblings` -- the gate reads
    /// that as "not confirmed", and the row stays "their half not held". No
    /// fabricated confirmation, no fetch-gated predicate.
    #[test]
    fn pane_b_local_only_peer_supplies_no_confirmed_sibling() {
        let local = mesh_half("a".repeat(64).as_str(), "requested", "d".repeat(64).as_str(), "e".repeat(64).as_str(), "m4-914b61c1");
        let pane = build_pane_b(&[local], &no_provenance());
        let row = &pane["rows"][0];
        assert_eq!(row["peer_id"], json!("node:m3"));
        assert_eq!(row["confirmed_siblings"].as_array().unwrap().len(), 0);
        assert!(
            row["node"]["text"]
                .as_str()
                .unwrap()
                .contains("their half not held")
        );
    }

    /// The provenance rule holds in Pane B exactly as in Pane C: a genuine
    /// cross-node served half with NO provenance line is not a counterparty
    /// half, so it supplies no `confirmed_siblings` -- the gate cannot close.
    #[test]
    fn pane_b_sibling_without_a_provenance_line_supplies_no_confirmed_sibling() {
        let local = mesh_half("a".repeat(64).as_str(), "requested", "d".repeat(64).as_str(), "e".repeat(64).as_str(), "m4-914b61c1");
        let foreign = mesh_half("b".repeat(64).as_str(), "served", "d".repeat(64).as_str(), "e".repeat(64).as_str(), "m3-82777e20");
        // No provenance -> `foreign` is not a received half.
        let pane = build_pane_b(&[local, foreign], &no_provenance());
        let row = pane["rows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["peer_id"] == json!("node:m3"))
            .expect("the peer is still attributed by this node's own record");
        assert_eq!(row["confirmed_siblings"].as_array().unwrap().len(), 0);
    }

    /// A correlated pushed half whose digests DIFFER supplies a `failed`
    /// `digest_match` -- which the ONE gate turns into CONTRADICTED, never a
    /// silent confirmation. The sibling is still supplied (a real disagreement
    /// between two present halves), never dropped.
    #[test]
    fn pane_b_correlated_pushed_half_with_differing_digests_supplies_a_failed_match() {
        let local = mesh_half("a".repeat(64).as_str(), "requested", "d".repeat(64).as_str(), "e".repeat(64).as_str(), "m4-914b61c1");
        // Same request_digest (correlates), DIFFERENT response_digest.
        let foreign = mesh_half("b".repeat(64).as_str(), "served", "d".repeat(64).as_str(), "f".repeat(64).as_str(), "m3-82777e20");
        let provenance: HashMap<String, ReceivedProvenance> =
            [provenance_for("b".repeat(64).as_str(), "m3")].into_iter().collect();

        let pane = build_pane_b(&[local, foreign], &provenance);

        let row = pane["rows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["peer_id"] == json!("node:m3"))
            .expect("the peer is attributed");
        let siblings = row["confirmed_siblings"].as_array().unwrap();
        assert_eq!(siblings.len(), 1);
        assert_eq!(siblings[0]["digest_match"]["state"], json!(STATE_FAILED));
    }

    #[test]
    fn pane_c_groups_by_digest_when_no_exchange_id_and_tags_served_by_default() {
        let records = vec![
            fixture_record("cap-1", "2026-09-01T00:00:00Z", "req-1", None),
            fixture_record("cap-2", "2026-09-02T00:00:00Z", "req-2", Some("cap-1")),
        ];
        let pane = build_pane_c_list(&records, &no_provenance());
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
        let pane = build_pane_c_list(&[record], &no_provenance());
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
        let pane = build_pane_c_list(&[record], &no_provenance());
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
        let pane = build_pane_c_list(&[record], &no_provenance());
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
        let pane = build_pane_c_list(&[record], &no_provenance());
        assert_eq!(pane["rows"][0]["theirs"]["state"], json!(STATE_ABSENT));
    }

    // -----------------------------------------------------------------
    // [mesh-closed-on-frozen-base] Route through the ONE gate: the pane
    // fires CLOSED on a locally-held, provenance-carrying, digest-matching
    // foreign sibling -- mirroring capsule-emit-mesh's
    // `tests/test_pane_fires_on_pushed_sibling.py`. The CLOSED/CONTRADICTED
    // DECISION is the ONE gate's (`exchange-row-state.ts::deriveRightCellState`,
    // `signatureOk && digestsCiteOurHalf`); these tests prove `build_pane_c_list`
    // SUPPLIES that gate its two inputs honestly -- the correlated sibling
    // (dropping the `unilateral: true` hardcode) and the structural
    // `digest_match` -- and that the provenance rule holds (no provenance ->
    // no counterparty half -> the gate cannot close).
    // -----------------------------------------------------------------

    /// A locally-held foreign sibling (a DIFFERENT host-minted exchange_id, the
    /// SAME request_digest, a `received-provenance.jsonl` line with
    /// `signature_ok: true`) is CORRELATED into this node's own asked half:
    /// ONE row, both columns filled, `unilateral: false`, and the structural
    /// `digest_match` is `verified` -- exactly the two inputs the ONE gate
    /// reads to render CLOSED. MUTANT: revert `build_pane_c_list` to the
    /// per-record `unilateral: true` hardcode and `unilateral`/`digest_match`
    /// both go red.
    #[test]
    fn pane_c_closes_a_correlated_provenance_carrying_signature_verifying_sibling() {
        let local = mesh_half("a".repeat(64).as_str(), "requested", "d".repeat(64).as_str(), "e".repeat(64).as_str(), "m4-914b61c1");
        let foreign = mesh_half("b".repeat(64).as_str(), "served", "d".repeat(64).as_str(), "e".repeat(64).as_str(), "m3-82777e20");
        // The door verified & recorded the foreign half; the two host-minted
        // exchange_ids differ, so ONLY the digest correlator groups them.
        let provenance: HashMap<String, ReceivedProvenance> =
            [provenance_for("b".repeat(64).as_str(), "m3")].into_iter().collect();

        let pane = build_pane_c_list(&[local.clone(), foreign.clone()], &provenance);

        assert_eq!(pane["row_count"], json!(1)); // ONE row, not two OPEN halves.
        let row = &pane["rows"][0];
        assert_eq!(row["exchange_key"], json!(format!("digest:{}", "d".repeat(64))));
        assert_eq!(row["mine"]["capsule_id"], json!("a".repeat(64)));
        assert_eq!(row["theirs"]["capsule_id"], json!("b".repeat(64))); // the sibling filled `theirs`.
        assert_eq!(row["unilateral"], json!(false)); // NOT the old hardcode.
        // The gate's `digestsCiteOurHalf` input: both digests agree -> verified.
        assert_eq!(row["digest_match"]["state"], json!(STATE_VERIFIED));
        // The gate's `signatureOk` input: the door's recorded provenance triple.
        assert_eq!(row["theirs"]["signature_ok"], json!(true));
        assert_eq!(row["theirs"]["received_from"], json!("m3"));
        assert_eq!(row["theirs"]["via"], json!("push"));
        assert_eq!(row["theirs"]["state"], json!(STATE_PRESENT_UNVERIFIED));
    }

    /// Only the local half present (no sibling, no provenance): unilateral/OPEN,
    /// `theirs` absent, `digest_match` absent (nothing to reconcile). The
    /// deferred browser-fetch fallback still surfaces the record's own
    /// peer-asserted join key when one exists, but the row is NOT closed here.
    #[test]
    fn pane_c_row_with_only_the_local_half_is_unilateral_open() {
        let local = mesh_half("a".repeat(64).as_str(), "requested", "d".repeat(64).as_str(), "e".repeat(64).as_str(), "m4-914b61c1");
        let pane = build_pane_c_list(&[local], &no_provenance());
        assert_eq!(pane["row_count"], json!(1));
        let row = &pane["rows"][0];
        assert_eq!(row["unilateral"], json!(true));
        assert_eq!(row["theirs"]["state"], json!(STATE_ABSENT));
        assert_eq!(row["digest_match"]["state"], json!(STATE_ABSENT));
    }

    /// The provenance rule: a self-sealed sibling (this node minted BOTH
    /// halves; NEITHER capsule_id has a `received-provenance.jsonl` line) never
    /// closes, even with a matching request_digest -- the two halves fold into
    /// one row (both are `mine`), `theirs` stays absent, `unilateral: true`.
    /// Correlation feeds the gate; it never bypasses it.
    #[test]
    fn pane_c_self_sealed_sibling_never_closes_even_when_digests_match() {
        let half_a = mesh_half("a".repeat(64).as_str(), "requested", "d".repeat(64).as_str(), "e".repeat(64).as_str(), "m4-914b61c1");
        let half_b = mesh_half("b".repeat(64).as_str(), "served", "d".repeat(64).as_str(), "e".repeat(64).as_str(), "m4-82777e20");
        // No provenance for EITHER capsule_id -> neither is a counterparty half.
        let pane = build_pane_c_list(&[half_a, half_b], &no_provenance());
        assert_eq!(pane["row_count"], json!(1)); // correlated into one row...
        let row = &pane["rows"][0];
        assert_eq!(row["unilateral"], json!(true)); // ...but never closed: no `theirs`.
        assert_eq!(row["theirs"]["state"], json!(STATE_ABSENT));
    }

    /// The provenance rule, no-provenance variant: a genuine cross-node sibling
    /// whose capsule_id carries NO provenance line (self-declared present in the
    /// ledger but never granted the triple at the door) is treated as `mine`,
    /// so the row stays unilateral/OPEN -- the gate has nothing to close on.
    #[test]
    fn pane_c_sibling_without_a_provenance_line_never_fills_theirs() {
        let local = mesh_half("a".repeat(64).as_str(), "requested", "d".repeat(64).as_str(), "e".repeat(64).as_str(), "m4-914b61c1");
        let foreign = mesh_half("b".repeat(64).as_str(), "served", "d".repeat(64).as_str(), "e".repeat(64).as_str(), "m3-82777e20");
        // Provenance map is empty -> `foreign` is not a received counterparty
        // half, even though it is a real cross-node served half.
        let pane = build_pane_c_list(&[local, foreign], &no_provenance());
        assert_eq!(pane["row_count"], json!(1));
        let row = &pane["rows"][0];
        assert_eq!(row["unilateral"], json!(true));
        assert_eq!(row["theirs"]["state"], json!(STATE_ABSENT));
    }

    /// A correlated pair whose digests DIFFER renders CONTRADICTED: the
    /// structural `digest_match` is `failed` (one byte off on the
    /// response_digest), which the ONE gate turns into CONTRADICTED. The pair
    /// is still ONE row with `theirs` filled (`unilateral: false`) -- a real
    /// disagreement between two present halves, never a missing-half OPEN.
    /// MUTANT: soften `digest_match_state`'s `any_failed` rule (average a
    /// mismatch into `verified`) and this goes red.
    #[test]
    fn pane_c_correlated_pair_with_differing_digests_is_contradicted() {
        let local = mesh_half("a".repeat(64).as_str(), "requested", "d".repeat(64).as_str(), "e".repeat(64).as_str(), "m4-914b61c1");
        // Same request_digest (correlates), DIFFERENT response_digest.
        let foreign = mesh_half("b".repeat(64).as_str(), "served", "d".repeat(64).as_str(), "f".repeat(64).as_str(), "m3-82777e20");
        let provenance: HashMap<String, ReceivedProvenance> =
            [provenance_for("b".repeat(64).as_str(), "m3")].into_iter().collect();

        let pane = build_pane_c_list(&[local, foreign], &provenance);

        assert_eq!(pane["row_count"], json!(1));
        let row = &pane["rows"][0];
        assert_eq!(row["unilateral"], json!(false)); // both halves present...
        assert_eq!(row["digest_match"]["state"], json!(STATE_FAILED)); // ...but they disagree.
    }

    /// `read_received_provenance` enforces the provenance rule at the file
    /// boundary: only a line carrying a non-empty `received_from` AND
    /// `signature_ok: true` is kept. A line missing `received_from`, or one
    /// with `signature_ok: false`, is dropped -- never a fabricated
    /// counterparty half. Matches `record_push`: a failed verify goes to
    /// `rejected-record-pushes.jsonl`, NEVER `received-provenance.jsonl`, so a
    /// false `signature_ok` should never appear -- but if it did, this reader
    /// refuses it.
    #[test]
    fn read_received_provenance_keeps_only_signature_ok_lines_carrying_received_from() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("received-provenance.jsonl"),
            "{\"capsule_id\":\"good\",\"received_from\":\"m3\",\"via\":\"push\",\"received_at\":\"2026-09-25T00:00:01Z\",\"signature_ok\":true}\n\
             {\"capsule_id\":\"no-from\",\"via\":\"push\",\"signature_ok\":true}\n\
             {\"capsule_id\":\"sig-false\",\"received_from\":\"m3\",\"signature_ok\":false}\n",
        )
        .unwrap();
        let map = read_received_provenance(dir.path());
        assert!(map.contains_key("good"));
        assert!(!map.contains_key("no-from"));
        assert!(!map.contains_key("sig-false"));
        assert_eq!(map["good"].received_from, "m3");
        assert!(map["good"].signature_ok);
    }

    /// A missing `received-provenance.jsonl` is the common case (this node has
    /// received no push): an empty map, no panic -- so no row can close on a
    /// local sibling, the honest default.
    #[test]
    fn read_received_provenance_absent_file_is_empty_not_a_panic() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_received_provenance(dir.path()).is_empty());
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

    /// The digest is the correlator that survives a cross-node exchange, so
    /// it is preferred over the host-minted `exchange_id` whenever a record
    /// carries one (see `exchange_key_for`'s doc + `served_request_join.py`'s
    /// CORRELATION FALLBACK). A record with BOTH keys groups by digest.
    #[test]
    fn exchange_key_for_prefers_request_digest_over_host_minted_exchange_id() {
        let mut record = fixture_record("cap-1", "2026-09-01T00:00:00Z", "req-1", None);
        record["model_attestation"]["compute_attestation"]["x-mesh-poc-v1"] =
            json!({ "serving_provenance": { "exchange_id": "exch-real" } });
        assert_eq!(exchange_key_for(&record).as_deref(), Some("digest:req-1"));
    }

    /// A record with no `request_digest` at all (e.g. a plugin-served stub
    /// with no digested body) falls back to the host-minted `exchange_id`.
    #[test]
    fn exchange_key_for_falls_back_to_exchange_id_when_no_request_digest() {
        let record = json!({
            "capsule_id": "cap-1",
            "timestamp": "2026-09-01T00:00:00Z",
            "model_attestation": { "compute_attestation": {
                "x-mesh-poc-v1": { "serving_provenance": { "exchange_id": "exch-real" } }
            } },
        });
        // No `effect.request_digest` on this record.
        assert!(record.pointer("/effect/request_digest").is_none());
        assert_eq!(exchange_key_for(&record).as_deref(), Some("exch-real"));
    }

    /// [mesh-reconcile-join-request-digest] the empirical CLOSED-tour finding:
    /// two cross-node halves of ONE real exchange carry DIFFERENT host-minted
    /// `exchange_id`s (M4 vs M3) but the SAME `request_digest` (each host
    /// digested the same wire bytes). They MUST group into one exchange, not
    /// two OPEN rows. MUTANT: revert `exchange_key_for` to exchange_id-first
    /// and this row_count goes from 1 to 2.
    #[test]
    fn pane_c_groups_two_cross_node_halves_with_differing_exchange_ids_as_one_exchange() {
        // Requester half (M4): role requested, its own host-minted exchange_id.
        let mut requester = fixture_record("cap-m4", "2026-09-25T00:00:00Z", "shared-req-digest", None);
        requester["model_attestation"]["compute_attestation"]["x-mesh-poc-v1"] = json!({
            "role": "requested",
            "serving_provenance": { "exchange_id": "914b61c1", "role": "requester" }
        });
        // Provider half (M3, pushed into M4's ledger): a DIFFERENT host-minted
        // exchange_id, the SAME request_digest.
        let mut provider = fixture_record("cap-m3", "2026-09-25T00:00:01Z", "shared-req-digest", None);
        provider["model_attestation"]["compute_attestation"]["x-mesh-poc-v1"] = json!({
            "role": "served",
            "serving_provenance": { "exchange_id": "82777e20", "role": "provider" }
        });

        let both = vec![requester.clone(), provider.clone()];
        // Both records share the digest key -> one exchange group.
        assert_eq!(exchange_key_for(&requester), exchange_key_for(&provider));
        assert_eq!(exchange_key_for(&requester).as_deref(), Some("digest:shared-req-digest"));

        // The drilldown groups both halves under the one shared key -- the
        // CLOSED-eligible pair the reconcile must produce, not two OPEN rows.
        let pane = build_pane_c_drilldown(&both, "digest:shared-req-digest");
        assert_eq!(pane["found"], json!(true));

        // And a CONFLICTING pair (equal host-minted exchange_id, DIFFERENT
        // request_digest) stays SPLIT -- distinct digest keys keep two
        // different requests apart, matching served_request_join.py's refusal.
        let mut conflict_a = fixture_record("cap-a", "2026-09-25T00:00:00Z", "digest-a", None);
        conflict_a["model_attestation"]["compute_attestation"]["x-mesh-poc-v1"] =
            json!({ "serving_provenance": { "exchange_id": "same-id" } });
        let mut conflict_b = fixture_record("cap-b", "2026-09-25T00:00:01Z", "digest-b", None);
        conflict_b["model_attestation"]["compute_attestation"]["x-mesh-poc-v1"] =
            json!({ "serving_provenance": { "exchange_id": "same-id" } });
        assert_ne!(exchange_key_for(&conflict_a), exchange_key_for(&conflict_b));
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
        assert_no_retired_vocabulary(&build_pane_b(&records, &no_provenance()), "$");
    }
}
