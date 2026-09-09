//! Server-side forward to the capsule-emit-mesh sidecar's accountability
//! pane routes ([mesh-ledger-earned-pass-and-native-panes] Part B).
//!
//! The Ledger tab's Balance/Peers/Exchanges sections used to call the
//! sidecar directly from the browser, which meant the end user had to know
//! the sidecar existed and type its URL in ([mesh-live-tab-pane-proxy] Q2's
//! original ruling -- superseded here). That leaked plumbing and broke on a
//! loopback-alias CORS mismatch the sidecar's own allowlist couldn't see
//! past. This route removes both problems the same way `capsules.rs`
//! already does for the read-only ledger: the HOST knows the sidecar's
//! location (operator config, never the end user), and a server-to-server
//! forward has no CORS to fail.
//!
//! This is a pure GET forward of three known pane paths to the sidecar's
//! own JSON responses -- never a bridge into `mesh-llm-log-store`, and never
//! a place that derives or caches a value itself (same discipline as
//! `capsules.rs`'s docstring).

use super::super::http::{respond_bytes, respond_error};
use tokio::net::TcpStream;
use url::Url;

const ROUTE_PREFIX: &str = "/api/capsules/panes/";
const ALLOWED_PANES: &[&str] = &["pane-a", "pane-b", "pane-c"];
/// Query parameters the sidecar's pane-c route accepts
/// (`accountability_pane_routes.py`) -- forwarded verbatim, everything else
/// dropped rather than concatenated into the forwarded URL raw.
const FORWARDED_QUERY_KEYS: &[&str] = &["limit", "after_seq", "exchange_id"];

pub(super) fn is_route(path: &str) -> bool {
    path.starts_with(ROUTE_PREFIX)
}

/// Resolves the sidecar base URL to forward to, in order:
/// 1. `MESH_LLM_CAPSULE_SIDECAR_URL` (explicit operator override)
/// 2. `http://127.0.0.1:8089` (capsule-emit-mesh's own `--listen-port`
///    default, `capsule_sidecar.py`)
fn sidecar_base_url() -> String {
    std::env::var("MESH_LLM_CAPSULE_SIDECAR_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:8089".to_string())
}

fn status_text(code: u16) -> &'static str {
    match code {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "OK",
    }
}

pub(super) async fn handle(
    stream: &mut TcpStream,
    path: &str,
    path_only: &str,
) -> anyhow::Result<()> {
    let Some(pane) = path_only.strip_prefix(ROUTE_PREFIX) else {
        return respond_error(stream, 404, "Not found").await;
    };
    if !ALLOWED_PANES.contains(&pane) {
        return respond_error(stream, 404, "Not found").await;
    }

    let mut url = match Url::parse(&format!("{}/accountability/{pane}", sidecar_base_url())) {
        Ok(url) => url,
        Err(err) => {
            return respond_error(stream, 500, &format!("invalid sidecar base URL: {err}")).await;
        }
    };
    if let Some((_, raw_query)) = path.split_once('?') {
        let mut pairs = url.query_pairs_mut();
        for (key, value) in url::form_urlencoded::parse(raw_query.as_bytes()) {
            if FORWARDED_QUERY_KEYS.contains(&key.as_ref()) {
                pairs.append_pair(&key, &value);
            }
        }
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(client) => client,
        Err(err) => {
            return respond_error(stream, 500, &format!("build sidecar client: {err}")).await;
        }
    };

    match client.get(url).send().await {
        Ok(response) => {
            let status = response.status().as_u16();
            match response.bytes().await {
                Ok(body) => {
                    respond_bytes(
                        stream,
                        status,
                        status_text(status),
                        "application/json",
                        &body,
                    )
                    .await
                }
                Err(err) => {
                    respond_error(stream, 502, &format!("sidecar response read failed: {err}"))
                        .await
                }
            }
        }
        Err(err) => {
            respond_error(
                stream,
                503,
                &format!("capsule sidecar is not reachable: {err}"),
            )
            .await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn is_route_matches_only_the_panes_prefix() {
        assert!(is_route("/api/capsules/panes/pane-a"));
        assert!(is_route("/api/capsules/panes/pane-c"));
        assert!(!is_route("/api/capsules/ledger"));
        assert!(!is_route("/api/capsules/panesx/pane-a"));
    }

    #[tokio::test]
    async fn handle_rejects_an_unknown_pane_name() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let mut client = tokio::net::TcpStream::connect(addr).await.unwrap();
        let (mut server, _) = listener.accept().await.unwrap();

        handle(
            &mut server,
            "/api/capsules/panes/pane-z",
            "/api/capsules/panes/pane-z",
        )
        .await
        .unwrap();
        server.shutdown().await.unwrap();

        let mut response = Vec::new();
        client.read_to_end(&mut response).await.unwrap();
        assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 404"));
    }

    #[tokio::test]
    async fn handle_reports_service_unavailable_when_the_sidecar_is_unreachable() {
        // No sidecar listens on this port -- exercises the "connection
        // refused" branch without a live sidecar process.
        unsafe {
            std::env::set_var("MESH_LLM_CAPSULE_SIDECAR_URL", "http://127.0.0.1:1");
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let mut client = tokio::net::TcpStream::connect(addr).await.unwrap();
        let (mut server, _) = listener.accept().await.unwrap();

        handle(
            &mut server,
            "/api/capsules/panes/pane-a",
            "/api/capsules/panes/pane-a",
        )
        .await
        .unwrap();
        server.shutdown().await.unwrap();

        let mut response = Vec::new();
        client.read_to_end(&mut response).await.unwrap();
        unsafe {
            std::env::remove_var("MESH_LLM_CAPSULE_SIDECAR_URL");
        }
        assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 503"));
    }

    #[tokio::test]
    async fn handle_forwards_only_allowlisted_query_keys() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let sidecar_addr = listener.local_addr().unwrap();
        unsafe {
            std::env::set_var(
                "MESH_LLM_CAPSULE_SIDECAR_URL",
                format!("http://{sidecar_addr}"),
            );
        }

        let sidecar_task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 4096];
            let n = stream.read(&mut buf).await.unwrap();
            let request_line = String::from_utf8_lossy(&buf[..n]).to_string();
            let body = "{}";
            stream
                .write_all(
                    format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", body.len(), body)
                        .as_bytes(),
                )
                .await
                .unwrap();
            stream.shutdown().await.unwrap();
            request_line
        });

        let inbound_client_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let inbound_addr = inbound_client_listener.local_addr().unwrap();
        let mut inbound_client = tokio::net::TcpStream::connect(inbound_addr).await.unwrap();
        let (mut inbound_server, _) = inbound_client_listener.accept().await.unwrap();

        handle(
            &mut inbound_server,
            "/api/capsules/panes/pane-c?limit=5&evil=x&exchange_id=abc",
            "/api/capsules/panes/pane-c",
        )
        .await
        .unwrap();
        inbound_server.shutdown().await.unwrap();

        let mut response = Vec::new();
        inbound_client.read_to_end(&mut response).await.unwrap();
        unsafe {
            std::env::remove_var("MESH_LLM_CAPSULE_SIDECAR_URL");
        }
        assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 200"));

        let forwarded_request_line = sidecar_task.await.unwrap();
        assert!(forwarded_request_line.contains("limit=5"));
        assert!(forwarded_request_line.contains("exchange_id=abc"));
        assert!(!forwarded_request_line.contains("evil"));
    }
}
