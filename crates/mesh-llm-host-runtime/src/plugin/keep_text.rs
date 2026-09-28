//! The owner's opt-in to keep the TEXT of each exchange (prompt and answer)
//! next to its sealed record, so a local adjudicator can compare two
//! providers' answers. Off unless `MESH_LLM_CAPSULE_KEEP_TEXT=1`; nothing is
//! written otherwise.
//!
//! Only the host holds the bytes: plugins see digests. Each exchange this
//! host routes or serves gets one file,
//! `<ledger>/disclosures/by-exchange/<exchange_id>.json` (dir 0700, file
//! 0600, written whole by rename), keyed by the host's `exchange_id`, which
//! the capsule plugin seals in `serving_provenance`.
//!
//! How the bytes are found: a task-local slot, opened around one exchange's
//! routing (`scope`), receives the request body (`offer_request`) and the
//! served response as it is digested (`offer_response`, from
//! `ExchangeOutputDigests`); the terminal event's publication writes the
//! file (`write_terminal`). An ambient twin runs in its own task, so it
//! gets its own slot and its own file.

use std::cell::RefCell;
use std::future::Future;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use crate::plugin::openai_exchange::{OpenAiExchangeEnvelope, OpenAiExchangePhase};

/// Set to `1` to keep prompt and answer text. Off by default.
pub(crate) const KEEP_TEXT_ENV: &str = "MESH_LLM_CAPSULE_KEEP_TEXT";

pub(crate) fn enabled() -> bool {
    std::env::var(KEEP_TEXT_ENV).is_ok_and(|value| value == "1")
}

#[derive(Default)]
struct Slot {
    request: Option<Value>,
    response: Option<Value>,
}

tokio::task_local! {
    static SLOT: RefCell<Slot>;
}

/// Run one exchange's routing with a text slot open, when keeping is on.
pub(crate) async fn scope<F: Future>(future: F) -> F::Output {
    if enabled() {
        SLOT.scope(RefCell::new(Slot::default()), future).await
    } else {
        future.await
    }
}

/// The request body this exchange sent. A no-op outside a slot.
pub(crate) fn offer_request(body: &Value) {
    let _ = SLOT.try_with(|slot| slot.borrow_mut().request = Some(body.clone()));
}

/// The served response, as digested. The last one offered is the one that
/// was delivered. A no-op outside a slot.
pub(crate) fn offer_response(body: &Value) {
    let _ = SLOT.try_with(|slot| slot.borrow_mut().response = Some(body.clone()));
}

/// Write the text file for a terminal event, if keeping is on and a slot is
/// open. Returns the file written, if any.
pub(crate) fn write_terminal(
    ledger_dir: &Path,
    envelope: &OpenAiExchangeEnvelope,
) -> std::io::Result<Option<PathBuf>> {
    if envelope.phase != OpenAiExchangePhase::Terminal || !safe_id(&envelope.exchange_id) {
        return Ok(None);
    }
    let Ok((request, response)) = SLOT.try_with(|slot| {
        let mut slot = slot.borrow_mut();
        (slot.request.clone(), slot.response.take())
    }) else {
        return Ok(None);
    };
    if request.is_none() && response.is_none() {
        return Ok(None);
    }
    let response_text = response
        .as_ref()
        .and_then(|body| body.pointer("/choices/0/message/content"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let mut document = json!({
        "v": 1,
        "exchange_id": envelope.exchange_id,
        "request_body": request,
        "response_body": response,
        "response_text": response_text,
        "written_at": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    });
    if let Some(bracket) = &envelope.twin_bracket_id {
        document["twin_bracket_id"] = json!(bracket);
    }
    let dir = ledger_dir.join("disclosures").join("by-exchange");
    std::fs::create_dir_all(&dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    }
    let path = dir.join(format!("{}.json", envelope.exchange_id));
    let tmp = dir.join(format!(".{}.json.tmp", envelope.exchange_id));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&tmp)?;
    file.write_all(&serde_json::to_vec(&document)?)?;
    file.sync_all()?;
    std::fs::rename(&tmp, &path)?;
    Ok(Some(path))
}

/// An exchange id is host-minted (a UUID); anything else never names a file.
fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin::openai_exchange::OpenAiExchangeDispatchPath;

    fn terminal(id: &str) -> OpenAiExchangeEnvelope {
        OpenAiExchangeEnvelope::terminal(
            id.to_string(),
            OpenAiExchangeDispatchPath::RawProxy,
            "m",
            Some(200),
            None,
            None,
        )
    }

    #[tokio::test]
    async fn a_terminal_inside_a_slot_writes_the_prompt_and_answer_0600() {
        let dir = tempfile::tempdir().unwrap();
        let request =
            json!({"model": "m", "messages": [{"role": "user", "content": "Pick a colour"}]});
        let response =
            json!({"choices": [{"index": 0, "message": {"role": "assistant", "content": "Blue"}}]});
        let written = SLOT
            .scope(RefCell::new(Slot::default()), async {
                offer_request(&request);
                offer_response(&response);
                let envelope = terminal("0f8fad5b-d9cb-469f-a165-70867728950e")
                    .with_twin_bracket_id("twin-1".to_string());
                write_terminal(dir.path(), &envelope).unwrap()
            })
            .await
            .expect("a file");
        let saved: Value = serde_json::from_slice(&std::fs::read(&written).unwrap()).unwrap();
        assert_eq!(
            saved["exchange_id"],
            json!("0f8fad5b-d9cb-469f-a165-70867728950e")
        );
        assert_eq!(saved["request_body"], request);
        assert_eq!(saved["response_body"], response);
        assert_eq!(saved["response_text"], json!("Blue"));
        assert_eq!(saved["twin_bracket_id"], json!("twin-1"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&written).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
            let dir_mode = std::fs::metadata(written.parent().unwrap())
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(dir_mode, 0o700);
        }
    }

    /// The wiring: the response is offered where every served response is
    /// digested (`ExchangeOutputDigests`), so the terminal's file holds it.
    /// MUTANT: drop the `offer_response` call there and `response_text` is null.
    #[tokio::test]
    async fn the_digested_response_is_the_one_kept() {
        let dir = tempfile::tempdir().unwrap();
        let body = br#"{"choices":[{"index":0,"message":{"role":"assistant","content":"Green"}}]}"#;
        let written = SLOT
            .scope(RefCell::new(Slot::default()), async {
                offer_request(&json!({"model": "m"}));
                let _ =
                    crate::plugin::openai_exchange::ExchangeOutputDigests::from_response_body(body);
                write_terminal(
                    dir.path(),
                    &terminal("6f9619ff-8b86-d011-b42d-00c04fc964ff"),
                )
                .unwrap()
            })
            .await
            .expect("a file");
        let saved: Value = serde_json::from_slice(&std::fs::read(&written).unwrap()).unwrap();
        assert_eq!(saved["response_text"], json!("Green"));
    }

    #[tokio::test]
    async fn nothing_is_written_outside_a_slot_or_for_an_unsafe_id() {
        let dir = tempfile::tempdir().unwrap();
        // No slot: keeping is off for this exchange.
        assert!(
            write_terminal(dir.path(), &terminal("abc"))
                .unwrap()
                .is_none()
        );
        let written = SLOT
            .scope(RefCell::new(Slot::default()), async {
                offer_request(&json!({"model": "m"}));
                write_terminal(dir.path(), &terminal("../escape")).unwrap()
            })
            .await;
        assert!(written.is_none());
        assert!(!dir.path().join("disclosures").exists());
    }
}
