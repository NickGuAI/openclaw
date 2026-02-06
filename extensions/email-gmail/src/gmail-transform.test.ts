import { afterEach, describe, expect, it, vi } from "vitest";

// Mock delivery-context
vi.mock("./delivery-context.js", () => ({
  writeDeliveryContext: vi.fn().mockResolvedValue(undefined),
}));

import { writeDeliveryContext } from "./delivery-context.js";
import transform from "./gmail-transform.js";

describe("gmail-transform", () => {
  const baseCtx = {
    headers: {},
    url: new URL("http://localhost/hooks/gmail"),
    path: "gmail",
  };

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

  it("uses root Reference as stable thread key for cross-domain threading", async () => {
    // Simulates reply arriving with References from a cross-domain thread
    // (e.g., Superhuman → SES). Gmail assigns a new threadId but References
    // preserves the real chain.
    const result = await transform({
      ...baseCtx,
      payload: {
        messages: [
          {
            id: "msg3",
            threadId: "new-gmail-thread",
            from: "user@example.com",
            subject: "Re: Original subject",
            body: "Follow-up message",
            messageId: "<reply2@superhuman.com>",
            references: "<root@superhuman.com> <ses-reply@amazonses.com>",
          },
        ],
      },
    });

    // Thread key should be the root Message-ID, not Gmail's threadId
    expect(result!.sessionKey).toBe("email:thread:<root@superhuman.com>");
    expect(result!.to).toBe("user@example.com##<root@superhuman.com>");

    // Delivery context stores Gmail's threadId for API use
    expect(writeDeliveryContext).toHaveBeenCalledWith("<root@superhuman.com>", {
      threadId: "new-gmail-thread",
      messageId: "<reply2@superhuman.com>",
      subject: "Re: Original subject",
      references: "<root@superhuman.com> <ses-reply@amazonses.com>",
      from: "user@example.com",
    });
  });

  it("uses messageId as thread key for first message (no References)", async () => {
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
            messageId: "<first@superhuman.com>",
          },
        ],
      },
    });

    // First message: no references, so use messageId as thread key
    expect(result!.sessionKey).toBe("email:thread:<first@superhuman.com>");
    expect(result!.to).toBe("user@example.com##<first@superhuman.com>");
  });
});
