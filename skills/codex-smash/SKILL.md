---
name: codex-smash
description: >
  Smash a GitHub issue end-to-end with Codex: create a feature branch,
  implement the fix, commit, open a PR, request deep review, wait, and then
  either fix P1 findings or post a success comment. Use when a user wants a
  no-nonsense issue execution flow from a GitHub issue URL.
argument-hint: <github-issue-url> [--team gammawave] [--wait-minutes 15] [--base main] [--no-wait]
disable-model-invocation: true
allowed-tools: Bash(gh *), Bash(git *), Bash(codex *), Bash(sleep *), Bash(bash *), Read, Grep, Glob
---

# Codex Smash

Run from the repository root:

```sh
bash "$(dirname "$0")/scripts/smash.sh" $ARGUMENTS
```

Default workflow:

1. Sync base branch (`main`) and create a feature branch.
2. Enter the review loop (repeat steps 2-8 until no `P0/P1` findings remain):
3. Invoke Codex to implement issue changes (first pass) or fix latest `P0/P1` findings (next passes), then commit.
4. Push branch and create/open PR.
5. Add PR comment:
   `@codex do a no nonsense deep review of the change for all. Find ALL P0/P1 issues. Explain why each added/exited file is good to go or has issues.`
6. Monitor for Codex review response (poll every 30s, timeout after `--wait-minutes`).
7. Once response received, check for `P0/P1` findings in PR comments and reviews.
8. If `P0/P1` findings exist, continue the loop from step 2. If no `P0/P1` findings exist, post `well done boys` and exit.

Notes:

- Requires clean git working tree before running.
- Requires `gh auth login` and push permissions.
- Use `--no-wait` or `--wait-minutes 0` to skip review monitoring (dry run).
