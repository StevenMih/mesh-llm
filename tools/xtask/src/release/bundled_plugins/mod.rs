//! `release bundled-plugins`: plugins bundled into each Mesh release archive,
//! pinned in `ci/bundled-plugins.json`. A port of `scripts/bundled-plugins.py`,
//! which stays in the tree (unused by the release) until the Python tooling goes.
//!
//! A default-enabled plugin ships inside the release; a node never downloads it.
//!
//! - `fetch` downloads each pinned plugin archive from its GitHub release at
//!   the pinned tag, checks it against that release's `SHA256SUMS` and against
//!   the pin, and verifies its build-provenance attestation with the pinned
//!   signer workflow (`gh attestation verify`).
//! - `place` puts the archives for one target into a product bundle's
//!   `plugins/` directory, with `plugins/manifest.json`. A target the pin lists
//!   as absent gets a manifest saying so and no archive.
//! - `verify` checks every published release archive: each one for a pinned
//!   target carries each plugin's archive at its pinned digest; one for a
//!   target listed as absent carries no `plugins/`.
//!
//! The archive is bundled exactly as the plugin's release published it (not
//! unpacked), so the bytes a node loads are the attested bytes.

mod fetch;
mod pins;
mod place;
mod verify;

#[cfg(test)]
mod tests;

use crate::command::DynResult;
use crate::repo_consistency::repo_root;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;

/// The release archives' targets, as their file names spell them.
pub(crate) const RELEASE_TARGETS: [&str; 4] = [
    "aarch64-apple-darwin",
    "aarch64-unknown-linux-gnu",
    "x86_64-unknown-linux-gnu",
    "x86_64-pc-windows-msvc",
];

const USAGE: &str = "usage:
  cargo run -p xtask -- release bundled-plugins fetch --out <dir> [--pins <path>]
  cargo run -p xtask -- release bundled-plugins place --from <dir> --target <triple> --bundle <dir> [--pins <path>]
  cargo run -p xtask -- release bundled-plugins verify <artifacts-dir> [--pins <path>]";

/// Runs `gh` for `fetch`: the only place its children are spawned. Tests
/// substitute a host that serves a fixture release.
pub(crate) trait GhHost {
    /// Runs `gh` with `args`, its output inherited; true when it exits 0.
    fn gh(&mut self, args: &[String]) -> DynResult<bool>;
}

/// The `gh` named by `BUNDLED_PLUGINS_GH`, else the one on `PATH`.
pub(crate) struct SystemGh;

impl GhHost for SystemGh {
    fn gh(&mut self, args: &[String]) -> DynResult<bool> {
        let program = std::env::var_os("BUNDLED_PLUGINS_GH").unwrap_or_else(|| "gh".into());
        let status = Command::new(&program)
            .args(args)
            .status()
            .map_err(|error| format!("cannot run {}: {error}", program.to_string_lossy()))?;
        Ok(status.success())
    }
}

pub(crate) fn run(args: &[String]) -> DynResult<()> {
    let (command, rest) = args.split_first().ok_or(USAGE)?;
    let parsed = parse_flags(command, rest)?;
    let pins = match parsed.pins.clone() {
        Some(pins) => pins,
        None => repo_root()?.join("ci").join("bundled-plugins.json"),
    };
    let result = match command.as_str() {
        "fetch" => fetch::fetch(&pins, Path::new(parsed.required("--out")?), &mut SystemGh),
        "place" => place::place(
            &pins,
            Path::new(parsed.required("--from")?),
            parsed.required("--target")?,
            Path::new(parsed.required("--bundle")?),
        ),
        "verify" => verify::verify(&pins, Path::new(parsed.required("<artifacts-dir>")?)),
        _ => return Err(USAGE.into()),
    };
    result.map_err(|error| format!("bundled-plugins: {error}").into())
}

#[derive(Default)]
struct Flags {
    pins: Option<PathBuf>,
    values: Vec<(&'static str, String)>,
}

impl Flags {
    fn required(&self, name: &str) -> DynResult<&str> {
        self.values
            .iter()
            .find(|(flag, _)| *flag == name)
            .map(|(_, value)| value.as_str())
            .ok_or_else(|| format!("missing {name}\n{USAGE}").into())
    }
}

fn parse_flags(command: &str, args: &[String]) -> DynResult<Flags> {
    let allowed: &[&'static str] = match command {
        "fetch" => &["--out"],
        "place" => &["--from", "--target", "--bundle"],
        "verify" => &[],
        _ => return Err(USAGE.into()),
    };
    let mut parsed = Flags::default();
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if command == "verify" && !arg.starts_with("--") {
            if parsed.required("<artifacts-dir>").is_ok() {
                return Err(format!("unexpected argument for verify: {arg}").into());
            }
            parsed.values.push(("<artifacts-dir>", arg.clone()));
            continue;
        }
        let value = iter
            .next()
            .ok_or_else(|| format!("missing value for {arg}"))?;
        if arg == "--pins" {
            parsed.pins = Some(PathBuf::from(value));
        } else if let Some(flag) = allowed.iter().find(|flag| **flag == arg) {
            parsed.values.push((flag, value.clone()));
        } else {
            return Err(format!("unknown flag for {command}: {arg}").into());
        }
    }
    Ok(parsed)
}

pub(crate) fn sha256_file(path: &Path) -> DynResult<String> {
    let mut file =
        File::open(path).map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0; 1 << 20];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(hex::encode(digest.finalize()))
}

pub(crate) fn sha256_bytes(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
