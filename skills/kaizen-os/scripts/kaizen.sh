#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat >&2 <<'USAGE'
Usage: kaizen.sh <command> [args...]

Commands:
  tools                       List available MCP tools.
  call <server> <tool> ...    Execute a tool.

Examples:
  kaizen.sh tools
  kaizen.sh tools --server kaizen-db
  kaizen.sh call kaizen-db list_cards
USAGE
  exit 2
}

if [[ $# -eq 0 ]]; then
  usage
fi

command="$1"
shift

case "$command" in
  tools)
    exec "${script_dir}/tools.sh" "$@"
    ;;
  call)
    exec "${script_dir}/call.sh" "$@"
    ;;
  -h|--help)
    usage
    ;;
  *)
    echo "Unknown command: ${command}" >&2
    usage
    ;;
esac
