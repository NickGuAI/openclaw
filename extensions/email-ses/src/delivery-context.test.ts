import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  readDeliveryContext,
  resolveThreadKeyByMessageId,
  updateDeliveryContextMessageId,
  writeDeliveryContext,
  writeMessageIdIndex,
} from "./delivery-context.js";

const testDir = join(homedir(), ".openclaw", "email-ses", "contexts");
const testMsgIndexDir = join(homedir(), ".openclaw", "email-ses", "msg-index");

describe("delivery-context", () => {
  const testThreadId = `test-thread-${Date.now()}`;

  afterAll(async () => {
    // Clean up test file
    try {
      const safe = testThreadId.replace(/[^a-zA-Z0-9_-]/g, "_");
      await rm(join(testDir, `${safe}.json`), { force: true });
    } catch {
      // ignore
    }
  });

  it("writes and reads delivery context", async () => {
    const ctx = {
      threadId: testThreadId,
      subject: "Test Subject",
      messageId: "<msg123@gmail.com>",
      from: "user@example.com",
    };

    await writeDeliveryContext(testThreadId, ctx);
    const loaded = await readDeliveryContext(testThreadId);

    expect(loaded).not.toBeNull();
    expect(loaded!.threadId).toBe(testThreadId);
    expect(loaded!.subject).toBe("Test Subject");
    expect(loaded!.messageId).toBe("<msg123@gmail.com>");
    expect(loaded!.from).toBe("user@example.com");
  });

  it("returns null for missing context", async () => {
    const result = await readDeliveryContext("nonexistent-thread-id");
    expect(result).toBeNull();
  });

  it("updates messageId and builds references chain", async () => {
    const threadId = `test-update-${Date.now()}`;
    await writeDeliveryContext(threadId, {
      threadId,
      subject: "Test",
      messageId: "<original@gmail.com>",
      references: "<prev@gmail.com>",
    });

    await updateDeliveryContextMessageId(threadId, "<new@ses.com>");

    const updated = await readDeliveryContext(threadId);
    expect(updated!.messageId).toBe("<new@ses.com>");
    expect(updated!.references).toBe("<prev@gmail.com> <original@gmail.com>");

    // Clean up
    try {
      const safe = threadId.replace(/[^a-zA-Z0-9_-]/g, "_");
      await rm(join(testDir, `${safe}.json`), { force: true });
    } catch {
      // ignore
    }
  });

  it("writes and resolves message-ID index", async () => {
    const msgId = `<test-${Date.now()}@ses.com>`;
    const threadKey = "test-thread-key";

    await writeMessageIdIndex(msgId, threadKey);
    const resolved = await resolveThreadKeyByMessageId(msgId);

    expect(resolved).toBe(threadKey);

    // Clean up
    try {
      const safe = msgId.replace(/[^a-zA-Z0-9_-]/g, "_");
      await rm(join(testMsgIndexDir, `${safe}.txt`), { force: true });
    } catch {
      // ignore
    }
  });

  it("returns null for unknown message-ID", async () => {
    const result = await resolveThreadKeyByMessageId("<nonexistent@test.com>");
    expect(result).toBeNull();
  });
});
