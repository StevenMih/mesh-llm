//! The owner's opt-in to keep the TEXT of each exchange (prompt and answer)
//! next to its sealed record, so a local adjudicator can compare two
//! providers' answers. Off unless `MESH_LLM_CAPSULE_KEEP_TEXT=1`; nothing is
//! written otherwise.
//!
//! Only the host holds the bytes: plugins see digests. Each exchange this
//! host routes or serves gets one file,
//! `<ledger>/disclosures/by-exchange/<exchange_id>.json` (both directories
//! 0700, file 0600, written whole by rename), keyed by the host's
//! `exchange_id`, which the capsule plugin seals in `serving_provenance`.
//!
//! Retention: files older than `MESH_LLM_CAPSULE_KEEP_TEXT_DAYS` (default 30)
//! are removed, checked at most once an hour per directory, on a write.
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
use std::time::{Duration, Instant, SystemTime};

use serde_json::{Value, json};

use crate::plugin::openai_exchange::{OpenAiExchangeEnvelope, OpenAiExchangePhase};

/// Set to `1` to keep prompt and answer text. Off by default.
pub(crate) const KEEP_TEXT_ENV: &str = "MESH_LLM_CAPSULE_KEEP_TEXT";

/// The capsule plugin's ledger directory, where kept text goes beside the
/// records, resolved in order:
/// 1. `MESH_LLM_CAPSULE_LEDGER_DIR` (explicit override)
/// 2. `$ADMISSION_POLICY_DATA_DIR/ledger` (the plugin's own data-dir
///    convention)
/// 3. `./admission-policy-data/ledger` (the plugin's default when neither is
///    set)
pub(crate) fn ledger_dir() -> PathBuf {
    if let Ok(path) = std::env::var("MESH_LLM_CAPSULE_LEDGER_DIR") {
        return PathBuf::from(path);
    }
    if let Ok(data_dir) = std::env::var("ADMISSION_POLICY_DATA_DIR") {
        return PathBuf::from(data_dir).join("ledger");
    }
    PathBuf::from("./admission-policy-data/ledger")
}

pub(crate) fn enabled() -> bool {
    std::env::var(KEEP_TEXT_ENV).is_ok_and(|value| value == "1")
}

/// How many days a kept text stays; a positive whole number, else the default.
pub(crate) const KEEP_TEXT_DAYS_ENV: &str = "MESH_LLM_CAPSULE_KEEP_TEXT_DAYS";
const DEFAULT_KEEP_DAYS: u64 = 30;
/// A directory is pruned at most this often.
const PRUNE_EVERY: Duration = Duration::from_secs(60 * 60);

fn retention(days: Option<&str>) -> Duration {
    let days = days
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|days| *days > 0)
        .unwrap_or(DEFAULT_KEEP_DAYS);
    Duration::from_secs(days.saturating_mul(24 * 60 * 60))
}

/// Remove kept texts (and leftover temp files) last written more than
/// `max_age` before `now`. Returns how many were removed.
fn prune(dir: &Path, max_age: Duration, now: SystemTime) -> std::io::Result<usize> {
    let mut removed = 0;
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !(name.ends_with(".json") || name.ends_with(".json.tmp")) {
            continue;
        }
        let metadata = entry.metadata()?;
        if !metadata.is_file() {
            continue;
        }
        let age = now
            .duration_since(metadata.modified()?)
            .unwrap_or(Duration::ZERO);
        if age > max_age {
            std::fs::remove_file(entry.path())?;
            removed += 1;
        }
    }
    Ok(removed)
}

/// Prune `dir` unless it was pruned within the last `PRUNE_EVERY`. A failed
/// prune is logged; it never fails the write that triggered it.
fn prune_if_due(dir: &Path) {
    static LAST: std::sync::Mutex<Option<std::collections::HashMap<PathBuf, Instant>>> =
        std::sync::Mutex::new(None);
    {
        let mut last = LAST
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let last = last.get_or_insert_with(Default::default);
        let now = Instant::now();
        if last
            .get(dir)
            .is_some_and(|at| now.duration_since(*at) < PRUNE_EVERY)
        {
            return;
        }
        last.insert(dir.to_path_buf(), now);
    }
    let max_age = retention(std::env::var(KEEP_TEXT_DAYS_ENV).ok().as_deref());
    if let Err(error) = prune(dir, max_age, SystemTime::now()) {
        tracing::warn!(%error, "could not prune kept exchange text");
    }
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
    let disclosures = ledger_dir.join("disclosures");
    let dir = disclosures.join("by-exchange");
    std::fs::create_dir_all(&dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for private in [&disclosures, &dir] {
            std::fs::set_permissions(private, std::fs::Permissions::from_mode(0o700))?;
        }
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
    prune_if_due(&dir);
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
            // The parent too: a listing of disclosures/ shows nothing to others.
            let parent = std::fs::metadata(dir.path().join("disclosures")).unwrap();
            assert_eq!(parent.permissions().mode() & 0o777, 0o700);
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

    fn file_aged(path: &Path, age: Duration) {
        std::fs::write(path, b"{}").unwrap();
        let file = std::fs::File::options().write(true).open(path).unwrap();
        file.set_modified(SystemTime::now() - age).unwrap();
    }

    /// EM adversarial read (3): kept text does not accumulate forever.
    /// MUTANT: never remove, or remove regardless of age, and this fails.
    #[test]
    fn prune_removes_only_texts_older_than_the_retention() {
        let dir = tempfile::tempdir().unwrap();
        let day = Duration::from_secs(24 * 60 * 60);
        file_aged(&dir.path().join("old.json"), 31 * day);
        file_aged(&dir.path().join(".old.json.tmp"), 31 * day);
        file_aged(&dir.path().join("fresh.json"), day);
        file_aged(&dir.path().join("not-ours.txt"), 31 * day);

        let removed = prune(dir.path(), retention(None), SystemTime::now()).unwrap();

        assert_eq!(removed, 2);
        assert!(!dir.path().join("old.json").exists());
        assert!(!dir.path().join(".old.json.tmp").exists());
        assert!(dir.path().join("fresh.json").exists());
        assert!(dir.path().join("not-ours.txt").exists());
    }

    #[test]
    fn retention_is_a_positive_number_of_days_else_thirty() {
        let day = Duration::from_secs(24 * 60 * 60);
        assert_eq!(retention(None), 30 * day);
        assert_eq!(retention(Some("7")), 7 * day);
        assert_eq!(retention(Some("0")), 30 * day);
        assert_eq!(retention(Some("soon")), 30 * day);
    }

    /// The wiring: a write prunes its directory. MUTANT: drop the call in
    /// `write_terminal` and the stale text stays.
    #[tokio::test]
    async fn a_write_prunes_stale_texts_in_its_directory() {
        let dir = tempfile::tempdir().unwrap();
        let by_exchange = dir.path().join("disclosures").join("by-exchange");
        std::fs::create_dir_all(&by_exchange).unwrap();
        let stale = by_exchange.join("0f8fad5b-d9cb-469f-a165-000000000000.json");
        file_aged(&stale, Duration::from_secs(400 * 24 * 60 * 60));
        SLOT.scope(RefCell::new(Slot::default()), async {
            offer_request(&json!({"model": "m"}));
            write_terminal(
                dir.path(),
                &terminal("6f9619ff-8b86-d011-b42d-00c04fc964aa"),
            )
            .unwrap()
        })
        .await
        .expect("a file");
        assert!(!stale.exists());
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
