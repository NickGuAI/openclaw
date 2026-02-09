---
name: tavily-search
description: Search the web with Tavily API via curl. Use when users explicitly request Tavily, when you need Tavily-specific controls (search_depth, topic, time_range, include/exclude domains, include_answer, include_raw_content), or when built-in web_search provider setup is unavailable.
metadata:
  {
    "openclaw":
      {
        "requires": { "bins": ["curl"], "env": ["TAVILY_API_KEY"] },
        "primaryEnv": "TAVILY_API_KEY",
      },
  }
---

# Tavily Search (curl)

Use Tavily Search with the helper script:

```bash
{baseDir}/scripts/search.sh "latest AI chip launches"
```

## Quick examples

News in the last week:

```bash
{baseDir}/scripts/search.sh "AI regulation updates" --topic news --time-range week --max-results 8
```

Include an answer synthesized from results:

```bash
{baseDir}/scripts/search.sh "best practices for SOC2 readiness" --include-answer
```

Get richer answer quality:

```bash
{baseDir}/scripts/search.sh "energy storage market outlook" --answer-mode advanced
```

Limit to specific domains:

```bash
{baseDir}/scripts/search.sh "Fed minutes summary" --include-domains federalreserve.gov,reuters.com
```

Use date boundaries:

```bash
{baseDir}/scripts/search.sh "NVIDIA earnings call highlights" --start-date 2025-01-01 --end-date 2025-12-31
```

## Parameter guidance

- Default `search_depth` to `basic` for cost and latency.
- Use `advanced` (or `fast` / `ultra-fast`) only when request quality or speed needs justify it.
- Use `topic news` for current events; use `topic general` for broad lookup.
- Use `time_range` for recent windows (`day`, `week`, `month`, `year`).
- Use `country` only with `topic general`. Pass lowercase country names (for example: `united states`).
- Turn on `include_raw_content` only when downstream extraction truly needs full text.

## API key setup

Set `TAVILY_API_KEY`, or configure it in `~/.openclaw/openclaw.json`:

```bash
export TAVILY_API_KEY="tvly-..."
```

Or place it in this skill-local file:

```bash
{baseDir}/.env
```

with:

```bash
TAVILY_API_KEY=tvly-...
```

The script reads `{baseDir}/.env` automatically when `TAVILY_API_KEY` is not already set.

OpenClaw config option:

```json5
{
  skills: {
    entries: {
      "tavily-search": {
        apiKey: "tvly-...",
      },
    },
  },
}
```
