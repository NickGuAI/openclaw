import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./gmail-auth.js", () => ({
  resolveGmailCredentials: vi.fn(),
  refreshGmailAccessToken: vi.fn(),
}));

vi.mock("./delivery-context.js", () => ({
  readDeliveryContext: vi.fn().mockResolvedValue(null),
  updateDeliveryContextMessageId: vi.fn().mockResolvedValue(undefined),
  writeMessageIdIndex: vi.fn().mockResolvedValue(undefined),
}));

import {
  readDeliveryContext,
  updateDeliveryContextMessageId,
  writeMessageIdIndex,
} from "./delivery-context.js";
import { refreshGmailAccessToken, resolveGmailCredentials } from "./gmail-auth.js";
import { sendEmailGmail } from "./send.js";

function decodeBase64Url(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (base64.length % 4)) % 4;
  const padded = base64 + "=".repeat(padLength);
  return Buffer.from(padded, "base64").toString("utf-8");
}

function mockValidCredentials() {
  vi.mocked(resolveGmailCredentials).mockResolvedValue({
    clientId: "cid",
    clientSecret: "secret",
    refreshToken: "refresh",
    accessToken: "access",
    expiresAt: Date.now() + 60_000,
  });
}

function mockSuccessfulSend(fetchMock: ReturnType<typeof vi.fn>, id = "gmail-msg-123") {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ id }),
    text: async () => "",
  });
}

describe("sendEmailGmail", () => {
  const baseCfg = {
    channels: {
      "email-gmail": {
        fromAddress: "agent@test.com",
        fromName: "TestBot",
      },
    },
  } as any;

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends email with plain email address", async () => {
    mockValidCredentials();
    mockSuccessfulSend(fetchMock);

    const result = await sendEmailGmail({
      cfg: baseCfg,
      to: "user@example.com",
      text: "Hello from the agent",
    });

    expect(result.channel).toBe("email-gmail");
    expect(result.messageId).toBe("gmail-msg-123");
    expect(result.conversationId).toBe("user@example.com");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("parses email##threadKey format and uses deliveryCtx.threadId for Gmail API", async () => {
    mockValidCredentials();

    // Thread key in `to` is a Message-ID (from References-based threading),
    // but delivery context stores the real Gmail threadId for API calls.
    vi.mocked(readDeliveryContext).mockResolvedValueOnce({
      threadId: "gmail-thread-abc",
      subject: "Test Subject",
      messageId: "<original@gmail.com>",
      from: "User <user@example.com>",
    });

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "gmail-msg-456", threadId: "gmail-thread-abc" }),
      text: async () => "",
    });

    const result = await sendEmailGmail({
      cfg: baseCfg,
      to: "user@example.com##<root@superhuman.com>",
      text: "Reply text",
    });

    expect(result.conversationId).toBe("user@example.com");
    expect(readDeliveryContext).toHaveBeenCalledWith("<root@superhuman.com>");

    const call = fetchMock.mock.calls[0];
    const body = JSON.parse(call[1].body as string) as { raw: string; threadId?: string };
    // Gmail API gets the real Gmail threadId, not the Message-ID thread key
    expect(body.threadId).toBe("gmail-thread-abc");

    const decoded = decodeBase64Url(body.raw);
    expect(decoded).toContain("In-Reply-To: <original@gmail.com>");
    expect(decoded).toContain("To: user@example.com");
    expect(decoded).not.toContain("\r\nCc:");

    expect(updateDeliveryContextMessageId).toHaveBeenCalledWith(
      "<root@superhuman.com>",
      expect.stringContaining("@openclaw.email"),
    );

    // Message-ID index written for cross-domain thread resolution
    expect(writeMessageIdIndex).toHaveBeenCalledWith(
      expect.stringContaining("@openclaw.email"),
      "<root@superhuman.com>",
    );
  });

  it("sends reply-all with CC from delivery context", async () => {
    mockValidCredentials();
    mockSuccessfulSend(fetchMock, "gmail-msg-reply-all");
    vi.mocked(readDeliveryContext).mockResolvedValueOnce({
      threadId: "gmail-thread-cc",
      messageId: "<original@gmail.com>",
      from: "Sender <sender@example.com>",
      toRecipients: ["agent@test.com", "other-to@example.com"],
      ccRecipients: ["cc-one@example.com", "cc-two@example.com"],
    });

    await sendEmailGmail({
      cfg: baseCfg,
      to: "sender@example.com##thread-key-cc",
      text: "Reply all message",
    });

    const call = fetchMock.mock.calls[0];
    const body = JSON.parse(call[1].body as string) as { raw: string };
    const decoded = decodeBase64Url(body.raw);
    expect(decoded).toContain("To: sender@example.com");
    expect(decoded).toContain("Cc: other-to@example.com, cc-one@example.com, cc-two@example.com");
  });

  it("uses Reply-To as primary To when present", async () => {
    mockValidCredentials();
    mockSuccessfulSend(fetchMock, "gmail-msg-reply-to");
    vi.mocked(readDeliveryContext).mockResolvedValueOnce({
      threadId: "gmail-thread-reply-to",
      messageId: "<original@gmail.com>",
      from: "Sender <sender@example.com>",
      replyTo: "reply-to@example.com",
      toRecipients: ["agent@test.com"],
    });

    await sendEmailGmail({
      cfg: baseCfg,
      to: "sender@example.com##thread-key-reply-to",
      text: "Reply to message",
    });

    const call = fetchMock.mock.calls[0];
    const body = JSON.parse(call[1].body as string) as { raw: string };
    const decoded = decodeBase64Url(body.raw);
    expect(decoded).toContain("To: reply-to@example.com");
  });

  it("filters agent address from CC", async () => {
    mockValidCredentials();
    mockSuccessfulSend(fetchMock, "gmail-msg-filter-agent");
    vi.mocked(readDeliveryContext).mockResolvedValueOnce({
      threadId: "gmail-thread-filter",
      messageId: "<original@gmail.com>",
      from: "sender@example.com",
      toRecipients: ["Agent <agent@test.com>", "teammate@example.com"],
      ccRecipients: ["AGENT@TEST.COM", "other@example.com"],
    });

    await sendEmailGmail({
      cfg: baseCfg,
      to: "sender@example.com##thread-key-filter",
      text: "Filter agent",
    });

    const call = fetchMock.mock.calls[0];
    const body = JSON.parse(call[1].body as string) as { raw: string };
    const decoded = decodeBase64Url(body.raw);
    expect(decoded).toContain("Cc: teammate@example.com, other@example.com");
    const ccLine = decoded
      .split("\r\n")
      .find((line) => line.startsWith("Cc: "))
      ?.toLowerCase();
    expect(ccLine).toBe("cc: teammate@example.com, other@example.com");
  });

  it("deduplicates addresses across To and CC", async () => {
    mockValidCredentials();
    mockSuccessfulSend(fetchMock, "gmail-msg-dedupe");
    vi.mocked(readDeliveryContext).mockResolvedValueOnce({
      threadId: "gmail-thread-dedupe",
      messageId: "<original@gmail.com>",
      from: "sender@example.com",
      toRecipients: ["duplicate@example.com", "sender@example.com"],
      ccRecipients: ["Duplicate@Example.com", "unique@example.com"],
    });

    await sendEmailGmail({
      cfg: baseCfg,
      to: "sender@example.com##thread-key-dedupe",
      text: "Dedupe",
    });

    const call = fetchMock.mock.calls[0];
    const body = JSON.parse(call[1].body as string) as { raw: string };
    const decoded = decodeBase64Url(body.raw);
    expect(decoded).toContain("Cc: duplicate@example.com, unique@example.com");
  });

  it("omits CC when delivery context is missing", async () => {
    mockValidCredentials();
    mockSuccessfulSend(fetchMock, "gmail-msg-no-context");

    await sendEmailGmail({
      cfg: baseCfg,
      to: "user@example.com##missing-thread-key",
      text: "No context",
    });

    const call = fetchMock.mock.calls[0];
    const body = JSON.parse(call[1].body as string) as { raw: string };
    const decoded = decodeBase64Url(body.raw);
    expect(decoded).toContain("To: user@example.com");
    expect(decoded).not.toContain("\r\nCc:");
  });

  it("refreshes token and retries on 401", async () => {
    vi.mocked(resolveGmailCredentials).mockResolvedValue({
      clientId: "cid",
      clientSecret: "secret",
      refreshToken: "refresh",
      accessToken: "stale",
      expiresAt: Date.now() + 60_000,
    });

    vi.mocked(refreshGmailAccessToken).mockResolvedValue("new-access");

    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({}),
        text: async () => "unauthorized",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "gmail-msg-789" }),
        text: async () => "",
      });

    const result = await sendEmailGmail({
      cfg: baseCfg,
      to: "user@example.com",
      text: "Retry me",
    });

    expect(result.messageId).toBe("gmail-msg-789");
    expect(refreshGmailAccessToken).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondHeaders = fetchMock.mock.calls[1][1].headers as Record<string, string>;
    expect(secondHeaders.Authorization).toBe("Bearer new-access");
  });

  it("throws when no credentials found", async () => {
    vi.mocked(resolveGmailCredentials).mockResolvedValue(undefined);

    await expect(
      sendEmailGmail({
        cfg: baseCfg,
        to: "user@example.com",
        text: "Hello",
      }),
    ).rejects.toThrow("credentials not found");
  });

  it("appends media URL as link when mediaUrl provided", async () => {
    mockValidCredentials();
    mockSuccessfulSend(fetchMock, "gmail-msg-media");

    await sendEmailGmail({
      cfg: baseCfg,
      to: "user@example.com",
      text: "Check this out",
      mediaUrl: "https://example.com/image.png",
    });

    const call = fetchMock.mock.calls[0];
    const body = JSON.parse(call[1].body as string) as { raw: string };
    const decoded = decodeBase64Url(body.raw);
    expect(decoded).toContain("https://example.com/image.png");
  });
});
