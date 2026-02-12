#!/usr/bin/env bash
# codex-smash: run an issue from URL through implementation, PR, and P1 review loop.
set -euo pipefail

TEAM="gammawave"
WAIT_MINUTES=15
BASE_BRANCH="main"
NO_WAIT=0
ISSUE_URL=""
REVIEW_REQUEST='@codex do a no nonsense deep review of the change for all P0/P1 issues. Explain why each added/exited file is good to go or has issues.'

usage() {
  cat <<'USAGE'
Usage: smash.sh <github-issue-url> [--team gammawave] [--wait-minutes 15] [--base main] [--no-wait]

Options:
  --team <name>          Team slug used in branch and commit naming (default: gammawave)
  --wait-minutes <n>     Minutes to wait before checking review comments (default: 15)
  --base <branch>        Base branch to branch from and target for PR (default: main)
  --no-wait              Skip waiting regardless of --wait-minutes
USAGE
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command not found: $1" >&2
    exit 1
  fi
}

slugify() {
  local input="$1"
  local slug
  slug=$(printf '%s' "$input" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g' \
    | cut -c1-36)

  if [[ -z "$slug" ]]; then
    slug="issue"
  fi

  printf '%s' "$slug"
}

origin_repo_name() {
  local remote_url
  remote_url=$(git remote get-url origin)
  printf '%s' "$remote_url" \
    | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --team)
      TEAM="$2"
      shift 2
      ;;
    --wait-minutes)
      WAIT_MINUTES="$2"
      shift 2
      ;;
    --base)
      BASE_BRANCH="$2"
      shift 2
      ;;
    --no-wait)
      NO_WAIT=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "$ISSUE_URL" ]]; then
        ISSUE_URL="$1"
        shift
      else
        echo "Error: unexpected argument: $1" >&2
        usage >&2
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$ISSUE_URL" ]]; then
  echo "Error: GitHub issue URL is required." >&2
  usage >&2
  exit 1
fi

if ! [[ "$WAIT_MINUTES" =~ ^[0-9]+$ ]]; then
  echo "Error: --wait-minutes must be a non-negative integer." >&2
  exit 1
fi

need_cmd git
need_cmd gh
need_cmd codex
need_cmd sed
need_cmd tr

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "Error: run this script inside a git repository." >&2
  exit 1
fi

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit/stash changes first." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Error: gh is not authenticated. Run: gh auth login" >&2
  exit 1
fi

if [[ "$ISSUE_URL" =~ github\.com/([^/]+)/([^/]+)/issues/([0-9]+) ]]; then
  ISSUE_OWNER="${BASH_REMATCH[1]}"
  ISSUE_REPO="${BASH_REMATCH[2]}"
  ISSUE_NUMBER="${BASH_REMATCH[3]}"
else
  echo "Error: invalid GitHub issue URL: $ISSUE_URL" >&2
  exit 1
fi

TARGET_REPO="${ISSUE_OWNER}/${ISSUE_REPO}"
ORIGIN_REPO=$(origin_repo_name)

if [[ "$ORIGIN_REPO" != "$TARGET_REPO" ]]; then
  echo "Error: origin repo ($ORIGIN_REPO) does not match issue repo ($TARGET_REPO)." >&2
  echo "Run this skill from a clone of $TARGET_REPO." >&2
  exit 1
fi

ISSUE_TITLE=$(gh issue view "$ISSUE_NUMBER" --repo "$TARGET_REPO" --json title --jq '.title')
ISSUE_BODY=$(gh issue view "$ISSUE_NUMBER" --repo "$TARGET_REPO" --json body --jq '.body // ""')
ISSUE_CANONICAL_URL=$(gh issue view "$ISSUE_NUMBER" --repo "$TARGET_REPO" --json url --jq '.url')

TITLE_SLUG=$(slugify "$ISSUE_TITLE")
BRANCH_NAME="feature/${TEAM}-issue-${ISSUE_NUMBER}-${TITLE_SLUG}"

echo "Issue: #${ISSUE_NUMBER} ${ISSUE_TITLE}"
echo "Repo: ${TARGET_REPO}"
echo "Base branch: ${BASE_BRANCH}"
echo "Feature branch: ${BRANCH_NAME}"

echo "Syncing base branch..."
git fetch origin "$BASE_BRANCH"
if git show-ref --verify --quiet "refs/heads/$BASE_BRANCH"; then
  git switch "$BASE_BRANCH"
else
  git switch --track -c "$BASE_BRANCH" "origin/$BASE_BRANCH"
fi
git pull --ff-only origin "$BASE_BRANCH"

if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  git switch "$BRANCH_NAME"
else
  git switch -c "$BRANCH_NAME"
fi

PR_URL=$(gh pr list --repo "$TARGET_REPO" --head "$BRANCH_NAME" --json url --jq '.[0].url // ""')
LOOP_NUMBER=1
P1_COMMENTS=""

while true; do
  PASS_BASE_SHA=$(git rev-parse HEAD)

  if [[ "$LOOP_NUMBER" -eq 1 ]]; then
    PASS_PROMPT=$(cat <<PROMPT
You are fixing a GitHub issue in ${TARGET_REPO}.

Issue URL: ${ISSUE_CANONICAL_URL}
Issue title: ${ISSUE_TITLE}
Issue body:
${ISSUE_BODY}

Task:
1. Implement a correct fix for this issue on the current branch.
2. Run relevant tests/checks and fix failures.
3. Commit the changes.
4. Do not create a PR (external script handles PR).

Constraints:
- Keep scope focused on this issue.
- Follow existing coding patterns and project tooling.
- Avoid unrelated refactors.

At the end, print:
COMMIT_SHA=<sha>
SUMMARY=<one-line>
PROMPT
)
    PASS_COMMIT_MESSAGE="fix(${TEAM}): resolve #${ISSUE_NUMBER}"
    echo "Running Codex implementation pass..."
  else
    PASS_PROMPT=$(cat <<PROMPT
You are addressing P0/P1 review findings.

Issue: ${ISSUE_CANONICAL_URL}
PR: ${PR_URL}

P0/P1 findings:
${P1_COMMENTS}

Task:
1. Fix all P0/P1 findings above on the current branch.
2. Run relevant tests/checks.
3. Commit any resulting changes.
4. Do not create a new PR.

At the end, print:
COMMIT_SHA=<sha>
SUMMARY=<one-line>
PROMPT
)
    PASS_COMMIT_MESSAGE="fix(${TEAM}): address P0/P1 review for #${ISSUE_NUMBER}"
    echo "Running Codex P0/P1 remediation pass (loop ${LOOP_NUMBER})..."
  fi

  codex exec --full-auto "$PASS_PROMPT"

  if [[ -n "$(git status --porcelain)" ]]; then
    git add -A
    git commit -m "$PASS_COMMIT_MESSAGE"
  fi

  PASS_HEAD_SHA=$(git rev-parse HEAD)
  if [[ "$PASS_HEAD_SHA" == "$PASS_BASE_SHA" ]]; then
    if [[ "$LOOP_NUMBER" -eq 1 ]]; then
      echo "Error: no commit was created for issue #${ISSUE_NUMBER}." >&2
    else
      echo "Error: P1 findings were detected but no remediation commit was created in loop ${LOOP_NUMBER}." >&2
    fi
    exit 1
  fi

  echo "Pushing branch..."
  if [[ "$LOOP_NUMBER" -eq 1 ]]; then
    git push -u origin "$BRANCH_NAME"
  else
    git push
  fi

  if [[ -z "$PR_URL" ]]; then
    PR_BODY=$(cat <<PRBODY
## Summary
Automated by codex-smash for ${ISSUE_CANONICAL_URL}.

## Trace
- Branch: `${BRANCH_NAME}`

Closes #${ISSUE_NUMBER}
PRBODY
)
    PR_URL=$(gh pr create --repo "$TARGET_REPO" --base "$BASE_BRANCH" --head "$BRANCH_NAME" --title "fix: ${ISSUE_TITLE}" --body "$PR_BODY")
  fi

  echo "PR: ${PR_URL}"
  PR_NUMBER=$(echo "$PR_URL" | grep -oE '[0-9]+$')

  REVIEW_COMMENT_META=$(gh api "repos/${ISSUE_OWNER}/${ISSUE_REPO}/issues/${PR_NUMBER}/comments" \
    -f body="$REVIEW_REQUEST" \
    --jq '[.id, .created_at] | @tsv')
  IFS=$'\t' read -r REVIEW_REQUEST_COMMENT_ID REVIEWED_AT <<< "$REVIEW_COMMENT_META"
  if [[ -z "$REVIEW_REQUEST_COMMENT_ID" || -z "$REVIEWED_AT" ]]; then
    echo "Error: failed to capture review request comment metadata." >&2
    exit 1
  fi
  echo "Posted review request comment id ${REVIEW_REQUEST_COMMENT_ID} at ${REVIEWED_AT}."

  if [[ "$NO_WAIT" -eq 1 || "$WAIT_MINUTES" -eq 0 ]]; then
    echo "Skipping review monitoring (dry run)."
    break
  fi

  # Poll for Codex review response instead of blind sleep
  POLL_INTERVAL=30
  MAX_WAIT=$((WAIT_MINUTES * 60))
  ELAPSED=0
  REVIEW_RECEIVED=0

  echo "Monitoring for review response (timeout: ${WAIT_MINUTES}m, polling every ${POLL_INTERVAL}s)..."

  while [[ "$ELAPSED" -lt "$MAX_WAIT" ]]; do
    sleep "$POLL_INTERVAL"
    ELAPSED=$((ELAPSED + POLL_INTERVAL))

    # Check for new PR comments posted after the review request
    NEW_COMMENTS=$(gh api "repos/${ISSUE_OWNER}/${ISSUE_REPO}/issues/${PR_NUMBER}/comments?per_page=100" \
      --jq '[.[] | select((.id | tonumber) > '"$REVIEW_REQUEST_COMMENT_ID"')] | length')

    # Check for new PR reviews submitted after the review request
    NEW_REVIEWS=$(gh api "repos/${ISSUE_OWNER}/${ISSUE_REPO}/pulls/${PR_NUMBER}/reviews?per_page=100" \
      --jq '[.[] | select(.submitted_at > "'"$REVIEWED_AT"'")] | length')

    TOTAL_RESPONSES=$(( NEW_COMMENTS + NEW_REVIEWS ))

    if [[ "$TOTAL_RESPONSES" -gt 0 ]]; then
      echo "Review response received after ${ELAPSED}s."
      REVIEW_RECEIVED=1
      break
    fi

    echo "  Polling... (${ELAPSED}s elapsed, no response yet)"
  done

  GLOBAL_TIMEOUT=10800  # 3 hours
  while [[ "$REVIEW_RECEIVED" -eq 0 ]]; do
    if [[ "$ELAPSED" -ge "$GLOBAL_TIMEOUT" ]]; then
      echo "Error: no review response within 3h global timeout. Check PR manually: ${PR_URL}" >&2
      exit 1
    fi
    echo "No review response within timeout. Extending wait by 5m..."
    EXTRA=0
    while [[ "$EXTRA" -lt 300 && "$ELAPSED" -lt "$GLOBAL_TIMEOUT" ]]; do
      sleep "$POLL_INTERVAL"
      EXTRA=$((EXTRA + POLL_INTERVAL))
      ELAPSED=$((ELAPSED + POLL_INTERVAL))

      NEW_COMMENTS=$(gh api "repos/${ISSUE_OWNER}/${ISSUE_REPO}/issues/${PR_NUMBER}/comments?per_page=100" \
        --jq '[.[] | select((.id | tonumber) > '"$REVIEW_REQUEST_COMMENT_ID"')] | length')
      NEW_REVIEWS=$(gh api "repos/${ISSUE_OWNER}/${ISSUE_REPO}/pulls/${PR_NUMBER}/reviews?per_page=100" \
        --jq '[.[] | select(.submitted_at > "'"$REVIEWED_AT"'")] | length')
      TOTAL_RESPONSES=$(( NEW_COMMENTS + NEW_REVIEWS ))

      if [[ "$TOTAL_RESPONSES" -gt 0 ]]; then
        echo "Review response received."
        REVIEW_RECEIVED=1
        break
      fi

      echo "  Polling... (${ELAPSED}s total elapsed, no response yet)"
    done
  done

  # Check for P0/P1 findings in PR comments posted after the review request
  P1_FROM_COMMENTS=$(gh api "repos/${ISSUE_OWNER}/${ISSUE_REPO}/issues/${PR_NUMBER}/comments?per_page=100" \
    --jq '.[] | select((.id | tonumber) > '"$REVIEW_REQUEST_COMMENT_ID"') | select(.body | test("(?i)\\b(P0|P1)\\b")) | "@" + .user.login + ": " + .body')

  # Check PR reviews submitted after the review request
  P1_FROM_REVIEWS=$(gh api "repos/${ISSUE_OWNER}/${ISSUE_REPO}/pulls/${PR_NUMBER}/reviews?per_page=100" \
    --jq '.[] | select(.submitted_at > "'"$REVIEWED_AT"'") | select(.body | test("(?i)\\b(P0|P1)\\b")) | "@" + .user.login + ": " + .body')

  P1_COMMENTS="${P1_FROM_COMMENTS}${P1_FROM_REVIEWS}"

  if [[ -n "$P1_COMMENTS" ]]; then
    echo "Detected P0/P1 findings in loop ${LOOP_NUMBER}. Continuing..."
    LOOP_NUMBER=$((LOOP_NUMBER + 1))
    continue
  fi

  gh pr comment "$PR_NUMBER" --repo "$TARGET_REPO" --body "well done boys" >/dev/null
  echo "No P0/P1 findings detected. Posted: well done boys"
  break
done

echo "Completed codex-smash workflow."
echo "Branch: ${BRANCH_NAME}"
echo "PR: ${PR_URL}"
