# Kaizen OS MCP API Reference

This reference documents the Kaizen MCP HTTP API used by the `kaizen-os` skill.

## Base URL and Auth

- Default base URL: `https://kaizen.gehirn.ai`
- Auth header: `X-API-Key: kaizen_sk_...`

Example:

```bash
curl -sS "https://kaizen.gehirn.ai/api/mcp/tools" \
  -H "X-API-Key: kaizen_sk_..."
```

## Endpoints

### `GET /api/mcp/tools`

Lists servers and tools visible to the API key (filtered by allowed servers and scopes).

Response shape:

```json
{
  "servers": {
    "kaizen-db": {
      "tools": [
        {
          "name": "list_cards",
          "description": "List cards with optional filters",
          "scope": "read"
        }
      ]
    }
  }
}
```

### `POST /api/mcp/call`

Executes one tool.

Request body:

```json
{
  "server": "kaizen-db",
  "tool": "list_cards",
  "args": {
    "limit": 20
  }
}
```

Response shape:

```json
{
  "result": {
    "content": [{ "type": "text", "text": "..." }]
  },
  "server": "kaizen-db",
  "tool": "list_cards",
  "durationMs": 12
}
```

## Error Codes

- `400`: invalid request body or invalid tool arguments
- `401`: missing, invalid, or expired API key
- `403`: server access forbidden or scope insufficient
- `404`: tool not found for the selected server
- `429`: API key rate limit exceeded

## Tool Arguments

All argument schemas are defined with Zod in server code. Types below match `app/src/server/agents/toolRegistry.ts`.

### `kaizen-db`

| Tool                          | Arguments                                                                                                                                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_cards`                  | `unitType?` (`THEME`, `ACTION_GATE`, `ACTION_EXPERIMENT`, `ACTION_ROUTINE`, `ACTION_OPS`, `VETO`), `parentId?` (string), `status?` (`not_started`, `in_progress`, `completed`, `backlog`), `limit?` (number, default `20`) |
| `get_card`                    | `cardId` (string)                                                                                                                                                                                                          |
| `create_card`                 | `title` (string), `unitType` (enum), `parentId?` (string), `description?` (string), `status?` (enum, default `not_started`), `criteria?` (string[])                                                                        |
| `update_card`                 | `cardId` (string), `title?` (string), `description?` (string), `status?` (enum), `targetDate?` (string), `criteria?` (string[]), `parentId?` (string or `null`)                                                            |
| `delete_card`                 | `cardId` (string)                                                                                                                                                                                                          |
| `get_active_season`           | no args                                                                                                                                                                                                                    |
| `get_recent_events`           | `limit?` (number, default `10`)                                                                                                                                                                                            |
| `list_cached_calendar_events` | `weekStart` (string, `YYYY-MM-DD`)                                                                                                                                                                                         |

### `workitems`

| Tool                | Arguments                                                                           |
| ------------------- | ----------------------------------------------------------------------------------- |
| `list_workitems`    | `startDate` (string, ISO date), `endDate` (string, ISO date), `accountId?` (string) |
| `get_workitem`      | `key` (string, format `gtasks:accountId:tasklistId:taskId`)                         |
| `complete_workitem` | `key` (string)                                                                      |
| `create_workitem`   | `title` (string), `dueDate?` (string, ISO date), `notes?` (string)                  |

### `scratchpad`

| Tool                | Arguments                                                         |
| ------------------- | ----------------------------------------------------------------- |
| `get_scratchpad`    | no args                                                           |
| `update_scratchpad` | `content` (string markdown), `append?` (boolean, default `false`) |
| `clear_scratchpad`  | no args                                                           |

### `calendar`

| Tool                    | Arguments                                                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_calendar_event` | `summary` (string), `start` (string, ISO 8601), `end` (string, ISO 8601), `description?` (string), `location?` (string), `isAllDay?` (boolean, default `false`)                                |
| `update_calendar_event` | `accountId` (string), `calendarId` (string), `eventId` (string), `summary?` (string), `description?` (string), `location?` (string), `start?` (string), `end?` (string), `isAllDay?` (boolean) |
| `delete_calendar_event` | `accountId` (string), `calendarId` (string), `eventId` (string)                                                                                                                                |

## Source Pointers

- Endpoint contract: `app/src/server/routes/mcp.ts`
- Tool schemas and handlers: `app/src/server/agents/toolRegistry.ts`
