#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

require_bin python3

usage() {
  cat <<'USAGE'
Usage: report.sh <project-path> [--output <filename>]

Generate a styled PDF from completed research reports.

Requires Python packages: markdown, weasyprint.
Auto-installs if missing.
USAGE
  exit 1
}

PROJECT_DIR=""
OUTPUT_ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) OUTPUT_ARG="$2"; shift 2 ;;
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

if [[ ! -f "${PROJECT_DIR}/specs.json" ]]; then
  echo "Error: specs.json not found in ${PROJECT_DIR}" >&2
  exit 1
fi

# Check Python deps
for pkg in markdown weasyprint; do
  if ! python3 -c "import $pkg" 2>/dev/null; then
    echo "Installing missing Python package: ${pkg}"
    pip3 install --quiet "$pkg"
  fi
done

# Build args for the Python script
ARGS=("${SCRIPT_DIR}/generate_report.py" "$PROJECT_DIR")
if [[ -n "$OUTPUT_ARG" ]]; then
  ARGS+=(--output "$OUTPUT_ARG")
fi

python3 "${ARGS[@]}"
