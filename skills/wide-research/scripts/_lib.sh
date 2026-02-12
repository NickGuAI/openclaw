#!/usr/bin/env bash
set -euo pipefail

_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
_SKILL_DIR="$(cd -- "${_SCRIPT_DIR}/.." && pwd)"
_ENV_FILE="${_SKILL_DIR}/.env"

STUB_MARKER="_Key findings will appear here_"
MAX_WORKERS="${MAX_WORKERS:-10}"
POLL_INTERVAL="${POLL_INTERVAL:-10}"

require_bin() {
  local bin="$1"
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "Missing required binary: ${bin}" >&2
    exit 1
  fi
}

load_env_var_from_file() {
  local key="$1"
  local value=""

  if [[ ! -f "${_ENV_FILE}" ]]; then
    return
  fi

  value="$(sed -nE "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*(.*)[[:space:]]*$/\1/p" "${_ENV_FILE}" | head -n 1)"
  if [[ -z "${value}" ]]; then
    return
  fi

  # Strip quotes
  if [[ "${value}" =~ ^\".*\"$ ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "${value}" =~ ^\'.*\'$ ]]; then
    value="${value:1:${#value}-2}"
  fi

  export "${key}=${value}"
}

load_env() {
  if [[ -z "${REPORT_PATH:-}" ]]; then
    load_env_var_from_file "REPORT_PATH"
  fi

  # Expand ~ in REPORT_PATH
  REPORT_PATH="${REPORT_PATH:-$HOME/.ocreports}"
  REPORT_PATH="${REPORT_PATH/#\~/$HOME}"
  export REPORT_PATH
}
