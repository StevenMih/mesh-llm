//! `/api/route-target`: where this console's chats go (u115).
//!
//! The Evidence tab's "Chat with this node" sets a node here; until it is
//! cleared, every chat the console sends through this host (`/api/chat`,
//! `/api/responses`: `routes/chat.rs`) carries it as `x-mesh-target`, the
//! ingress's existing header. Its contract applies unchanged: a node that
//! does not serve the model is refused (409), never quietly swapped for
//! another. Clearing it restores automatic routing. Nothing else that
//! reaches this host (`/v1/*` clients) is affected, and Chat's own code is
//! untouched.
//!
//! `GET` answers `{"node_id": <64 hex> | null}`; `POST {"node_id"}` sets it;
//! `DELETE` clears it. Loopback-only (`api::access`): it changes routing.

use serde::Deserialize;
use tokio::net::TcpStream;

use super::super::{
    MeshApi,
    http::{respond_error, respond_json},
};

pub(super) const ROUTE: &str = "/api/route-target";

pub(super) fn is_route(path: &str) -> bool {
    path == ROUTE
}

#[derive(Debug, Deserialize)]
struct SetTarget {
    node_id: String,
}

pub(super) async fn handle(
    stream: &mut TcpStream,
    state: &MeshApi,
    method: &str,
    body: &str,
) -> anyhow::Result<()> {
    match method {
        "GET" => {}
        "POST" => {
            let Ok(request) = serde_json::from_str::<SetTarget>(body) else {
                return respond_error(stream, 400, "body must be {\"node_id\": <64-hex node id>}")
                    .await;
            };
            let Some(node_id) = full_node_id(&request.node_id) else {
                return respond_error(stream, 400, "node_id must be a 64-hex node id").await;
            };
            state.inner.lock().await.console_chat_target = Some(node_id);
        }
        "DELETE" => state.inner.lock().await.console_chat_target = None,
        _ => return respond_error(stream, 405, "Method Not Allowed").await,
    }
    let node_id = state.inner.lock().await.console_chat_target.clone();
    respond_json(stream, 200, &serde_json::json!({ "node_id": node_id })).await
}

/// The node id, lower-case, when `value` is exactly one.
fn full_node_id(value: &str) -> Option<String> {
    let bytes: [u8; 32] = hex::decode(value.trim()).ok()?.try_into().ok()?;
    iroh::EndpointId::from_bytes(&bytes).ok()?;
    Some(hex::encode(bytes))
}

/// `request` (the console's chat, as received) with `x-mesh-target: target`
/// added to its headers, unless it already names a target of its own.
pub(super) fn with_mesh_target(request: &str, target: Option<&str>) -> String {
    let Some(target) = target else {
        return request.to_string();
    };
    let Some(line_end) = request.find("\r\n") else {
        return request.to_string();
    };
    let head_end = request.find("\r\n\r\n").unwrap_or(request.len());
    let names_one = request[..head_end].split("\r\n").skip(1).any(|line| {
        line.split_once(':')
            .is_some_and(|(name, _)| name.trim().eq_ignore_ascii_case("x-mesh-target"))
    });
    if names_one {
        return request.to_string();
    }
    let (first, rest) = request.split_at(line_end + 2);
    format!("{first}x-mesh-target: {target}\r\n{rest}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_target_is_added_to_the_headers_only() {
        let request =
            "POST /api/responses HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\n\r\n{}";
        let target = "a".repeat(64);
        assert_eq!(
            with_mesh_target(request, Some(&target)),
            format!(
                "POST /api/responses HTTP/1.1\r\nx-mesh-target: {target}\r\nHost: localhost\r\nContent-Length: 2\r\n\r\n{{}}"
            )
        );
        assert_eq!(with_mesh_target(request, None), request);
    }

    /// A request that names its own target keeps it: the console setting
    /// never overrides an explicit one. MUTANT: always add, and the ingress
    /// refuses the now-ambiguous pair.
    #[test]
    fn a_request_naming_its_own_target_keeps_it() {
        let request = "POST /api/chat HTTP/1.1\r\nX-Mesh-Target: bbbb\r\n\r\n{}";
        assert_eq!(with_mesh_target(request, Some(&"a".repeat(64))), request);
        // A body mentioning the header name is not a header.
        let body_only = "POST /api/chat HTTP/1.1\r\nHost: h\r\n\r\n{\"x-mesh-target:\":1}";
        assert!(with_mesh_target(body_only, Some("t")).contains("\r\nx-mesh-target: t\r\n"));
    }

    #[test]
    fn only_a_full_node_id_is_accepted() {
        let full = hex::encode(iroh::SecretKey::generate().public().as_bytes());
        assert_eq!(full_node_id(&full.to_uppercase()), Some(full));
        assert!(full_node_id("a70d3967").is_none());
        assert!(full_node_id(&"z".repeat(64)).is_none());
    }
}
