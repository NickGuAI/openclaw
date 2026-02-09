import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock execFile with custom promisify support so promisify(execFile) returns our mock.
// Node's promisify uses Symbol.for('nodejs.util.promisify.custom') for execFile.
const { loadConfigMock, mockExecFileAsync, readAllowFromStoreMock } = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  mockExecFileAsync: vi.fn(),
  readAllowFromStoreMock: vi.fn(),
}));

vi.mock("node:child_process", () => {
  const fn = (() => {}) as ((...args: unknown[]) => void) & Record<symbol, unknown>;
  fn[Symbol.for("nodejs.util.promisify.custom")] = mockExecFileAsync;
  return { execFile: fn };
});

vi.mock("openclaw/plugin-sdk", () => ({
  loadConfig: loadConfigMock,
  readChannelAllowFromStore: readAllowFromStoreMock,
}));

// Mock delivery-context
vi.mock("./delivery-context.js", () => ({
  writeDeliveryContext: vi.fn().mockResolvedValue(undefined),
  resolveThreadKeyByMessageId: vi.fn().mockResolvedValue(null),
}));

import { resolveThreadKeyByMessageId, writeDeliveryContext } from "./delivery-context.js";
import transform from "./gmail-transform.js";

// Helper: make gog return specific headers
function mockGogHeaders(headers: Array<{ name: string; value: string }>) {
  mockExecFileAsync.mockResolvedValueOnce({
    stdout: JSON.stringify({ message: { payload: { headers } } }),
    stderr: "",
  });
}

function mockGogFailure() {
  mockExecFileAsync.mockRejectedValue(new Error("gog not available"));
}

describe("gmail-transform", () => {
  const baseCtx = {
    headers: {},
    url: new URL("http://localhost/hooks/gmail"),
    path: "gmail",
  };

  beforeEach(() => {
    loadConfigMock.mockReturnValue({});
    readAllowFromStoreMock.mockResolvedValue([]);
    mockGogFailure();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no messages in payload", async () => {
    const result = await transform({ ...baseCtx, payload: {} });
    expect(result).toBeNull();
  });

  it("returns null when messages array is empty", async () => {
    const result = await transform({ ...baseCtx, payload: { messages: [] } });
    expect(result).toBeNull();
  });

  it("allows sender in config allowFrom", async () => {
    loadConfigMock.mockReturnValue({
      channels: {
        "email-gmail": {
          allowFrom: ["allowed@example.com"],
        },
      },
    });

    const result = await transform({
      ...baseCtx,
      payload: {
        messages: [
          {
            id: "msg-allow",
            threadId: "thread-allow",
            from: "Allowed User <allowed@example.com>",
            body: "Hi",
          },
        ],
      },
    });

    expect(result).not.toBeNull();
  });

  it("returns null when sender is not in allowFrom", async () => {
    loadConfigMock.mockReturnValue({
      channels: {
        "email-gmail": {
          allowFrom: ["allowed@example.com"],
        },
      },
    });

    const result = await transform({
      ...baseCtx,
      payload: {
        messages: [
          {
            id: "msg-blocked",
            threadId: "thread-blocked",
            from: "blocked@example.com",
            body: "Hi",
          },
        ],
      },
    });

    expect(result).toBeNull();
    expect(mockExecFileAsync).not.toHaveBeenCalled();
    expect(writeDeliveryContext).not.toHaveBeenCalled();
  });

  it("allows all senders when allowFrom is empty", async () => {
    loadConfigMock.mockReturnValue({
      channels: {
        "email-gmail": {
          allowFrom: [],
        },
      },
    });

    const result = await transform({
      ...baseCtx,
      payload: {
        messages: [
          {
            id: "msg-open",
            threadId: "thread-open",
            from: "anyone@example.com",
            body: "Hello",
          },
        ],
      },
    });

    expect(result).not.toBeNull();
  });

  it("allows all senders when wildcard allowFrom is configured", async () => {
    loadConfigMock.mockReturnValue({
      channels: {
        "email-gmail": {
          allowFrom: ["*"],
        },
      },
    });

    const result = await transform({
      ...baseCtx,
      payload: {
        messages: [
          {
            id: "msg-wildcard",
            threadId: "thread-wildcard",
            from: "wildcard@example.com",
            body: "Hello",
          },
        ],
      },
    });

    expect(result).not.toBeNull();
  });

  it("transforms a Gmail message into agent session", async () => {
    const result = await transform({
      ...baseCtx,
      payload: {
        messages: [
          {
            id: "msg1",
            threadId: "thread123",
            from: "John Doe <john@example.com>",
            subject: "Help me with something",
            body: "Can you help me with this task?",
          },
        ],
      },
    });

    expect(result).not.toBeNull();
    expect(result!.kind).toBe("agent");
    expect(result!.sessionKey).toBe("email:thread:thread123");
    expect(result!.channel).toBe("email-gmail");
    expect(result!.to).toBe("john@example.com##thread123");
    expect(result!.deliver).toBe(true);
    expect(result!.wakeMode).toBe("now");
    expect(result!.message).toContain("Help me with something");
    expect(result!.message).toContain("Can you help me with this task?");
  });

  it("writes delivery context", async () => {
    await transform({
      ...baseCtx,
      payload: {
        messages: [
          {
            id: "msg1",
            threadId: "thread456",
            from: "user@test.com",
            subject: "Test",
            body: "Hello",
          },
        ],
      },
    });

    expect(writeDeliveryContext).toHaveBeenCalledWith("thread456", {
      threadId: "thread456",
      messageId: undefined,
      subject: "Test",
      references: undefined,
      from: "user@test.com",
    });
  });

  it("extracts email from Name <email> format", async () => {
    const result = await transform({
      ...baseCtx,
      payload: {
        messages: [
          {
            id: "msg1",
            threadId: "t1",
            from: '"Jane Smith" <jane@corp.com>',
            body: "Hi",
          },
        ],
      },
    });

    expect(result!.to).toBe("jane@corp.com##t1");
  });

  it("falls back to message id when threadId is missing", async () => {
    const result = await transform({
      ...baseCtx,
      payload: {
        messages: [
          {
            id: "fallback-id",
            from: "test@test.com",
            body: "No thread",
          },
        ],
      },
    });

    expect(result!.sessionKey).toBe("email:thread:fallback-id");
  });

  it("strips quoted reply content from body", async () => {
    const result = await transform({
      ...baseCtx,
      payload: {
        messages: [
          {
            id: "msg1",
            threadId: "t1",
            from: "user@test.com",
            body: "New content here\n\nOn Mon, Jan 1, 2026 at 10:00 AM Agent wrote:\n> Old content",
          },
        ],
      },
    });

    expect(result!.message).toContain("New content here");
    expect(result!.message).not.toContain("Old content");
  });

  it("uses snippet when body is empty", async () => {
    const result = await transform({
      ...baseCtx,
      payload: {
        messages: [
          {
            id: "msg1",
            threadId: "t1",
            from: "user@test.com",
            snippet: "Short snippet text",
          },
        ],
      },
    });

    expect(result!.message).toContain("Short snippet text");
  });

  it("encodes threadId in to field with ## separator", async () => {
    const result = await transform({
      ...baseCtx,
      payload: {
        messages: [
          {
            id: "msg1",
            threadId: "abc123def",
            from: "user@domain.com",
            body: "Test",
          },
        ],
      },
    });

    expect(result!.to).toBe("user@domain.com##abc123def");
    // Verify the format can be split
    const [email, threadId] = result!.to.split("##");
    expect(email).toBe("user@domain.com");
    expect(threadId).toBe("abc123def");
  });

  it("resolves cross-domain thread via In-Reply-To and message-ID index", async () => {
    // Scenario: user replies from Superhuman, Gmail assigns new threadId.
    // gog fetches In-Reply-To pointing to our SES reply.
    // resolveThreadKeyByMessageId finds the original thread key.
    mockGogHeaders([
      { name: "Message-ID", value: "<reply2@superhuman.com>" },
      { name: "In-Reply-To", value: "<ses-reply@amazonses.com>" },
      { name: "References", value: "<ses-reply@amazonses.com>" },
    ]);
    vi.mocked(resolveThreadKeyByMessageId).mockResolvedValueOnce("original-thread-key");

    const result = await transform({
      ...baseCtx,
      payload: {
        messages: [
          {
            id: "msg3",
            threadId: "new-gmail-thread",
            from: "user@example.com",
            to: "agent@test.com",
            subject: "Re: Original subject",
            body: "Follow-up message",
          },
        ],
      },
    });

    expect(resolveThreadKeyByMessageId).toHaveBeenCalledWith("<ses-reply@amazonses.com>");
    expect(result!.sessionKey).toBe("email:thread:original-thread-key");
    expect(result!.to).toBe("user@example.com##original-thread-key");

    // Delivery context stores Gmail's threadId for API use
    expect(writeDeliveryContext).toHaveBeenCalledWith("original-thread-key", {
      threadId: "new-gmail-thread",
      messageId: "<reply2@superhuman.com>",
      subject: "Re: Original subject",
      references: "<ses-reply@amazonses.com>",
      from: "user@example.com",
    });
  });

  it("uses messageId from gog as thread key for first message", async () => {
    mockGogHeaders([{ name: "Message-ID", value: "<first@superhuman.com>" }]);

    const result = await transform({
      ...baseCtx,
      payload: {
        messages: [
          {
            id: "msg1",
            threadId: "gmail-t1",
            from: "user@example.com",
            subject: "New thread",
            body: "First message",
          },
        ],
      },
    });

    // First message: no In-Reply-To, so use messageId as thread key
    expect(result!.sessionKey).toBe("email:thread:<first@superhuman.com>");
    expect(result!.to).toBe("user@example.com##<first@superhuman.com>");
  });

  it("passes account to gog when msg.to is present", async () => {
    mockGogHeaders([]);

    await transform({
      ...baseCtx,
      payload: {
        messages: [
          {
            id: "msg1",
            threadId: "t1",
            from: "sender@example.com",
            to: "Agent <agent@test.com>",
            body: "Test",
          },
        ],
      },
    });

    // Verify gog was called with --account agent@test.com
    // mockExecFileAsync receives ("gog", argsArray, opts)
    const gogArgs = mockExecFileAsync.mock.calls[0][1] as string[];
    expect(gogArgs).toContain("--account");
    expect(gogArgs).toContain("agent@test.com");
  });
});
