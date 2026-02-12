#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

require_bin jq
require_bin tmux
require_bin claude

usage() {
  cat <<'USAGE'
Usage: run.sh <project-path> [--fix-only] [--dry-run] [--max-workers N]

Spawn Claude agents in tmux sessions with a worker pool.

Options:
  --fix-only       Only re-run reports that still contain the stub marker
  --dry-run        Show what would happen without launching
  --max-workers N  Max concurrent tmux sessions (default: 10, or $MAX_WORKERS)
USAGE
  exit 1
}

PROJECT_DIR=""
FIX_ONLY=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fix-only) FIX_ONLY=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --max-workers) MAX_WORKERS="$2"; shift 2 ;;
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

LOG_DIR="${PROJECT_DIR}/.logs"
mkdir -p "$LOG_DIR"

PROJECT_NAME=$(jq -r '.project' "$SPECS_FILE")
ANGLE_COUNT=$(jq '.angles | length' "$SPECS_FILE")

# Build queue of angle indices to process
QUEUE=()
for i in $(seq 0 $((ANGLE_COUNT - 1))); do
  LABEL=$(jq -r ".angles[$i].label" "$SPECS_FILE")
  REPORT_PATH_I=$(jq -r ".angles[$i].report_path" "$SPECS_FILE")

  if $FIX_ONLY; then
    if [[ ! -f "$REPORT_PATH_I" ]]; then
      echo "  [MISSING]    ${LABEL}"
      QUEUE+=("$i")
    elif grep -q "$STUB_MARKER" "$REPORT_PATH_I"; then
      echo "  [STUB]       ${LABEL}"
      QUEUE+=("$i")
    else
      echo "  [OK]         ${LABEL}"
    fi
  else
    QUEUE+=("$i")
  fi
done

COUNT=${#QUEUE[@]}

if [[ $COUNT -eq 0 ]]; then
  echo ""
  echo "All reports complete. Nothing to run."
  exit 0
fi

MODE="full"
$FIX_ONLY && MODE="fix-only"

echo ""
echo "Project: ${PROJECT_NAME}"
echo "Mode: ${MODE} | Agents: ${COUNT} | Max workers: ${MAX_WORKERS} | Poll: ${POLL_INTERVAL}s"
[[ -n "${MODEL:-}" ]] && echo "Model: $MODEL"
echo ""

if $DRY_RUN; then
  for idx in "${QUEUE[@]}"; do
    LABEL=$(jq -r ".angles[$idx].label" "$SPECS_FILE")
    TITLE=$(jq -r ".angles[$idx].title" "$SPECS_FILE")
    echo "  Would spawn: ${PROJECT_NAME}-${LABEL} (${TITLE})"
  done
  echo ""
  echo "Dry run complete. ${COUNT} agents would be spawned."
  exit 0
fi

# Worker pool: FIFO with max concurrency
ACTIVE=()
QUEUE_POS=0
DONE=0

spawn_one() {
  local idx="${QUEUE[$QUEUE_POS]}"
  local label prompt prompt_file log_file session_name claude_cmd

  label=$(jq -r ".angles[$idx].label" "$SPECS_FILE")
  prompt=$(jq -r ".angles[$idx].prompt" "$SPECS_FILE")
  session_name="${PROJECT_NAME}-${label}"

  prompt_file="${LOG_DIR}/${label}-prompt.txt"
  printf '%s' "$prompt" > "$prompt_file"

  log_file="${LOG_DIR}/${label}.log"
  tmux kill-session -t "$session_name" 2>/dev/null || true

  claude_cmd="claude --dangerously-skip-permissions"
  [[ -n "${MODEL:-}" ]] && claude_cmd="$claude_cmd --model $MODEL"

  tmux new-session -d -s "$session_name" \
    "$claude_cmd -p \"\$(cat '${prompt_file}')\" 2>&1 | tee '${log_file}'"

  ACTIVE+=("$session_name")
  QUEUE_POS=$((QUEUE_POS + 1))
  echo "  [START]  ${session_name}  (${#ACTIVE[@]}/${MAX_WORKERS} workers)"
}

# Fill initial pool
while [[ ${#ACTIVE[@]} -lt $MAX_WORKERS && $QUEUE_POS -lt $COUNT ]]; do
  spawn_one
done

# Poll loop: wait for slots to free, backfill from queue
while [[ $DONE -lt $COUNT ]]; do
  sleep "$POLL_INTERVAL"

  STILL_ACTIVE=()
  for session in "${ACTIVE[@]}"; do
    if tmux has-session -t "$session" 2>/dev/null; then
      STILL_ACTIVE+=("$session")
    else
      DONE=$((DONE + 1))
      echo "  [DONE]   ${session}  (${DONE}/${COUNT} complete)"
    fi
  done
  ACTIVE=("${STILL_ACTIVE[@]+"${STILL_ACTIVE[@]}"}")

  # Backfill freed slots
  while [[ ${#ACTIVE[@]} -lt $MAX_WORKERS && $QUEUE_POS -lt $COUNT ]]; do
    spawn_one
  done
done

echo ""
echo "All ${COUNT} agents completed."
