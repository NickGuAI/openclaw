#!/usr/bin/env bash
set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

usage() {
  cat >&2 <<'USAGE'
Usage: call.sh <server> <tool> [--arg key=value]... [--raw]

Examples:
  call.sh kaizen-db list_cards
  call.sh kaizen-db create_card --arg title="Ship v2" --arg unitType=ACTION_GATE
  call.sh scratchpad update_scratchpad --arg content="Hello" --arg append=true
  call.sh kaizen-db create_card --arg criteria='["Done", "Reviewed"]'
USAGE
  exit 2
}

coerce_json_value() {
  local value="$1"

  if [[ "$value" == "true" || "$value" == "false" || "$value" == "null" ]]; then
    printf '%s' "$value"
    return
  fi

  if [[ "$value" =~ ^-?[0-9]+([.][0-9]+)?$ ]]; then
    printf '%s' "$value"
    return
  fi

  if [[ "$value" =~ ^[[:space:]]*\{.*\}[[:space:]]*$ || "$value" =~ ^[[:space:]]*\[.*\][[:space:]]*$ ]]; then
    if jq -e . >/dev/null 2>&1 <<<"$value"; then
      printf '%s' "$value"
      return
    fi
  fi

  jq -Rn --arg value "$value" '$value'
}

if [[ $# -lt 2 ]]; then
  usage
fi

server="$1"
shift
tool="$1"
shift

require_bin curl
require_bin jq

raw="false"
args_json='{}'

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arg)
      pair="${2:-}"
      if [[ -z "$pair" || "$pair" != *=* ]]; then
        echo "--arg expects key=value" >&2
        usage
      fi

      key="${pair%%=*}"
      value="${pair#*=}"
      if [[ -z "$key" ]]; then
        echo "--arg key cannot be empty" >&2
        usage
      fi

      value_json="$(coerce_json_value "$value")"
      args_json="$(jq -cn --argjson current "$args_json" --arg key "$key" --argjson value "$value_json" '$current + {($key): $value}')"
      shift 2
      ;;
    --raw)
      raw="true"
      shift
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

load_env

request_body="$(jq -cn --arg server "$server" --arg tool "$tool" --argjson args "$args_json" '{server: $server, tool: $tool, args: $args}')"
response="$(kaizen_request POST /api/mcp/call "$request_body")"

if [[ "$raw" == "true" ]]; then
  printf '%s\n' "$response"
  exit 0
fi

text_output="$(printf '%s\n' "$response" | jq -r '
  if (.result | type) == "object" and (.result.content? | type) == "array" then
    [
      .result.content[]?
      | select((.type? == "text") and (.text? | type == "string"))
      | .text
    ]
    | join("\n")
  else
    ""
  end
' 2>/dev/null || true)"

if [[ -n "$text_output" ]]; then
  printf '%s\n' "$text_output"
else
  printf '%s\n' "$response" | jq .
fi
