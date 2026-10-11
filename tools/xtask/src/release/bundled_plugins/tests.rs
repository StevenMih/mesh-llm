use super::fetch::fetch;
use super::pins::load_pins;
use super::place::place;
use super::verify::{ArchiveKind, product_archive, verify};
use super::{GhHost, sha256_bytes};
use crate::command::{DynResult, unique_temp_dir, workflow_job_section};
use crate::repo_consistency::repo_root;
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const UNIX: [&str; 3] = [
    "aarch64-apple-darwin",
    "aarch64-unknown-linux-gnu",
    "x86_64-unknown-linux-gnu",
];
const LINUX_X86: &str = "x86_64-unknown-linux-gnu";
const LINUX_X86_ASSET: &str = "example-1.2.3-x86_64-unknown-linux-gnu.tar.gz";

/// A small, deterministic stand-in for one plugin release archive.
fn archive_bytes(target: &str) -> DynResult<Vec<u8>> {
    let data = format!("plugin for {target}\n");
    let mut header = tar::Header::new_gnu();
    header.set_size(data.len() as u64);
    header.set_mode(0o644);
    header.set_mtime(0);
    let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
        Vec::new(),
        flate2::Compression::default(),
    ));
    builder.append_data(&mut header, format!("example/{target}"), data.as_bytes())?;
    Ok(builder.into_inner()?.finish()?)
}

/// Serves a fixture plugin release the way `gh release download` would, and
/// passes every attestation except the one named in `refuse_attestation`.
struct FakeGh {
    release: PathBuf,
    refuse_attestation: Option<String>,
    calls: Vec<String>,
}

impl GhHost for FakeGh {
    fn gh(&mut self, args: &[String]) -> DynResult<bool> {
        self.calls.push(args.join(" "));
        match args {
            [release, download, ..] if release == "release" && download == "download" => {
                let out = args
                    .iter()
                    .position(|arg| arg == "-D")
                    .map(|index| PathBuf::from(&args[index + 1]))
                    .ok_or("no -D")?;
                for pair in args.windows(2).filter(|pair| pair[0] == "-p") {
                    let source = self.release.join(&pair[1]);
                    if source.exists() {
                        fs::copy(&source, out.join(&pair[1]))?;
                    }
                }
                Ok(true)
            }
            [attestation, verify, path, ..]
                if attestation == "attestation" && verify == "verify" =>
            {
                Ok(!self
                    .refuse_attestation
                    .as_deref()
                    .is_some_and(|refused| path.ends_with(refused)))
            }
            _ => Ok(false),
        }
    }
}

/// A pin file and a fake plugin release, in a fresh directory.
struct Fixture {
    root: PathBuf,
    release: PathBuf,
    pins: PathBuf,
    archives: BTreeMap<&'static str, Vec<u8>>,
}

impl Fixture {
    fn new() -> DynResult<Self> {
        let root = unique_temp_dir("bundled-plugins-test");
        let release = root.join("release");
        fs::create_dir_all(&release)?;
        let mut archives = BTreeMap::new();
        for target in UNIX {
            let data = archive_bytes(target)?;
            fs::write(release.join(asset(target)), &data)?;
            archives.insert(target, data);
        }
        let fixture = Self {
            pins: root.join("pins.json"),
            root,
            release,
            archives,
        };
        fixture.write_sums(&BTreeMap::new())?;
        fixture.write_pins(&fixture.pinned_digests())?;
        Ok(fixture)
    }

    fn pinned_digests(&self) -> BTreeMap<String, String> {
        self.archives
            .iter()
            .map(|(target, data)| (target.to_string(), sha256_bytes(data)))
            .collect()
    }

    fn write_sums(&self, overrides: &BTreeMap<&str, &str>) -> DynResult<()> {
        let mut lines = String::new();
        for (target, data) in &self.archives {
            let name = asset(target);
            let digest = overrides
                .get(name.as_str())
                .map_or_else(|| sha256_bytes(data), |digest| digest.to_string());
            lines.push_str(&format!("{digest}  {name}\n"));
        }
        Ok(fs::write(self.release.join("SHA256SUMS"), lines)?)
    }

    fn write_pins(&self, archives: &BTreeMap<String, String>) -> DynResult<()> {
        let pins = serde_json::json!({
            "schema_version": 1,
            "plugins": [{
                "name": "example",
                "repository": "Example/example",
                "tag": "v1.2.3",
                "version": "1.2.3",
                "signer_workflow": "Example/example/.github/workflows/release.yml",
                "archives": archives,
                "absent": {"x86_64-pc-windows-msvc": "no Windows build"},
            }],
        });
        Ok(fs::write(&self.pins, serde_json::to_vec(&pins)?)?)
    }

    fn gh(&self, refuse_attestation: Option<&str>) -> FakeGh {
        FakeGh {
            release: self.release.clone(),
            refuse_attestation: refuse_attestation.map(str::to_string),
            calls: Vec::new(),
        }
    }

    fn fetched(&self) -> DynResult<PathBuf> {
        let out = self.root.join("fetched");
        if !out.exists() {
            fetch(&self.pins, &out, &mut self.gh(None))?;
        }
        Ok(out)
    }

    /// The members of a product bundle for `target` after `place`.
    fn placed_members(&self, target: &str) -> DynResult<Vec<(String, Vec<u8>)>> {
        let bundle = self
            .root
            .join(format!("bundle-{target}"))
            .join("mesh-bundle");
        place(&self.pins, &self.fetched()?, target, &bundle)?;
        let mut members = vec![("mesh-bundle/mesh-llm".to_string(), b"host".to_vec())];
        for entry in fs::read_dir(bundle.join("plugins"))? {
            let entry = entry?;
            members.push((
                format!(
                    "mesh-bundle/plugins/{}",
                    entry.file_name().to_string_lossy()
                ),
                fs::read(entry.path())?,
            ));
        }
        Ok(members)
    }

    /// Every product archive a release publishes, plus a non-product asset.
    fn full_release(&self, label: &str) -> DynResult<PathBuf> {
        let artifacts = self.root.join(label);
        for target in UNIX {
            let members = self.placed_members(target)?;
            release_archive(
                &artifacts,
                &format!("mesh-llm-v9.9.9-{target}.tar.gz"),
                &members,
            )?;
            release_archive(&artifacts, &format!("mesh-llm-{target}.tar.gz"), &members)?;
        }
        release_archive(
            &artifacts,
            "mesh-llm-x86_64-unknown-linux-gnu-cuda-12.tar.gz",
            &self.placed_members(LINUX_X86)?,
        )?;
        release_archive(
            &artifacts,
            "mesh-llm-v9.9.9-x86_64-pc-windows-msvc.zip",
            &[("mesh-bundle/mesh-llm.exe".to_string(), b"host".to_vec())],
        )?;
        release_archive(
            &artifacts,
            "mesh-llm-node-sdk-addon-9.9.9-win32-x64.tar.gz",
            &[("addon/x.node".to_string(), b"addon".to_vec())],
        )?;
        Ok(artifacts)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn asset(target: &str) -> String {
    format!("example-1.2.3-{target}.tar.gz")
}

fn release_archive(artifacts: &Path, name: &str, members: &[(String, Vec<u8>)]) -> DynResult<()> {
    fs::create_dir_all(artifacts)?;
    let path = artifacts.join(name);
    let file = fs::File::create(&path)?;
    if name.ends_with(".zip") {
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (member, data) in members {
            zip.start_file(member.as_str(), options)?;
            zip.write_all(data)?;
        }
        zip.finish()?;
        return Ok(());
    }
    let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
        file,
        flate2::Compression::default(),
    ));
    for (member, data) in members {
        let mut header = tar::Header::new_gnu();
        header.set_size(data.len() as u64);
        header.set_mode(0o644);
        builder.append_data(&mut header, member, data.as_slice())?;
    }
    builder.into_inner()?.finish()?;
    Ok(())
}

fn expect_error(result: DynResult<()>, words: &str, label: &str) -> DynResult<()> {
    match result {
        Ok(()) => Err(format!("{label}: expected an error containing `{words}`").into()),
        Err(error) if error.to_string().contains(words) => Ok(()),
        Err(error) => Err(format!("{label}: expected `{words}`, got `{error}`").into()),
    }
}

#[test]
fn the_repository_pin_file_is_valid_and_lists_windows_as_absent() -> DynResult<()> {
    let pins = repo_root()?.join("ci").join("bundled-plugins.json");
    let plugins = load_pins(&pins)?;
    assert!(!plugins.is_empty());
    for plugin in &plugins {
        assert_eq!(plugin.archives.keys().collect::<Vec<_>>(), {
            let mut unix = UNIX.to_vec();
            unix.sort();
            unix
        });
        assert!(plugin.absent.contains_key("x86_64-pc-windows-msvc"));
        assert_eq!(plugin.tag, format!("v{}", plugin.version));
    }
    // The pins load; only the empty directory is refused.
    let empty = unique_temp_dir("bundled-plugins-empty");
    fs::create_dir_all(&empty)?;
    let result = verify(&pins, &empty);
    let _ = fs::remove_dir_all(&empty);
    expect_error(result, "no release archives", "empty artifacts")
}

#[test]
fn the_pin_file_refuses_an_incomplete_or_inconsistent_entry() -> DynResult<()> {
    let fx = Fixture::new()?;
    let mut digests = fx.pinned_digests();
    digests.remove("aarch64-apple-darwin");
    fx.write_pins(&digests)?;
    expect_error(
        load_pins(&fx.pins).map(drop),
        "neither pins nor lists as absent: aarch64-apple-darwin",
        "missing target",
    )?;
    let mut digests = fx.pinned_digests();
    digests.insert(LINUX_X86.to_string(), "A".repeat(64));
    fx.write_pins(&digests)?;
    expect_error(
        load_pins(&fx.pins).map(drop),
        "pins \"x86_64-unknown-linux-gnu\"",
        "uppercase digest",
    )?;
    let mut digests = fx.pinned_digests();
    digests.insert("x86_64-pc-windows-msvc".to_string(), "0".repeat(64));
    fx.write_pins(&digests)?;
    expect_error(
        load_pins(&fx.pins).map(drop),
        "both pinned and absent",
        "pinned and absent",
    )?;
    fs::write(&fx.pins, br#"{"schema_version": 2, "plugins": []}"#)?;
    expect_error(
        load_pins(&fx.pins).map(drop),
        "expected schema_version 1",
        "schema",
    )
}

#[test]
fn fetch_verifies_sums_pin_and_attestation() -> DynResult<()> {
    let fx = Fixture::new()?;
    let out = fx.root.join("fetched");
    let mut gh = fx.gh(None);
    fetch(&fx.pins, &out, &mut gh)?;
    for (target, data) in &fx.archives {
        assert_eq!(&fs::read(out.join("example").join(asset(target)))?, data);
    }
    let calls = gh.calls.join("\n");
    assert!(
        calls.contains("release download v1.2.3 -R Example/example"),
        "{calls}"
    );
    assert_eq!(calls.matches("attestation verify").count(), 3, "{calls}");
    assert!(
        calls.contains("--signer-workflow Example/example/.github/workflows/release.yml"),
        "{calls}"
    );
    assert_eq!(
        calls
            .matches("--source-ref refs/tags/v1.2.3 --deny-self-hosted-runners")
            .count(),
        3,
        "{calls}"
    );
    Ok(())
}

#[test]
fn fetch_refuses_a_sha256sums_line_that_disagrees_with_the_file() -> DynResult<()> {
    let fx = Fixture::new()?;
    let zeros = "0".repeat(64);
    fx.write_sums(&BTreeMap::from([(LINUX_X86_ASSET, zeros.as_str())]))?;
    let result = fetch(&fx.pins, &fx.root.join("fetched"), &mut fx.gh(None));
    expect_error(result, &format!("SHA256SUMS says {zeros}"), "sums")
}

#[test]
fn fetch_refuses_a_release_archive_that_is_not_the_pinned_one() -> DynResult<()> {
    let fx = Fixture::new()?;
    let mut digests = fx.pinned_digests();
    digests.insert(LINUX_X86.to_string(), "1".repeat(64));
    fx.write_pins(&digests)?;
    let result = fetch(&fx.pins, &fx.root.join("fetched"), &mut fx.gh(None));
    expect_error(result, "the release serves", "pin")
}

#[test]
fn fetch_refuses_a_pinned_archive_the_release_does_not_have() -> DynResult<()> {
    let fx = Fixture::new()?;
    fs::remove_file(fx.release.join(LINUX_X86_ASSET))?;
    let result = fetch(&fx.pins, &fx.root.join("fetched"), &mut fx.gh(None));
    expect_error(
        result,
        &format!("v1.2.3 has no {LINUX_X86_ASSET}"),
        "missing",
    )
}

#[test]
fn fetch_refuses_an_attestation_that_does_not_verify() -> DynResult<()> {
    let fx = Fixture::new()?;
    let out = fx.root.join("fetched");
    let result = fetch(&fx.pins, &out, &mut fx.gh(Some(LINUX_X86_ASSET)));
    expect_error(result, "attestation does not verify", "attestation")?;
    assert!(!out.join("example").join(LINUX_X86_ASSET).exists());
    Ok(())
}

#[test]
fn place_bundles_the_pinned_archive_with_a_manifest() -> DynResult<()> {
    let fx = Fixture::new()?;
    let target = "aarch64-unknown-linux-gnu";
    let bundle = fx.root.join("mesh-bundle");
    place(&fx.pins, &fx.fetched()?, target, &bundle)?;
    let placed = bundle.join("plugins").join(asset(target));
    assert_eq!(fs::read(&placed)?, fx.archives[target]);
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(bundle.join("plugins").join("manifest.json"))?)?;
    assert_eq!(manifest["target"], target);
    assert_eq!(manifest["plugins"][0]["archive"], asset(target));
    assert_eq!(manifest["plugins"].as_array().map(Vec::len), Some(1));
    assert_eq!(
        manifest["plugins"][0]["sha256"],
        sha256_bytes(&fx.archives[target])
    );
    assert_eq!(manifest["absent"], serde_json::json!([]));
    Ok(())
}

#[test]
fn place_writes_the_manifest_with_sorted_keys() -> DynResult<()> {
    let fx = Fixture::new()?;
    let bundle = fx.root.join("mesh-bundle");
    place(&fx.pins, &fx.fetched()?, LINUX_X86, &bundle)?;
    let text = fs::read_to_string(bundle.join("plugins").join("manifest.json"))?;
    let keys = text
        .lines()
        .filter_map(|line| line.trim().strip_prefix('"')?.split_once("\":"))
        .map(|(key, _)| key)
        .collect::<Vec<_>>();
    assert_eq!(
        keys,
        [
            "absent",
            "plugins",
            "archive",
            "name",
            "repository",
            "sha256",
            "tag",
            "target",
            "version",
            "schema_version",
            "target"
        ]
    );
    assert!(text.ends_with("}\n"));
    Ok(())
}

#[test]
fn place_for_an_absent_target_bundles_nothing_and_says_why() -> DynResult<()> {
    let fx = Fixture::new()?;
    let bundle = fx.root.join("mesh-bundle");
    place(&fx.pins, &fx.fetched()?, "x86_64-pc-windows-msvc", &bundle)?;
    let names = fs::read_dir(bundle.join("plugins"))?
        .map(|entry| entry.map(|entry| entry.file_name()))
        .collect::<Result<Vec<_>, _>>()?;
    assert_eq!(names, ["manifest.json"]);
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(bundle.join("plugins").join("manifest.json"))?)?;
    assert_eq!(manifest["plugins"], serde_json::json!([]));
    assert_eq!(
        manifest["absent"],
        serde_json::json!([{"name": "example", "version": "1.2.3", "reason": "no Windows build"}])
    );
    Ok(())
}

#[test]
fn place_refuses_a_missing_or_changed_archive() -> DynResult<()> {
    let fx = Fixture::new()?;
    let out = fx.fetched()?;
    let archive = out.join("example").join(LINUX_X86_ASSET);
    fs::write(&archive, b"not the pinned archive")?;
    let result = place(&fx.pins, &out, LINUX_X86, &fx.root.join("b1"));
    expect_error(result, "pinned", "changed")?;
    fs::remove_file(&archive)?;
    let result = place(&fx.pins, &out, LINUX_X86, &fx.root.join("b2"));
    expect_error(result, "run fetch first", "missing")
}

#[test]
fn place_refuses_an_unknown_target() -> DynResult<()> {
    let fx = Fixture::new()?;
    let result = place(
        &fx.pins,
        &fx.fetched()?,
        "riscv64gc-unknown-linux-gnu",
        &fx.root.join("b"),
    );
    expect_error(result, "unknown release target", "target")
}

#[test]
fn product_archive_names_read_as_the_python_pattern_does() {
    let cases = [
        (
            "mesh-llm-v9.9.9-aarch64-apple-darwin.tar.gz",
            Some(("aarch64-apple-darwin", ArchiveKind::TarGz)),
        ),
        (
            "mesh-llm-x86_64-unknown-linux-gnu-cuda-12.tar.gz",
            Some((LINUX_X86, ArchiveKind::TarGz)),
        ),
        (
            "mesh-llm-v0.78.0-x86_64-unknown-linux-gnu-rocm.tar.gz",
            Some((LINUX_X86, ArchiveKind::TarGz)),
        ),
        (
            "mesh-llm-x86_64-pc-windows-msvc.zip",
            Some(("x86_64-pc-windows-msvc", ArchiveKind::Zip)),
        ),
        ("mesh-llm-x86_64-unknown-linux-gnu-CUDA.tar.gz", None),
        ("mesh-llm-x86_64-unknown-linux-gnu-.tar.gz", None),
        ("mesh-llm-vX-x86_64-unknown-linux-gnu.tar.gz", None),
        ("mesh-llm-v9.9.9-riscv64gc-unknown-linux-gnu.tar.gz", None),
        ("mesh-llm-x86_64-unknown-linux-gnu.tar.gz.sha256", None),
    ];
    for (name, expected) in cases {
        assert_eq!(product_archive(name), expected, "{name}");
    }
}

#[test]
fn verify_accepts_a_release_whose_archives_carry_the_pinned_plugins() -> DynResult<()> {
    let fx = Fixture::new()?;
    verify(&fx.pins, &fx.full_release("artifacts")?)
}

#[test]
fn verify_fails_a_release_missing_a_plugin() -> DynResult<()> {
    let fx = Fixture::new()?;
    let host_only = vec![("mesh-bundle/mesh-llm".to_string(), b"host".to_vec())];
    let changed = vec![
        ("mesh-bundle/mesh-llm".to_string(), b"host".to_vec()),
        (
            "mesh-bundle/plugins/example-1.2.3-aarch64-apple-darwin.tar.gz".to_string(),
            b"changed".to_vec(),
        ),
    ];
    let windows_with_plugins = vec![(
        "mesh-bundle/plugins/manifest.json".to_string(),
        b"{}".to_vec(),
    )];
    let cases = [
        (
            "without-plugin",
            "mesh-llm-x86_64-unknown-linux-gnu-cuda-12.tar.gz",
            host_only,
            "does not carry",
        ),
        (
            "changed-plugin",
            "mesh-llm-aarch64-apple-darwin.tar.gz",
            changed,
            "pinned",
        ),
        (
            "windows-plugins",
            "mesh-llm-x86_64-pc-windows-msvc.zip",
            windows_with_plugins,
            "lists as absent",
        ),
    ];
    for (label, name, members, words) in cases {
        let artifacts = fx.full_release(label)?;
        release_archive(&artifacts, name, &members)?;
        expect_error(verify(&fx.pins, &artifacts), words, label)?;
    }
    Ok(())
}

#[test]
fn verify_fails_an_archive_whose_manifest_does_not_list_the_plugin() -> DynResult<()> {
    let fx = Fixture::new()?;
    let artifacts = fx.full_release("artifacts")?;
    let mut members = fx.placed_members(LINUX_X86)?;
    for (name, data) in &mut members {
        if name.ends_with("manifest.json") {
            *data = br#"{"plugins": []}"#.to_vec();
        }
    }
    release_archive(
        &artifacts,
        "mesh-llm-x86_64-unknown-linux-gnu.tar.gz",
        &members,
    )?;
    expect_error(
        verify(&fx.pins, &artifacts),
        "manifest.json does not list",
        "manifest",
    )
}

#[test]
fn verify_fails_a_product_archive_it_cannot_read_a_target_from() -> DynResult<()> {
    let fx = Fixture::new()?;
    let artifacts = fx.full_release("artifacts")?;
    release_archive(
        &artifacts,
        "mesh-llm-v9.9.9-riscv64gc-unknown-linux-gnu.tar.gz",
        &[("mesh-bundle/mesh-llm".to_string(), b"host".to_vec())],
    )?;
    expect_error(
        verify(&fx.pins, &artifacts),
        "target is not recognized",
        "target",
    )
}

#[test]
fn verify_fails_when_a_pinned_target_has_no_release_archive() -> DynResult<()> {
    let fx = Fixture::new()?;
    let artifacts = fx.full_release("artifacts")?;
    for entry in fs::read_dir(&artifacts)? {
        let path = entry?.path();
        if path.to_string_lossy().contains("aarch64-apple-darwin") {
            fs::remove_file(path)?;
        }
    }
    expect_error(
        verify(&fx.pins, &artifacts),
        "no release archive for aarch64-apple-darwin",
        "unseen",
    )
}

/// `bundle_plugins` runs nothing without a plugin directory, and with one runs
/// `place` for the base target of a GPU flavour. A stub `cargo` records the call.
#[cfg(unix)]
#[test]
fn package_release_bundles_plugins_only_when_given_them() -> DynResult<()> {
    use std::os::unix::fs::PermissionsExt;
    let root = repo_root()?;
    let fx = Fixture::new()?;
    let stub_dir = fx.root.join("stub-bin");
    fs::create_dir_all(&stub_dir)?;
    let log = fx.root.join("cargo-calls.log");
    let stub = stub_dir.join("cargo");
    fs::write(
        &stub,
        format!("#!/bin/sh\nprintf '%s\\n' \"$*\" >> '{}'\n", log.display()),
    )?;
    fs::set_permissions(&stub, fs::Permissions::from_mode(0o755))?;
    let path = format!(
        "{}:{}",
        stub_dir.display(),
        std::env::var("PATH").unwrap_or_default()
    );
    for plugins_dir in [None, Some(fx.root.join("fetched"))] {
        let bundle = fx.root.join("mesh-bundle");
        fs::create_dir_all(&bundle)?;
        let mut bash = std::process::Command::new("bash");
        bash.current_dir(&root)
            .arg("-c")
            .arg("source \"$1\"; resolve_release_target; bundle_plugins \"$2\"")
            .arg("bash")
            .arg(root.join("mesh/scripts/package-release.sh"))
            .arg(&bundle)
            .env("PATH", &path)
            .env("MESH_RELEASE_OS", "Linux")
            .env("MESH_RELEASE_ARCH", "x86_64")
            .env("MESH_RELEASE_FLAVOR", "cuda")
            .env("MESH_CUDA_VERSION", "12.9.2")
            .env("MESH_LLM_BUNDLED_PLUGINS_PINS", &fx.pins)
            .env_remove("MESH_LLM_BUNDLED_PLUGINS_DIR");
        if let Some(dir) = &plugins_dir {
            bash.env("MESH_LLM_BUNDLED_PLUGINS_DIR", dir);
        }
        let output = bash.output()?;
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let calls = fs::read_to_string(&log).unwrap_or_default();
        match &plugins_dir {
            None => assert_eq!(calls, ""),
            Some(dir) => assert_eq!(
                calls.trim_end(),
                format!(
                    "run -q --manifest-path {}/Cargo.toml -p xtask -- release bundled-plugins place --pins {} --from {} --target {LINUX_X86} --bundle {}",
                    root.display(),
                    fx.pins.display(),
                    dir.display(),
                    bundle.display()
                )
            ),
        }
    }
    Ok(())
}

#[test]
fn package_release_bundles_before_writing_either_archive() -> DynResult<()> {
    let script = fs::read_to_string(repo_root()?.join("mesh/scripts/package-release.sh"))?;
    let main = &script[script.find("\nmain() {").ok_or("no main()")?..];
    let call = main
        .find("    bundle_plugins \"$bundle_dir\"")
        .ok_or("no bundle_plugins call")?;
    for archive in [
        "create_archive \"$bundle_dir\" \"$output_dir/$versioned_asset\"",
        "create_archive \"$bundle_dir\" \"$output_dir/$STABLE_ASSET\"",
    ] {
        assert!(call < main.find(archive).ok_or(archive)?, "{archive}");
    }
    Ok(())
}

#[test]
fn release_workflow_bundles_into_every_unix_product_and_verifies_before_publishing() -> DynResult<()>
{
    let workflow = fs::read_to_string(repo_root()?.join(".github/workflows/release.yml"))?;
    let job = |name: &str| workflow_job_section(&workflow, name).ok_or(format!("no job {name}"));
    let fetch_job = job("bundled_plugins")?;
    assert!(fetch_job.contains("      contents: read\n      attestations: read\n"));
    assert!(fetch_job.contains(
        "run: cargo run -q -p xtask -- release bundled-plugins fetch --out bundled-plugins\n"
    ));
    for name in [
        "compose_cpu_products",
        "compose_linux_arm64_cpu",
        "compose_linux_aarch64_cuda",
        "compose_linux_cuda",
        "compose_linux_rocm",
        "compose_linux_vulkan",
    ] {
        let section = job(name)?;
        let needs = section
            .lines()
            .find(|line| line.trim_start().starts_with("needs:"));
        assert!(
            needs.is_some_and(|line| line.contains("bundled_plugins")),
            "{name}"
        );
        assert_eq!(
            section.matches("scripts/package-release.sh").count(),
            1,
            "{name}"
        );
        assert!(
            section
                .contains("MESH_LLM_BUNDLED_PLUGINS_DIR: ${{ github.workspace }}/bundled-plugins"),
            "{name}"
        );
    }
    for name in ["compose_windows_cpu", "compose_windows_gpu"] {
        assert!(
            !job(name)?.contains("bundled_plugins"),
            "{name}: Windows is listed as absent"
        );
    }
    let publish = job("publish")?;
    let verify_at = publish
        .find("run: cargo run -q -p xtask -- release bundled-plugins verify release-artifacts\n")
        .ok_or("publish does not verify the bundled plugins")?;
    let publish_at = publish
        .find("- name: Publish GitHub release\n")
        .ok_or("no Publish GitHub release step")?;
    assert!(verify_at < publish_at);
    Ok(())
}
