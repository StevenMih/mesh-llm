//! `verify`: before the GitHub release is created, check that every product
//! archive for a pinned target carries each plugin at its pinned digest, and
//! that one for an absent target carries no `plugins/`.

use super::pins::load_pins;
use super::{RELEASE_TARGETS, sha256_bytes};
use crate::command::DynResult;
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ArchiveKind {
    TarGz,
    Zip,
}

/// Every release asset named like a product archive:
/// `^mesh-llm-(?!node-sdk-addon-).*\.(?:tar\.gz|zip)$`. One whose target
/// cannot be read fails verification rather than going unchecked.
pub(crate) fn is_product_archive_name(name: &str) -> bool {
    name.strip_prefix("mesh-llm-").is_some_and(|rest| {
        !rest.starts_with("node-sdk-addon-")
            && (rest.ends_with(".tar.gz") || rest.ends_with(".zip"))
    })
}

/// The target and kind of a product archive, read as
/// `^mesh-llm-(?:v[0-9][^-]*-)?<target>(?:-[a-z0-9.-]+)?\.(tar\.gz|zip)$`.
pub(crate) fn product_archive(name: &str) -> Option<(&'static str, ArchiveKind)> {
    let rest = name.strip_prefix("mesh-llm-")?;
    let (stem, kind) = match (rest.strip_suffix(".tar.gz"), rest.strip_suffix(".zip")) {
        (Some(stem), _) => (stem, ArchiveKind::TarGz),
        (_, Some(stem)) => (stem, ArchiveKind::Zip),
        _ => return None,
    };
    let unversioned = stem
        .strip_prefix('v')
        .filter(|version| version.starts_with(|c: char| c.is_ascii_digit()))
        .and_then(|version| version.split_once('-'))
        .map(|(_, rest)| rest);
    unversioned
        .and_then(target_of)
        .or_else(|| target_of(stem))
        .map(|target| (target, kind))
}

fn target_of(stem: &str) -> Option<&'static str> {
    RELEASE_TARGETS.into_iter().find(|target| {
        stem.strip_prefix(target).is_some_and(|flavor| {
            flavor.is_empty()
                || flavor.strip_prefix('-').is_some_and(|flavor| {
                    !flavor.is_empty()
                        && flavor.bytes().all(|b| {
                            b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-'
                        })
                })
        })
    })
}

pub(crate) fn verify(pins: &Path, artifacts: &Path) -> DynResult<()> {
    let plugins = load_pins(pins)?;
    let mut names = fs::read_dir(artifacts)
        .map_err(|error| format!("cannot read {}: {error}", artifacts.display()))?
        .map(|entry| entry.map(|entry| entry.file_name().to_string_lossy().into_owned()))
        .collect::<Result<Vec<_>, _>>()?;
    names.sort();
    let mut checked = 0;
    let mut seen_targets = BTreeSet::new();
    for name in names {
        let Some((target, kind)) = product_archive(&name) else {
            if is_product_archive_name(&name) {
                return Err(format!(
                    "{name}: a product archive whose target is not recognized; it cannot be checked"
                )
                .into());
            }
            continue;
        };
        let members = archive_members(&artifacts.join(&name), kind)?;
        for plugin in &plugins {
            if plugin.absent.contains_key(target) {
                if !members.is_empty() {
                    return Err(format!(
                        "{name}: carries plugins/ for {target}, which the pin lists as absent"
                    )
                    .into());
                }
                continue;
            }
            let asset = plugin.asset_name(target);
            let found = members_ending(&members, &format!("/plugins/{asset}"));
            let [data] = found[..] else {
                return Err(format!("{name}: does not carry plugins/{asset}").into());
            };
            let actual = sha256_bytes(data);
            let pinned = &plugin.archives[target];
            if &actual != pinned {
                return Err(format!("{name}: plugins/{asset} is {actual}, pinned {pinned}").into());
            }
            if !manifest_lists(&members, &asset, &actual)? {
                return Err(format!(
                    "{name}: plugins/manifest.json does not list {asset} at {actual}"
                )
                .into());
            }
        }
        seen_targets.insert(target);
        checked += 1;
        println!("ok {name}");
    }
    if checked == 0 {
        return Err(format!("no release archives under {}", artifacts.display()).into());
    }
    for plugin in &plugins {
        let unseen = plugin
            .archives
            .keys()
            .filter(|target| !seen_targets.contains(target.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        if !unseen.is_empty() {
            return Err(format!(
                "no release archive for {}, which {} is pinned for",
                unseen.join(", "),
                plugin.name
            )
            .into());
        }
    }
    Ok(())
}

fn members_ending<'a>(members: &'a BTreeMap<String, Vec<u8>>, suffix: &str) -> Vec<&'a [u8]> {
    members
        .iter()
        .filter(|(name, _)| name.ends_with(suffix))
        .map(|(_, data)| data.as_slice())
        .collect()
}

/// Whether the archive's single `plugins/manifest.json` lists `asset` at `digest`.
fn manifest_lists(
    members: &BTreeMap<String, Vec<u8>>,
    asset: &str,
    digest: &str,
) -> DynResult<bool> {
    let [manifest] = members_ending(members, "/plugins/manifest.json")[..] else {
        return Ok(false);
    };
    let manifest: serde_json::Value = serde_json::from_slice(manifest)
        .map_err(|error| format!("plugins/manifest.json is not JSON: {error}"))?;
    Ok(manifest
        .get("plugins")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|entries| {
            entries.iter().any(|entry| {
                entry.get("archive").and_then(serde_json::Value::as_str) == Some(asset)
                    && entry.get("sha256").and_then(serde_json::Value::as_str) == Some(digest)
            })
        }))
}

/// The regular files under any `plugins/` directory of a product archive, by
/// member name.
pub(crate) fn archive_members(
    path: &Path,
    kind: ArchiveKind,
) -> DynResult<BTreeMap<String, Vec<u8>>> {
    let file =
        File::open(path).map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    let in_plugins = |name: &str| format!("/{name}").contains("/plugins/");
    let mut members = BTreeMap::new();
    match kind {
        ArchiveKind::TarGz => {
            let mut archive = tar::Archive::new(flate2::read::MultiGzDecoder::new(file));
            for entry in archive.entries()? {
                let mut entry = entry?;
                let name = String::from_utf8_lossy(&entry.path_bytes()).into_owned();
                if entry.header().entry_type().is_file() && in_plugins(&name) {
                    let mut data = Vec::new();
                    entry.read_to_end(&mut data)?;
                    members.insert(name, data);
                }
            }
        }
        ArchiveKind::Zip => {
            let mut archive = zip::ZipArchive::new(file)?;
            for index in 0..archive.len() {
                let mut entry = archive.by_index(index)?;
                let name = entry.name().to_string();
                if in_plugins(&name) && !name.ends_with('/') {
                    let mut data = Vec::new();
                    entry.read_to_end(&mut data)?;
                    members.insert(name, data);
                }
            }
        }
    }
    Ok(members)
}
