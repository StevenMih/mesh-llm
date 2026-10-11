//! `fetch`: download each pinned archive and stand behind its bytes three
//! ways: the plugin release's `SHA256SUMS`, the pin, and its build-provenance
//! attestation.

use super::pins::{Plugin, load_pins};
use super::{GhHost, sha256_file};
use crate::command::{DynResult, unique_temp_dir};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

/// A download directory removed when the plugin is done, like Python's
/// `tempfile.TemporaryDirectory`.
struct DownloadDir(PathBuf);

impl Drop for DownloadDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub(crate) fn fetch(pins: &Path, out: &Path, gh: &mut dyn GhHost) -> DynResult<()> {
    fs::create_dir_all(out)?;
    for plugin in load_pins(pins)? {
        let download = DownloadDir(unique_temp_dir("bundled-plugins"));
        fs::create_dir_all(&download.0)?;
        fetch_plugin(&plugin, &download.0, out, gh)?;
    }
    Ok(())
}

fn fetch_plugin(plugin: &Plugin, tmp: &Path, out: &Path, gh: &mut dyn GhHost) -> DynResult<()> {
    // Asset name to (target, pinned digest), in name order.
    let assets = plugin
        .archives
        .iter()
        .map(|(target, digest)| (plugin.asset_name(target), digest))
        .collect::<BTreeMap<_, _>>();
    let mut download = strings(&[
        "release",
        "download",
        &plugin.tag,
        "-R",
        &plugin.repository,
        "-D",
        &tmp.to_string_lossy(),
        "-p",
        "SHA256SUMS",
    ]);
    for asset in assets.keys() {
        download.extend(strings(&["-p", asset]));
    }
    if !gh.gh(&download)? {
        return Err(format!("could not download {} {}", plugin.repository, plugin.tag).into());
    }
    let sums = read_sums(&tmp.join("SHA256SUMS"))?;
    for (asset, pinned) in &assets {
        let path = tmp.join(asset);
        if !path.is_file() {
            return Err(format!("{} has no {asset}", plugin.tag).into());
        }
        let actual = sha256_file(&path)?;
        let listed = sums.get(asset.as_str());
        if listed != Some(&actual) {
            let listed = listed.map_or("nothing", String::as_str);
            return Err(format!("{asset}: SHA256SUMS says {listed}, the file is {actual}").into());
        }
        if &&actual != pinned {
            return Err(format!("{asset}: pinned {pinned}, the release serves {actual}").into());
        }
        // The attestation must come from the pinned signer workflow, run for
        // the pinned tag on a GitHub-hosted runner.
        let verify = strings(&[
            "attestation",
            "verify",
            &path.to_string_lossy(),
            "--repo",
            &plugin.repository,
            "--signer-workflow",
            &plugin.signer_workflow,
            "--source-ref",
            &format!("refs/tags/{}", plugin.tag),
            "--deny-self-hosted-runners",
        ]);
        if !gh.gh(&verify)? {
            return Err(format!(
                "{asset}: its build-provenance attestation does not verify for {}",
                plugin.signer_workflow
            )
            .into());
        }
        let destination = out.join(&plugin.name).join(asset);
        fs::create_dir_all(out.join(&plugin.name))?;
        fs::copy(&path, &destination)?;
        println!(
            "verified {asset} {actual} ({} {})",
            plugin.repository, plugin.tag
        );
    }
    Ok(())
}

/// File name to lowercase digest, from `<digest> [*]<name>` lines; any other
/// line is skipped.
fn read_sums(path: &Path) -> DynResult<BTreeMap<String, String>> {
    let text = fs::read_to_string(path)
        .map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    Ok(text
        .lines()
        .filter_map(
            |line| match line.split_whitespace().collect::<Vec<_>>()[..] {
                [digest, name] => Some((
                    name.trim_start_matches('*').to_string(),
                    digest.to_lowercase(),
                )),
                _ => None,
            },
        )
        .collect())
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}
