//! `place`: put one target's verified archives into a product bundle's
//! `plugins/`, with a `manifest.json` that names each archive and digest and
//! says why any plugin is absent for the target.

use super::pins::load_pins;
use super::{RELEASE_TARGETS, sha256_file};
use crate::command::DynResult;
use serde::Serialize;
use std::fs;
use std::path::Path;

// Fields are declared in key order: the manifest is written with sorted keys.
#[derive(Serialize)]
struct Manifest<'a> {
    absent: Vec<AbsentEntry<'a>>,
    plugins: Vec<PlacedEntry<'a>>,
    schema_version: u32,
    target: &'a str,
}

#[derive(Serialize)]
struct PlacedEntry<'a> {
    archive: String,
    name: &'a str,
    repository: &'a str,
    sha256: String,
    tag: &'a str,
    target: &'a str,
    version: &'a str,
}

#[derive(Serialize)]
struct AbsentEntry<'a> {
    name: &'a str,
    reason: &'a str,
    version: &'a str,
}

pub(crate) fn place(pins: &Path, source: &Path, target: &str, bundle: &Path) -> DynResult<()> {
    if !RELEASE_TARGETS.contains(&target) {
        return Err(format!("unknown release target {target:?}").into());
    }
    let plugins = load_pins(pins)?;
    let plugins_dir = bundle.join("plugins");
    let mut placed = Vec::new();
    let mut absent = Vec::new();
    for plugin in &plugins {
        if let Some(reason) = plugin.absent.get(target) {
            absent.push(AbsentEntry {
                name: &plugin.name,
                reason,
                version: &plugin.version,
            });
            continue;
        }
        let asset = plugin.asset_name(target);
        let path = source.join(&plugin.name).join(&asset);
        if !path.is_file() {
            return Err(format!(
                "no verified {asset} under {}: run fetch first",
                source.display()
            )
            .into());
        }
        let actual = sha256_file(&path)?;
        let pinned = &plugin.archives[target];
        if &actual != pinned {
            return Err(format!("{asset}: pinned {pinned}, found {actual}").into());
        }
        fs::create_dir_all(&plugins_dir)?;
        fs::copy(&path, plugins_dir.join(&asset))?;
        placed.push(PlacedEntry {
            archive: asset,
            name: &plugin.name,
            repository: &plugin.repository,
            sha256: actual,
            tag: &plugin.tag,
            target,
            version: &plugin.version,
        });
    }
    fs::create_dir_all(&plugins_dir)?;
    let manifest = Manifest {
        absent,
        plugins: placed,
        schema_version: 1,
        target,
    };
    let mut text = serde_json::to_string_pretty(&manifest)?;
    text.push('\n');
    fs::write(plugins_dir.join("manifest.json"), text)?;
    for entry in &manifest.plugins {
        println!("bundled {} {}", entry.archive, entry.sha256);
    }
    for entry in &manifest.absent {
        println!(
            "not bundled for {target}: {} ({})",
            entry.name, entry.reason
        );
    }
    Ok(())
}
