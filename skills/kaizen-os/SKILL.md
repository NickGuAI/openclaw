---
name: kaizen-os
description: Interact with Kaizen OS via MCP API to manage cards, workitems, scratchpad notes, and calendar events. Use when tasks involve planning, personal productivity, or scheduling.
metadata:
  openclaw:
    requires:
      bins:
        - curl
        - jq
      env:
        - KAIZEN_API_KEY
    primaryEnv: KAIZEN_API_KEY
---

# Kaizen OS MCP

Use this skill to call Kaizen OS MCP endpoints from shell scripts.

## Setup

Set credentials in environment variables, or place them in `{baseDir}/.env`.

```bash
export KAIZEN_API_KEY="kaizen_sk_..."
export KAIZEN_BASE_URL="https://kaizen.gehirn.ai"
```

`KAIZEN_BASE_URL` is optional. Default is `https://kaizen.gehirn.ai`.

Generate API keys in Kaizen OS at:

`Settings -> API Keys -> Create New Key`

## Quick Start

List available tools:

```bash
{baseDir}/scripts/kaizen.sh tools
```

List cards:

```bash
{baseDir}/scripts/kaizen.sh call kaizen-db list_cards
```

Create a card:

```bash
{baseDir}/scripts/kaizen.sh call kaizen-db create_card \
  --arg title="Ship v2 release" \
  --arg unitType=ACTION_GATE
```

Get workitems for a date range:

```bash
{baseDir}/scripts/kaizen.sh call workitems list_workitems \
  --arg startDate="2026-02-10" \
  --arg endDate="2026-02-10"
```

Read scratchpad:

```bash
{baseDir}/scripts/kaizen.sh call scratchpad get_scratchpad
```

Append scratchpad content:

```bash
{baseDir}/scripts/kaizen.sh call scratchpad update_scratchpad \
  --arg content="## Meeting Notes" \
  --arg append=true
```

Create a calendar event:

```bash
{baseDir}/scripts/kaizen.sh call calendar create_calendar_event \
  --arg summary="Team standup" \
  --arg start="2026-02-11T09:00:00-08:00" \
  --arg end="2026-02-11T09:30:00-08:00"
```

## Workflow

1. Run `tools` to discover servers and tool names.
2. Run `call <server> <tool> --arg key=value` to execute a tool.
3. Add `--raw` to print the unformatted JSON response.

## Server Reference

| Server       | Purpose                  | Key Tools                                                                      |
| ------------ | ------------------------ | ------------------------------------------------------------------------------ |
| `kaizen-db`  | Cards and seasons        | `list_cards`, `create_card`, `update_card`, `delete_card`, `get_active_season` |
| `workitems`  | Google Tasks integration | `list_workitems`, `create_workitem`, `complete_workitem`                       |
| `scratchpad` | Markdown notes           | `get_scratchpad`, `update_scratchpad`, `clear_scratchpad`                      |
| `calendar`   | Calendar events          | `create_calendar_event`, `update_calendar_event`, `delete_calendar_event`      |

## Config

OpenClaw managed configuration example:

```json5
{
  skills: {
    entries: {
      "kaizen-os": {
        apiKey: "kaizen_sk_...",
        env: {
          KAIZEN_BASE_URL: "https://kaizen.gehirn.ai",
        },
      },
    },
  },
}
```

## Argument Notes

- `--arg` accepts `key=value` pairs.
- Values auto-convert to JSON booleans (`true`, `false`), `null`, and numbers.
- To pass arrays/objects, provide valid JSON in the value.

Example:

```bash
{baseDir}/scripts/kaizen.sh call kaizen-db create_card \
  --arg title="Launch checklist" \
  --arg unitType=ACTION_EXPERIMENT \
  --arg criteria='["Tests green", "Docs updated"]'
```

## References

See `references/mcp-api.md` for endpoint contract, error codes, and full tool argument reference.
