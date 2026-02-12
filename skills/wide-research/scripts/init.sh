#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

require_bin jq

load_env

usage() {
  cat <<'USAGE'
Usage: init.sh <project-name>

Reads a JSON spec from stdin, scaffolds a research project at $REPORT_PATH/<project-name>.

Input JSON format:
{
  "description": "Project description",
  "angles": [
    { "label": "01", "title": "Topic Title", "task": "Research instructions..." }
  ]
}
USAGE
  exit 1
}

PROJECT_NAME="${1:-}"
if [[ -z "$PROJECT_NAME" ]]; then
  echo "Error: project name is required." >&2
  usage
fi

# Read spec from stdin
SPEC=$(cat)
if [[ -z "$SPEC" ]]; then
  echo "Error: no JSON spec provided on stdin." >&2
  exit 1
fi

# Validate JSON structure
if ! echo "$SPEC" | jq -e '.angles | length > 0' >/dev/null 2>&1; then
  echo "Error: spec must contain a non-empty 'angles' array." >&2
  exit 1
fi

PROJECT_DIR="${REPORT_PATH}/${PROJECT_NAME}"
if [[ -d "$PROJECT_DIR" ]]; then
  echo "Error: project directory already exists: ${PROJECT_DIR}" >&2
  exit 1
fi

mkdir -p "${PROJECT_DIR}/.logs"

# Read prompt template
TEMPLATE_FILE="${_SKILL_DIR}/references/prompt-template.md"
if [[ ! -f "$TEMPLATE_FILE" ]]; then
  echo "Error: prompt template not found: ${TEMPLATE_FILE}" >&2
  exit 1
fi
TEMPLATE=$(cat "$TEMPLATE_FILE")

DESCRIPTION=$(echo "$SPEC" | jq -r '.description // ""')
ANGLE_COUNT=$(echo "$SPEC" | jq '.angles | length')

# Build enriched specs with prompts and report paths
ENRICHED_SPEC=$(echo "$SPEC" | jq --arg project "$PROJECT_NAME" '{
  project: $project,
  description: .description,
  angles: .angles
}')

for i in $(seq 0 $((ANGLE_COUNT - 1))); do
  LABEL=$(echo "$SPEC" | jq -r ".angles[$i].label")
  TITLE=$(echo "$SPEC" | jq -r ".angles[$i].title")
  TASK=$(echo "$SPEC" | jq -r ".angles[$i].task")
  REPORT_FILE="${PROJECT_DIR}/report-${LABEL}.md"

  # Generate prompt from template
  PROMPT="$TEMPLATE"
  PROMPT="${PROMPT//\{TASK\}/$TASK}"
  PROMPT="${PROMPT//\{REPORT_PATH\}/$REPORT_FILE}"
  PROMPT="${PROMPT//\{PROJECT\}/$PROJECT_NAME}"
  PROMPT="${PROMPT//\{TITLE\}/$TITLE}"

  # Add report_path and prompt to spec
  ENRICHED_SPEC=$(echo "$ENRICHED_SPEC" | jq \
    --arg idx "$i" \
    --arg rpath "$REPORT_FILE" \
    --arg prompt "$PROMPT" \
    '.angles[($idx | tonumber)].report_path = $rpath | .angles[($idx | tonumber)].prompt = $prompt')

  # Write stub report
  cat > "$REPORT_FILE" <<STUB
# ${TITLE}

${STUB_MARKER}
STUB

  echo "  Created: report-${LABEL}.md"
done

# Save enriched spec
echo "$ENRICHED_SPEC" | jq '.' > "${PROJECT_DIR}/specs.json"

echo ""
echo "Project initialized: ${PROJECT_DIR}"
echo "  ${ANGLE_COUNT} report stubs created"
echo "  specs.json written"
echo ""
echo "${PROJECT_DIR}"
