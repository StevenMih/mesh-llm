//! The dispatch outcome the ordinary relay reports for a backend response,
//! computed from that response's raw bytes.
//!
//! The paid seller forwards its backend's raw HTTP response to the payer and
//! never runs the relay itself; the payer runs the relay over those same
//! bytes. Replaying them here through the same relay (into a discard sink)
//! gives the seller the exact usage and response digests the payer records,
//! so the two halves of a paid exchange can pair like a free one.

use super::common::{ResponseRetryPolicy, RouteAttemptResult};
use super::routing::route_local_attempt_after_forward;
use crate::logging::OpenAiRouteObserver;
use crate::network::openai::client_stream::ClientStream;
use crate::network::openai::request_normalize::ResponseAdapter;
use crate::network::openai::transport::{RouteDispatchOutcome, delivered_outcome};
use mesh_llm_events::logging::identifiers::RequestId;
use tokio::io::AsyncWriteExt;

/// Which response adapter the payer's relay runs for a paid request: the
/// same rule ingress applies (`request_parse`): a chat completion is relayed
/// through the chat adapter, streamed or not; anything else passes through.
/// A streamed answer is only digested by assembling its chunks, so the seller
/// must replay with the payer's adapter to record the same answer.
pub(crate) fn paid_response_adapter(path: &str, streamed: bool) -> ResponseAdapter {
    if path.split('?').next().unwrap_or(path) != "/v1/chat/completions" {
        return ResponseAdapter::None;
    }
    if streamed {
        ResponseAdapter::OpenAiChatCompletionsStream
    } else {
        ResponseAdapter::OpenAiChatCompletionsJson
    }
}

/// The outcome (status, usage, output digests) the relay reports for `raw`,
/// a complete backend HTTP response relayed through `adapter`. `Failed` when
/// the bytes are not one.
pub(crate) async fn served_outcome_of_raw_response(
    raw: &[u8],
    adapter: ResponseAdapter,
) -> RouteDispatchOutcome {
    // Room for every byte, so the write completes before the relay reads.
    let (mut writer, mut upstream) = tokio::io::duplex(raw.len().max(1));
    if writer.write_all(raw).await.is_err() {
        return RouteDispatchOutcome::Failed("could not replay the served response");
    }
    drop(writer);
    let mut sink = ClientStream::null();
    match route_local_attempt_after_forward(
        &mut sink,
        &mut upstream,
        0,
        RequestId::new(),
        ResponseRetryPolicy::next_target_available(false),
        adapter,
        None,
        None,
        OpenAiRouteObserver::default(),
    )
    .await
    {
        RouteAttemptResult::Delivered {
            status_code,
            usage,
            output_digests,
            ..
        } => delivered_outcome(status_code, usage, output_digests),
        _ => RouteDispatchOutcome::Failed("the served response did not relay"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin::openai_exchange::ExchangeOutputDigests;

    fn http(content_type: &str, body: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        )
        .into_bytes()
    }

    /// A JSON response replays to the digests the relay computes on the body.
    #[tokio::test]
    async fn a_json_response_replays_to_the_relay_digests() {
        let body = r#"{"id":"c1","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}"#;
        let outcome =
            served_outcome_of_raw_response(&http("application/json", body), ResponseAdapter::None)
                .await;
        let RouteDispatchOutcome::RespondedWithUsage {
            status_code,
            output_digests,
            ..
        } = outcome
        else {
            panic!("expected a served outcome with usage, got {outcome:?}");
        };
        assert_eq!(status_code, 200);
        assert_eq!(
            output_digests,
            ExchangeOutputDigests::from_response_body(body.as_bytes())
        );
        assert!(output_digests.has_any());
    }

    /// mc:4 / Q, run-paid3: a STREAMED paid Chat turn sealed the seller's
    /// half with no response digest, so it could never confirm. The payer's
    /// relay assembles the streamed chunks with the chat stream adapter; the
    /// seller replays with the same adapter and records the same answer.
    #[tokio::test]
    async fn a_streamed_chat_answer_replays_to_the_assembled_digests() {
        let raw = concat!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n",
            "data: {\"id\":\"c1\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"hi\"}}]}\n\n",
            "data: {\"id\":\"c1\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\" there\"},\"finish_reason\":\"stop\"}]}\n\n",
            "data: [DONE]\n\n",
        );
        let adapter = paid_response_adapter("/v1/chat/completions", true);
        assert_eq!(adapter, ResponseAdapter::OpenAiChatCompletionsStream);
        let digests = match served_outcome_of_raw_response(raw.as_bytes(), adapter).await {
            RouteDispatchOutcome::RespondedWithUsage { output_digests, .. }
            | RouteDispatchOutcome::RespondedWithDigests { output_digests, .. } => output_digests,
            other => panic!("expected a served outcome with digests, got {other:?}"),
        };
        let expected = ExchangeOutputDigests::from_response_value(&serde_json::json!({
            "choices": [{"index": 0, "message": {"role": "assistant", "content": "hi there"}}]
        }));
        assert!(expected.has_any());
        assert_eq!(digests, expected);
    }

    #[test]
    fn the_payer_adapter_is_chosen_by_path_and_stream() {
        assert_eq!(
            paid_response_adapter("/v1/chat/completions", false),
            ResponseAdapter::OpenAiChatCompletionsJson
        );
        assert_eq!(
            paid_response_adapter("/v1/completions", true),
            ResponseAdapter::None
        );
    }

    #[tokio::test]
    async fn bytes_that_are_not_a_response_never_yield_digests() {
        let outcome =
            served_outcome_of_raw_response(b"not http at all", ResponseAdapter::None).await;
        assert!(
            matches!(outcome, RouteDispatchOutcome::Failed(_)),
            "{outcome:?}"
        );
    }
}
