//! Bridges the two real OpenAI-exchange dispatch paths (see
//! `docs/plugins/openai-exchange-lifecycle-design-note.md`, #1331 M1/M2) to
//! an out-of-process plugin over the existing `PluginMeshEvent::Channel`
//! transport, so a plugin sees one unified stream regardless of which
//! in-process Rust hook interface produced an event.

use std::sync::Arc;

use async_trait::async_trait;
use openai_frontend::{
    CapsuleMarker, ChatCompletionOutcome, ChatCompletionRequest, ChatCompletionResponse,
    ChatExchangeRoute, OpenAiHookPolicy,
};
use serde::Serialize;

use super::PluginManager;

/// The single mesh channel both dispatch paths publish to.
pub const OPENAI_EXCHANGE_CHANNEL: &str = "openai.exchange.v1";

/// Which real dispatch path produced an [`OpenAiExchangeEnvelope`] — the two
/// paths M1 found are disjoint and don't share a request type, so the
/// envelope carries this instead of assuming one shape fits both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenAiExchangeDispatchPath {
    /// `openai-frontend`'s typed `OpenAiHookPolicy`/`HookedOpenAiBackend` seam.
    TypedFrontend,
    /// The raw-proxy ingress (`network/openai/ingress.rs`), used for
    /// plugin-served models; never sees a typed `ChatCompletionRequest`.
    RawProxy,
}

/// Which moment in an exchange's lifecycle an [`OpenAiExchangeEnvelope`]
/// reports — the same two moments [`OpenAiHookPolicy::on_effective_chat_completion`]
/// and [`OpenAiHookPolicy::on_chat_completion_terminal`] already observe for
/// path 1.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenAiExchangePhase {
    EffectiveRequest,
    Terminal,
}

/// Which side actually contributed a terminal event's `nonce` — the
/// authoritative signal for the same tri-state `capsule-emit-mesh`'s own
/// sidecar tracks as `client_nonce_source` (`client_supplied` /
/// `sidecar_generated_fallback`; the implicit third state is "no marker was
/// minted at all," carried by `nonce_source` itself being `None`). A
/// downstream plugin (M3) must use this field rather than sniffing the
/// `nonce`'s `fallback-` prefix, which stays only for human-readability.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClientNonceSource {
    ClientSupplied,
    SidecarGeneratedFallback,
}

/// What the host actually knows, at serve time, about *what ran, at what
/// fidelity, on whose hardware* for one exchange — the proof-of-inference
/// provenance a downstream capsule attests over (advances #1233's digest
/// advertisement). Every field is either a real value the host holds for the
/// served model/node, or omitted (serialized only `if Some`) when the host
/// genuinely does not know it for this exchange — never a fabricated string.
///
/// Sourced entirely from state the local [`mesh::Node`] already holds for the
/// served model and this host's hardware survey (see the raw-proxy dispatch
/// callsite in `network/openai/ingress.rs`): model metadata comes from the
/// served-model descriptor (`ServedModelMetadata`: `quant`, `architecture`,
/// `native_context_length`, `identity_hash`, revision/repository), and
/// hardware comes from the node's startup hardware survey (`gpu_name`,
/// `hostname`, `is_soc`, `vram_bytes`). No raw prompt or response text is
/// carried — provenance only.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ServingProvenance {
    /// The node that actually served the inference — this host's own mesh
    /// endpoint id. On a plugin-served (raw-proxy) exchange this is the node
    /// whose plugin endpoint produced the response.
    pub served_by_node_id: String,
    /// Serving host name, when the hardware survey resolved one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hostname: Option<String>,
    /// Model quantization format as the served-model descriptor reports it
    /// (e.g. `"Q4_K_M"`), from `ServedModelMetadata.quant`. Omitted when the
    /// descriptor carries no quant (unquantized weights, or metadata absent).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantization: Option<String>,
    /// Model architecture / family (e.g. `"llama"`), from
    /// `ServedModelMetadata.architecture`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub architecture: Option<String>,
    /// Native context length (n_ctx) the served weights advertise, from
    /// `ServedModelMetadata.native_context_length`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_length: Option<u32>,
    /// Human-readable parameter size (e.g. `"7B"`), from
    /// `ServedModelMetadata.parameter_size`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameter_size: Option<String>,
    /// Transformer layer count, from `ServedModelMetadata.layer_count`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layer_count: Option<u32>,
    /// Content-addressed identity hash of the served model artifact, from
    /// `ServedModelIdentity.identity_hash` — a digest of the actual model
    /// identity (not a hash of the model *name* string). Omitted when the
    /// descriptor did not resolve one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_identity_hash: Option<String>,
    /// Canonical model reference (e.g. `repo@rev/file`), from
    /// `ServedModelIdentity.canonical_ref`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_canonical_ref: Option<String>,
    /// Source revision (git commit / tag) of the served model, from
    /// `ServedModelIdentity.revision`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_revision: Option<String>,
    /// GPU display name from this host's startup hardware survey
    /// (`Node.gpu_name`). Omitted on CPU-only hosts or where no accelerator
    /// was enumerated.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpu: Option<String>,
    /// Accelerator-resident VRAM capacity in bytes advertised by this host
    /// (`Node.vram_bytes`). `0` means none was reported, so it is omitted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vram_bytes: Option<u64>,
    /// Whether the serving host is a unified-memory SoC (Apple Silicon and
    /// similar), from the hardware survey (`Node.is_soc`) — the honest
    /// device signal this host has (it does not carry a separate cpu/cuda/
    /// metal enum on the served-model path).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_soc: Option<bool>,
}

/// The real token accounting the host observed for a served exchange, from the
/// dispatch outcome's [`crate::network::openai::transport::RouteDispatchOutcome::RespondedWithUsage`]
/// (the served backend's own OpenAI-shaped `usage` object). Present on a
/// terminal envelope only when the served response actually carried usage;
/// omitted (never zeroed) when the dispatch produced no usage — so a downstream
/// plugin can seal the REAL token counts of a host-served real-weights exchange
/// rather than a stub's zeros. Every field is a real count the host read off the
/// wire; nothing is fabricated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ExchangeUsage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
}

/// The digests a host-served exchange yields OVER ITS RESPONSE BODY, computed at
/// the JSON-relay delivery point (`response::json_adaptation` /
/// `response::pipeline`) where the host still holds the complete, non-streamed
/// response body in hand. This is the fact the terminal event previously lacked:
/// the host streamed the body to the client and only `usage` returned on the
/// `Copy` `RouteDispatchOutcome`, so a downstream capsule could bind neither the
/// real response nor the model's tool_calls/reasoning. Threaded here as a `Copy`
/// bundle of RAW sha-256 bytes (never allocated strings, so the enums it rides
/// stay `Copy`), hex-encoded only when serialized onto the terminal envelope.
///
/// Every field is honest-optional: `tool_calls`/`reasoning` are `None` (never a
/// digest over an empty list) when the served response carried none, exactly
/// mirroring the Python reference `digest_conversation_exchange`
/// (`capsule_ledger/conversation/exchange.py`) which leaves those sub-digests
/// absent rather than fabricating one. `response_body` is `None` only when the
/// body could not be parsed as JSON.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ExchangeOutputDigests {
    /// SHA-256 over the plain-JCS canonicalization of the FULL response body
    /// JSON — the real bytes the host produced. Binds `agent_output_digest` to
    /// the real response, not just the terminal accounting facts.
    pub response_body: Option<[u8; 32]>,
    /// SHA-256 over the plain-JCS canonicalization of the flattened `tool_calls`
    /// array across the response's assistant message(s). `None` when the model
    /// emitted none — never a digest over `[]`. Byte-for-byte identical to the
    /// Python reference `json_digest(tool_calls)`.
    pub tool_calls: Option<[u8; 32]>,
    /// SHA-256 over the plain-JCS canonicalization of the list of
    /// `reasoning_content` chunks the response carried. `None` when the model
    /// surfaced no reasoning (an honest null for a non-reasoning model like
    /// Llama-3.2) — never fabricated. Matches `json_digest(reasoning_chunks)`.
    pub reasoning: Option<[u8; 32]>,
}

impl ExchangeOutputDigests {
    /// Compute the response-body / tool_calls / reasoning digests over a served
    /// OpenAI chat-completion (or Responses-API) response body, at the one point
    /// the host still holds the whole body. Canonicalization is PLAIN JCS (no
    /// float-stringification): the tool_calls/reasoning values are strings and
    /// structural JSON with no floats, so plain JCS matches the Python reference
    /// `agent_action_capsule.json_digest` exactly (verified by the parity test
    /// below and the shared fixture). A body that does not parse as JSON yields
    /// an all-`None` bundle rather than a fabricated digest.
    pub fn from_response_body(body: &[u8]) -> Self {
        let Ok(value) = serde_json::from_slice::<serde_json::Value>(body) else {
            return Self::default();
        };
        let response_body = Some(jcs_sha256(&value));
        let tool_calls = collect_tool_calls(&value);
        let reasoning = collect_reasoning(&value);
        Self {
            response_body,
            tool_calls: (!tool_calls.is_empty()).then(|| jcs_sha256(&serde_json::Value::Array(tool_calls))),
            reasoning: (!reasoning.is_empty()).then(|| jcs_sha256(&serde_json::Value::Array(reasoning))),
        }
    }

    /// True when the bundle carries at least one real digest — the caller only
    /// attaches it to the terminal envelope then, so an all-`None` bundle (a
    /// non-JSON body) never adds empty fields.
    pub fn has_any(&self) -> bool {
        self.response_body.is_some() || self.tool_calls.is_some() || self.reasoning.is_some()
    }
}

/// SHA-256 over the PLAIN-JCS canonicalization of `value` (no float
/// stringification), lowercase-hex-equivalent as raw bytes. This is the exact
/// preimage the Python reference `json_digest` uses (`HEX(SHA-256(JCS(v)))`);
/// returning raw bytes keeps the result `Copy` for the carrier struct.
fn jcs_sha256(value: &serde_json::Value) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    Sha256::digest(jcs_bytes(value)).into()
}

/// Flatten the `tool_calls` array across every assistant `choices[].message`
/// (mirrors the Python reference's `[tc for m in messages for tc in
/// m.get("tool_calls")]`). The host-served single response has one choice, but
/// this tolerates multiple. Returns an empty vec — never a synthetic entry —
/// when the response has none.
fn collect_tool_calls(response: &serde_json::Value) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    if let Some(choices) = response.get("choices").and_then(|c| c.as_array()) {
        for choice in choices {
            if let Some(tcs) = choice
                .get("message")
                .and_then(|m| m.get("tool_calls"))
                .and_then(|t| t.as_array())
            {
                out.extend(tcs.iter().cloned());
            }
        }
    }
    out
}

/// Collect the `reasoning_content` chunks across every assistant
/// `choices[].message` (mirrors the Python reference's per-message
/// `m.get("reasoning")` collection). Empty — yielding an absent digest — when no
/// message surfaced reasoning, the honest case for a non-reasoning model.
fn collect_reasoning(response: &serde_json::Value) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    if let Some(choices) = response.get("choices").and_then(|c| c.as_array()) {
        for choice in choices {
            if let Some(r) = choice
                .get("message")
                .and_then(|m| m.get("reasoning_content"))
                .filter(|r| !r.is_null())
            {
                if !matches!(r, serde_json::Value::String(s) if s.is_empty()) {
                    out.push(r.clone());
                }
            }
        }
    }
    out
}

/// The wire shape both dispatch paths publish on [`OPENAI_EXCHANGE_CHANNEL`].
/// Deliberately independent of `openai_frontend`'s typed request/response —
/// the raw-proxy path never has one — so one shape covers both paths without
/// either being forced into the other's type.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OpenAiExchangeEnvelope {
    /// Stable per-exchange id, minted when the dispatch path admits the
    /// request. Shared by an exchange's `EffectiveRequest` and `Terminal`
    /// envelopes (and mirrored into the transport `correlation_id`), so a
    /// plugin can pair the two events for one exchange even when concurrent
    /// requests on the same model are in flight.
    pub exchange_id: String,
    pub dispatch_path: OpenAiExchangeDispatchPath,
    pub phase: OpenAiExchangePhase,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    /// Present only on a `Terminal` envelope carrying a rung-ladder response
    /// marker (see [`CapsuleMarker`]) — the `capsule_id` already written into
    /// the client's response as `X-Capsule-Id`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capsule_id: Option<String>,
    /// The nonce the marker is correlated against, so a plugin observing
    /// this event knows what a later client ack must sign over.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nonce: Option<String>,
    /// Which side contributed `nonce` — see [`ClientNonceSource`]. `None`
    /// exactly when `nonce` is `None` (no marker minted).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nonce_source: Option<ClientNonceSource>,
    /// What ran, at what fidelity, on whose hardware — see [`ServingProvenance`].
    /// Present on a `Terminal` envelope for a served exchange; `None` on
    /// effective-request envelopes and on terminal envelopes where nothing was
    /// served (a denial/error before dispatch).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serving_provenance: Option<ServingProvenance>,
    /// The real token usage the served backend reported for this exchange (see
    /// [`ExchangeUsage`]). Present on a terminal envelope for a host-served
    /// exchange whose response carried a `usage` object; `None` on
    /// effective-request envelopes and wherever the dispatch produced no usage
    /// (a plugin-served stub, a denial, or a non-usage-bearing backend).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<ExchangeUsage>,
    /// The canonical JSON-DIGEST (RFC 8785 JCS over the profile-normalized,
    /// float-stringified request body — see [`request_body_digest`]) of the
    /// REAL request body this host actually dispatched. This is the one fact a
    /// downstream capsule needs to bind its `agent_input_digest` to the real
    /// bytes: the terminal event otherwise carries provenance and usage but
    /// nothing tying the sealed capsule to *what was asked*. Byte-for-byte the
    /// same value the `capsule-emit-mesh` plugin computes with its own
    /// `canonical_body_digest`, so the two are comparable across
    /// implementations. Present on a host-served terminal envelope whose request
    /// carried a JSON body; `None` when the host held no parsed body to digest
    /// (never a fabricated digest). No raw prompt text is carried — only its
    /// digest.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_digest: Option<String>,
    /// The canonical JSON-DIGEST (plain RFC 8785 JCS, matching the Python
    /// reference `json_digest`) of the REAL response body the host served for
    /// this exchange, computed at the JSON-relay delivery point where the host
    /// still holds the whole body. Lets a downstream capsule bind its
    /// `agent_output_digest` to the real response, not merely the terminal
    /// accounting facts (model + usage). `None` on effective-request envelopes
    /// and where no JSON response body was captured — never fabricated.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_digest: Option<String>,
    /// The canonical JSON-DIGEST of the flattened `tool_calls` array the model
    /// actually emitted on this exchange (plain JCS, byte-for-byte identical to
    /// the Python reference `json_digest(tool_calls)`). This is the fact that
    /// lets a downstream capsule seal a real `tool_calls_digest`. Present ONLY
    /// when the model emitted at least one tool call; `None` — never a digest
    /// over `[]` — when it emitted none, so a plugin can never misread it as
    /// "asserted zero tool calls". No raw arguments text is carried, only the
    /// digest.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls_digest: Option<String>,
    /// The canonical JSON-DIGEST of the model's `reasoning_content` chunk(s) on
    /// this exchange (plain JCS, matching the Python reference
    /// `json_digest(reasoning_chunks)`). Present only when the model surfaced
    /// reasoning; `None` (honest null) for a non-reasoning model such as
    /// Llama-3.2 — never fabricated.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_digest: Option<String>,
}

impl OpenAiExchangeEnvelope {
    pub fn effective(
        exchange_id: impl Into<String>,
        dispatch_path: OpenAiExchangeDispatchPath,
        model: impl Into<String>,
    ) -> Self {
        Self {
            exchange_id: exchange_id.into(),
            dispatch_path,
            phase: OpenAiExchangePhase::EffectiveRequest,
            model: model.into(),
            status: None,
            capsule_id: None,
            nonce: None,
            nonce_source: None,
            serving_provenance: None,
            usage: None,
            request_digest: None,
            response_digest: None,
            tool_calls_digest: None,
            reasoning_digest: None,
        }
    }

    pub fn terminal(
        exchange_id: impl Into<String>,
        dispatch_path: OpenAiExchangeDispatchPath,
        model: impl Into<String>,
        status: Option<u16>,
        marker: Option<CapsuleMarker>,
        nonce_source: Option<ClientNonceSource>,
    ) -> Self {
        Self {
            exchange_id: exchange_id.into(),
            dispatch_path,
            phase: OpenAiExchangePhase::Terminal,
            model: model.into(),
            status,
            capsule_id: marker.as_ref().map(|marker| marker.capsule_id.clone()),
            nonce: marker.as_ref().map(|marker| marker.nonce.clone()),
            nonce_source,
            serving_provenance: None,
            usage: None,
            request_digest: None,
            response_digest: None,
            tool_calls_digest: None,
            reasoning_digest: None,
        }
    }

    /// Attach the serving provenance the host resolved for this exchange. A
    /// small builder rather than a wider constructor so the two existing
    /// callsites that already pass six positional args aren't churned, and so
    /// the raw-proxy path can add provenance in one readable line after it has
    /// gathered it from the node.
    #[must_use]
    pub fn with_serving_provenance(mut self, provenance: ServingProvenance) -> Self {
        self.serving_provenance = Some(provenance);
        self
    }

    /// Attach the real token usage the served backend reported. Mirrors
    /// [`Self::with_serving_provenance`] — a small builder so the host-served
    /// raw-proxy path can add the REAL counts it read off the dispatch outcome
    /// in one readable line, without churning the positional `terminal`
    /// constructor. Only ever called with real usage; the field stays `None`
    /// when the dispatch produced none.
    #[must_use]
    pub fn with_usage(mut self, usage: ExchangeUsage) -> Self {
        self.usage = Some(usage);
        self
    }

    /// Attach the canonical JSON-DIGEST of the REAL request body this host
    /// dispatched, so a downstream capsule can bind its `agent_input_digest` to
    /// the real bytes. Mirrors the other builders — a small one-liner the
    /// raw-proxy host-served path calls after it has the request body in hand.
    /// Only ever called with a real digest computed by [`request_body_digest`];
    /// the field stays `None` when the host held no parsed body.
    #[must_use]
    pub fn with_request_digest(mut self, digest: String) -> Self {
        self.request_digest = Some(digest);
        self
    }

    /// Attach the response-body / tool_calls / reasoning digests computed over
    /// the REAL served response at the JSON-relay delivery point (see
    /// [`ExchangeOutputDigests`]). Hex-encodes each raw digest onto the wire.
    /// Only the digests the response actually yielded are set: an absent
    /// tool_calls/reasoning digest stays absent (honest null), never fabricated.
    /// A no-op for an all-`None` bundle, so a non-JSON body adds nothing.
    #[must_use]
    pub fn with_output_digests(mut self, digests: ExchangeOutputDigests) -> Self {
        if let Some(d) = digests.response_body {
            self.response_digest = Some(hex::encode(d));
        }
        if let Some(d) = digests.tool_calls {
            self.tool_calls_digest = Some(hex::encode(d));
        }
        if let Some(d) = digests.reasoning {
            self.reasoning_digest = Some(hex::encode(d));
        }
        self
    }
}

/// The canonical JSON-DIGEST of a request body, byte-for-byte identical to the
/// `capsule-emit-mesh` plugin's own `canonical_body_digest`
/// (`plugins/admission-policy/src/capsule_emit.rs`) and the Python reference's
/// `capsule_sidecar.digest_json` — so the digest the host forwards on a terminal
/// event and the digest a verifier recomputes agree across implementations.
///
/// It is `HEX(SHA-256(JCS(normalize(stringify_floats(body)))))`:
///  1. `stringify_floats` — every JSON float becomes its exact decimal string
///     (JCS refuses floats in a digest-bearing value; OpenAI chat bodies are
///     full of them: temperature, top_p, penalties);
///  2. `normalize` — profile §2 bottom-up removal of null / empty-array /
///     empty-object members;
///  3. JCS — RFC 8785 canonical serialization (sorted keys, minimal form);
///  4. SHA-256, lowercase hex.
///
/// A self-contained port kept in this crate (the host cannot depend on the
/// plugin's `capsule-producer`), verified equal to the plugin on the shared
/// Python-reference fixture in the tests below.
pub fn request_body_digest(body: &serde_json::Value) -> String {
    use sha2::{Digest, Sha256};
    let canonical = jcs_bytes(&normalize(&stringify_floats(body)));
    hex::encode(Sha256::digest(&canonical))
}

/// Replace every JSON float with its exact decimal-string form (mirrors the
/// plugin's `stringify_floats` / the Python `_stringify_floats`).
fn stringify_floats(value: &serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    match value {
        Value::Number(n) => {
            if n.is_f64() && !(n.is_i64() || n.is_u64()) {
                if let Some(f) = n.as_f64() {
                    let s = format!("{f}");
                    let s = if s.contains('.') || s.contains('e') || s.contains('E') {
                        s
                    } else {
                        format!("{s}.0")
                    };
                    return Value::String(s);
                }
            }
            value.clone()
        }
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(k, v)| (k.clone(), stringify_floats(v)))
                .collect(),
        ),
        Value::Array(arr) => Value::Array(arr.iter().map(stringify_floats).collect()),
        other => other.clone(),
    }
}

/// Profile §2 absent-field normalization: bottom-up removal of members whose
/// value is null, an empty array, or an empty object (mirror of the plugin's
/// `jcs::normalize`).
fn normalize(v: &serde_json::Value) -> serde_json::Value {
    use serde_json::{Map, Value};
    match v {
        Value::Object(map) => {
            let mut out = Map::new();
            for (key, val) in map {
                let nv = normalize(val);
                let drop = match &nv {
                    Value::Null => true,
                    Value::Array(a) => a.is_empty(),
                    Value::Object(o) => o.is_empty(),
                    _ => false,
                };
                if !drop {
                    out.insert(key.clone(), nv);
                }
            }
            Value::Object(out)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(normalize).collect()),
        other => other.clone(),
    }
}

/// RFC 8785 JCS serialization (mirror of the plugin's `jcs::jcs`). Floats are
/// already stringified before this runs, so a bare float here is a programmer
/// error, serialized via serde's default rather than panicking.
fn jcs_bytes(v: &serde_json::Value) -> Vec<u8> {
    let mut out = String::new();
    jcs_value(v, &mut out);
    out.into_bytes()
}

fn jcs_value(v: &serde_json::Value, out: &mut String) {
    use serde_json::Value;
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(true) => out.push_str("true"),
        Value::Bool(false) => out.push_str("false"),
        Value::String(s) => jcs_string(s, out),
        Value::Number(n) => out.push_str(&n.to_string()),
        Value::Array(arr) => {
            out.push('[');
            for (i, x) in arr.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                jcs_value(x, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            // RFC 8785 §3.2.3: object members sorted by UTF-16 code-unit sequence.
            let mut items: Vec<(&String, &Value)> = map.iter().collect();
            items.sort_by(|(a, _), (b, _)| {
                let au: Vec<u16> = a.encode_utf16().collect();
                let bu: Vec<u16> = b.encode_utf16().collect();
                au.cmp(&bu).then_with(|| a.cmp(b))
            });
            out.push('{');
            for (i, (k, val)) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                jcs_string(k, out);
                out.push(':');
                jcs_value(val, out);
            }
            out.push('}');
        }
    }
}

fn jcs_string(s: &str, out: &mut String) {
    out.push('"');
    for ch in s.chars() {
        let o = ch as u32;
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            _ if o == 0x08 => out.push_str("\\b"),
            _ if o == 0x09 => out.push_str("\\t"),
            _ if o == 0x0A => out.push_str("\\n"),
            _ if o == 0x0C => out.push_str("\\f"),
            _ if o == 0x0D => out.push_str("\\r"),
            _ if o < 0x20 => out.push_str(&format!("\\u{o:04x}")),
            _ => out.push(ch),
        }
    }
    out.push('"');
}

/// Publishes [`OpenAiExchangeEnvelope`]s to whatever is subscribed on
/// [`OPENAI_EXCHANGE_CHANNEL`] — an out-of-process plugin in production, a
/// recording double in tests. Fire-and-forget by design, mirroring
/// [`OpenAiHookPolicy`]'s own observer methods: exchange delivery to a
/// plugin must never affect whether the client's own request succeeds.
#[async_trait]
pub trait OpenAiExchangeChannel: Send + Sync + 'static {
    async fn publish(&self, event: &OpenAiExchangeEnvelope);
}

#[async_trait]
impl OpenAiExchangeChannel for PluginManager {
    async fn publish(&self, event: &OpenAiExchangeEnvelope) {
        let body = match serde_json::to_vec(event) {
            Ok(body) => body,
            Err(error) => {
                tracing::warn!(%error, "failed to serialize openai exchange event");
                return;
            }
        };
        if let Err(error) = self
            .broadcast_channel_message(
                OPENAI_EXCHANGE_CHANNEL,
                "application/json",
                body,
                &event.exchange_id,
            )
            .await
        {
            tracing::warn!(%error, "failed to publish openai exchange event to plugins");
        }
    }
}

/// Bridges path 1 (`openai-frontend`'s typed hook seam) to
/// [`OpenAiExchangeChannel`], so an out-of-process plugin observes the same
/// effective-request/terminal events this crate's `MeshAutoHookPolicy`
/// already sees in-process. Compose alongside other [`OpenAiHookPolicy`]
/// implementors rather than in place of them — this bridge only observes and
/// mints capsule markers, it never mutates or denies a request.
pub struct OpenAiExchangeHookBridge {
    channel: Arc<dyn OpenAiExchangeChannel>,
}

impl OpenAiExchangeHookBridge {
    pub fn new(channel: Arc<dyn OpenAiExchangeChannel>) -> Self {
        Self { channel }
    }
}

#[async_trait]
impl OpenAiHookPolicy for OpenAiExchangeHookBridge {
    async fn on_effective_chat_completion(
        &self,
        _request: &ChatCompletionRequest,
        route: &ChatExchangeRoute,
    ) {
        self.channel
            .publish(&OpenAiExchangeEnvelope::effective(
                route.exchange_id.clone(),
                OpenAiExchangeDispatchPath::TypedFrontend,
                route.model.clone(),
            ))
            .await;
    }

    async fn on_chat_completion_terminal(
        &self,
        request: &ChatCompletionRequest,
        exchange_id: &str,
        outcome: &ChatCompletionOutcome<'_>,
    ) {
        let (status, marker): (Option<u16>, Option<CapsuleMarker>) = match outcome {
            ChatCompletionOutcome::Success { response } => {
                (Some(200), response.capsule_marker.clone())
            }
            ChatCompletionOutcome::Error { status, .. } => (Some(*status), None),
            ChatCompletionOutcome::Denied { status, .. } => (Some(*status), None),
            // `ChatCompletionOutcome::Cancelled` and any future variant:
            // no HTTP response was produced, so there's nothing to report
            // beyond a status-free terminal event.
            _ => (None, None),
        };
        // Recomputed from `request` rather than threaded through
        // `CapsuleMarker` (an `openai-frontend` public type this crate
        // doesn't own): both this and `capsule_marker_for_response` below
        // read the same `client_nonce` field, so they always agree on which
        // branch was taken.
        let nonce_source = marker.as_ref().map(|_| client_nonce_source(request));
        self.channel
            .publish(&OpenAiExchangeEnvelope::terminal(
                exchange_id,
                OpenAiExchangeDispatchPath::TypedFrontend,
                request.model.clone(),
                status,
                marker,
                nonce_source,
            ))
            .await;
    }

    /// Reference nonce sourcing for the rung-ladder response leg: a
    /// client-contributed `client_nonce` (landing in `request.extra` via
    /// `ChatCompletionRequest`'s `#[serde(flatten)]` bag, the same mechanism
    /// `mesh_hooks` already uses) wins; absent that, mint a fallback rather
    /// than silently mislabeling it as client-supplied — mirroring
    /// `capsule-emit-mesh`'s own `client_nonce_source` tri-state
    /// (`client_supplied` / `sidecar_generated_fallback`). The `fallback-`
    /// prefix stays for readability, but [`ClientNonceSource`] (see
    /// `on_chat_completion_terminal`) is the authoritative signal — a plugin
    /// must not infer sourcing by sniffing this string.
    async fn capsule_marker_for_response(
        &self,
        request: &ChatCompletionRequest,
        response: &ChatCompletionResponse,
    ) -> Option<CapsuleMarker> {
        let nonce = match client_nonce_source(request) {
            ClientNonceSource::ClientSupplied => request
                .extra
                .get("client_nonce")
                .and_then(|value| value.as_str())
                .expect("client_nonce_source() confirmed a client_nonce string is present")
                .to_string(),
            ClientNonceSource::SidecarGeneratedFallback => format!("fallback-{}", response.id),
        };
        Some(CapsuleMarker {
            capsule_id: format!("capsule-{}", response.id),
            nonce,
        })
    }
}

/// The single place that decides client-supplied vs. sidecar-minted, used by
/// both [`OpenAiExchangeHookBridge::capsule_marker_for_response`] (to choose
/// the nonce value) and [`OpenAiExchangeHookBridge::on_chat_completion_terminal`]
/// (to label it on the envelope) so the two can never disagree.
fn client_nonce_source(request: &ChatCompletionRequest) -> ClientNonceSource {
    if request
        .extra
        .get("client_nonce")
        .and_then(|value| value.as_str())
        .is_some()
    {
        ClientNonceSource::ClientSupplied
    } else {
        ClientNonceSource::SidecarGeneratedFallback
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use openai_frontend::{ChatCompletionOutcome, HookedOpenAiBackend, OpenAiBackend, Usage};

    use super::*;

    /// A terminal envelope with serving provenance serializes the known fields
    /// and OMITS the unknown ones (never a fabricated `null` or empty string) —
    /// this is the honesty contract a downstream capsule relies on: a field
    /// that is present is a real host fact, a field that is absent is genuinely
    /// unknown, not zeroed.
    #[test]
    fn terminal_carries_serving_provenance_and_omits_unknown_fields() {
        let envelope = OpenAiExchangeEnvelope::terminal(
            "exch-1",
            OpenAiExchangeDispatchPath::RawProxy,
            "hermes-2-pro-mistral-7b",
            Some(200),
            None,
            None,
        )
        .with_serving_provenance(ServingProvenance {
            served_by_node_id: "node-abc".to_string(),
            hostname: Some("host-1".to_string()),
            quantization: Some("Q4_K_M".to_string()),
            architecture: Some("llama".to_string()),
            context_length: Some(8192),
            parameter_size: Some("7B".to_string()),
            layer_count: Some(32),
            model_identity_hash: Some("abc123".to_string()),
            model_canonical_ref: None,
            model_revision: None,
            gpu: None,
            vram_bytes: None,
            is_soc: Some(true),
        });

        let value = serde_json::to_value(&envelope).expect("serialize");
        let prov = &value["serving_provenance"];
        assert_eq!(prov["served_by_node_id"], "node-abc");
        assert_eq!(prov["quantization"], "Q4_K_M");
        assert_eq!(prov["architecture"], "llama");
        assert_eq!(prov["context_length"], 8192);
        assert_eq!(prov["layer_count"], 32);
        assert_eq!(prov["is_soc"], true);
        // Unknown facts are ABSENT (omitted), not fabricated as null/empty.
        assert!(prov.get("model_canonical_ref").is_none());
        assert!(prov.get("model_revision").is_none());
        assert!(prov.get("gpu").is_none());
        assert!(prov.get("vram_bytes").is_none());
    }

    /// The real token usage the host-served path reads off its dispatch outcome
    /// rides the terminal envelope, so a downstream plugin can seal the REAL
    /// counts of a host-served real-weights exchange instead of a stub's zeros.
    #[test]
    fn terminal_carries_real_usage_when_attached() {
        let envelope = OpenAiExchangeEnvelope::terminal(
            "exch-usage",
            OpenAiExchangeDispatchPath::RawProxy,
            "llama-3.2-3b-instruct",
            Some(200),
            None,
            None,
        )
        .with_usage(ExchangeUsage {
            prompt_tokens: 42,
            completion_tokens: 6,
            total_tokens: 48,
        });

        let value = serde_json::to_value(&envelope).expect("serialize");
        assert_eq!(value["usage"]["prompt_tokens"], 42);
        assert_eq!(value["usage"]["completion_tokens"], 6);
        assert_eq!(value["usage"]["total_tokens"], 48);
    }

    /// A terminal envelope with no usage attached OMITS the `usage` key entirely
    /// (never a fabricated all-zero object) — the same honesty contract the
    /// serving-provenance fields hold: absent means genuinely unknown.
    #[test]
    fn terminal_omits_usage_when_none_attached() {
        let envelope = OpenAiExchangeEnvelope::terminal(
            "exch-no-usage",
            OpenAiExchangeDispatchPath::RawProxy,
            "some-plugin-model",
            Some(200),
            None,
            None,
        );
        let value = serde_json::to_value(&envelope).expect("serialize");
        assert!(value.get("usage").is_none());
    }

    /// The host's `request_body_digest` is byte-for-byte the value the
    /// `capsule-emit-mesh` plugin's own `canonical_body_digest` produces — the
    /// expected digest here is the SAME frozen constant the plugin pins against
    /// the Python reference (`capsule_sidecar.digest_json`) in
    /// `plugins/admission-policy/src/capsule_emit.rs`. This is the cross-impl
    /// contract that lets the host forward `agent_input_digest` and a verifier
    /// recompute it. `top_p: 1.0` exercises the whole-number-float edge case
    /// (`stringify_floats` must emit "1.0", not "1").
    #[test]
    fn request_body_digest_matches_plugin_and_python_reference() {
        let body = serde_json::json!({
            "model": "hermes-2-pro-mistral-7b",
            "messages": [{"role": "user", "content": "hello"}],
            "temperature": 0.7,
            "top_p": 1.0,
            "max_tokens": 512
        });
        let expected = "a6329c5ebb66562f38a8136a8d8511b6aeed166e4c7d889b9133ac96fc49a9d5";
        assert_eq!(request_body_digest(&body), expected);
    }

    /// PARITY PIN: the host's `tool_calls_digest`, computed over the REAL
    /// `tool_calls` the model emitted on the live SETI@Home / web_search demo
    /// exchange, is byte-for-byte identical to the Python reference
    /// `agent_action_capsule.json_digest(tool_calls)`. The expected value is the
    /// requester-side digest recorded in the live-demo capture
    /// (`_work/mesh-live-demo/b-tool_calls.json`, `tool_calls_digest_requester_side`),
    /// independently recomputed via:
    ///
    ///   python3 -c "from agent_action_capsule import json_digest; \
    ///     print(json_digest([{ 'function': {'arguments': '{\"query\": \"mesh-llm vs SETI@Home\"}', \
    ///     'name': 'web_search'}, 'id': 'call_719a955fb46a41008dd847d412f00795', 'type': 'function'}]))"
    ///   -> f294be8a53bb9c29cd94472721f0857591f34b23fe010882de79b9fb210b1395
    ///
    /// This is the load-bearing guarantee that a capsule sealed from the host's
    /// forwarded `tool_calls_digest` equals what any verifier recomputes with the
    /// neutral Python reference over the same tool_calls.
    #[test]
    fn tool_calls_digest_over_real_seti_response_matches_python_reference() {
        // A full chat.completion body carrying the real emitted tool call under
        // choices[].message.tool_calls (the shape the normalized JSON relay
        // preserves), plus a real usage block — exactly what the host serves.
        let body = br#"{"id":"chatcmpl-seti","object":"chat.completion","created":1,"model":"llama-3.2-3b-instruct","choices":[{"index":0,"message":{"role":"assistant","content":"","tool_calls":[{"function":{"arguments":"{\"query\": \"mesh-llm vs SETI@Home\"}","name":"web_search"},"id":"call_719a955fb46a41008dd847d412f00795","type":"function"}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":202,"completion_tokens":25,"total_tokens":227}}"#;
        let digests = ExchangeOutputDigests::from_response_body(body);
        let tool_calls_hex =
            hex::encode(digests.tool_calls.expect("tool_calls digest present for a real tool call"));
        assert_eq!(
            tool_calls_hex,
            "f294be8a53bb9c29cd94472721f0857591f34b23fe010882de79b9fb210b1395",
            "host tool_calls_digest must equal the Python reference json_digest(tool_calls)"
        );
        // The response-body digest is real (present), and a non-reasoning model
        // (Llama-3.2) surfaces no reasoning_content -> honest null, never fabricated.
        assert!(digests.response_body.is_some());
        assert!(
            digests.reasoning.is_none(),
            "a non-reasoning model must yield an absent reasoning digest, not a fabricated one"
        );
    }

    /// A response with NO tool_calls yields an absent tool_calls digest — never
    /// a digest over `[]` — so a capsule can never be misread as asserting "zero
    /// tool calls". The response-body digest is still real.
    #[test]
    fn no_tool_calls_yields_absent_tool_calls_digest() {
        let body = br#"{"id":"x","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"hello"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}"#;
        let digests = ExchangeOutputDigests::from_response_body(body);
        assert!(digests.tool_calls.is_none());
        assert!(digests.reasoning.is_none());
        assert!(digests.response_body.is_some());
    }

    /// When the model DOES surface `reasoning_content`, its digest is present and
    /// equals the Python reference `json_digest([reasoning_content])`.
    #[test]
    fn reasoning_digest_over_real_reasoning_matches_python_reference() {
        // json_digest(["let me think about this"]) via the Python reference:
        //   python3 -c "from agent_action_capsule import json_digest; \
        //     print(json_digest(['let me think about this']))"
        let body = br#"{"id":"x","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"42","reasoning_content":"let me think about this"},"finish_reason":"stop"}]}"#;
        let digests = ExchangeOutputDigests::from_response_body(body);
        let reasoning_hex =
            hex::encode(digests.reasoning.expect("reasoning digest present"));
        // Recompute the expected value the same way json_digest would: plain JCS
        // over ["let me think about this"], sha-256, hex.
        let expected = {
            use sha2::{Digest, Sha256};
            let jcs = jcs_bytes(&serde_json::json!(["let me think about this"]));
            hex::encode(Sha256::digest(jcs))
        };
        assert_eq!(reasoning_hex, expected);
    }

    /// The three output digests round-trip onto a terminal envelope as
    /// lowercase-hex, and are omitted entirely when absent (honest null).
    #[test]
    fn terminal_carries_output_digests_and_omits_absent_ones() {
        let body = br#"{"id":"x","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"","tool_calls":[{"function":{"arguments":"{\"query\": \"mesh-llm vs SETI@Home\"}","name":"web_search"},"id":"call_719a955fb46a41008dd847d412f00795","type":"function"}]},"finish_reason":"tool_calls"}]}"#;
        let digests = ExchangeOutputDigests::from_response_body(body);
        let envelope = OpenAiExchangeEnvelope::terminal(
            "exch-od",
            OpenAiExchangeDispatchPath::RawProxy,
            "llama-3.2-3b-instruct",
            Some(200),
            None,
            None,
        )
        .with_output_digests(digests);
        let value = serde_json::to_value(&envelope).expect("serialize");
        assert_eq!(
            value["tool_calls_digest"],
            "f294be8a53bb9c29cd94472721f0857591f34b23fe010882de79b9fb210b1395"
        );
        assert!(value["response_digest"].is_string());
        // Non-reasoning -> the key is omitted entirely, not null.
        assert!(value.get("reasoning_digest").is_none());
    }

    /// A terminal envelope carrying a real request digest serializes it, and it
    /// survives a round-trip — the one fact a downstream capsule binds its
    /// `agent_input_digest` to.
    #[test]
    fn terminal_carries_request_digest_when_attached() {
        let envelope = OpenAiExchangeEnvelope::terminal(
            "exch-rd",
            OpenAiExchangeDispatchPath::RawProxy,
            "llama-3.2-3b-instruct",
            Some(200),
            None,
            None,
        )
        .with_request_digest("deadbeef".to_string());
        let value = serde_json::to_value(&envelope).expect("serialize");
        assert_eq!(value["request_digest"], "deadbeef");
    }

    /// No request digest attached -> the key is omitted entirely (never a
    /// fabricated empty digest), same honesty contract as usage/provenance.
    #[test]
    fn terminal_omits_request_digest_when_none_attached() {
        let envelope = OpenAiExchangeEnvelope::terminal(
            "exch-no-rd",
            OpenAiExchangeDispatchPath::RawProxy,
            "m",
            Some(200),
            None,
            None,
        );
        let value = serde_json::to_value(&envelope).expect("serialize");
        assert!(value.get("request_digest").is_none());
    }

    /// An effective-request envelope carries NO serving provenance (the field
    /// is omitted entirely), so the block is a terminal-only, served-exchange
    /// fact — never claimed before the exchange actually ran.
    #[test]
    fn effective_envelope_has_no_serving_provenance() {
        let envelope =
            OpenAiExchangeEnvelope::effective("exch-1", OpenAiExchangeDispatchPath::RawProxy, "m");
        assert!(envelope.serving_provenance.is_none());
        let value = serde_json::to_value(&envelope).expect("serialize");
        assert!(value.get("serving_provenance").is_none());
    }

    #[derive(Default)]
    struct RecordingChannel {
        events: Mutex<Vec<OpenAiExchangeEnvelope>>,
    }

    #[async_trait]
    impl OpenAiExchangeChannel for RecordingChannel {
        async fn publish(&self, event: &OpenAiExchangeEnvelope) {
            self.events.lock().unwrap().push(event.clone());
        }
    }

    struct EchoBackend;

    #[async_trait]
    impl OpenAiBackend for EchoBackend {
        async fn models(&self) -> openai_frontend::OpenAiResult<Vec<openai_frontend::ModelObject>> {
            Ok(Vec::new())
        }

        async fn chat_completion(
            &self,
            request: ChatCompletionRequest,
        ) -> openai_frontend::OpenAiResult<ChatCompletionResponse> {
            Ok(ChatCompletionResponse::new(
                request.model,
                "ok",
                Usage::new(1, 1),
            ))
        }

        async fn chat_completion_stream(
            &self,
            _request: ChatCompletionRequest,
            _context: openai_frontend::OpenAiRequestContext,
        ) -> openai_frontend::OpenAiResult<openai_frontend::ChatCompletionStream> {
            Ok(Box::pin(futures_util::stream::empty()))
        }
    }

    fn chat_request(model: &str) -> ChatCompletionRequest {
        serde_json::from_value(serde_json::json!({
            "model": model,
            "messages": [{"role": "user", "content": "hi"}]
        }))
        .unwrap()
    }

    /// Reference: a full request through `HookedOpenAiBackend` wired with
    /// this bridge publishes both the effective-request and terminal events
    /// on the typed-frontend path, and the terminal event carries the same
    /// capsule marker that (per the openai-frontend-crate tests) also became
    /// the client-visible `X-Capsule-Id` header — proving the plugin sees
    /// exactly what the client's response leg exposed, not a divergent copy.
    #[tokio::test]
    async fn typed_frontend_path_publishes_effective_and_terminal_with_capsule_marker() {
        let channel = Arc::new(RecordingChannel::default());
        let bridge = Arc::new(OpenAiExchangeHookBridge::new(channel.clone()));
        let hooked = HookedOpenAiBackend::new(Arc::new(EchoBackend), bridge);

        let response = hooked
            .chat_completion(chat_request("gpt-mesh"))
            .await
            .expect("backend call succeeds");

        let events = channel.events.lock().unwrap();
        assert_eq!(events.len(), 2, "one effective-request, one terminal");

        assert_eq!(
            events[0].dispatch_path,
            OpenAiExchangeDispatchPath::TypedFrontend
        );
        assert_eq!(events[0].phase, OpenAiExchangePhase::EffectiveRequest);
        assert_eq!(events[0].model, "gpt-mesh");

        assert_eq!(events[1].phase, OpenAiExchangePhase::Terminal);
        assert_eq!(events[1].status, Some(200));
        assert!(!events[0].exchange_id.is_empty());
        assert_eq!(events[0].exchange_id, events[1].exchange_id);
        let capsule_id = events[1]
            .capsule_id
            .as_deref()
            .expect("terminal event carries the capsule id");
        assert_eq!(
            capsule_id,
            response
                .capsule_marker
                .as_ref()
                .expect("router-visible marker")
                .capsule_id
        );
    }

    #[tokio::test]
    async fn client_supplied_nonce_survives_into_the_terminal_event() {
        let channel = Arc::new(RecordingChannel::default());
        let bridge = Arc::new(OpenAiExchangeHookBridge::new(channel.clone()));
        let hooked = HookedOpenAiBackend::new(Arc::new(EchoBackend), bridge);

        let mut request = chat_request("gpt-mesh");
        request
            .extra
            .insert("client_nonce".to_string(), serde_json::json!("abc123"));

        hooked
            .chat_completion(request)
            .await
            .expect("backend call succeeds");

        let events = channel.events.lock().unwrap();
        assert_eq!(events[1].nonce.as_deref(), Some("abc123"));
        assert_eq!(
            events[1].nonce_source,
            Some(ClientNonceSource::ClientSupplied),
            "a plugin must be able to trust nonce_source over sniffing the nonce string"
        );
    }

    /// When the client contributes no nonce, the mint still labels it
    /// `sidecar_generated_fallback` via `nonce_source` — not just the
    /// human-readable `fallback-` prefix on the nonce string itself.
    #[tokio::test]
    async fn absent_client_nonce_is_labeled_sidecar_generated_fallback() {
        let channel = Arc::new(RecordingChannel::default());
        let bridge = Arc::new(OpenAiExchangeHookBridge::new(channel.clone()));
        let hooked = HookedOpenAiBackend::new(Arc::new(EchoBackend), bridge);

        hooked
            .chat_completion(chat_request("gpt-mesh"))
            .await
            .expect("backend call succeeds");

        let events = channel.events.lock().unwrap();
        assert!(
            events[1]
                .nonce
                .as_deref()
                .is_some_and(|n| n.starts_with("fallback-"))
        );
        assert_eq!(
            events[1].nonce_source,
            Some(ClientNonceSource::SidecarGeneratedFallback)
        );
    }

    /// A denial never reaches the backend, so there is no response to mint a
    /// marker from — the bridge's own terminal handling (not a stand-in) must
    /// publish a status-only event with no capsule id.
    #[tokio::test]
    async fn denied_outcome_publishes_terminal_without_a_capsule_marker() {
        let channel = Arc::new(RecordingChannel::default());
        let bridge = OpenAiExchangeHookBridge::new(channel.clone());
        let request = chat_request("gpt-mesh");
        let denial = ChatCompletionOutcome::Denied {
            status: 400,
            reason: "denied by policy",
        };

        bridge
            .on_chat_completion_terminal(&request, "exchange-1", &denial)
            .await;

        let events = channel.events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].exchange_id, "exchange-1");
        assert_eq!(events[0].status, Some(400));
        assert!(events[0].capsule_id.is_none());
        assert!(events[0].nonce.is_none());
        assert!(events[0].nonce_source.is_none());
    }

    /// The exact scenario `TerminalGuard` (in `openai-frontend`) exists to
    /// close: the backend future never returns, so `HookedOpenAiBackend`
    /// reports `ChatCompletionOutcome::Cancelled` instead of nothing — this
    /// bridge must still publish a terminal event for it, with no status,
    /// capsule id, nonce, or nonce_source to report.
    #[tokio::test]
    async fn cancelled_outcome_publishes_a_status_free_terminal_event() {
        let channel = Arc::new(RecordingChannel::default());
        let bridge = OpenAiExchangeHookBridge::new(channel.clone());
        let request = chat_request("gpt-mesh");

        bridge
            .on_chat_completion_terminal(&request, "exchange-1", &ChatCompletionOutcome::Cancelled)
            .await;

        let events = channel.events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].phase, OpenAiExchangePhase::Terminal);
        assert!(events[0].status.is_none());
        assert!(events[0].capsule_id.is_none());
        assert!(events[0].nonce.is_none());
        assert!(events[0].nonce_source.is_none());
    }

    struct DelayedBackend {
        delay: std::time::Duration,
    }

    #[async_trait]
    impl OpenAiBackend for DelayedBackend {
        async fn models(&self) -> openai_frontend::OpenAiResult<Vec<openai_frontend::ModelObject>> {
            Ok(Vec::new())
        }

        async fn chat_completion(
            &self,
            request: ChatCompletionRequest,
        ) -> openai_frontend::OpenAiResult<ChatCompletionResponse> {
            tokio::time::sleep(self.delay).await;
            Ok(ChatCompletionResponse::new(
                request.model,
                "ok",
                Usage::new(1, 1),
            ))
        }

        async fn chat_completion_stream(
            &self,
            _request: ChatCompletionRequest,
            _context: openai_frontend::OpenAiRequestContext,
        ) -> openai_frontend::OpenAiResult<openai_frontend::ChatCompletionStream> {
            Ok(Box::pin(futures_util::stream::empty()))
        }
    }

    /// Two concurrent exchanges on the same model must not be pairable by
    /// mere arrival order — the terminal event for the exchange with the
    /// shorter backend delay lands before the effective event of neither
    /// exchange lines up with it positionally. Only matching `exchange_id`
    /// correctly recovers each exchange's own effective/terminal pair.
    #[tokio::test(start_paused = true)]
    async fn concurrent_exchanges_on_the_same_model_pair_by_exchange_id_not_by_arrival_order() {
        let channel = Arc::new(RecordingChannel::default());
        let bridge = Arc::new(OpenAiExchangeHookBridge::new(channel.clone()));
        let slow = HookedOpenAiBackend::new(
            Arc::new(DelayedBackend {
                delay: std::time::Duration::from_millis(50),
            }),
            bridge.clone(),
        );
        let fast = HookedOpenAiBackend::new(
            Arc::new(DelayedBackend {
                delay: std::time::Duration::from_millis(1),
            }),
            bridge,
        );

        let (slow_result, fast_result) = tokio::join!(
            slow.chat_completion(chat_request("gpt-mesh")),
            fast.chat_completion(chat_request("gpt-mesh")),
        );
        slow_result.expect("slow exchange succeeds");
        fast_result.expect("fast exchange succeeds");

        let events = channel.events.lock().unwrap();
        assert_eq!(events.len(), 4, "two effective + two terminal events");
        assert_eq!(events[0].phase, OpenAiExchangePhase::EffectiveRequest);
        assert_eq!(events[1].phase, OpenAiExchangePhase::EffectiveRequest);
        assert_eq!(events[2].phase, OpenAiExchangePhase::Terminal);
        assert_eq!(events[3].phase, OpenAiExchangePhase::Terminal);
        assert_ne!(
            events[0].exchange_id, events[1].exchange_id,
            "each exchange mints its own id"
        );

        // The fast exchange finishes first, so its terminal event (index 2)
        // is adjacent to the slow exchange's effective event (index 0) by
        // position — but it must still pair with the fast effective event
        // (index 1) by id, and the slow terminal (index 3) with the slow
        // effective (index 0).
        assert_eq!(
            events[2].exchange_id, events[1].exchange_id,
            "fast exchange's terminal event pairs with its own effective event"
        );
        assert_eq!(
            events[3].exchange_id, events[0].exchange_id,
            "slow exchange's terminal event pairs with its own effective event"
        );
    }
}
