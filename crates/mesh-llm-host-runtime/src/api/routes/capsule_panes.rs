//! The Ledger tab's Balance/Peers/Exchanges panes.
//!
//! [mesh-C3-ledger-tab-reads-plugin-not-sidecar]: as of this file, the
//! DEFAULT source is a local, in-process read of the on-disk ledger the
//! admission-policy plugin's `capsule-producer` (path 1, upstream-adoptable)
//! already writes -- `capsule_panes_native`, same file-reading discipline as
//! `capsules.rs`. The maintainers can run this with nothing but the plugin;
//! no Python sidecar process required. See `capsule_panes_native`'s module
//! docs for exactly which fields this cut computes for real vs. renders
//! `NOT_CHECKED`/absent.
//!
//! The OLDER path -- a server-side forward to the capsule-emit-mesh
//! sidecar's own `/accountability/pane-*` HTTP routes
//! ([mesh-ledger-earned-pass-and-native-panes] Part B) -- still exists and
//! still works, opt-in via `MESH_LLM_CAPSULE_PANES_SOURCE=sidecar`: the
//! reset doc's own instruction ("the sidecar path keeps working as the
//! alternative -- a flag/env, not a delete"). It remains a pure GET forward
//! of three known pane paths to the sidecar's own JSON responses -- never a
//! bridge into `mesh-llm-log-store`, never a place that derives or caches a
//! value itself.

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

#[derive(PartialEq, Eq, Debug)]
enum PanesSource {
    /// Read `<ledger_dir>/capsules.jsonl` directly, in-process. Default:
    /// the acceptance demo is "renders on plain upstream `main` + plugin,
    /// no sidecar running" ([mesh-C3-ledger-tab-reads-plugin-not-sidecar]).
    Native,
    /// Forward to the capsule-emit-mesh sidecar's own HTTP routes -- the
    /// pre-existing behavior, opt-in only now.
    Sidecar,
}

/// `MESH_LLM_CAPSULE_PANES_SOURCE=sidecar` opts back into the forward;
/// anything else (unset, `native`, a typo) reads the plugin's ledger
/// directly. Config, never a hardcoded assumption about which producer is
/// running -- design item (1) of the task's checkpoint note.
fn panes_source() -> PanesSource {
    match std::env::var("MESH_LLM_CAPSULE_PANES_SOURCE")
        .ok()
        .as_deref()
    {
        Some("sidecar") => PanesSource::Sidecar,
        _ => PanesSource::Native,
    }
}

/// The `exchange_id` query parameter, if present and non-empty -- the only
/// native-path query key this cut consumes (pane-c drill-down). `limit`/
/// `after_seq` paging is sidecar-forward-only for now: the native list
/// path reads the whole ledger, same as Pane A/B always have.
fn exchange_id_query_param(path: &str) -> Option<String> {
    let (_, raw_query) = path.split_once('?')?;
    url::form_urlencoded::parse(raw_query.as_bytes())
        .find(|(key, _)| key == "exchange_id")
        .map(|(_, value)| value.into_owned())
        .filter(|value| !value.is_empty())
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

    if panes_source() == PanesSource::Native {
        return handle_native(stream, path, pane).await;
    }
    handle_sidecar_forward(stream, path, pane).await
}

/// [mesh-C3-ledger-tab-reads-plugin-not-sidecar]: local read of the
/// plugin-written ledger -- no sidecar process, no network call, so an
/// unreachable/absent sidecar cannot break this path.
async fn handle_native(stream: &mut TcpStream, path: &str, pane: &str) -> anyhow::Result<()> {
    let ledger_dir = super::capsules::ledger_dir();
    let exchange_id = exchange_id_query_param(path);
    let Some(payload) =
        super::capsule_panes_native::build_pane_json(pane, &ledger_dir, exchange_id.as_deref())
    else {
        return respond_error(stream, 404, "Not found").await;
    };
    let body = match serde_json::to_vec(&payload) {
        Ok(body) => body,
        Err(err) => {
            return respond_error(stream, 500, &format!("serialize pane payload: {err}")).await;
        }
    };
    respond_bytes(stream, 200, "OK", "application/json", &body).await
}

async fn handle_sidecar_forward(
    stream: &mut TcpStream,
    path: &str,
    pane: &str,
) -> anyhow::Result<()> {
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
    use serial_test::serial;
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
    #[serial]
    async fn handle_reports_service_unavailable_when_the_sidecar_is_unreachable() {
        // No sidecar listens on this port -- exercises the "connection
        // refused" branch without a live sidecar process. Explicit opt-in:
        // the default source is now Native (see the tests below), so
        // exercising the sidecar-forward branch at all requires this flag.
        unsafe {
            std::env::set_var("MESH_LLM_CAPSULE_PANES_SOURCE", "sidecar");
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
            std::env::remove_var("MESH_LLM_CAPSULE_PANES_SOURCE");
        }
        assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 503"));
    }

    #[tokio::test]
    #[serial]
    async fn handle_forwards_only_allowlisted_query_keys() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let sidecar_addr = listener.local_addr().unwrap();
        unsafe {
            std::env::set_var("MESH_LLM_CAPSULE_PANES_SOURCE", "sidecar");
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
            std::env::remove_var("MESH_LLM_CAPSULE_PANES_SOURCE");
        }
        assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 200"));

        let forwarded_request_line = sidecar_task.await.unwrap();
        assert!(forwarded_request_line.contains("limit=5"));
        assert!(forwarded_request_line.contains("exchange_id=abc"));
        assert!(!forwarded_request_line.contains("evil"));
    }

    #[test]
    #[serial]
    fn panes_source_defaults_to_native_with_no_env_override() {
        // `#[serial]`: this test doesn't mutate the env var itself, but it
        // MUST NOT run concurrently with a test that does (found by a real
        // local-gate run: without this, the full-suite parallel runner
        // occasionally observed another test's mid-flight
        // `MESH_LLM_CAPSULE_PANES_SOURCE` value here). Asserts the
        // OUT-OF-THE-BOX behavior a maintainer gets with no sidecar env
        // configured at all -- the acceptance demo in
        // [mesh-C3-ledger-tab-reads-plugin-not-sidecar].
        assert_eq!(panes_source(), PanesSource::Native);
    }

    #[test]
    #[serial]
    fn panes_source_is_sidecar_only_when_explicitly_set() {
        unsafe {
            std::env::set_var("MESH_LLM_CAPSULE_PANES_SOURCE", "sidecar");
        }
        assert_eq!(panes_source(), PanesSource::Sidecar);
        unsafe {
            std::env::set_var("MESH_LLM_CAPSULE_PANES_SOURCE", "native");
        }
        assert_eq!(panes_source(), PanesSource::Native);
        unsafe {
            std::env::set_var("MESH_LLM_CAPSULE_PANES_SOURCE", "not-a-real-value");
        }
        assert_eq!(panes_source(), PanesSource::Native);
        unsafe {
            std::env::remove_var("MESH_LLM_CAPSULE_PANES_SOURCE");
        }
    }

    #[tokio::test]
    #[serial]
    async fn handle_serves_native_pane_json_even_when_the_sidecar_env_points_nowhere() {
        // [mesh-C3-ledger-tab-reads-plugin-not-sidecar] point (5): an
        // unreachable sidecar must not break the tab. Default source is
        // Native, so this must succeed even with a poisoned sidecar URL and
        // no ledger dir configured (missing ledger dir -> empty pane, not
        // an error -- `capsule_panes_native::read_capsule_records`).
        unsafe {
            std::env::set_var("MESH_LLM_CAPSULE_SIDECAR_URL", "http://127.0.0.1:1");
            std::env::set_var(
                "MESH_LLM_CAPSULE_LEDGER_DIR",
                "/nonexistent/mesh-c3-ledger-dir-for-tests",
            );
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
            std::env::remove_var("MESH_LLM_CAPSULE_LEDGER_DIR");
        }
        let response = String::from_utf8_lossy(&response);
        assert!(response.starts_with("HTTP/1.1 200"), "{response}");
        assert!(response.contains("\"rows\":[]"), "{response}");
    }

    #[test]
    fn exchange_id_query_param_reads_only_that_key_and_ignores_empty() {
        assert_eq!(
            exchange_id_query_param("/api/capsules/panes/pane-c?exchange_id=abc&limit=5"),
            Some("abc".to_string())
        );
        assert_eq!(
            exchange_id_query_param("/api/capsules/panes/pane-c?limit=5"),
            None
        );
        assert_eq!(
            exchange_id_query_param("/api/capsules/panes/pane-c?exchange_id="),
            None
        );
        assert_eq!(exchange_id_query_param("/api/capsules/panes/pane-c"), None);
    }
}
