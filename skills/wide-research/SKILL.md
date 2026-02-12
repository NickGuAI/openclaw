---
name: wide-research
description: Run parallelized deep research across multiple angles. Generate specs, spawn Claude agents in tmux, monitor progress, fix incomplete reports, and compile a styled PDF.
metadata:
  openclaw:
    requires:
      bins:
        - claude
        - tmux
        - jq
        - python3
      env:
        - REPORT_PATH
    primaryEnv: REPORT_PATH
---

# Wide Research

Parallelized deep-research skill. Takes a topic, generates research angles, spawns Claude agents in tmux sessions with a worker pool, and compiles results into a styled PDF.

## Setup

Set `REPORT_PATH` in environment or in `{baseDir}/.env`:

```bash
export REPORT_PATH="$HOME/.ocreports"
```

Default is `~/.ocreports` if not set.

## Workflow

### 1. Initialize a project

Claude generates a spec JSON and pipes it to `init.sh`:

```bash
cat <<'EOF' | {baseDir}/scripts/init.sh my-research
{
  "description": "AI agent frameworks comparison",
  "angles": [
    { "label": "01", "title": "LangChain Analysis", "task": "Research LangChain architecture..." },
    { "label": "02", "title": "CrewAI Analysis", "task": "Research CrewAI patterns..." }
  ]
}
EOF
```

This creates the project directory with stubs and `specs.json`.

### 2. Run agents

```bash
{baseDir}/scripts/run.sh ~/.ocreports/my-research
```

Options:

```
--fix-only       Only re-run incomplete reports
--dry-run        Show what would happen without launching
--max-workers N  Max concurrent tmux sessions (default: 10)
```

### 3. Monitor progress

```bash
{baseDir}/scripts/status.sh ~/.ocreports/my-research
```

### 4. Fix incomplete reports

```bash
{baseDir}/scripts/run.sh ~/.ocreports/my-research --fix-only
```

### 5. Generate PDF report

```bash
{baseDir}/scripts/report.sh ~/.ocreports/my-research
```

Options:

```
--output <filename>  Override output filename
```

Requires Python packages: `markdown`, `weasyprint`. The script auto-installs them if missing.

### 6. Cleanup

```bash
{baseDir}/scripts/cleanup.sh ~/.ocreports/my-research
```

Use `--force` to skip confirmation.

## Spec JSON Format

```json
{
  "description": "Project description for the cover page",
  "angles": [
    {
      "label": "01",
      "title": "Human-readable title",
      "task": "Detailed research instructions for the agent"
    }
  ]
}
```

## Environment Variables

| Variable        | Default        | Description                              |
| --------------- | -------------- | ---------------------------------------- |
| `REPORT_PATH`   | `~/.ocreports` | Base directory for all research projects |
| `MAX_WORKERS`   | `10`           | Max concurrent tmux agent sessions       |
| `POLL_INTERVAL` | `10`           | Seconds between worker pool checks       |
| `MODEL`         | (none)         | Claude model override                    |
