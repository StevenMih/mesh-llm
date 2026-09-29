//! `/api/evidence-requests`: ask the other side of an exchange for its record.
//!
//! `POST {peer, request}` sends one evidence request (the capsule plugin's E14
//! request map) to `peer` over the mesh through the plugin's
//! `mesh_evidence_request` operation, and answers with the peer's own reply,
//! unchanged: an artifact carrying the record, or the refusal the peer signed.
//! The console judges what comes back; this route never does. A peer that
//! can't be reached, or doesn't answer, is a 502 with the reason.
//!
//! Loopback-only (`api::access::requires_trusted_local_access`): the route
//! makes this node contact another one.
//!
//! The reply also carries the key this node was told the peer signs with
//! (`announced_key_id`, from `ADMISSION_POLICY_PEER_KEYS`, the same operator
//! map the capsule plugin's door checks pushes against). The console judges
//! a refusal or a record only under that key, never under the key the reply
//! names itself; `null` when the peer has no announced key.

use serde::{Deserialize, Serialize};
use tokio::net::TcpStream;

use super::super::{
    MeshApi,
    http::{respond_error, respond_json},
};

pub(super) const ROUTE: &str = "/api/evidence-requests";
/// The capsule plugin sends the request. It installs as `capsule-emit-mesh`;
/// `admission-policy` is the id it had before, still tried if the first is
/// not there.
const PLUGIN_IDS: [&str; 2] = ["capsule-emit-mesh", "admission-policy"];
const ASK_OPERATION: &str = "mesh_evidence_request";
/// Peer id -> the key that peer signs with, as a JSON object; set by the
/// operator (the capsule plugin's `peer_keys.py` reads the same variable).
const PEER_KEYS_ENV: &str = "ADMISSION_POLICY_PEER_KEYS";

pub(super) fn is_route(path: &str) -> bool {
    path == ROUTE
}

#[derive(Debug, Deserialize)]
struct AskRequest {
    /// The other side's full endpoint id (64 hex).
    peer: String,
    /// The E14 request map, passed to the plugin unchanged.
    request: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct AskResponse {
    /// The peer's reply as it sent it: an artifact, or a signed refusal.
    answer: serde_json::Value,
    /// The key this node was told `peer` signs with; `None` when unknown.
    announced_key_id: Option<String>,
}

pub(super) async fn handle(
    stream: &mut TcpStream,
    state: &MeshApi,
    method: &str,
    body: &str,
) -> anyhow::Result<()> {
    if method != "POST" {
        return respond_error(stream, 405, "Method Not Allowed").await;
    }
    let request: AskRequest = match serde_json::from_str(body) {
        Ok(request) => request,
        Err(error) => return respond_error(stream, 400, &error.to_string()).await,
    };
    let Some(peer) = full_peer_id(&request.peer) else {
        return respond_error(stream, 400, "peer must be a 64-hex endpoint id").await;
    };
    if !request.request.is_object() {
        return respond_error(stream, 400, "request must be an evidence request object").await;
    }
    let plugin_manager = state.inner.lock().await.plugin_manager.clone();
    match ask(&plugin_manager, &ask_arguments(&peer, &request.request)).await {
        Ok(answer) => {
            let registry = std::env::var(PEER_KEYS_ENV).ok();
            respond_json(
                stream,
                200,
                &ask_response(answer, registry.as_deref(), &peer),
            )
            .await
        }
        Err(reason) => respond_error(stream, 502, &reason).await,
    }
}

/// The endpoint id, lower-case, when `value` is exactly one.
fn full_peer_id(value: &str) -> Option<String> {
    let bytes: [u8; 32] = hex::decode(value.trim()).ok()?.try_into().ok()?;
    iroh::EndpointId::from_bytes(&bytes).ok()?;
    Some(hex::encode(bytes))
}

/// The reply: the peer's answer, unchanged, and the key it is announced with.
fn ask_response(answer: serde_json::Value, registry: Option<&str>, peer: &str) -> AskResponse {
    AskResponse {
        answer,
        announced_key_id: announced_key_for(registry, peer),
    }
}

/// The key `peer` is announced with in `registry` (the JSON object in
/// `ADMISSION_POLICY_PEER_KEYS`), lower-case. `None` when the variable is
/// unset, not a JSON object, or has no non-empty string for `peer`: never a
/// guess, as `peer_keys.announced_key_for` reads it.
fn announced_key_for(registry: Option<&str>, peer: &str) -> Option<String> {
    let registry: serde_json::Value = serde_json::from_str(registry?).ok()?;
    let key = registry.as_object()?.get(peer)?.as_str()?.trim();
    (!key.is_empty()).then(|| key.to_ascii_lowercase())
}

fn ask_arguments(peer: &str, request: &serde_json::Value) -> String {
    serde_json::json!({ "peer_id": peer, "request": request }).to_string()
}

/// Ask through the capsule plugin, under the id it is installed as. Only when
/// the call to one id fails is the next tried; the first error is reported.
/// A reply the plugin marks as an error (the peer could not be reached, or
/// never answered) is an error here too; anything else is the peer's answer.
async fn ask(
    plugin_manager: &crate::plugin::PluginManager,
    arguments: &str,
) -> Result<serde_json::Value, String> {
    let mut first_error = None;
    for plugin in PLUGIN_IDS {
        match plugin_manager
            .invoke_operation(plugin, ASK_OPERATION, arguments)
            .await
        {
            Ok(result) if result.is_error => return Err(result.content_json),
            Ok(result) => {
                return serde_json::from_str(&result.content_json)
                    .map_err(|error| format!("the plugin's reply is not JSON: {error}"));
            }
            Err(error) => {
                first_error.get_or_insert_with(|| error.to_string());
            }
        }
    }
    Err(first_error.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A capsule plugin double that records whom it was asked through and
    /// answers every `mesh_evidence_request` with `reply`.
    struct CapsulePlugin {
        asked: std::sync::Mutex<Vec<(String, serde_json::Value)>>,
        reply: serde_json::Value,
    }

    impl crate::plugin::PluginRpcBridge for CapsulePlugin {
        fn handle_request(
            &self,
            plugin_name: String,
            _method: String,
            params_json: String,
        ) -> crate::plugin::BridgeFuture<
            Result<crate::plugin::RpcResult, crate::plugin::proto::ErrorResponse>,
        > {
            let request: mesh_llm_plugin::OperationRequest =
                serde_json::from_str(&params_json).unwrap();
            assert_eq!(request.name, ASK_OPERATION);
            self.asked
                .lock()
                .unwrap()
                .push((plugin_name, request.arguments.clone()));
            let reply = self.reply.clone();
            Box::pin(async move {
                Ok(crate::plugin::RpcResult {
                    result_json: serde_json::to_string(&rmcp::model::CallToolResult::structured(
                        reply,
                    ))
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

    /// The ask goes to the installed capsule plugin with the peer and the
    /// request map unchanged, and the peer's signed refusal comes back as the
    /// answer, unjudged. MUTANT: asking `admission-policy` only returns an
    /// error instead of the refusal.
    #[tokio::test]
    async fn an_ask_reaches_the_peer_and_returns_its_signed_refusal() {
        let refusal = serde_json::json!({
            "request_digest": "a".repeat(64),
            "reason": "no_such_record",
            "issued_at": "2026-09-28T21:00:00Z",
            "key_id": "b".repeat(64),
            "sig": "c".repeat(128),
        });
        let bridge = std::sync::Arc::new(CapsulePlugin {
            asked: std::sync::Mutex::new(Vec::new()),
            reply: refusal.clone(),
        });
        let manager =
            crate::plugin::PluginManager::for_test_bridge(&["capsule-emit-mesh"], bridge.clone());
        let peer = hex::encode(iroh::SecretKey::generate().public().as_bytes());
        let request = serde_json::json!({
            "subject": {"kind": "correlation", "by": "nonce", "value": "nonce-under-test"},
            "coverage": {},
        });

        let answer = ask(&manager, &ask_arguments(&peer, &request)).await;

        assert_eq!(answer, Ok(refusal));
        let asked = bridge.asked.lock().unwrap();
        assert_eq!(asked.len(), 1);
        assert_eq!(asked[0].0, "capsule-emit-mesh");
        assert_eq!(asked[0].1["peer_id"], serde_json::Value::from(peer));
        assert_eq!(asked[0].1["request"], request);
    }

    /// The console judges a reply only under this key. MUTANT: return the
    /// first key in the map, or any key for an unknown peer, and this fails.
    #[test]
    fn the_announced_key_is_the_one_configured_for_that_peer_only() {
        let peer = "a".repeat(64);
        let other = "b".repeat(64);
        let registry = format!(
            r#"{{"{other}":"{}","{peer}":"{}"}}"#,
            "1".repeat(64),
            "2F".repeat(32)
        );
        assert_eq!(
            announced_key_for(Some(&registry), &peer),
            Some("2f".repeat(32))
        );
        assert_eq!(announced_key_for(Some(&registry), &"c".repeat(64)), None);
        assert_eq!(announced_key_for(None, &peer), None);
        assert_eq!(announced_key_for(Some("not json"), &peer), None);
        assert_eq!(
            announced_key_for(Some(&format!(r#"{{"{peer}":""}}"#)), &peer),
            None
        );
        assert_eq!(announced_key_for(Some(r#"["x"]"#), &peer), None);
    }

    /// The reply names the asked peer's announced key, or null. MUTANT: drop
    /// it from the response and the console can never verify anything.
    #[test]
    fn the_reply_carries_the_asked_peers_announced_key() {
        let peer = "a".repeat(64);
        let registry = format!(r#"{{"{peer}":"{}"}}"#, "2".repeat(64));
        let body = serde_json::to_value(ask_response(
            serde_json::json!({"reason": "no_such_record"}),
            Some(&registry),
            &peer,
        ))
        .unwrap();
        assert_eq!(body["answer"]["reason"], "no_such_record");
        assert_eq!(
            body["announced_key_id"],
            serde_json::Value::from("2".repeat(64))
        );
        let unknown =
            serde_json::to_value(ask_response(serde_json::json!({}), None, &peer)).unwrap();
        assert_eq!(unknown["announced_key_id"], serde_json::Value::Null);
    }

    /// The console digests the request bytes it sends and a refusal must name
    /// that digest; the bytes survive this route and the plugin's
    /// `serde_json::to_vec` unchanged (keys already sorted, compact).
    /// MUTANT: pretty-print or reorder here and the digests part.
    #[test]
    fn the_console_request_bytes_survive_serde_unchanged() {
        let sent =
            r#"{"coverage":{},"subject":{"by":"nonce","kind":"correlation","value":"nonce-1"}}"#;
        let arguments = ask_arguments(&"a".repeat(64), &serde_json::from_str(sent).unwrap());
        let arguments: serde_json::Value = serde_json::from_str(&arguments).unwrap();
        assert_eq!(
            serde_json::to_vec(&arguments["request"]).unwrap(),
            sent.as_bytes()
        );
    }

    #[test]
    fn the_peer_must_be_a_full_endpoint_id() {
        let full = hex::encode(iroh::SecretKey::generate().public().as_bytes());
        assert_eq!(full_peer_id(&full.to_uppercase()), Some(full));
        assert!(
            full_peer_id("a70d3967bea3b22f").is_none(),
            "a short id is refused"
        );
        assert!(full_peer_id("node:a70d3967").is_none());
    }
}
