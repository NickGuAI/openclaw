#!/usr/bin/env bash
set -euo pipefail

_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
_SKILL_DIR="$(cd -- "${_SCRIPT_DIR}/.." && pwd)"
_ENV_FILE="${_SKILL_DIR}/.env"

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

  if [[ "${value}" =~ ^\".*\"$ ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "${value}" =~ ^\'.*\'$ ]]; then
    value="${value:1:${#value}-2}"
  fi

  export "${key}=${value}"
}

load_env() {
  if [[ -z "${KAIZEN_API_KEY:-}" ]]; then
    load_env_var_from_file "KAIZEN_API_KEY"
  fi
  if [[ -z "${KAIZEN_BASE_URL:-}" ]]; then
    load_env_var_from_file "KAIZEN_BASE_URL"
  fi

  if [[ -z "${KAIZEN_API_KEY:-}" ]]; then
    echo "Missing KAIZEN_API_KEY (env or ${_ENV_FILE})" >&2
    exit 1
  fi

  KAIZEN_BASE_URL="${KAIZEN_BASE_URL:-https://kaizen.gehirn.ai}"
  KAIZEN_BASE_URL="${KAIZEN_BASE_URL%/}"
}

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "${s}"
}

extract_error_message() {
  local response="$1"
  local message=""

  if command -v jq >/dev/null 2>&1; then
    message="$(printf '%s\n' "$response" | jq -r '.error.message // empty' 2>/dev/null || true)"
  fi

  printf '%s' "$message"
}

kaizen_request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local url="${KAIZEN_BASE_URL}${path}"

  local response_with_code=""
  local http_code=""
  local response=""
  local api_message=""

  if [[ -n "$body" ]]; then
    if ! response_with_code="$(curl -sS -X "$method" "$url" -H "X-API-Key: ${KAIZEN_API_KEY}" -H "Content-Type: application/json" -d "$body" -w $'\n%{http_code}')"; then
      echo "Failed to connect to Kaizen API: ${url}" >&2
      exit 1
    fi
  else
    if ! response_with_code="$(curl -sS -X "$method" "$url" -H "X-API-Key: ${KAIZEN_API_KEY}" -H "Content-Type: application/json" -w $'\n%{http_code}')"; then
      echo "Failed to connect to Kaizen API: ${url}" >&2
      exit 1
    fi
  fi

  http_code="${response_with_code##*$'\n'}"
  response="${response_with_code%$'\n'*}"

  if [[ ! "$http_code" =~ ^[0-9]{3}$ ]]; then
    echo "Unexpected HTTP response from Kaizen API" >&2
    printf '%s\n' "$response" >&2
    exit 1
  fi

  if (( http_code >= 200 && http_code < 300 )); then
    printf '%s\n' "$response"
    return 0
  fi

  api_message="$(extract_error_message "$response")"

  case "$http_code" in
    400)
      echo "Bad request to Kaizen API (400)" >&2
      ;;
    401)
      echo "Authentication failed (401): check KAIZEN_API_KEY" >&2
      ;;
    403)
      echo "Forbidden (403): API key scope or server access is insufficient" >&2
      ;;
    404)
      echo "Not found (404): server, tool, or endpoint does not exist" >&2
      ;;
    429)
      echo "Rate limited (429): retry after cooldown" >&2
      ;;
    *)
      echo "Kaizen API error (${http_code})" >&2
      ;;
  esac

  if [[ -n "$api_message" ]]; then
    echo "$api_message" >&2
  else
    printf '%s\n' "$response" >&2
  fi
  exit 1
}
