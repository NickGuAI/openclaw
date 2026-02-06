import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EmailDeliveryContext } from "./types.js";

function getBaseDir(): string {
  return join(homedir(), ".openclaw", "email-gmail");
}

function getContextsDir(): string {
  return join(getBaseDir(), "contexts");
}

function getMsgIndexDir(): string {
  return join(getBaseDir(), "msg-index");
}

function contextPath(threadId: string): string {
  // Sanitize threadId for use as a filename
  const safe = threadId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(getContextsDir(), `${safe}.json`);
}

export async function writeDeliveryContext(
  threadId: string,
  ctx: EmailDeliveryContext,
): Promise<void> {
  const dir = getContextsDir();
  await mkdir(dir, { recursive: true });
  await writeFile(contextPath(threadId), JSON.stringify(ctx, null, 2), "utf-8");
}

export async function readDeliveryContext(threadId: string): Promise<EmailDeliveryContext | null> {
  try {
    const data = await readFile(contextPath(threadId), "utf-8");
    return JSON.parse(data) as EmailDeliveryContext;
  } catch {
    return null;
  }
}

export async function updateDeliveryContextMessageId(
  threadId: string,
  newMessageId: string,
): Promise<void> {
  const ctx = await readDeliveryContext(threadId);
  if (!ctx) {
    return;
  }

  // Append old messageId to references chain
  const refs = [ctx.references, ctx.messageId].filter(Boolean).join(" ");
  ctx.messageId = newMessageId;
  if (refs) {
    ctx.references = refs;
  }

  await writeDeliveryContext(threadId, ctx);
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// Message-ID index: maps outbound Message-IDs back to thread keys
// so inbound replies can resolve to the correct thread.
export async function writeMessageIdIndex(messageId: string, threadKey: string): Promise<void> {
  const dir = getMsgIndexDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${sanitize(messageId)}.txt`), threadKey, "utf-8");
}

export async function resolveThreadKeyByMessageId(messageId: string): Promise<string | null> {
  try {
    return (await readFile(join(getMsgIndexDir(), `${sanitize(messageId)}.txt`), "utf-8")).trim();
  } catch {
    return null;
  }
}
