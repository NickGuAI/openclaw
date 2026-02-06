import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EmailDeliveryContext } from "./types.js";

function getContextsDir(): string {
  return join(homedir(), ".openclaw", "email-gmail", "contexts");
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
