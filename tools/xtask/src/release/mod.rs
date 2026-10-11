//! `release`: release-time tooling ported from `scripts/*.py`.
//!
//! - `bundled-plugins` ports `scripts/bundled-plugins.py`; the release workflow
//!   and `package-release.sh` call this one.

pub(crate) mod bundled_plugins;
