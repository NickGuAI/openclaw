# Claude SDK Adapter

Replace pi-ai's internal Anthropic implementation with the official `@anthropic-ai/sdk`.

## Motivation

1. **Official SDK** - Direct support from Anthropic, faster access to new features
2. **Simpler dependency** - One SDK instead of pi-ai's multi-provider abstraction
3. **Better debugging** - Official SDK has better error messages and docs
4. **OAuth alignment** - SDK has native OAuth support matching Anthropic's auth flow

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      OpenClaw                                │
│                                                              │
│   run.ts: resolves API key via auth profiles                 │
│   ↓ sets authStorage.setRuntimeApiKey()                      │
│   ↓                                                          │
│   attempt.ts: configures agent.streamFn                      │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│   StreamFn decorator chain (attempt.ts:508-531)              │
│                                                              │
│   1. base streamFn (streamSimple OR claudeSdkAdapter)        │
│   2. → applyExtraParamsToAgent() wraps with config params    │
│   3. → cacheTrace.wrapStreamFn() (optional debug logging)    │
│   4. → anthropicPayloadLogger.wrapStreamFn() (optional)      │
└──────────────────────────┬──────────────────────────────────┘
                           │
         ┌─────────────────┴──────────────────┐
         │ provider === "anthropic"?          │
         ├───── YES ──────────┬────── NO ─────┤
         ▼                    │               ▼
┌──────────────────┐          │   ┌──────────────────────┐
│ Claude SDK       │          │   │ streamSimple          │
│ Adapter (new)    │          │   │ (pi-ai, unchanged)    │
│                  │          │   │ OpenAI, Gemini, etc.  │
│ - Direct HTTPS   │          │   └──────────────────────┘
│ - Native OAuth   │          │
│ - Cache control  │          │
└──────────────────┘          │
```

## Codebase Context

### Current Flow (what we're changing)

**Auth resolution** happens in `src/agents/pi-embedded-runner/run.ts`:
- `resolveApiKeyForProvider()` → resolves API key from auth profiles, env vars, etc.
- `authStorage.setRuntimeApiKey(model.provider, apiKeyInfo.apiKey)` → stores key for pi-ai to read
- pi-ai's `streamSimple` internally reads the key from `authStorage` when making HTTP calls

**StreamFn assignment** happens in `src/agents/pi-embedded-runner/run/attempt.ts:508-531`:
```typescript
// Line 509: base assignment
activeSession.agent.streamFn = streamSimple;

// Lines 511-517: wrap with extra params (temperature, maxTokens, cacheRetention)
applyExtraParamsToAgent(activeSession.agent, params.config, params.provider, params.modelId, params.streamParams);

// Line 525: optional cache trace wrapper
activeSession.agent.streamFn = cacheTrace.wrapStreamFn(activeSession.agent.streamFn);

// Lines 528-530: optional anthropic payload logger wrapper
activeSession.agent.streamFn = anthropicPayloadLogger.wrapStreamFn(activeSession.agent.streamFn);
```

**The wrappers are compatible** - they all follow the `StreamFn` signature and delegate to the inner function. The adapter only needs to replace the base `streamSimple` call; the wrapper chain works unchanged.

### Key Types (from @mariozechner/pi-ai v0.50.9)

```typescript
// StreamFn = same signature as streamSimple, sync or async return
type StreamFn = (...args: Parameters<typeof streamSimple>) =>
  ReturnType<typeof streamSimple> | Promise<ReturnType<typeof streamSimple>>;

// streamSimple signature
function streamSimple<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream;

// Context
interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

// Message = UserMessage | AssistantMessage | ToolResultMessage
interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}
interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;        // e.g. "anthropic-messages"
  provider: Provider; // e.g. "anthropic"
  model: string;   // e.g. "claude-sonnet-4-20250514"
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  timestamp: number;
}
interface ToolResultMessage<TDetails = any> {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  details?: TDetails;
  isError: boolean;
  timestamp: number;
}

// Content blocks
interface TextContent {
  type: "text";
  text: string;
  textSignature?: string;
}
interface ThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
}
interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;
  thoughtSignature?: string;
}
interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

// Usage
interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

// SimpleStreamOptions
interface SimpleStreamOptions extends StreamOptions {
  reasoning?: ThinkingLevel;
  thinkingBudgets?: ThinkingBudgets;
}
interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  apiKey?: string;
  cacheRetention?: "none" | "short" | "long";
  sessionId?: string;
  onPayload?: (payload: unknown) => void;
  headers?: Record<string, string>;
  maxRetryDelayMs?: number;
}

// AssistantMessageEventStream (extends EventStream)
class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
  constructor();
  push(event: AssistantMessageEvent): void;
  end(result?: AssistantMessage): void;
  [Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent>;
  result(): Promise<AssistantMessage>;
}

// All event types require `partial: AssistantMessage` (except done/error)
type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: "stop" | "length" | "toolUse"; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };

// Model
interface Model<TApi extends Api> {
  id: string;
  name: string;
  api: TApi;         // "anthropic-messages"
  provider: Provider; // "anthropic"
  baseUrl: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
}

// Tool
interface Tool<TParameters extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParameters;
}
```

### API Key Flow

API key is resolved **before** `attempt.ts` runs, in `run.ts:214-247`:

```typescript
// run.ts resolves API key and sets it in authStorage
const apiKeyInfo = await getApiKeyForModel({ model, cfg, profileId, store, agentDir });
authStorage.setRuntimeApiKey(model.provider, apiKeyInfo.apiKey);
```

The `streamSimple` function receives the key via `options.apiKey` (set by wrappers or passed through). The adapter needs to read from the same source.

**Two approaches:**

1. **Read `options.apiKey`** - The `StreamOptions` interface has an `apiKey` field. The existing `applyExtraParamsToAgent` wrapper and the agent core's `agentLoop` pass `apiKey` through options. The adapter can read `options?.apiKey` at call time.

2. **Use `agent.getApiKey` callback** - The `Agent` class supports a `getApiKey?: (provider: string) => Promise<string | undefined>` callback for dynamic key resolution. This is already used for GitHub Copilot tokens.

**Recommended: Approach 1** - Read `options.apiKey` since the existing flow already passes it through. Fall back to a pre-configured client key if not provided.

## Implementation

### Step 1: Add dependency

```bash
pnpm add @anthropic-ai/sdk
```

Add to root `package.json` `dependencies`:
```json
"@anthropic-ai/sdk": "^0.39.0"
```

### Step 2: Create adapter

**File: `src/agents/adapters/claude-sdk-stream.ts`**

Place under `src/agents/adapters/` since this is agent infrastructure, not a top-level adapter.

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { StreamFn } from "@mariozechner/pi-agent-core";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  SimpleStreamOptions,
  TextContent,
  ThinkingContent,
  ToolCall,
  Tool,
} from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";

/**
 * Convert pi-ai Context + SimpleStreamOptions into an Anthropic SDK
 * MessageCreateParamsStreaming and push translated events into a
 * pi-ai AssistantMessageEventStream.
 *
 * Returns an AssistantMessageEventStream (same class streamSimple uses)
 * so all existing wrappers (extraParams, cacheTrace, payloadLogger) work unchanged.
 */
export function createClaudeSdkStreamFn(clientOrToken: Anthropic | string): StreamFn {
  const client =
    typeof clientOrToken === "string"
      ? new Anthropic({ apiKey: clientOrToken })
      : clientOrToken;

  return (model, context, options) => {
    const eventStream = createAssistantMessageEventStream();

    // Run async processing without blocking the return
    processStream(client, model, context, options, eventStream).catch((err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      const errorMsg = buildAssistantMessage(model, [], 0, 0, 0, 0, "error", error.message);
      eventStream.push({ type: "error", reason: "error", error: errorMsg });
      eventStream.end(errorMsg);
    });

    return eventStream;
  };
}

async function processStream(
  client: Anthropic,
  model: Model<any>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  eventStream: ReturnType<typeof createAssistantMessageEventStream>,
): Promise<void> {
  const messages = context.messages.map((msg) => convertMessage(msg));
  const tools = context.tools?.map(convertTool);

  // Build request params
  const thinkingBudget = resolveThinkingBudget(options?.reasoning, options?.thinkingBudgets);

  const requestParams: Anthropic.MessageCreateParamsStreaming = {
    model: model.id,
    max_tokens: options?.maxTokens ?? model.maxTokens ?? 8192,
    messages,
    stream: true,
  };

  // System prompt
  if (context.systemPrompt) {
    requestParams.system = context.systemPrompt;
  }

  // Tools
  if (tools && tools.length > 0) {
    requestParams.tools = tools;
  }

  // Extended thinking
  if (thinkingBudget) {
    requestParams.thinking = {
      type: "enabled",
      budget_tokens: thinkingBudget,
    };
    // When thinking is enabled, must remove temperature or set to 1
    delete requestParams.temperature;
  } else if (options?.temperature !== undefined) {
    requestParams.temperature = options.temperature;
  }

  // Invoke onPayload callback if provided (for payload logging)
  options?.onPayload?.(requestParams);

  // Start the stream
  const stream = client.messages.stream(requestParams, {
    signal: options?.signal,
    headers: options?.headers,
  });

  const contentBlocks: (TextContent | ThinkingContent | ToolCall)[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let stopReason: StopReason = "stop";
  let currentBlockIndex = -1;
  let currentBlockType: "text" | "thinking" | "tool_use" | null = null;

  type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

  const partial = () =>
    buildAssistantMessage(
      model, contentBlocks, inputTokens, outputTokens,
      cacheReadTokens, cacheWriteTokens, "stop",
    );

  for await (const event of stream) {
    switch (event.type) {
      case "message_start": {
        const usage = event.message.usage;
        inputTokens = usage?.input_tokens ?? 0;
        cacheReadTokens = (usage as any)?.cache_read_input_tokens ?? 0;
        cacheWriteTokens = (usage as any)?.cache_creation_input_tokens ?? 0;
        eventStream.push({ type: "start", partial: partial() });
        break;
      }

      case "content_block_start": {
        currentBlockIndex = event.index;
        const cb = event.content_block;
        if (cb.type === "text") {
          currentBlockType = "text";
          contentBlocks.push({ type: "text", text: "" });
          eventStream.push({ type: "text_start", contentIndex: currentBlockIndex, partial: partial() });
        } else if (cb.type === "thinking") {
          currentBlockType = "thinking";
          contentBlocks.push({ type: "thinking", thinking: "" });
          eventStream.push({ type: "thinking_start", contentIndex: currentBlockIndex, partial: partial() });
        } else if (cb.type === "tool_use") {
          currentBlockType = "tool_use";
          contentBlocks.push({
            type: "toolCall",
            id: cb.id,
            name: cb.name,
            arguments: {},
          });
          eventStream.push({ type: "toolcall_start", contentIndex: currentBlockIndex, partial: partial() });
        }
        break;
      }

      case "content_block_delta": {
        const delta = event.delta;
        if (delta.type === "text_delta") {
          const block = contentBlocks[currentBlockIndex] as TextContent;
          block.text += delta.text;
          eventStream.push({
            type: "text_delta",
            delta: delta.text,
            contentIndex: currentBlockIndex,
            partial: partial(),
          });
        } else if (delta.type === "thinking_delta") {
          const block = contentBlocks[currentBlockIndex] as ThinkingContent;
          block.thinking += delta.thinking;
          eventStream.push({
            type: "thinking_delta",
            delta: delta.thinking,
            contentIndex: currentBlockIndex,
            partial: partial(),
          });
        } else if (delta.type === "input_json_delta") {
          const block = contentBlocks[currentBlockIndex] as ToolCall & { _json?: string };
          block._json = (block._json ?? "") + delta.partial_json;
          eventStream.push({
            type: "toolcall_delta",
            delta: delta.partial_json,
            contentIndex: currentBlockIndex,
            partial: partial(),
          });
        }
        break;
      }

      case "content_block_stop": {
        if (currentBlockType === "text") {
          const block = contentBlocks[currentBlockIndex] as TextContent;
          // Capture textSignature if present in the raw content block
          const rawBlock = (event as any).content_block;
          if (rawBlock?.text_signature) {
            block.textSignature = rawBlock.text_signature;
          }
          eventStream.push({
            type: "text_end",
            content: block.text,
            contentIndex: currentBlockIndex,
            partial: partial(),
          });
        } else if (currentBlockType === "thinking") {
          const block = contentBlocks[currentBlockIndex] as ThinkingContent;
          // Capture thinking signature from the raw content block
          const rawBlock = (event as any).content_block;
          if (rawBlock?.signature) {
            block.thinkingSignature = rawBlock.signature;
          }
          eventStream.push({
            type: "thinking_end",
            content: block.thinking,
            contentIndex: currentBlockIndex,
            partial: partial(),
          });
        } else if (currentBlockType === "tool_use") {
          const block = contentBlocks[currentBlockIndex] as ToolCall & { _json?: string };
          try {
            block.arguments = JSON.parse(block._json ?? "{}");
          } catch {
            block.arguments = {};
          }
          delete block._json;
          eventStream.push({
            type: "toolcall_end",
            toolCall: block,
            contentIndex: currentBlockIndex,
            partial: partial(),
          });
        }
        currentBlockType = null;
        break;
      }

      case "message_delta": {
        const usage = event.usage;
        outputTokens = usage?.output_tokens ?? outputTokens;
        const sr = event.delta?.stop_reason;
        if (sr === "tool_use") stopReason = "toolUse";
        else if (sr === "max_tokens") stopReason = "length";
        else if (sr === "end_turn") stopReason = "stop";
        break;
      }

      case "message_stop": {
        const finalMsg = buildAssistantMessage(
          model, contentBlocks, inputTokens, outputTokens,
          cacheReadTokens, cacheWriteTokens, stopReason,
        );
        eventStream.push({
          type: "done",
          reason: stopReason as "stop" | "length" | "toolUse",
          message: finalMsg,
        });
        eventStream.end(finalMsg);
        return; // done
      }
    }
  }
}

// --- Conversion helpers ---

function buildAssistantMessage(
  model: Model<any>,
  content: (TextContent | ThinkingContent | ToolCall)[],
  inputTokens: number,
  outputTokens: number,
  cacheRead: number,
  cacheWrite: number,
  stopReason: string,
  errorMessage?: string,
): AssistantMessage {
  const cost = calculateCost(model, inputTokens, outputTokens, cacheRead, cacheWrite);
  return {
    role: "assistant",
    content: [...content],
    api: model.api,
    provider: model.provider,
    model: model.id,
    timestamp: Date.now(),
    stopReason: stopReason as any,
    ...(errorMessage ? { errorMessage } : {}),
    usage: {
      input: inputTokens,
      output: outputTokens,
      cacheRead,
      cacheWrite,
      totalTokens: inputTokens + outputTokens + cacheRead,
      cost,
    },
  };
}

function calculateCost(
  model: Model<any>,
  inputTokens: number,
  outputTokens: number,
  cacheRead: number,
  cacheWrite: number,
): { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } {
  // Use model.cost which has per-token pricing (already per-1M in model config)
  const mc = model.cost;
  const inputCost = (inputTokens / 1_000_000) * (mc?.input ?? 0);
  const outputCost = (outputTokens / 1_000_000) * (mc?.output ?? 0);
  const cacheReadCost = (cacheRead / 1_000_000) * (mc?.cacheRead ?? 0);
  const cacheWriteCost = (cacheWrite / 1_000_000) * (mc?.cacheWrite ?? 0);
  return {
    input: inputCost,
    output: outputCost,
    cacheRead: cacheReadCost,
    cacheWrite: cacheWriteCost,
    total: inputCost + outputCost + cacheReadCost + cacheWriteCost,
  };
}

function convertTool(tool: Tool): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description || "",
    input_schema: tool.parameters as Anthropic.Tool.InputSchema,
  };
}

function convertMessage(msg: Context["messages"][number]): Anthropic.MessageParam {
  if (msg.role === "user") {
    if (typeof msg.content === "string") {
      return { role: "user", content: msg.content };
    }
    const blocks: Anthropic.ContentBlockParam[] = [];
    for (const block of msg.content) {
      if (block.type === "text") {
        blocks.push({ type: "text", text: block.text });
      } else if (block.type === "image") {
        blocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: block.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: block.data,
          },
        });
      }
    }
    return { role: "user", content: blocks };
  }

  if (msg.role === "assistant") {
    const blocks: Anthropic.ContentBlockParam[] = [];
    for (const block of msg.content) {
      if (block.type === "text") {
        blocks.push({ type: "text", text: block.text });
      } else if (block.type === "thinking") {
        blocks.push({
          type: "thinking",
          thinking: block.thinking,
          signature: block.thinkingSignature ?? "",
        });
      } else if (block.type === "toolCall") {
        blocks.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.arguments,
        });
      }
    }
    return { role: "assistant", content: blocks };
  }

  if (msg.role === "toolResult") {
    const resultBlocks: Anthropic.ToolResultBlockParam["content"] = [];
    for (const block of msg.content) {
      if (block.type === "text") {
        resultBlocks.push({ type: "text", text: block.text });
      } else if (block.type === "image") {
        resultBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: block.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: block.data,
          },
        });
      }
    }
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: msg.toolCallId,
          content: resultBlocks,
          is_error: msg.isError,
        },
      ],
    };
  }

  throw new Error(`Unknown message role: ${(msg as any).role}`);
}

function resolveThinkingBudget(
  level?: string,
  budgets?: Record<string, number>,
): number | undefined {
  if (budgets && level && budgets[level] !== undefined) {
    return budgets[level];
  }
  // Default budgets matching pi-ai's built-in levels
  switch (level) {
    case "minimal": return 1024;
    case "low": return 4096;
    case "medium": return 8192;
    case "high": return 16384;
    case "xhigh": return 32768;
    default: return undefined;
  }
}
```

### Step 3: Integration point

**File: `src/agents/pi-embedded-runner/run/attempt.ts`**

The change is minimal. We conditionally use the Claude SDK adapter when the provider is Anthropic:

```typescript
// --- Before (line 509) ---
activeSession.agent.streamFn = streamSimple;

// --- After ---
import { createClaudeSdkStreamFn } from "../../adapters/claude-sdk-stream.js";

if (params.provider === "anthropic" || params.model.api === "anthropic-messages") {
  // Use official Claude SDK for Anthropic models.
  // The API key is already resolved in run.ts and available via options.apiKey
  // which gets passed through the wrapper chain.
  activeSession.agent.streamFn = createClaudeSdkStreamFn(apiKeyForSdk);
} else {
  activeSession.agent.streamFn = streamSimple;
}
```

**API key threading**: The API key needs to reach the adapter. Two options:

**Option A (recommended):** Pass the key when creating the adapter. The key is resolved in `run.ts` before `runEmbeddedAttempt` is called. Add `apiKey` to `EmbeddedRunAttemptParams`:

```typescript
// In run.ts, after resolving apiKeyInfo:
const attemptResult = await runEmbeddedAttempt({
  ...existingParams,
  resolvedApiKey: apiKeyInfo.apiKey,  // new field
});

// In attempt.ts:
if (params.provider === "anthropic") {
  activeSession.agent.streamFn = createClaudeSdkStreamFn(params.resolvedApiKey!);
}
```

**Option B:** Use `agent.getApiKey` callback on the Agent class. Set it in attempt.ts so the adapter can call it dynamically:

```typescript
// The Agent class already supports getApiKey callback
activeSession.agent.getApiKey = async (provider) => {
  // Read from authStorage which was set in run.ts
  return authStorage.getRuntimeApiKey?.(provider);
};
```

**Recommendation**: Option A is simpler and more explicit. The API key is already resolved and doesn't change during a single attempt. Pass it through params.

### Step 4: Preserve wrapper compatibility

The existing wrapper chain (`applyExtraParamsToAgent`, `cacheTrace.wrapStreamFn`, `anthropicPayloadLogger.wrapStreamFn`) all work by wrapping the `StreamFn` signature. They pass through `options` (including `temperature`, `maxTokens`, `cacheRetention`) and call the inner function.

The adapter reads these from `options` directly, so the wrappers work unchanged:

```
createClaudeSdkStreamFn(apiKey)   ← base: reads options.maxTokens, options.temperature, etc.
  ↓ wrapped by
applyExtraParamsToAgent()          ← merges config params into options
  ↓ wrapped by
cacheTrace.wrapStreamFn()         ← logs context, delegates unchanged
  ↓ wrapped by
anthropicPayloadLogger.wrapStreamFn() ← calls options.onPayload, delegates unchanged
```

The adapter calls `options?.onPayload?.(requestParams)` before sending, so the payload logger still captures the request.

### Step 5: Handle Anthropic-specific features

#### Cache control (cacheRetention)

The `options.cacheRetention` from `SimpleStreamOptions` maps to Anthropic's `cache_control`:

```typescript
// In the adapter, before sending:
if (options?.cacheRetention && options.cacheRetention !== "none") {
  // Add cache_control to system prompt blocks
  if (requestParams.system && typeof requestParams.system === "string") {
    requestParams.system = [{
      type: "text",
      text: requestParams.system,
      cache_control: { type: "ephemeral" },
    }];
  }
  // Add cache_control to last tool definition
  if (requestParams.tools?.length) {
    const lastTool = requestParams.tools[requestParams.tools.length - 1];
    (lastTool as any).cache_control = { type: "ephemeral" };
  }
}
```

#### Thinking signatures

The Claude API returns a `signature` field on thinking blocks. This maps to pi-ai's `thinkingSignature`:

- On `content_block_stop` for thinking blocks, capture `signature` from the raw response
- Set `block.thinkingSignature = rawBlock.signature`
- On `convertMessage()` for assistant messages with thinking, send `signature: block.thinkingSignature ?? ""`

#### Abort signal

Pass `options?.signal` to the Anthropic SDK via the request options:

```typescript
const stream = client.messages.stream(requestParams, {
  signal: options?.signal,
});
```

## Dependencies

Add to root `package.json`:

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0"
  }
}
```

## Event Mapping

| Claude SDK Event | pi-ai Event | Notes |
|---|---|---|
| `message_start` | `start` | Extract `usage.input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` |
| `content_block_start` (text) | `text_start` | Include `partial` |
| `content_block_delta` (text_delta) | `text_delta` | Include `partial` |
| `content_block_stop` (text) | `text_end` | Include `partial`, capture `textSignature` |
| `content_block_start` (thinking) | `thinking_start` | Include `partial` |
| `content_block_delta` (thinking_delta) | `thinking_delta` | Include `partial` |
| `content_block_stop` (thinking) | `thinking_end` | Include `partial`, capture `thinkingSignature` from `signature` |
| `content_block_start` (tool_use) | `toolcall_start` | Include `partial` |
| `content_block_delta` (input_json_delta) | `toolcall_delta` | Accumulate partial JSON |
| `content_block_stop` (tool_use) | `toolcall_end` | Parse accumulated JSON into `arguments` |
| `message_delta` | (internal) | Update `output_tokens` and `stop_reason` |
| `message_stop` | `done` | Build final AssistantMessage, call `eventStream.end()` |
| Error thrown | `error` | Build error AssistantMessage with `stopReason: "error"` |

## Message Format Mapping

### User Messages

| pi-ai | Claude SDK |
|---|---|
| `{ role: "user", content: "text" }` | `{ role: "user", content: "text" }` |
| `{ role: "user", content: [{ type: "text" }] }` | `{ role: "user", content: [{ type: "text" }] }` |
| `{ role: "user", content: [{ type: "image", data, mimeType }] }` | `{ role: "user", content: [{ type: "image", source: { type: "base64", data, media_type } }] }` |

### Assistant Messages

| pi-ai | Claude SDK |
|---|---|
| `{ type: "text", text, textSignature? }` | `{ type: "text", text }` |
| `{ type: "thinking", thinking, thinkingSignature? }` | `{ type: "thinking", thinking, signature }` |
| `{ type: "toolCall", id, name, arguments }` | `{ type: "tool_use", id, name, input }` |

### Tool Results

| pi-ai | Claude SDK |
|---|---|
| `{ role: "toolResult", toolCallId, toolName, content, isError }` | `{ role: "user", content: [{ type: "tool_result", tool_use_id, content, is_error }] }` |

## Files Changed

| File | Change |
|---|---|
| `package.json` | Add `@anthropic-ai/sdk` dependency |
| `src/agents/adapters/claude-sdk-stream.ts` | **New** - Claude SDK adapter |
| `src/agents/pi-embedded-runner/run/attempt.ts` | Conditional streamFn: Claude SDK for anthropic, streamSimple for others |
| `src/agents/pi-embedded-runner/run/types.ts` | Add `resolvedApiKey?: string` to `EmbeddedRunAttemptParams` |
| `src/agents/pi-embedded-runner/run.ts` | Pass `resolvedApiKey` in attempt params |

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Non-Anthropic models break | Guard with `params.provider === "anthropic"` check; non-Anthropic still uses `streamSimple` |
| Event stream contract mismatch | Use `createAssistantMessageEventStream()` from pi-ai (same class `streamSimple` returns) |
| Missing `partial` on events | All events include `partial: AssistantMessage` per the type definition |
| Missing `api`/`provider` on AssistantMessage | Read from `model.api` and `model.provider` |
| Thinking signature lost across turns | Capture from raw `content_block_stop` event, store in `thinkingSignature`, send back in `convertMessage` |
| Cache token tracking | Read `cache_read_input_tokens` and `cache_creation_input_tokens` from `message_start.usage` |
| Auth profile failover | No change needed - failover happens in `run.ts` which creates a new attempt with a new key |
| Wrapper chain breaks | Adapter returns `AssistantMessageEventStream` (pi-ai's own class), all wrappers pass through `options` |

## Limitations

1. **Claude-only** - This adapter only works with Anthropic models (anthropic-messages API). Other providers (OpenAI, Gemini, Bedrock) continue to use `streamSimple`.
2. **No batch API** - This is streaming-only; batch mode would need a separate adapter.
3. **Prompt caching** - Initial implementation supports `cache_control` via `cacheRetention` option. Full cache management (multi-breakpoint) is a future enhancement.

## Future Enhancements

1. **Multi-breakpoint caching** - Fine-grained `cache_control` placement beyond system prompt + last tool
2. **Batch API support** - Non-interactive workloads using `client.messages.batches`
3. **Token counting** - Pre-flight token estimation using `client.messages.count_tokens`
4. **Session-based caching** - Map `options.sessionId` to Anthropic's session-aware features when available
5. **Remove pi-ai Anthropic dependency** - Once adapter is stable, remove the Anthropic provider code from pi-ai's dependency tree (reduces bundle size)

## Testing

### Unit test: `src/agents/adapters/claude-sdk-stream.test.ts`

Test the conversion functions and event mapping:

```typescript
import { describe, it, expect } from "vitest";
// Test convertMessage, convertTool, resolveThinkingBudget, buildAssistantMessage
// Mock Anthropic SDK stream for event translation tests
```

### Live test: `src/agents/adapters/claude-sdk-stream.live.test.ts`

```typescript
import { createClaudeSdkStreamFn } from "./claude-sdk-stream.js";

const streamFn = createClaudeSdkStreamFn(process.env.ANTHROPIC_API_KEY!);

const model = {
  id: "claude-sonnet-4-20250514",
  name: "Claude Sonnet 4",
  api: "anthropic-messages" as const,
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  reasoning: true,
  input: ["text", "image"] as const,
  cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  contextWindow: 200000,
  maxTokens: 8192,
};

const context = {
  systemPrompt: "You are a helpful assistant.",
  messages: [{ role: "user" as const, content: "Say hello", timestamp: Date.now() }],
};

const stream = streamFn(model, context, { maxTokens: 64 });
for await (const event of stream) {
  console.log(event.type);
}
const result = await stream.result();
console.log("Final:", result.content, result.usage);
```
