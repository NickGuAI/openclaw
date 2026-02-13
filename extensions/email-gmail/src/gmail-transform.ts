import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig, readChannelAllowFromStore } from "openclaw/plugin-sdk";
import { resolveThreadKeyByMessageId, writeDeliveryContext } from "./delivery-context.js";
import { extractEmail, parseAddressList } from "./email-address.js";
import { stripQuotedReply } from "./strip-quotes.js";

const execFileAsync = promisify(execFile);

type GmailMessage = {
  id: string;
  threadId?: string;
  from: string;
  to?: string;
  subject?: string;
  date?: string;
  snippet?: string;
  body?: string;
  bodyTruncated?: boolean;
  labels?: string[];
  messageId?: string;
  references?: string;
  inReplyTo?: string;
};

type EmailHeaders = {
  messageId?: string;
  references?: string;
  inReplyTo?: string;
  from?: string;
  to?: string;
  cc?: string;
  replyTo?: string;
};

// Fetch RFC 2822 headers from Gmail API via gog CLI.
// gog handles OAuth; we just need the message ID.
async function fetchMessageHeaders(msgId: string, account?: string): Promise<EmailHeaders> {
  try {
    const args = [
      "gmail",
      "get",
      msgId,
      "--format=metadata",
      "--headers=References,Message-Id,In-Reply-To,From,To,Cc,Reply-To",
      "--json",
    ];
    if (account) {
      args.push("--account", account);
    }
    const { stdout } = await execFileAsync("gog", args, {
      timeout: 5000,
      env: { ...process.env },
    });
    const data = JSON.parse(stdout);
    const headers = data.message?.payload?.headers as
      | Array<{ name: string; value: string }>
      | undefined;
    if (!headers) {
      return {};
    }
    const result: EmailHeaders = {};
    for (const h of headers) {
      if (h.name === "Message-ID" || h.name === "Message-Id") {
        result.messageId = h.value;
      }
      if (h.name === "References") {
        result.references = h.value;
      }
      if (h.name === "In-Reply-To") {
        result.inReplyTo = h.value;
      }
      if (h.name === "From") {
        result.from = h.value;
      }
      if (h.name === "To") {
        result.to = h.value;
      }
      if (h.name === "Cc" || h.name === "CC") {
        result.cc = h.value;
      }
      if (h.name === "Reply-To") {
        result.replyTo = h.value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export { extractEmail, parseAddressList } from "./email-address.js";

function formatEmailMessage(params: { from: string; subject?: string; body: string }): string {
  const parts: string[] = [];
  if (params.subject) {
    parts.push(`Subject: ${params.subject}`);
  }
  parts.push(`From: ${params.from}`);
  parts.push("");
  parts.push(params.body);
  return parts.join("\n");
}

function normalizeAllowEntry(entry: unknown): string {
  return String(entry).trim().toLowerCase();
}

/**
 * Hook transform: Gmail webhook payload → email agent session.
 *
 * Loaded by hooks-mapping.ts via mapping.transform.modulePath.
 * The function signature matches HookMappingContext (inlined since it's module-private).
 */
export default async function transform(ctx: {
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  url: URL;
  path: string;
}) {
  const messages = ctx.payload.messages as GmailMessage[] | undefined;
  const msg = messages?.[0];
  if (!msg) {
    return null;
  }

  const senderEmail = extractEmail(msg.from);
  const normalizedSender = senderEmail.trim().toLowerCase();

  const cfg = loadConfig();
  const channelCfg = (cfg.channels as Record<string, unknown> | undefined)?.["email-gmail"] as
    | { allowFrom?: unknown[] }
    | undefined;
  const configAllowFrom = (channelCfg?.allowFrom ?? [])
    .map((entry) => normalizeAllowEntry(entry))
    .filter(Boolean);
  const storeAllowFrom = (await readChannelAllowFromStore("email-gmail").catch(() => []))
    .map((entry) => normalizeAllowEntry(entry))
    .filter(Boolean);
  const combinedAllowFrom = [...new Set([...configAllowFrom, ...storeAllowFrom])];
  if (
    combinedAllowFrom.length > 0 &&
    !combinedAllowFrom.includes("*") &&
    !combinedAllowFrom.includes(normalizedSender)
  ) {
    return null;
  }

  const body = msg.body || msg.snippet || "";
  const strippedBody = stripQuotedReply(body);

  // Fetch RFC 2822 headers from Gmail API (gog doesn't include them in webhook).
  // Uses In-Reply-To to resolve cross-domain threads where Gmail assigns
  // different threadIds (e.g. Superhuman → SES).
  const account = msg.to ? extractEmail(msg.to) : undefined;
  const hdrs = await fetchMessageHeaders(msg.id, account);

  // Merge: prefer fetched headers, fall back to payload fields
  const messageId = hdrs.messageId || msg.messageId;
  const references = hdrs.references || msg.references;
  const inReplyTo = hdrs.inReplyTo || msg.inReplyTo;
  const replyTo = hdrs.replyTo ? extractEmail(hdrs.replyTo).trim().toLowerCase() : undefined;
  const toRecipients = hdrs.to ? parseAddressList(hdrs.to) : [];
  const ccRecipients = hdrs.cc ? parseAddressList(hdrs.cc) : [];

  // Resolve thread key: if this message replies to a known outbound message,
  // use the same thread key as the original conversation.
  const existingThreadKey = inReplyTo ? await resolveThreadKeyByMessageId(inReplyTo) : null;
  const threadKey = existingThreadKey || messageId || msg.threadId || msg.id;
  const gmailThreadId = msg.threadId || msg.id;

  await writeDeliveryContext(threadKey, {
    threadId: gmailThreadId,
    messageId,
    subject: msg.subject,
    references,
    from: hdrs.from || msg.from,
    replyTo,
    toRecipients,
    ccRecipients,
  });

  return {
    kind: "agent",
    sessionKey: `email:thread:${threadKey}`,
    message: formatEmailMessage({ from: msg.from, subject: msg.subject, body: strippedBody }),
    name: "Email",
    deliver: true,
    channel: "email-gmail",
    to: `${senderEmail}##${threadKey}`,
    wakeMode: "now",
  };
}
