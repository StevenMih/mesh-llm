//! `GET /api/openai/exchanges/recent` — the most recent terminal
//! `openai.exchange.v1` events this node has published, newest first. Reads
//! [`crate::plugin::PluginManager::recent_openai_exchanges`], the bounded
//! in-memory ring `OpenAiExchangeChannel::publish` already fills as a side
//! effect of delivering events to subscribing plugins. Read-only: this route
//! adds no new data, just a way to see it without a plugin running.

use super::super::{
    MeshApi,
    http::{respond_error, respond_json},
};
use url::form_urlencoded;

const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 200;

pub(super) async fn handle(
    stream: &mut tokio::net::TcpStream,
    state: &MeshApi,
    path: &str,
) -> anyhow::Result<()> {
    let limit = match parse_limit(path) {
        Ok(limit) => limit,
        Err(message) => return respond_error(stream, 400, &message).await,
    };
    let plugin_manager = state.inner.lock().await.plugin_manager.clone();
    let events = plugin_manager.recent_openai_exchanges(limit).await;
    respond_json(stream, 200, &serde_json::json!({ "events": events })).await
}

fn parse_limit(path: &str) -> Result<usize, String> {
    let mut limit = DEFAULT_LIMIT;
    if let Some((_, raw_query)) = path.split_once('?') {
        for (key, value) in form_urlencoded::parse(raw_query.as_bytes()) {
            if key == "limit" {
                limit = value
                    .parse::<usize>()
                    .map_err(|_| format!("Invalid 'limit' value '{value}'"))?;
            }
        }
    }
    Ok(limit.min(MAX_LIMIT))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_default_limit_with_no_query() {
        assert_eq!(
            parse_limit("/api/openai/exchanges/recent").unwrap(),
            DEFAULT_LIMIT
        );
    }

    #[test]
    fn honors_an_explicit_limit_within_bounds() {
        assert_eq!(
            parse_limit("/api/openai/exchanges/recent?limit=5").unwrap(),
            5
        );
    }

    #[test]
    fn caps_a_limit_above_the_maximum_rather_than_erroring() {
        assert_eq!(
            parse_limit("/api/openai/exchanges/recent?limit=999999").unwrap(),
            MAX_LIMIT
        );
    }

    #[test]
    fn rejects_a_non_numeric_limit() {
        assert!(parse_limit("/api/openai/exchanges/recent?limit=abc").is_err());
    }
}
