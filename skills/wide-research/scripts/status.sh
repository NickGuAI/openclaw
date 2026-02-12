#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

require_bin jq

usage() {
  cat <<'USAGE'
Usage: status.sh <project-path>

Show progress for a wide-research project.
USAGE
  exit 1
}

PROJECT_DIR="${1:-}"
if [[ -z "$PROJECT_DIR" ]]; then
  echo "Error: project path is required." >&2
  usage
fi

SPECS_FILE="${PROJECT_DIR}/specs.json"
if [[ ! -f "$SPECS_FILE" ]]; then
  echo "Error: specs.json not found in ${PROJECT_DIR}" >&2
  exit 1
fi

LOG_DIR="${PROJECT_DIR}/.logs"
PROJECT_NAME=$(jq -r '.project' "$SPECS_FILE")
ANGLE_COUNT=$(jq '.angles | length' "$SPECS_FILE")

echo "Wide Research Status: ${PROJECT_NAME}"
echo "======================================"
echo ""

running=0
complete=0
incomplete=0
failed=0

for i in $(seq 0 $((ANGLE_COUNT - 1))); do
  LABEL=$(jq -r ".angles[$i].label" "$SPECS_FILE")
  TITLE=$(jq -r ".angles[$i].title" "$SPECS_FILE")
  REPORT_PATH_I=$(jq -r ".angles[$i].report_path" "$SPECS_FILE")
  SESSION_NAME="${PROJECT_NAME}-${LABEL}"
  LOG_FILE="${LOG_DIR}/${LABEL}.log"

  if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    status="running"
    running=$((running + 1))
  elif [[ -f "$REPORT_PATH_I" ]] && ! grep -q "$STUB_MARKER" "$REPORT_PATH_I"; then
    status="complete"
    complete=$((complete + 1))
  elif [[ -f "$LOG_FILE" ]] && grep -qi 'error\|fatal\|panic' "$LOG_FILE" 2>/dev/null && ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    status="failed"
    failed=$((failed + 1))
  else
    status="incomplete"
    incomplete=$((incomplete + 1))
  fi

  printf "  %-6s  %-10s  %s\n" "$LABEL" "$status" "$TITLE"
done

echo ""
echo "Summary: ${running} running | ${complete} complete | ${incomplete} incomplete | ${failed} failed"
echo "Total: ${ANGLE_COUNT}"
