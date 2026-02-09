#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  search.sh <query> [options]

Options:
  --topic <general|news|finance>
  --search-depth <basic|advanced|fast|ultra-fast>
  --time-range <day|week|month|year|d|w|m|y>
  --start-date <YYYY-MM-DD>
  --end-date <YYYY-MM-DD>
  --max-results <0-20>
  --country <lowercase country name>
  --include-domains <domain1,domain2,...>
  --exclude-domains <domain1,domain2,...>
  --include-answer
  --answer-mode <basic|advanced>
  --include-raw-content
  --raw-content-format <markdown|text>
  --out <path/to/response.json>
  -h, --help
EOF
  exit 2
}

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

csv_to_json_array() {
  local csv="$1"
  local out=""
  local item=""
  local escaped=""
  IFS=',' read -r -a items <<<"$csv"
  for item in "${items[@]}"; do
    item="$(trim "$item")"
    if [[ -z "$item" ]]; then
      continue
    fi
    escaped="$(json_escape "$item")"
    if [[ -n "$out" ]]; then
      out+=", "
    fi
    out+="\"$escaped\""
  done
  printf '[%s]' "$out"
}

if [[ "${1:-}" == "" || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
skill_dir="$(cd -- "${script_dir}/.." && pwd)"
skill_env_file="${skill_dir}/.env"

if [[ "${TAVILY_API_KEY:-}" == "" && -f "$skill_env_file" ]]; then
  file_key="$(sed -nE 's/^[[:space:]]*TAVILY_API_KEY[[:space:]]*=[[:space:]]*(.*)[[:space:]]*$/\1/p' "$skill_env_file" | head -n 1)"
  if [[ -n "$file_key" ]]; then
    if [[ "$file_key" =~ ^\".*\"$ ]]; then
      file_key="${file_key:1:${#file_key}-2}"
    fi
    if [[ "$file_key" =~ ^\'.*\'$ ]]; then
      file_key="${file_key:1:${#file_key}-2}"
    fi
    export TAVILY_API_KEY="$file_key"
  fi
fi

if [[ "${TAVILY_API_KEY:-}" == "" ]]; then
  echo "Missing TAVILY_API_KEY (env or ${skill_env_file})" >&2
  exit 1
fi

query="${1:-}"
shift || true

topic="general"
search_depth="basic"
time_range=""
start_date=""
end_date=""
max_results="5"
country=""
include_domains=""
exclude_domains=""
include_answer="false"
include_raw_content="false"
out=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --topic)
      topic="${2:-}"
      shift 2
      ;;
    --search-depth)
      search_depth="${2:-}"
      shift 2
      ;;
    --time-range)
      time_range="${2:-}"
      shift 2
      ;;
    --start-date)
      start_date="${2:-}"
      shift 2
      ;;
    --end-date)
      end_date="${2:-}"
      shift 2
      ;;
    --max-results)
      max_results="${2:-}"
      shift 2
      ;;
    --country)
      country="${2:-}"
      shift 2
      ;;
    --include-domains)
      include_domains="${2:-}"
      shift 2
      ;;
    --exclude-domains)
      exclude_domains="${2:-}"
      shift 2
      ;;
    --include-answer)
      include_answer="true"
      shift 1
      ;;
    --answer-mode)
      include_answer="${2:-}"
      shift 2
      ;;
    --include-raw-content)
      include_raw_content="true"
      shift 1
      ;;
    --raw-content-format)
      include_raw_content="${2:-}"
      shift 2
      ;;
    --out|--output)
      out="${2:-}"
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

case "$topic" in
  general|news|finance) ;;
  *)
    echo "Invalid --topic: $topic" >&2
    exit 1
    ;;
esac

case "$search_depth" in
  basic|advanced|fast|ultra-fast) ;;
  *)
    echo "Invalid --search-depth: $search_depth" >&2
    exit 1
    ;;
esac

if [[ -n "$time_range" ]]; then
  case "$time_range" in
    day|week|month|year|d|w|m|y) ;;
    *)
      echo "Invalid --time-range: $time_range" >&2
      exit 1
      ;;
  esac
fi

if [[ -n "$start_date" && ! "$start_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "Invalid --start-date: $start_date" >&2
  exit 1
fi

if [[ -n "$end_date" && ! "$end_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "Invalid --end-date: $end_date" >&2
  exit 1
fi

if [[ ! "$max_results" =~ ^[0-9]+$ ]]; then
  echo "Invalid --max-results: $max_results (must be an integer)" >&2
  exit 1
fi

if (( max_results < 0 || max_results > 20 )); then
  echo "Invalid --max-results: $max_results (must be in range 0-20)" >&2
  exit 1
fi

case "$include_answer" in
  true|false|basic|advanced) ;;
  *)
    echo "Invalid include answer mode: $include_answer" >&2
    exit 1
    ;;
esac

case "$include_raw_content" in
  true|false|markdown|text) ;;
  *)
    echo "Invalid raw content mode: $include_raw_content" >&2
    exit 1
    ;;
esac

body="{"
first=1

add_field() {
  local key="$1"
  local value="$2"
  if [[ $first -eq 0 ]]; then
    body+=", "
  fi
  body+="\"$key\": $value"
  first=0
}

add_field "query" "\"$(json_escape "$query")\""
add_field "topic" "\"$(json_escape "$topic")\""
add_field "search_depth" "\"$(json_escape "$search_depth")\""
add_field "max_results" "$max_results"

if [[ "$include_answer" == "true" || "$include_answer" == "false" ]]; then
  add_field "include_answer" "$include_answer"
else
  add_field "include_answer" "\"$(json_escape "$include_answer")\""
fi

if [[ "$include_raw_content" == "true" || "$include_raw_content" == "false" ]]; then
  add_field "include_raw_content" "$include_raw_content"
else
  add_field "include_raw_content" "\"$(json_escape "$include_raw_content")\""
fi

if [[ -n "$time_range" ]]; then
  add_field "time_range" "\"$(json_escape "$time_range")\""
fi

if [[ -n "$start_date" ]]; then
  add_field "start_date" "\"$(json_escape "$start_date")\""
fi

if [[ -n "$end_date" ]]; then
  add_field "end_date" "\"$(json_escape "$end_date")\""
fi

if [[ -n "$country" ]]; then
  add_field "country" "\"$(json_escape "$country")\""
fi

if [[ -n "$include_domains" ]]; then
  add_field "include_domains" "$(csv_to_json_array "$include_domains")"
fi

if [[ -n "$exclude_domains" ]]; then
  add_field "exclude_domains" "$(csv_to_json_array "$exclude_domains")"
fi

body+="}"

response_with_code="$(
  curl -sS -X POST "https://api.tavily.com/search" \
    -H "Authorization: Bearer ${TAVILY_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$body" \
    -w $'\n%{http_code}'
)"

http_code="${response_with_code##*$'\n'}"
response="${response_with_code%$'\n'*}"

if [[ ! "$http_code" =~ ^[0-9]{3}$ ]]; then
  echo "Unexpected HTTP status code from Tavily API: $http_code" >&2
  exit 1
fi

if (( http_code < 200 || http_code >= 300 )); then
  echo "Tavily API error ($http_code)" >&2
  printf '%s\n' "$response" >&2
  exit 1
fi

if [[ -n "$out" ]]; then
  mkdir -p "$(dirname "$out")"
  printf '%s\n' "$response" >"$out"
  echo "$out"
else
  printf '%s\n' "$response"
fi
