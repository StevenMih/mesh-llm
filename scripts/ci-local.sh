#!/usr/bin/env bash
# scripts/ci-local.sh — local approximation of
# .github/workflows/ci-quality-slice.yml, run before pushing to any
# upstream-bound branch. One line per gate, PASS/FAIL/SKIP, non-zero exit on
# any FAIL — read the output to know which upstream CI job would go red
# before spending one of their maintainer-approval clicks on a run we could
# have caught locally.
#
# APPROXIMATIONS — read before trusting a green run as proof of a CI-green:
#
#   - rust_clippy: upstream runs `cargo clippy -p <crate> [-p <crate> ...]
#     --all-targets -- -D warnings` in per-batch matrix jobs on
#     ghcr.io/mesh-llm/mesh-llm-cuda-runner. This script instead runs
#     `cargo clippy --workspace --all-targets -- -D warnings` in one pass.
#     Same lints, same -D warnings, but a different job boundary: any lint
#     clippy reports is still caught, but we cannot reproduce a failure that
#     depended on which OTHER crates were or weren't compiled in the same
#     clippy invocation (feature-unification effects across a batch). We
#     have not observed that class of difference in practice.
#     The `--workspace` flag is NOT optional and must not be dropped even
#     though it looks redundant next to `--all-targets`: this repo's root
#     Cargo.toml sets `default-members = ["crates/mesh-llm",
#     "crates/mesh-llm-plugin"]`, so bare `cargo clippy --all-targets`
#     silently limits `--all-targets` expansion (tests/benches/examples) to
#     just those two crates — every other workspace crate is still built as
#     a plain lib dependency (so lint errors in ITS library code still
#     surface), but its OWN test/bench/example targets are never compiled or
#     linted. That is precisely the shape of the bug #1668 shipped:
#     `unnecessary_fallible_conversions` lived in a `#[cfg(test)]` module of
#     `mesh-llm-host-runtime`, a non-default-member crate. Verified by
#     reproducing #1668's pre-fix head (58f9ec85d) both ways: bare
#     `--all-targets` reports clean; `--workspace --all-targets` (and
#     `-p mesh-llm-host-runtime --all-targets`, upstream's actual scope)
#     both catch it.
#   - Runner image: this script builds and runs docker/Dockerfile.ci-local
#     (rust:1-bookworm + build tools), not the pinned mesh-llm-cuda-runner
#     image, which is private and CUDA-oriented — not something a local gate
#     script should be pulling. No CUDA toolchain, no GPU. A difference
#     traceable to the runner image itself (e.g. a GPU-only code path, or a
#     toolchain/glibc skew) will not be caught here.
#   - No Windows leg. CI's full platform matrix is not reproduced; this
#     script only proves the Linux quality-slice jobs (quality_contracts,
#     rust_fmt, rust_clippy, cli_docs_sync) — not ci-runner-contract-slice,
#     ci-ui-artifact-slice, ci-web-slice, or any Windows/macOS leg.
#   - cli_docs_sync: upstream computes `cli_surface_changed` from its own
#     path-based CI planner (scripts/plan-ci.py + ci/ownership.yml, which
#     resolves a full base-sha-aware routing plan). This script does not
#     invoke that planner. It instead diffs the working tree against --base
#     (default origin/main) against exactly the four paths ci/ownership.yml
#     lists under its "cli" domain
#     (crates/mesh-llm-cli/src/{parser,models,runtime,benchmark}.rs) — a
#     narrower signal than the planner's full domain graph, which can also
#     route other changes into this gate. A false negative here means a
#     CLI-surface change ships without a local check; CI is still
#     authoritative. Override with --with-cli-docs / --skip-cli-docs.
#   - Node/just pinning: see docker/Dockerfile.ci-local's header — `just`
#     tracks latest-release rather than CI's action-pinned version, and
#     Node tracks latest-24.x rather than the exact 24.20.0 CI pins.
#   - quality_contracts' xtask/cargo-tree checks need a workspace that
#     resolves and builds xtask; if that fails, the gate reports FAIL rather
#     than a separate "couldn't even check" state.
#
# Usage: scripts/ci-local.sh [--fast] [--base <ref>] [--with-cli-docs|--skip-cli-docs] [--rebuild-image]
#   --fast            Skip Docker; run every gate natively on the host OS.
#                      For the inner dev loop only. CI runs Linux in a
#                      container, so a --fast green is NOT proof of a
#                      CI-green — the pre-push run must be the default
#                      (Docker/Linux) mode.
#   --base <ref>       Ref to diff against for the cli_docs_sync heuristic.
#                       Default: origin/main.
#   --with-cli-docs    Force-run cli_docs_sync regardless of the heuristic.
#   --skip-cli-docs    Force-skip cli_docs_sync regardless of the heuristic.
#   --rebuild-image    Force `docker build --no-cache` before running gates.
#
# Do NOT extend this script to install anything system-wide on the host to
# make a gate pass — a missing host tool (docker, in --fast mode: just,
# actionlint, ...) is reported as a blocker (FAIL/SKIP with a reason), never
# silently worked around.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FAST=0
BASE_REF="origin/main"
CLI_DOCS_MODE="auto" # auto | force | skip
REBUILD_IMAGE=0
IMAGE_TAG="mesh-llm-ci-local:latest"
DOCKERFILE="docker/Dockerfile.ci-local"
CONTAINER_NAME="mesh-llm-ci-local-$$"

usage() {
  sed -n '/^# Usage:/,/^# Do NOT/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fast) FAST=1; shift ;;
    --base) BASE_REF="${2:?--base requires a ref}"; shift 2 ;;
    --with-cli-docs) CLI_DOCS_MODE="force"; shift ;;
    --skip-cli-docs) CLI_DOCS_MODE="skip"; shift ;;
    --rebuild-image) REBUILD_IMAGE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ci-local.sh: unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

GATE_LINES=()
OVERALL=0

record() { # record <job> <gate> <status> [<detail>]
  local job="$1" gate="$2" status="$3" detail="${4:-}"
  local line
  line="$(printf '[%-17s] %-28s %-5s' "$job" "$gate" "$status")"
  if [[ -n "$detail" ]]; then
    line="${line} ${detail}"
  fi
  GATE_LINES+=("$line")
  echo "$line"
  if [[ "$status" == "FAIL" ]]; then
    OVERALL=1
  fi
}

# cli_surface_changed(): reuse ci/ownership.yml's own "cli" domain patterns
# rather than inventing a separate heuristic. See header note above.
CLI_SURFACE_PATTERNS=(
  'crates/mesh-llm-cli/src/parser.rs'
  'crates/mesh-llm-cli/src/models.rs'
  'crates/mesh-llm-cli/src/runtime.rs'
  'crates/mesh-llm-cli/src/benchmark.rs'
)

cli_surface_changed() {
  if ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null; then
    echo "unknown" # base ref not resolvable; caller decides
    return
  fi
  local changed
  changed="$(git diff --name-only "$BASE_REF"...HEAD -- . 2>/dev/null || true)"
  local pat
  for pat in "${CLI_SURFACE_PATTERNS[@]}"; do
    if grep -qxF "$pat" <<<"$changed"; then
      echo "yes"
      return
    fi
  done
  echo "no"
}

should_run_cli_docs() {
  case "$CLI_DOCS_MODE" in
    force) return 0 ;;
    skip) return 1 ;;
    auto)
      local v
      v="$(cli_surface_changed)"
      [[ "$v" == "yes" ]]
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Gate commands. Each is a single shell command string, run with the repo
# root as cwd, identically whether invoked on the host (--fast) or inside
# the container (default). Keep these as the single source of truth so the
# two modes cannot silently diverge.
# ---------------------------------------------------------------------------

CMD_ACTIONLINT='actionlint -config-file .github/actionlint.yaml'
CMD_PY_CONTRACTS='(python3 -m pip install --disable-pip-version-check --no-input --break-system-packages -r ci/requirements-ci-python.txt 2>/dev/null || python3 -m pip install --disable-pip-version-check --no-input -r ci/requirements-ci-python.txt) && python3 -m unittest discover -s scripts/tests -p "test_*.py"'
CMD_CI_CRATE_LISTS='cargo run -p xtask -- repo-consistency ci-crate-lists'
CMD_PUBLISH_CRATES='cargo run -p xtask -- repo-consistency publish-crates'
CMD_RELEASE_TARGETS_AND_DEPS='cargo run -p xtask -- repo-consistency release-targets && cargo tree -p mesh-llm-client --prefix=none --no-dedupe > /tmp/mesh-client-deps.txt && ! grep -E "^[[:space:]│├└─-]*(keyring|rpassword|hf-hub|dirs|clap|include_dir|rmcp|keyring-core)([[:space:]]|$)" /tmp/mesh-client-deps.txt'
CMD_NO_CONSOLE_PRINT='just no-console-print'
CMD_RUST_FMT='cargo fmt --all -- --check'
CMD_RUST_CLIPPY='cargo clippy --workspace --all-targets -- -D warnings'
CMD_CLI_DOCS='cd website && npm ci && npm run check:cli'

run_gate_host() { # run_gate_host <job> <gate> <cmd>
  local job="$1" gate="$2" cmd="$3"
  local out status
  out="$(bash -o pipefail -c "$cmd" 2>&1)"
  status=$?
  if [[ $status -eq 0 ]]; then
    record "$job" "$gate" PASS
  else
    record "$job" "$gate" FAIL "(exit $status; see log)"
    printf '\n----- %s: %s -----\n%s\n----- end %s -----\n\n' "$job" "$gate" "$out" "$gate" >&2
  fi
}

run_gate_docker() { # run_gate_docker <job> <gate> <cmd>
  local job="$1" gate="$2" cmd="$3"
  local out status
  out="$(docker exec "$CONTAINER_NAME" bash -o pipefail -c "$cmd" 2>&1)"
  status=$?
  if [[ $status -eq 0 ]]; then
    record "$job" "$gate" PASS
  else
    record "$job" "$gate" FAIL "(exit $status; see log)"
    printf '\n----- %s: %s -----\n%s\n----- end %s -----\n\n' "$job" "$gate" "$out" "$gate" >&2
  fi
}

skip_tool_missing() { # skip_tool_missing <job> <gate> <tool>
  record "$1" "$2" FAIL "(tool missing: $3 — not installed; see Do-NOT in the task and this script's header)"
}

run_all_gates() {
  local runner="$1" # run_gate_host | run_gate_docker

  if [[ "$runner" == run_gate_host ]]; then
    command -v actionlint >/dev/null 2>&1 || { skip_tool_missing quality_contracts actionlint actionlint; }
    command -v actionlint >/dev/null 2>&1 && "$runner" quality_contracts actionlint "$CMD_ACTIONLINT"
  else
    "$runner" quality_contracts actionlint "$CMD_ACTIONLINT"
  fi

  "$runner" quality_contracts python_contract_tests "$CMD_PY_CONTRACTS"
  "$runner" quality_contracts xtask_ci_crate_lists "$CMD_CI_CRATE_LISTS"
  "$runner" quality_contracts xtask_publish_crates "$CMD_PUBLISH_CRATES"
  "$runner" quality_contracts release_targets_and_deps "$CMD_RELEASE_TARGETS_AND_DEPS"

  if [[ "$runner" == run_gate_host ]]; then
    if command -v just >/dev/null 2>&1; then
      "$runner" quality_contracts no_console_print "$CMD_NO_CONSOLE_PRINT"
    else
      skip_tool_missing quality_contracts no_console_print just
    fi
  else
    "$runner" quality_contracts no_console_print "$CMD_NO_CONSOLE_PRINT"
  fi

  "$runner" rust_fmt cargo_fmt_check "$CMD_RUST_FMT"
  "$runner" rust_clippy cargo_clippy_workspace "$CMD_RUST_CLIPPY"

  if should_run_cli_docs; then
    if [[ "$runner" == run_gate_host ]]; then
      if command -v just >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
        "$runner" cli_docs_sync cli_inventory_check "$CMD_CLI_DOCS"
      else
        skip_tool_missing cli_docs_sync cli_inventory_check "just/npm"
      fi
    else
      "$runner" cli_docs_sync cli_inventory_check "$CMD_CLI_DOCS"
    fi
  else
    record cli_docs_sync cli_inventory_check SKIP "(heuristic: no cli-domain file under ${CLI_SURFACE_PATTERNS[*]} changed vs $BASE_REF; override with --with-cli-docs)"
  fi
}

cleanup_docker() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}

main() {
  echo "ci-local.sh: mode=$([[ $FAST -eq 1 ]] && echo fast/native || echo docker/linux) base=$BASE_REF"
  echo

  if [[ $FAST -eq 1 ]]; then
    run_all_gates run_gate_host
  else
    if ! command -v docker >/dev/null 2>&1; then
      echo "ci-local.sh: BLOCKER — docker is not installed/available on this host." >&2
      echo "This is not something ci-local.sh will install for you (no system-wide installs)." >&2
      echo "Report this as a blocker, or re-run with --fast for a native (non-CI-scope) check." >&2
      exit 3
    fi
    if ! docker info >/dev/null 2>&1; then
      echo "ci-local.sh: BLOCKER — docker CLI is present but the daemon is not reachable (is Docker running?)." >&2
      exit 3
    fi

    trap cleanup_docker EXIT

    if [[ $REBUILD_IMAGE -eq 1 ]] || ! docker image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
      echo "ci-local.sh: building $IMAGE_TAG from $DOCKERFILE ..."
      if ! docker build $([[ $REBUILD_IMAGE -eq 1 ]] && echo --no-cache) -f "$DOCKERFILE" -t "$IMAGE_TAG" docker/; then
        echo "ci-local.sh: BLOCKER — docker build of $DOCKERFILE failed; see output above." >&2
        exit 3
      fi
    fi

    # Some quality_contracts checks shell out to `git` (e.g.
    # scripts/tests/test_plan_ci.py's `git ls-files`). When REPO_ROOT is a
    # `git worktree add` checkout, its .git is a file pointing at an
    # absolute host path outside REPO_ROOT (the common repo's
    # .git/worktrees/<name>); bind-mount that common dir read-only at the
    # same absolute path so the pointer resolves inside the container too.
    GIT_MOUNT_ARGS=()
    if [[ -f "$REPO_ROOT/.git" ]]; then
      GIT_COMMON_DIR="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
      if [[ -n "$GIT_COMMON_DIR" ]]; then
        GIT_COMMON_ROOT="$(cd "$GIT_COMMON_DIR/.." && pwd)"
        GIT_MOUNT_ARGS=(-v "$GIT_COMMON_ROOT":"$GIT_COMMON_ROOT":ro)
      fi
    fi

    # Persist the cargo registry/git cache in a named volume across runs.
    # Without this, every gate that touches the dependency graph (cargo
    # metadata, clippy, ...) re-fetches the crates.io index in a fresh
    # container, which can be slow enough under load to trip a 60s
    # subprocess timeout in scripts/tests (observed: affected-crates.sh via
    # test_cli_inventory_contract.py). target/ does not need this — it
    # already lives under /workspace and survives because REPO_ROOT persists
    # on the host.
    docker volume create mesh-llm-ci-local-cargo-registry >/dev/null

    docker run -d --name "$CONTAINER_NAME" \
      -v "$REPO_ROOT":/workspace -w /workspace \
      -v mesh-llm-ci-local-cargo-registry:/usr/local/cargo/registry \
      "${GIT_MOUNT_ARGS[@]}" \
      "$IMAGE_TAG" sleep infinity >/dev/null

    run_all_gates run_gate_docker
  fi

  echo
  if [[ $OVERALL -eq 0 ]]; then
    echo "ci-local.sh: ALL GATES PASS (or honestly SKIPped — see above)."
  else
    echo "ci-local.sh: AT LEAST ONE GATE FAILED — see per-gate detail above and the logs on stderr."
  fi
  exit $OVERALL
}

main
