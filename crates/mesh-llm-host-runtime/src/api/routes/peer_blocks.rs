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
/// The capsule plugin seals the record. It installs as `capsule-emit-mesh`;
/// `admission-policy` is the id it had before, still tried if the first is
/// not there.
const PLUGIN_IDS: [&str; 2] = ["capsule-emit-mesh", "admission-policy"];
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
    let sealed = invoke_seal(plugin_manager, &seal_arguments(&entry).to_string())
        .await
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

/// Ask the capsule plugin to seal, under the id it is installed as. Only when
/// the call to one id fails is the next tried; the first error is reported.
async fn invoke_seal(
    plugin_manager: &crate::plugin::PluginManager,
    arguments: &str,
) -> Result<crate::plugin::ToolCallResult, String> {
    let mut first_error = None;
    for plugin in PLUGIN_IDS {
        match plugin_manager
            .invoke_operation(plugin, SEAL_OPERATION, arguments)
            .await
        {
            Ok(result) => return Ok(result),
            Err(error) => {
                first_error.get_or_insert_with(|| error.to_string());
            }
        }
    }
    Err(first_error.unwrap_or_default())
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

    /// UI-QA: "Stop routing" sealed nothing, because the seal was asked of
    /// `admission-policy` while the plugin is installed as
    /// `capsule-emit-mesh`. A block now seals through the installed id and
    /// the record is attached to the choice. MUTANT: seal through
    /// `admission-policy` only and `sealed` is false.
    #[tokio::test]
    async fn stop_routing_seals_through_the_plugin_as_installed() {
        struct CapsulePlugin(std::sync::Mutex<Vec<String>>);
        impl crate::plugin::PluginRpcBridge for CapsulePlugin {
            fn handle_request(
                &self,
                plugin_name: String,
                _method: String,
                params_json: String,
            ) -> crate::plugin::BridgeFuture<
                Result<crate::plugin::RpcResult, crate::plugin::proto::ErrorResponse>,
            > {
                self.0.lock().unwrap().push(plugin_name);
                let request: mesh_llm_plugin::OperationRequest =
                    serde_json::from_str(&params_json).unwrap();
                assert_eq!(request.name, SEAL_OPERATION);
                let peer = request.arguments["peer_id"].as_str().unwrap().to_string();
                let salt: [u8; 32] = hex::decode(request.arguments["salt"].as_str().unwrap())
                    .unwrap()
                    .try_into()
                    .unwrap();
                let record = serde_json::json!({
                    "capsule_id": "c".repeat(64),
                    "peer_commitment": crate::network::peer_blocks::peer_commitment(&peer, &salt),
                });
                Box::pin(async move {
                    Ok(crate::plugin::RpcResult {
                        result_json: serde_json::to_string(
                            &rmcp::model::CallToolResult::structured(record),
                        )
                        .unwrap(),
                    })
                })
            }
            fn handle_notification(
                &self,
                _plugin_name: String,
                _method: String,
                _params_json: String,
            ) -> crate::plugin::BridgeFuture<()> {
                Box::pin(async {})
            }
        }

        let bridge = std::sync::Arc::new(CapsulePlugin(std::sync::Mutex::new(Vec::new())));
        let manager =
            crate::plugin::PluginManager::for_test_bridge(&["capsule-emit-mesh"], bridge.clone());
        let blocks = PeerBlocks::in_memory();
        let peer = iroh::SecretKey::generate().public();
        let entry = blocks
            .block(&peer, BlockLength::UntilUndone, now_ms())
            .unwrap();
        let response = seal_and_attach(&blocks, &manager, entry).await;
        assert!(response.sealed, "{:?}", response.seal_error);
        assert_eq!(response.choice.capsule_id, Some("c".repeat(64)));
        assert_eq!(*bridge.0.lock().unwrap(), ["capsule-emit-mesh"]);
        // The block itself stops routing to THAT node, and only that one.
        assert!(blocks.is_blocked(&peer, now_ms()));
        assert!(!blocks.is_blocked(&iroh::SecretKey::generate().public(), now_ms()));
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
