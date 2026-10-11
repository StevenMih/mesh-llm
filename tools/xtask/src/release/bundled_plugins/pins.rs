//! `ci/bundled-plugins.json`: each plugin's release tag, signer workflow and
//! the digest of every archive it ships, or why a target has none.

use super::RELEASE_TARGETS;
use crate::command::DynResult;
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone)]
pub(crate) struct Plugin {
    pub(crate) name: String,
    pub(crate) repository: String,
    pub(crate) tag: String,
    pub(crate) version: String,
    pub(crate) signer_workflow: String,
    /// Release target to the pinned SHA-256 of its archive.
    pub(crate) archives: BTreeMap<String, String>,
    /// Release target to why the plugin ships nothing for it.
    pub(crate) absent: BTreeMap<String, String>,
}

impl Plugin {
    /// The archive's file name in the plugin's release.
    pub(crate) fn asset_name(&self, target: &str) -> String {
        format!("{}-{}-{target}.tar.gz", self.name, self.version)
    }
}

pub(crate) fn load_pins(path: &Path) -> DynResult<Vec<Plugin>> {
    let shown = path.display();
    let pins: Value = std::fs::read(path)
        .map_err(|error| error.to_string())
        .and_then(|bytes| serde_json::from_slice(&bytes).map_err(|error| error.to_string()))
        .map_err(|error| format!("cannot read the pin file {shown}: {error}"))?;
    let entries = match (pins.get("schema_version"), pins.get("plugins")) {
        (Some(version), Some(Value::Array(entries))) if version == 1 => entries,
        _ => return Err(format!("{shown}: expected schema_version 1 and a plugins list").into()),
    };
    let mut plugins: Vec<Plugin> = Vec::new();
    for entry in entries {
        let plugin = plugin_entry(entry).map_err(|error| format!("{shown}: {error}"))?;
        if plugins.iter().any(|seen| seen.name == plugin.name) {
            return Err(format!("{shown}: {} is pinned twice", plugin.name).into());
        }
        check_targets(&plugin).map_err(|error| format!("{shown}: {error}"))?;
        plugins.push(plugin);
    }
    Ok(plugins)
}

fn plugin_entry(entry: &Value) -> Result<Plugin, String> {
    let entry = entry.as_object().ok_or("a plugin entry is not an object")?;
    let text = |key: &str| match entry.get(key) {
        Some(Value::String(value)) if !value.is_empty() => Ok(value.clone()),
        _ => Err(format!("a plugin entry has no {key}")),
    };
    let name = text("name")?;
    let repository = text("repository")?;
    let tag = text("tag")?;
    let version = text("version")?;
    let signer_workflow = text("signer_workflow")?;
    let archives = match entry.get("archives") {
        Some(Value::Object(archives)) if !archives.is_empty() => string_map(&name, archives)?,
        _ => return Err("a plugin entry has no archives".to_string()),
    };
    let absent = match entry.get("absent") {
        None => BTreeMap::new(),
        Some(Value::Object(absent)) => string_map(&name, absent)?,
        Some(other) => return Err(format!("{name} lists absent targets as {other}")),
    };
    Ok(Plugin {
        name,
        repository,
        tag,
        version,
        signer_workflow,
        archives,
        absent,
    })
}

fn string_map(name: &str, map: &Map<String, Value>) -> Result<BTreeMap<String, String>, String> {
    map.iter()
        .map(|(target, value)| match value {
            Value::String(value) => Ok((target.clone(), value.clone())),
            other => Err(format!("{name} pins {target:?} with {other}")),
        })
        .collect()
}

fn check_targets(plugin: &Plugin) -> Result<(), String> {
    let name = &plugin.name;
    if plugin.tag != format!("v{}", plugin.version) {
        return Err(format!(
            "{name} tag {} is not v{}",
            plugin.tag, plugin.version
        ));
    }
    for (target, digest) in &plugin.archives {
        if !RELEASE_TARGETS.contains(&target.as_str()) || !is_sha256(digest) {
            return Err(format!("{name} pins {target:?} with {digest:?}"));
        }
        if plugin.absent.contains_key(target) {
            return Err(format!("{name} lists {target} as both pinned and absent"));
        }
    }
    if let Some(target) = plugin
        .absent
        .keys()
        .find(|target| !RELEASE_TARGETS.contains(&target.as_str()))
    {
        return Err(format!("{name} lists an unknown absent target {target:?}"));
    }
    let missing = RELEASE_TARGETS
        .iter()
        .filter(|target| {
            !plugin.archives.contains_key(**target) && !plugin.absent.contains_key(**target)
        })
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(format!(
            "{name} neither pins nor lists as absent: {}",
            missing.join(", ")
        ));
    }
    Ok(())
}

/// Lowercase hex, 64 digits: the only form a pin may take.
fn is_sha256(digest: &str) -> bool {
    digest.len() == 64
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
