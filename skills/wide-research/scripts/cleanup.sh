#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

require_bin jq
require_bin tmux

usage() {
  cat <<'USAGE'
Usage: cleanup.sh <project-path> [--force]

Kill all tmux sessions for a wide-research project.

Options:
  --force  Skip confirmation prompt
USAGE
  exit 1
}

PROJECT_DIR=""
FORCE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE=true; shift ;;
    -h|--help) usage ;;
    *)
      if [[ -z "$PROJECT_DIR" ]]; then
        PROJECT_DIR="$1"; shift
      else
        echo "Error: unexpected argument: $1" >&2
        usage
      fi
      ;;
  esac
done

if [[ -z "$PROJECT_DIR" ]]; then
  echo "Error: project path is required." >&2
  usage
fi

SPECS_FILE="${PROJECT_DIR}/specs.json"
if [[ ! -f "$SPECS_FILE" ]]; then
  echo "Error: specs.json not found in ${PROJECT_DIR}" >&2
  exit 1
fi

PROJECT_NAME=$(jq -r '.project' "$SPECS_FILE")
ANGLE_COUNT=$(jq '.angles | length' "$SPECS_FILE")

# Find active sessions
ACTIVE_SESSIONS=()
for i in $(seq 0 $((ANGLE_COUNT - 1))); do
  LABEL=$(jq -r ".angles[$i].label" "$SPECS_FILE")
  SESSION_NAME="${PROJECT_NAME}-${LABEL}"
  if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    ACTIVE_SESSIONS+=("$SESSION_NAME")
  fi
done

if [[ ${#ACTIVE_SESSIONS[@]} -eq 0 ]]; then
  echo "No active tmux sessions found for project: ${PROJECT_NAME}"
  exit 0
fi

echo "Found ${#ACTIVE_SESSIONS[@]} active sessions for ${PROJECT_NAME}:"
for s in "${ACTIVE_SESSIONS[@]}"; do
  echo "  ${s}"
done

if ! $FORCE; then
  echo ""
  read -rp "Kill all ${#ACTIVE_SESSIONS[@]} sessions? [y/N] " confirm
  if [[ "$confirm" != [yY] ]]; then
    echo "Aborted."
    exit 0
  fi
fi

for s in "${ACTIVE_SESSIONS[@]}"; do
  tmux kill-session -t "$s" 2>/dev/null || true
  echo "  Killed: ${s}"
done

echo ""
echo "Cleanup complete."
