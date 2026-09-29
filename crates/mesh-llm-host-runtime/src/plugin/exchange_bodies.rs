//! The operator's opt-in to hand each exchange's request and response bodies
//! to plugins, on the `openai.exchange.v1` terminal event they already
//! receive. Off unless `MESH_LLM_PLUGIN_EXCHANGE_BODIES=1`: with it off, the
//! event carries digests only, exactly as before.
//!
//! The host never stores the bodies. What a plugin does with them (keep them,
//! for how long, where) is the plugin's own choice, behind its own settings.
//!
//! How the bodies are found: a task-local slot, opened around one exchange's
//! routing (`scope`), receives the request body (`offer_request`) and the
//! served response as it is digested (`offer_response`, from
//! `ExchangeOutputDigests`). The terminal event's publication takes them
//! (`attach`). An exchange that runs in its own task gets its own slot.

use std::cell::RefCell;
use std::future::Future;

use serde_json::Value;

use crate::plugin::openai_exchange::{ExchangeBodies, OpenAiExchangeEnvelope, OpenAiExchangePhase};

const EXCHANGE_BODIES_ENV: &str = "MESH_LLM_PLUGIN_EXCHANGE_BODIES";

/// Whether the operator turned this on. Only `1` counts.
pub(crate) fn enabled() -> bool {
    enabled_from(std::env::var(EXCHANGE_BODIES_ENV).ok().as_deref())
}

fn enabled_from(value: Option<&str>) -> bool {
    value.map(str::trim) == Some("1")
}

#[derive(Default)]
struct Slot {
    request: Option<Value>,
    response: Option<Value>,
}

tokio::task_local! {
    static SLOT: RefCell<Slot>;
}

/// Run one exchange's routing with a body slot open, when this is on.
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

/// The terminal event with this exchange's bodies attached, when this is on
/// and a slot holds any; `None` leaves the event as it is.
pub(crate) fn attach(envelope: &OpenAiExchangeEnvelope) -> Option<OpenAiExchangeEnvelope> {
    if envelope.phase != OpenAiExchangePhase::Terminal || !enabled() {
        return None;
    }
    let (request, response) = SLOT
        .try_with(|slot| {
            let mut slot = slot.borrow_mut();
            (slot.request.clone(), slot.response.take())
        })
        .ok()?;
    if request.is_none() && response.is_none() {
        return None;
    }
    let mut with_bodies = envelope.clone();
    with_bodies.exchange_bodies = Some(ExchangeBodies { request, response });
    Some(with_bodies)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin::openai_exchange::OpenAiExchangeDispatchPath;
    use serde_json::json;

    fn terminal() -> OpenAiExchangeEnvelope {
        OpenAiExchangeEnvelope::terminal(
            "ex-1".to_string(),
            OpenAiExchangeDispatchPath::RawProxy,
            "m",
            Some(200),
            None,
            None,
        )
    }

    #[test]
    fn only_one_turns_it_on_and_it_is_off_by_default() {
        assert!(enabled_from(Some("1")));
        for value in [
            None,
            Some(""),
            Some("0"),
            Some("true"),
            Some("yes"),
            Some("2"),
        ] {
            assert!(!enabled_from(value), "{value:?}");
        }
    }

    /// Inside a slot, the bodies ride the terminal event. Outside one, or for
    /// a non-terminal event, nothing is attached. (`attach` also checks the
    /// switch; the tests below exercise the slot directly.)
    #[tokio::test]
    async fn the_slot_holds_the_request_and_the_last_digested_response() {
        let (request, response) = SLOT
            .scope(RefCell::new(Slot::default()), async {
                offer_request(&json!({"messages": [{"role": "user", "content": "hi"}]}));
                offer_response(&json!({"choices": [{"message": {"content": "first"}}]}));
                offer_response(&json!({"choices": [{"message": {"content": "hello"}}]}));
                SLOT.with(|slot| {
                    let slot = slot.borrow();
                    (slot.request.clone(), slot.response.clone())
                })
            })
            .await;
        assert_eq!(request.unwrap()["messages"][0]["content"], "hi");
        assert_eq!(
            response.unwrap()["choices"][0]["message"]["content"],
            "hello"
        );
    }

    #[tokio::test]
    async fn outside_a_slot_nothing_is_kept_or_attached() {
        offer_request(&json!({"messages": []}));
        offer_response(&json!({"choices": []}));
        assert!(attach(&terminal()).is_none());
    }

    #[test]
    fn the_event_carries_no_bodies_unless_attached() {
        let value = serde_json::to_value(terminal()).unwrap();
        assert!(value.get("exchange_bodies").is_none());
    }
}
