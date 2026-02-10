#!/usr/bin/env bash
set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

usage() {
  cat >&2 <<'USAGE'
Usage: tools.sh [--server <name>] [--raw]

Options:
  --server <name>  Filter to one server.
  --raw            Print the raw JSON response.
  -h, --help       Show help.
USAGE
  exit 2
}

raw="false"
server_filter=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --raw)
      raw="true"
      shift
      ;;
    --server)
      server_filter="${2:-}"
      if [[ -z "$server_filter" ]]; then
        echo "--server requires a value" >&2
        usage
      fi
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      ;;
  esac
done

require_bin curl
require_bin jq
load_env

response="$(kaizen_request GET /api/mcp/tools)"

if [[ "$raw" == "true" ]]; then
  printf '%s\n' "$response"
  exit 0
fi

if [[ -n "$server_filter" ]]; then
  if ! printf '%s\n' "$response" | jq -e --arg server "$server_filter" '.servers[$server] != null' >/dev/null; then
    echo "Unknown server: ${server_filter}" >&2
    echo "Run tools.sh without --server to list available servers." >&2
    exit 1
  fi

  printf '[%s]\n' "$server_filter"
  printf '%s\n' "$response" | jq -r --arg server "$server_filter" '
    .servers[$server].tools[]? |
    "  \(.name) (\(.scope)) - \(.description)"
  '
  exit 0
fi

printf '%s\n' "$response" | jq -r '
  .servers
  | to_entries[]
  | "[\(.key)]",
    (.value.tools[]? | "  \(.name) (\(.scope)) - \(.description)"),
    ""
'
