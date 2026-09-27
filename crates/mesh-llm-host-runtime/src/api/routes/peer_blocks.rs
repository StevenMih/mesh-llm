//! `/api/peer-blocks`: the operator's local "stop routing to this peer".
//!
//! `GET` lists active blocks and every recorded choice. `POST` blocks a peer;
//! `POST /api/peer-blocks/unblock` undoes it. The block is saved and takes
//! effect in the router first; then the capsule plugin seals a record of it
//! with the salt the store already holds. If the seal is not confirmed (the
//! plugin is down, refuses, times out, or returns a commitment that does not
//! match), the block still holds and the response says `sealed: false`: the
//! record may or may not be on the chain, and the kept salt can match it later.
//!
//! Loopback-only (`api::access::requires_trusted_local_access`).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use tokio::net::TcpStream;

use super::super::{
    MeshApi,
    http::{respond_error, respond_json},
};
use crate::network::peer_blocks::{
    ActiveBlock, BlockLength, ChoiceEntry, PeerBlocks, RoutingChange, SealedChoice, now_ms,
};

pub(super) const ROUTE: &str = "/api/peer-blocks";
const UNBLOCK_ROUTE: &str = "/api/peer-blocks/unblock";
const PLUGIN: &str = "admission-policy";
const SEAL_OPERATION: &str = "mesh_local_routing_choice";

pub(super) fn is_route(path: &str) -> bool {
    path == ROUTE || path == UNBLOCK_ROUTE
}

#[derive(Debug, Deserialize)]
struct BlockRequest {
    peer: String,
    length: BlockLength,
}

#[derive(Debug, Deserialize)]
struct UnblockRequest {
    peer: String,
}

/// A recorded choice as the console sees it. The salt stays on disk.
#[derive(Debug, Serialize)]
struct ChoiceView {
    change: RoutingChange,
    peer: String,
    at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    until_ms: Option<u64>,
    /// The sealed record's id; `None` when the plugin did not seal one.
    capsule_id: Option<String>,
}

impl From<&ChoiceEntry> for ChoiceView {
    fn from(entry: &ChoiceEntry) -> Self {
        Self {
            change: entry.change,
            peer: entry.peer.clone(),
            at_ms: entry.at_ms,
            until_ms: entry.until_ms,
            capsule_id: entry
                .record
                .as_ref()
                .map(|record| record.capsule_id.clone()),
        }
    }
}

#[derive(Debug, Serialize)]
struct ListResponse {
    blocks: BTreeMap<String, ActiveBlock>,
    choices: Vec<ChoiceView>,
}

#[derive(Debug, Serialize)]
struct ChangeResponse {
    choice: ChoiceView,
    sealed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    seal_error: Option<String>,
}

pub(super) async fn handle(
    stream: &mut TcpStream,
    state: &MeshApi,
    method: &str,
    path: &str,
    body: &str,
) -> anyhow::Result<()> {
    let (blocks, plugin_manager) = {
        let inner = state.inner.lock().await;
        (inner.node.peer_blocks.clone(), inner.plugin_manager.clone())
    };
    // One change at a time, sealed in the order it was made.
    let _in_order = if method == "POST" {
        Some(blocks.change_order().lock().await)
    } else {
        None
    };
    match (method, path) {
        ("GET", ROUTE) => {
            let (active, choices) = blocks.snapshot(now_ms());
            respond_json(
                stream,
                200,
                &ListResponse {
                    blocks: active,
                    choices: choices.iter().map(ChoiceView::from).collect(),
                },
            )
            .await
        }
        ("POST", ROUTE) => {
            let request: BlockRequest = match serde_json::from_str(body) {
                Ok(request) => request,
                Err(error) => return respond_error(stream, 400, &error.to_string()).await,
            };
            let Some(peer) = parse_peer(&request.peer) else {
                return respond_error(stream, 400, "peer must be a 64-hex endpoint id").await;
            };
            let entry = match blocks.block(&peer, request.length, now_ms()) {
                Ok(entry) => entry,
                Err(error) => return respond_error(stream, 500, &error.to_string()).await,
            };
            let response = seal_and_attach(&blocks, &plugin_manager, entry).await;
            respond_json(stream, 200, &response).await
        }
        ("POST", UNBLOCK_ROUTE) => {
            let request: UnblockRequest = match serde_json::from_str(body) {
                Ok(request) => request,
                Err(error) => return respond_error(stream, 400, &error.to_string()).await,
            };
            let Some(peer) = parse_peer(&request.peer) else {
                return respond_error(stream, 400, "peer must be a 64-hex endpoint id").await;
            };
            match blocks.unblock(&peer, now_ms()) {
                Ok(Some(entry)) => {
                    let response = seal_and_attach(&blocks, &plugin_manager, entry).await;
                    respond_json(stream, 200, &response).await
                }
                Ok(None) => respond_error(stream, 409, "this peer is not blocked").await,
                Err(error) => respond_error(stream, 500, &error.to_string()).await,
            }
        }
        _ => respond_error(stream, 405, "Method Not Allowed").await,
    }
}

fn parse_peer(value: &str) -> Option<iroh::EndpointId> {
    let bytes: [u8; 32] = hex::decode(value.trim()).ok()?.try_into().ok()?;
    iroh::EndpointId::from_bytes(&bytes).ok()
}

/// The arguments the plugin's `mesh_local_routing_choice` operation takes. The
/// salt is ours: the plugin seals with it and never picks its own.
fn seal_arguments(entry: &ChoiceEntry) -> serde_json::Value {
    let until = entry.until_ms.and_then(|ms| {
        chrono::DateTime::from_timestamp_millis(i64::try_from(ms).ok()?)
            .map(|at| at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
    });
    let change = match entry.change {
        RoutingChange::Block => "block",
        RoutingChange::Unblock => "unblock",
    };
    serde_json::json!({
        "change": change,
        "peer_id": entry.peer,
        "until": until,
        "salt": entry.salt,
    })
}

async fn seal_and_attach(
    blocks: &PeerBlocks,
    plugin_manager: &crate::plugin::PluginManager,
    entry: ChoiceEntry,
) -> ChangeResponse {
    let sealed = plugin_manager
        .invoke_operation(PLUGIN, SEAL_OPERATION, &seal_arguments(&entry).to_string())
        .await
        .map_err(|error| error.to_string())
        .and_then(|result| {
            if result.is_error {
                Err(result.content_json)
            } else {
                serde_json::from_str::<SealedChoice>(&result.content_json)
                    .map_err(|error| format!("unexpected seal result: {error}"))
            }
        })
        .and_then(|record| confirm_commitment(&entry, record))
        .and_then(|record| {
            blocks
                .attach_record(entry.id, record.clone())
                .map(|()| record)
                .map_err(|error| error.to_string())
        });
    let mut choice = ChoiceView::from(&entry);
    match sealed {
        Ok(record) => {
            choice.capsule_id = Some(record.capsule_id);
            ChangeResponse {
                choice,
                sealed: true,
                seal_error: None,
            }
        }
        Err(error) => ChangeResponse {
            choice,
            sealed: false,
            seal_error: Some(error),
        },
    }
}

/// A seal counts only if its commitment is the one this store's salt and peer
/// give; anything else is a record of some other choice.
fn confirm_commitment(entry: &ChoiceEntry, record: SealedChoice) -> Result<SealedChoice, String> {
    if entry.expected_commitment().as_deref() == Some(record.peer_commitment.as_str()) {
        Ok(record)
    } else {
        Err("the sealed record names a different commitment".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(change: RoutingChange, until_ms: Option<u64>) -> ChoiceEntry {
        ChoiceEntry {
            id: 0,
            change,
            peer: "ab".repeat(32),
            at_ms: 0,
            until_ms,
            salt: "07".repeat(32),
            record: None,
        }
    }

    #[test]
    fn a_seal_counts_only_with_the_commitment_our_salt_gives() {
        let choice = entry(RoutingChange::Block, None);
        let good = SealedChoice {
            capsule_id: "c".repeat(64),
            peer_commitment: choice.expected_commitment().unwrap(),
        };
        assert_eq!(confirm_commitment(&choice, good.clone()), Ok(good));
        let other = SealedChoice {
            capsule_id: "c".repeat(64),
            peer_commitment: "d".repeat(64),
        };
        assert!(confirm_commitment(&choice, other).is_err());
    }

    #[test]
    fn seal_arguments_carry_our_salt_and_until_only_for_a_timed_block() {
        let timed = entry(RoutingChange::Block, Some(1_790_000_000_000));
        let args = seal_arguments(&timed);
        assert_eq!(args["change"], "block");
        assert_eq!(args["peer_id"], serde_json::Value::from("ab".repeat(32)));
        assert_eq!(args["until"], "2026-09-21T14:13:20Z");
        assert_eq!(args["salt"], serde_json::Value::from("07".repeat(32)));

        let args = seal_arguments(&entry(RoutingChange::Unblock, None));
        assert_eq!(args["change"], "unblock");
        assert!(args["until"].is_null());
    }

    #[test]
    fn peer_must_be_a_full_endpoint_id() {
        let full = hex::encode(iroh::SecretKey::generate().public().as_bytes());
        assert!(parse_peer(&full).is_some());
        assert!(
            parse_peer("a70d3967bea3b22f").is_none(),
            "a short id is refused"
        );
        assert!(parse_peer("node:a70d3967").is_none());
    }
}
