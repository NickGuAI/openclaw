---
name: twenty-crm
description: Query and update Twenty CRM person records via REST. Use when a task requires finding a person by name, pulling full person data, or updating a person record in Twenty.
metadata:
  openclaw:
    requires:
      bins:
        - curl
        - jq
      env:
        - TWENTY_API_KEY
    primaryEnv: TWENTY_API_KEY
---

# Twenty CRM Person Operations

Use this skill to run reliable person lookups and updates against the Twenty REST API.

## Setup

Set auth in environment variables, or place them in `{baseDir}/.env`.

```bash
export TWENTY_API_KEY="your-token"
export TWENTY_BASE_URL="https://api.twenty.com/rest"
```

`TWENTY_BASE_URL` is optional. Default is `https://api.twenty.com/rest`.

## Quick Start

Find records by name:

```bash
{baseDir}/scripts/twenty_people.sh find --name "Jane Doe"
```

Pull one person record:

```bash
{baseDir}/scripts/twenty_people.sh get --id 11111111-2222-3333-4444-555555555555
```

Update a person with inline JSON:

```bash
{baseDir}/scripts/twenty_people.sh update \
  --id 11111111-2222-3333-4444-555555555555 \
  --json '{"jobTitle":"Head of Partnerships","city":"Austin"}'
```

Update from a JSON file:

```bash
{baseDir}/scripts/twenty_people.sh update \
  --id 11111111-2222-3333-4444-555555555555 \
  --file /tmp/person_update.json
```

## Workflow

1. Run `find` with `--name` to locate candidate records.
2. If multiple people match, confirm the target `id` before changing data.
3. Run `get` to inspect the current record.
4. Run `update` with the smallest valid JSON payload.
5. Run `get` again to verify the change.

## Command Notes

- `find` accepts either `--name` or raw `--filter`.
- `find` also supports `--limit`, `--depth`, `--order-by`, and `--raw`.
- `get` requires `--id` and supports `--depth` and `--raw`.
- `update` requires `--id` and one payload input:
  - `--json '<object>'`
  - `--file /path/to/payload.json`
  - `--stdin`
- Use `--raw` on any command to print the full API response object.

## References

Read `references/people-api.md` for endpoint, filter, and response-key details extracted from the provided Twenty OpenAPI schema.
