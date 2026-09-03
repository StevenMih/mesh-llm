//! Read-only capsule ledger route for the Capsules dashboard tab.
//!
//! This is NOT a plugin<->host bridge and does not touch `mesh-llm-log-store`.
//! It statically serves the on-disk ledger directory the admission-policy
//! plugin (or any capsule-emit-compatible producer) already writes to:
//! `<ledger_dir>/capsules.jsonl`, `<ledger_dir>/signed-statements/*.cose`, the
//! node's public key at `<ledger_dir>/../keys/node-key.pub.pem` (the same
//! sibling-`keys/`-dir convention capsule-mesh-view's `_issuer_key_for` uses),
//! and `<ledger_dir>/disclosures/<capsule_id>.json` -- the OPTIONAL request+
//! response TEXT preimage capsule-emit-mesh's sidecar writes next to the
//! ledger when it seals a capsule with disclosure on (capsule-emit-mesh PR
//! #79, `capsule_sidecar.persist_disclosure_preimage`). This is a LOCAL,
//! out-of-band attachment -- it is never part of the signed capsule, and the
//! UI recomputes request_digest/response_digest from it in-browser to prove
//! (or disprove) the disclosed text is what was sealed, rather than trusting
//! this route's word for it.
//! No auth: this is local-dashboard-only data, gated by the same
//! trusted-local-caller check as the rest of the management API.

use super::super::http::{respond_bytes, respond_error};
use std::path::{Path, PathBuf};
use tokio::net::TcpStream;

const ROUTE_PREFIX: &str = "/api/capsules/ledger/";

pub(super) fn is_route(path: &str) -> bool {
    path == "/api/capsules/ledger" || path.starts_with(ROUTE_PREFIX)
}

/// Resolves the ledger directory to serve, in order:
/// 1. `MESH_LLM_CAPSULE_LEDGER_DIR` (explicit override)
/// 2. `$ADMISSION_POLICY_DATA_DIR/ledger` (the admission-policy plugin's own
///    data-dir convention, `main.rs`'s `data_dir()`)
/// 3. `./admission-policy-data/ledger` (the plugin's own default when neither
///    env var is set)
fn ledger_dir() -> PathBuf {
    if let Ok(path) = std::env::var("MESH_LLM_CAPSULE_LEDGER_DIR") {
        return PathBuf::from(path);
    }
    if let Ok(data_dir) = std::env::var("ADMISSION_POLICY_DATA_DIR") {
        return PathBuf::from(data_dir).join("ledger");
    }
    PathBuf::from("./admission-policy-data/ledger")
}

pub(super) async fn handle(stream: &mut TcpStream, path_only: &str) -> anyhow::Result<()> {
    let Some(rel) = path_only.strip_prefix(ROUTE_PREFIX) else {
        return respond_error(stream, 404, "Not found").await;
    };
    let ledger_dir = ledger_dir();

    let Some((file_path, content_type)) = resolve_target(&ledger_dir, rel) else {
        return respond_error(stream, 400, "Invalid ledger path").await;
    };

    match tokio::fs::read(&file_path).await {
        Ok(bytes) => respond_bytes(stream, 200, "OK", content_type, &bytes).await,
        Err(_) => respond_error(stream, 404, "Not found").await,
    }
}

fn resolve_target(ledger_dir: &Path, rel: &str) -> Option<(PathBuf, &'static str)> {
    if rel.contains("..") {
        return None;
    }
    match rel {
        "capsules.jsonl" => Some((ledger_dir.join("capsules.jsonl"), "application/x-ndjson")),
        "node-key.pub.pem" => Some((
            ledger_dir.join("..").join("keys").join("node-key.pub.pem"),
            "application/x-pem-file",
        )),
        other => {
            if let Some(capsule_id) = other
                .strip_prefix("signed-statements/")
                .and_then(|s| s.strip_suffix(".cose"))
            {
                if capsule_id.is_empty() || !capsule_id.chars().all(|c| c.is_ascii_alphanumeric()) {
                    return None;
                }
                return Some((
                    ledger_dir
                        .join("signed-statements")
                        .join(format!("{capsule_id}.cose")),
                    "application/octet-stream",
                ));
            }
            let capsule_id = other.strip_prefix("disclosures/")?.strip_suffix(".json")?;
            if capsule_id.is_empty() || !capsule_id.chars().all(|c| c.is_ascii_alphanumeric()) {
                return None;
            }
            Some((
                ledger_dir
                    .join("disclosures")
                    .join(format!("{capsule_id}.json")),
                "application/json",
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_capsules_jsonl() {
        let dir = Path::new("/tmp/ledger");
        let (path, content_type) = resolve_target(dir, "capsules.jsonl").unwrap();
        assert_eq!(path, dir.join("capsules.jsonl"));
        assert_eq!(content_type, "application/x-ndjson");
    }

    #[test]
    fn resolves_signed_statement() {
        let dir = Path::new("/tmp/ledger");
        let (path, content_type) = resolve_target(dir, "signed-statements/abc123.cose").unwrap();
        assert_eq!(path, dir.join("signed-statements").join("abc123.cose"));
        assert_eq!(content_type, "application/octet-stream");
    }

    #[test]
    fn resolves_disclosure_preimage() {
        let dir = Path::new("/tmp/ledger");
        let (path, content_type) = resolve_target(dir, "disclosures/abc123.json").unwrap();
        assert_eq!(path, dir.join("disclosures").join("abc123.json"));
        assert_eq!(content_type, "application/json");
    }

    #[test]
    fn rejects_traversal_in_disclosure_path() {
        let dir = Path::new("/tmp/ledger");
        assert!(resolve_target(dir, "disclosures/../../etc/passwd.json").is_none());
    }

    #[test]
    fn rejects_non_alphanumeric_disclosure_capsule_id() {
        let dir = Path::new("/tmp/ledger");
        assert!(resolve_target(dir, "disclosures/abc-123.json").is_none());
        assert!(resolve_target(dir, "disclosures/.json").is_none());
    }

    #[test]
    fn rejects_unknown_path() {
        let dir = Path::new("/tmp/ledger");
        assert!(resolve_target(dir, "disclosures/abc123.txt").is_none());
        assert!(resolve_target(dir, "something-else").is_none());
    }
}
