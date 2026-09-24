use crate::plugin::openai_exchange::{
    OpenAiExchangeChannel, OpenAiExchangeDispatchPath, OpenAiExchangeEnvelope, ServingProvenance,
};

async fn empty_plugin_manager() -> plugin::PluginManager {
    let resolved_plugins = plugin::ResolvedPlugins {
        externals: vec![],
        inactive: vec![],
    };
    let (mesh_tx, _mesh_rx) = mpsc::channel(1);
    plugin::PluginManager::start(
        &resolved_plugins,
        plugin::PluginHostMode {
            mesh_visibility: MeshVisibility::Private,
        },
        mesh_tx,
    )
    .await
    .unwrap()
}

fn terminal_envelope(exchange_id: &str, served_by_node_id: &str) -> OpenAiExchangeEnvelope {
    OpenAiExchangeEnvelope::terminal(
        exchange_id,
        OpenAiExchangeDispatchPath::RawProxy,
        "llama-3.2-3b-instruct",
        Some(200),
        None,
        None,
    )
    .with_serving_provenance(ServingProvenance {
        served_by_node_id: served_by_node_id.to_string(),
        hostname: None,
        quantization: None,
        architecture: None,
        context_length: None,
        parameter_size: None,
        layer_count: None,
        model_identity_hash: None,
        model_canonical_ref: None,
        model_revision: None,
        weights_digest: None,
        gpu: None,
        vram_bytes: None,
        is_soc: None,
    })
}

#[tokio::test]
async fn test_api_openai_exchanges_recent_returns_published_terminal_events_newest_first() {
    let plugin_manager = empty_plugin_manager().await;
    plugin_manager
        .publish(&terminal_envelope("exch-1", "node-a"))
        .await;
    plugin_manager
        .publish(&terminal_envelope("exch-2", "node-a"))
        .await;
    let state = build_test_mesh_api_with_plugin_manager(3131, plugin_manager).await;
    let (addr, handle) = spawn_management_test_server(state).await;

    let response = send_management_request(
        addr,
        "GET /api/openai/exchanges/recent HTTP/1.1\r\nHost: localhost\r\n\r\n".into(),
    )
    .await;

    assert!(response.starts_with("HTTP/1.1 200"));
    let payload = json_body(&response);
    let events = payload["events"].as_array().cloned().unwrap_or_default();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0]["exchange_id"], json!("exch-2"));
    assert_eq!(events[1]["exchange_id"], json!("exch-1"));
    assert_eq!(events[0]["served_by_node_id"], json!("node-a"));
    assert_eq!(events[0]["dispatch_path"], json!("raw_proxy"));

    handle.abort();
}

#[tokio::test]
async fn test_api_openai_exchanges_recent_honors_the_limit_query_parameter() {
    let plugin_manager = empty_plugin_manager().await;
    for i in 0..5 {
        plugin_manager
            .publish(&terminal_envelope(&format!("exch-{i}"), "node-a"))
            .await;
    }
    let state = build_test_mesh_api_with_plugin_manager(3131, plugin_manager).await;
    let (addr, handle) = spawn_management_test_server(state).await;

    let response = send_management_request(
        addr,
        "GET /api/openai/exchanges/recent?limit=2 HTTP/1.1\r\nHost: localhost\r\n\r\n".into(),
    )
    .await;

    assert!(response.starts_with("HTTP/1.1 200"));
    let payload = json_body(&response);
    let events = payload["events"].as_array().cloned().unwrap_or_default();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0]["exchange_id"], json!("exch-4"));
    assert_eq!(events[1]["exchange_id"], json!("exch-3"));

    handle.abort();
}

#[tokio::test]
async fn test_api_openai_exchanges_recent_rejects_a_non_numeric_limit() {
    let state = build_test_mesh_api_with_plugin_manager(3131, empty_plugin_manager().await).await;
    let (addr, handle) = spawn_management_test_server(state).await;

    let response = send_management_request(
        addr,
        "GET /api/openai/exchanges/recent?limit=nope HTTP/1.1\r\nHost: localhost\r\n\r\n".into(),
    )
    .await;

    assert!(response.starts_with("HTTP/1.1 400"));

    handle.abort();
}

#[tokio::test]
async fn test_api_openai_exchanges_recent_is_empty_with_no_events_published() {
    let state = build_test_mesh_api_with_plugin_manager(3131, empty_plugin_manager().await).await;
    let (addr, handle) = spawn_management_test_server(state).await;

    let response = send_management_request(
        addr,
        "GET /api/openai/exchanges/recent HTTP/1.1\r\nHost: localhost\r\n\r\n".into(),
    )
    .await;

    assert!(response.starts_with("HTTP/1.1 200"));
    let payload = json_body(&response);
    assert!(payload["events"].as_array().unwrap().is_empty());

    handle.abort();
}
