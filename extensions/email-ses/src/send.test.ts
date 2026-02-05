import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSend = vi.fn().mockResolvedValue({ MessageId: "ses-msg-123" });

// Mock AWS SES before importing send module
vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class MockSESClient {
    send = mockSend;
  },
  SendRawEmailCommand: class MockSendRawEmailCommand {
    constructor(public params: unknown) {}
  },
}));

// Mock delivery-context
vi.mock("./delivery-context.js", () => ({
  readDeliveryContext: vi.fn().mockResolvedValue(null),
  updateDeliveryContextMessageId: vi.fn().mockResolvedValue(undefined),
}));

import { readDeliveryContext, updateDeliveryContextMessageId } from "./delivery-context.js";
import { sendEmailSes } from "./send.js";

describe("sendEmailSes", () => {
  const baseCfg = {
    channels: {
      "email-ses": {
        fromAddress: "agent@test.com",
        fromName: "TestBot",
        region: "us-east-1",
      },
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends email with plain email address", async () => {
    const result = await sendEmailSes({
      cfg: baseCfg,
      to: "user@example.com",
      text: "Hello from the agent",
    });

    expect(result.channel).toBe("email-ses");
    expect(result.messageId).toBe("ses-msg-123");
    expect(result.conversationId).toBe("user@example.com");
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("parses email##threadId format", async () => {
    vi.mocked(readDeliveryContext).mockResolvedValueOnce({
      threadId: "thread123",
      subject: "Test Subject",
      messageId: "<original@gmail.com>",
      from: "User <user@example.com>",
    });

    const result = await sendEmailSes({
      cfg: baseCfg,
      to: "user@example.com##thread123",
      text: "Reply text",
    });

    expect(result.conversationId).toBe("user@example.com");
    expect(readDeliveryContext).toHaveBeenCalledWith("thread123");
    expect(updateDeliveryContextMessageId).toHaveBeenCalledWith(
      "thread123",
      expect.stringContaining("@email.amazonses.com"),
    );
  });

  it("throws when fromAddress is not configured", async () => {
    await expect(
      sendEmailSes({
        cfg: { channels: {} } as any,
        to: "user@example.com",
        text: "Hello",
      }),
    ).rejects.toThrow("fromAddress not configured");
  });

  it("appends media URL as link when mediaUrl provided", async () => {
    mockSend.mockResolvedValueOnce({ MessageId: "ses-media-123" });

    const result = await sendEmailSes({
      cfg: baseCfg,
      to: "user@example.com",
      text: "Check this out",
      mediaUrl: "https://example.com/image.png",
    });

    expect(result.messageId).toBe("ses-media-123");
    // The raw email data sent to SES should contain the media URL
    const callArg = mockSend.mock.calls[0][0];
    const rawData = Buffer.from(callArg.params.RawMessage.Data).toString("utf-8");
    expect(rawData).toContain("https://example.com/image.png");
  });

  it("does not update delivery context when no threadId", async () => {
    await sendEmailSes({
      cfg: baseCfg,
      to: "user@example.com",
      text: "No thread",
    });

    expect(updateDeliveryContextMessageId).not.toHaveBeenCalled();
  });
});
