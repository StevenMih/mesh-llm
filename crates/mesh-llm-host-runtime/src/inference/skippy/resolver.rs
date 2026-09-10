mod effective_settings_digest;
mod request_defaults;
mod resolution;
mod speculative;
mod support;
mod translation;
mod types;

#[cfg(test)]
mod test_support;

#[cfg(test)]
mod native_mtp_tests;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod speculative_tests;

#[cfg(test)]
mod exact_head_tests;

#[cfg(test)]
mod hardware_tests;

pub(crate) use effective_settings_digest::effective_settings_digest_for;
#[cfg(test)]
pub(crate) use resolution::resolve_skippy_config;
pub(crate) use resolution::resolve_skippy_config_for_selector;
pub(crate) use types::{
    ResolvedEmbeddedOpenAiArgs, ResolvedSkippyConfig, SkippyConfigResolveRequest,
};
