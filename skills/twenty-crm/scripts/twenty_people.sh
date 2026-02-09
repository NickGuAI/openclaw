#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
skill_dir="$(cd -- "${script_dir}/.." && pwd)"
skill_env_file="${skill_dir}/.env"

usage() {
  cat >&2 <<EOF
Usage:
  twenty_people.sh find --name "Jane Doe" [--limit 10] [--depth 1] [--order-by updatedAt[DescNullsLast]] [--raw]
  twenty_people.sh find --filter 'name.firstName[ilike]:"%jane%"' [--limit 10] [--depth 1] [--raw]
  twenty_people.sh get --id <person-uuid> [--depth 1] [--raw]
  twenty_people.sh update --id <person-uuid> (--json '<payload>' | --file /path/payload.json | --stdin) [--depth 1] [--raw]

Commands:
  find     Search people in Twenty.
  get      Fetch one person by UUID.
  update   Patch one person by UUID.

Environment:
  TWENTY_API_KEY   Required API token.
  TWENTY_BASE_URL  Optional. Default: https://api.twenty.com/rest

If env vars are unset, the script reads ${skill_env_file}.
EOF
  exit 2
}

require_bin() {
  local bin="$1"
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "Missing required binary: ${bin}" >&2
    exit 1
  fi
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

load_env_var_from_file() {
  local key="$1"
  local value=""

  if [[ ! -f "$skill_env_file" ]]; then
    return
  fi

  value="$(sed -nE "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*(.*)[[:space:]]*$/\1/p" "$skill_env_file" | head -n 1)"
  if [[ -z "$value" ]]; then
    return
  fi

  if [[ "$value" =~ ^\".*\"$ ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" =~ ^\'.*\'$ ]]; then
    value="${value:1:${#value}-2}"
  fi

  export "${key}=${value}"
}

is_integer() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

validate_limit() {
  local limit="$1"
  if ! is_integer "$limit"; then
    echo "--limit must be an integer" >&2
    exit 1
  fi
  if (( limit < 1 || limit > 200 )); then
    echo "--limit must be between 1 and 200" >&2
    exit 1
  fi
}

validate_depth() {
  local depth="$1"
  if [[ "$depth" != "0" && "$depth" != "1" ]]; then
    echo "--depth must be 0 or 1" >&2
    exit 1
  fi
}

validate_uuid() {
  local id="$1"
  if [[ ! "$id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
    echo "--id must be a UUID" >&2
    exit 1
  fi
}

escape_filter_value() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}

build_name_filter() {
  local raw_name="$1"
  local name first rest escaped_first escaped_rest

  name="$(trim "$raw_name")"
  if [[ -z "$name" ]]; then
    echo "--name cannot be empty" >&2
    exit 1
  fi

  name="$(printf '%s' "$name" | tr -s ' ')"
  first="${name%% *}"

  if [[ "$name" == "$first" ]]; then
    escaped_first="$(escape_filter_value "$first")"
    printf 'or(name.firstName[ilike]:"%%%s%%",name.lastName[ilike]:"%%%s%%")' "$escaped_first" "$escaped_first"
    return
  fi

  rest="${name#* }"
  escaped_first="$(escape_filter_value "$first")"
  escaped_rest="$(escape_filter_value "$rest")"
  printf 'and(name.firstName[ilike]:"%%%s%%",name.lastName[ilike]:"%%%s%%")' "$escaped_first" "$escaped_rest"
}

api_call() {
  local method="$1"
  local url="$2"
  shift 2

  local body_file http_code
  body_file="$(mktemp)"

  http_code="$(
    curl -sS \
      -o "$body_file" \
      -w '%{http_code}' \
      -X "$method" \
      -H "Authorization: Bearer ${TWENTY_API_KEY}" \
      -H 'Accept: application/json' \
      "$@" \
      "$url"
  )"

  if [[ ! "$http_code" =~ ^2 ]]; then
    echo "Twenty API request failed (${http_code}): ${method} ${url}" >&2
    if [[ -s "$body_file" ]]; then
      cat "$body_file" >&2
      echo >&2
    fi
    rm -f "$body_file"
    return 1
  fi

  cat "$body_file"
  rm -f "$body_file"
}

cmd_find() {
  local name="" filter="" limit="10" depth="1" order_by="updatedAt[DescNullsLast]" raw="false"
  local response
  local -a curl_args

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --name)
        name="${2:-}"
        shift 2
        ;;
      --filter)
        filter="${2:-}"
        shift 2
        ;;
      --limit)
        limit="${2:-}"
        shift 2
        ;;
      --depth)
        depth="${2:-}"
        shift 2
        ;;
      --order-by)
        order_by="${2:-}"
        shift 2
        ;;
      --raw)
        raw="true"
        shift 1
        ;;
      -h|--help)
        usage
        ;;
      *)
        echo "Unknown find argument: $1" >&2
        usage
        ;;
    esac
  done

  validate_limit "$limit"
  validate_depth "$depth"

  if [[ -z "$filter" ]]; then
    if [[ -z "$name" ]]; then
      echo "find requires --name or --filter" >&2
      exit 1
    fi
    filter="$(build_name_filter "$name")"
  fi

  curl_args=(
    --get
    --data-urlencode "limit=${limit}"
    --data-urlencode "depth=${depth}"
    --data-urlencode "order_by=${order_by}"
    --data-urlencode "filter=${filter}"
  )

  response="$(api_call "GET" "${TWENTY_BASE_URL}/people" "${curl_args[@]}")"

  if [[ "$raw" == "true" ]]; then
    echo "$response" | jq .
    return
  fi

  echo "$response" | jq '{
    totalCount: (.totalCount // 0),
    hasNextPage: (.pageInfo.hasNextPage // false),
    people: (
      (.data.people // []) |
      map({
        id,
        firstName: (.name.firstName // ""),
        lastName: (.name.lastName // ""),
        primaryEmail: (.emails.primaryEmail // ""),
        jobTitle: (.jobTitle // ""),
        city: (.city // ""),
        companyId: (.companyId // "")
      })
    )
  }'
}

cmd_get() {
  local id="" depth="1" raw="false"
  local response
  local -a curl_args

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --id)
        id="${2:-}"
        shift 2
        ;;
      --depth)
        depth="${2:-}"
        shift 2
        ;;
      --raw)
        raw="true"
        shift 1
        ;;
      -h|--help)
        usage
        ;;
      *)
        echo "Unknown get argument: $1" >&2
        usage
        ;;
    esac
  done

  if [[ -z "$id" ]]; then
    echo "get requires --id" >&2
    exit 1
  fi
  validate_uuid "$id"
  validate_depth "$depth"

  curl_args=(
    --get
    --data-urlencode "depth=${depth}"
  )

  response="$(api_call "GET" "${TWENTY_BASE_URL}/people/${id}" "${curl_args[@]}")"

  if [[ "$raw" == "true" ]]; then
    echo "$response" | jq .
    return
  fi

  echo "$response" | jq '.data.person'
}

cmd_update() {
  local id="" depth="1" raw="false"
  local json_payload="" payload_file="" use_stdin="false"
  local payload response
  local source_count=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --id)
        id="${2:-}"
        shift 2
        ;;
      --json)
        json_payload="${2:-}"
        shift 2
        ;;
      --file)
        payload_file="${2:-}"
        shift 2
        ;;
      --stdin)
        use_stdin="true"
        shift 1
        ;;
      --depth)
        depth="${2:-}"
        shift 2
        ;;
      --raw)
        raw="true"
        shift 1
        ;;
      -h|--help)
        usage
        ;;
      *)
        echo "Unknown update argument: $1" >&2
        usage
        ;;
    esac
  done

  if [[ -z "$id" ]]; then
    echo "update requires --id" >&2
    exit 1
  fi
  validate_uuid "$id"
  validate_depth "$depth"

  if [[ -n "$json_payload" ]]; then
    source_count=$((source_count + 1))
  fi
  if [[ -n "$payload_file" ]]; then
    source_count=$((source_count + 1))
  fi
  if [[ "$use_stdin" == "true" ]]; then
    source_count=$((source_count + 1))
  fi

  if (( source_count != 1 )); then
    echo "update requires exactly one payload source: --json, --file, or --stdin" >&2
    exit 1
  fi

  if [[ -n "$json_payload" ]]; then
    payload="$json_payload"
  elif [[ -n "$payload_file" ]]; then
    if [[ ! -f "$payload_file" ]]; then
      echo "Payload file not found: ${payload_file}" >&2
      exit 1
    fi
    payload="$(cat "$payload_file")"
  else
    payload="$(cat)"
  fi

  if ! echo "$payload" | jq -e . >/dev/null 2>&1; then
    echo "Invalid JSON payload" >&2
    exit 1
  fi

  payload="$(echo "$payload" | jq -c .)"
  response="$(api_call "PATCH" "${TWENTY_BASE_URL}/people/${id}?depth=${depth}" -H "Content-Type: application/json" --data "$payload")"

  if [[ "$raw" == "true" ]]; then
    echo "$response" | jq .
    return
  fi

  echo "$response" | jq '.data.updatePerson'
}

main() {
  local cmd="${1:-}"

  if [[ -z "$cmd" || "$cmd" == "-h" || "$cmd" == "--help" ]]; then
    usage
  fi
  shift || true

  require_bin curl
  require_bin jq

  if [[ -z "${TWENTY_API_KEY:-}" ]]; then
    load_env_var_from_file "TWENTY_API_KEY"
  fi
  if [[ -z "${TWENTY_BASE_URL:-}" ]]; then
    load_env_var_from_file "TWENTY_BASE_URL"
  fi

  if [[ -z "${TWENTY_API_KEY:-}" ]]; then
    echo "Missing TWENTY_API_KEY (env or ${skill_env_file})" >&2
    exit 1
  fi

  TWENTY_BASE_URL="${TWENTY_BASE_URL:-https://api.twenty.com/rest}"
  TWENTY_BASE_URL="${TWENTY_BASE_URL%/}"

  case "$cmd" in
    find)
      cmd_find "$@"
      ;;
    get)
      cmd_get "$@"
      ;;
    update)
      cmd_update "$@"
      ;;
    *)
      echo "Unknown command: ${cmd}" >&2
      usage
      ;;
  esac
}

main "$@"
