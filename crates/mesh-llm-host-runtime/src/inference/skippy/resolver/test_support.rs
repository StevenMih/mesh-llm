use std::io::Write;
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;

use super::resolution::resolve_skippy_config;
use super::types::{ResolvedSkippyConfig, SkippyConfigResolveRequest};
use crate::inference::skippy::SkippyPackageIdentity;
use crate::plugin::MeshConfig;

pub(super) fn push_gguf_string(bytes: &mut Vec<u8>, value: &str) {
    bytes.extend_from_slice(&(value.len() as u64).to_le_bytes());
    bytes.extend_from_slice(value.as_bytes());
}

pub(super) fn push_u32_kv(bytes: &mut Vec<u8>, key: &str, value: u32) {
    push_gguf_string(bytes, key);
    bytes.extend_from_slice(&4u32.to_le_bytes());
    bytes.extend_from_slice(&value.to_le_bytes());
}

pub(super) fn push_string_kv(bytes: &mut Vec<u8>, key: &str, value: &str) {
    push_gguf_string(bytes, key);
    bytes.extend_from_slice(&8u32.to_le_bytes());
    push_gguf_string(bytes, value);
}

pub(super) fn temp_model_file() -> NamedTempFile {
    temp_model_file_with_tensor_names(&[], None)
}

pub(super) fn temp_model_file_with_architecture(architecture: &str) -> NamedTempFile {
    temp_model_file_with_architecture_and_tensor_names(architecture, &[], None)
}

pub(super) fn temp_model_file_with_tensor_names(
    tensor_names: &[&str],
    nextn_predict_layers: Option<u32>,
) -> NamedTempFile {
    temp_model_file_with_architecture_and_tensor_names("llama", tensor_names, nextn_predict_layers)
}

fn temp_model_file_with_architecture_and_tensor_names(
    architecture: &str,
    tensor_names: &[&str],
    nextn_predict_layers: Option<u32>,
) -> NamedTempFile {
    let mut file = NamedTempFile::new().expect("temp model file");
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"GGUF");
    bytes.extend_from_slice(&2u32.to_le_bytes());
    bytes.extend_from_slice(&(tensor_names.len() as i64).to_le_bytes());
    bytes.extend_from_slice(&(8 + i64::from(nextn_predict_layers.is_some())).to_le_bytes());
    push_string_kv(&mut bytes, "general.architecture", architecture);
    push_string_kv(&mut bytes, "tokenizer.ggml.model", "gpt2");
    push_u32_kv(&mut bytes, "llama.context_length", 8192);
    push_u32_kv(&mut bytes, "llama.embedding_length", 4096);
    push_u32_kv(&mut bytes, "llama.block_count", 24);
    push_u32_kv(&mut bytes, "llama.attention.head_count", 32);
    push_u32_kv(&mut bytes, "llama.attention.head_count_kv", 8);
    push_u32_kv(&mut bytes, "llama.attention.key_length", 128);
    if let Some(value) = nextn_predict_layers {
        push_u32_kv(&mut bytes, "llama.nextn_predict_layers", value);
    }
    for name in tensor_names {
        push_gguf_string(&mut bytes, name);
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&1u64.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&0u64.to_le_bytes());
    }
    file.write_all(&bytes).expect("write fake gguf");
    file.flush().expect("flush fake gguf");
    file
}

pub(super) fn parse_config(toml: &str) -> MeshConfig {
    toml::from_str(toml).expect("config should parse")
}

pub(super) fn toml_path(path: &Path) -> String {
    toml::Value::String(path.to_string_lossy().into_owned()).to_string()
}

pub(super) fn fake_package_identity(layer_count: u32) -> SkippyPackageIdentity {
    SkippyPackageIdentity {
        package_ref: "gguf:///models/qwen.gguf".to_string(),
        manifest_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
            .to_string(),
        source_model_path: PathBuf::from("/models/qwen.gguf"),
        source_model_sha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
            .to_string(),
        source_model_bytes: 1234,
        source_files: Vec::new(),
        layer_weight_bytes: Vec::new(),
        layer_count,
        activation_width: 4096,
        tensor_count: 100,
        generation: None,
    }
}

pub(super) fn fake_hf_package_identity(layer_count: u32) -> SkippyPackageIdentity {
    let mut package = fake_package_identity(layer_count);
    package.package_ref = "hf://meshllm/Qwen3-8B-Q4_K_M-layers".to_string();
    package
}

/// A fully resolved config with concrete, non-default values for every field
/// the `effective_settings_digest` covers -- so a test flipping one field
/// starts from a state where "changed" and "unchanged" are unambiguous
/// (e.g. flash attention starts `Enabled`, not the `Auto` default, so a test
/// can flip it to a different concrete variant).
pub(super) fn sample_resolved_skippy_config() -> ResolvedSkippyConfig {
    let mesh_config = parse_config(
        r#"
[defaults.model_fit]
ctx_size = 8192
batch = 512
ubatch = 128
cache_type_k = "f16"
cache_type_v = "f16"
flash_attention = "enabled"

[defaults.hardware]
gpu_layers = 32

[defaults.speculative]
mode = "off"

[defaults.request_defaults]
temperature = 0.7
top_p = 0.9
top_k = 40
min_p = 0.05
presence_penalty = 0.1
frequency_penalty = 0.1
repeat_penalty = 1.1
repeat_last_n = 64
max_tokens = 128

[[models]]
model = "test/sample-model:Q4_K_M"
"#,
    );
    let model_file = temp_model_file();
    resolve_skippy_config(SkippyConfigResolveRequest {
        mesh_config: &mesh_config,
        model_id: "test/sample-model:Q4_K_M",
        model_path: model_file.path(),
        model_bytes: 8 * 1024 * 1024 * 1024,
        allocatable_memory_bytes: Some(16 * 1024 * 1024 * 1024),
        request_defaults: None,
        package_generation: None,
        compact_meta: None,
    })
    .expect("sample resolved skippy config should resolve")
}
