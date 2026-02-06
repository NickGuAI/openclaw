import { writeDeliveryContext } from "./delivery-context.js";
import { stripQuotedReply } from "./strip-quotes.js";

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
};

// Extract the first Message-ID from a References header.
// In a thread, the first reference is the root message — stable across
// all replies regardless of SMTP domain (Superhuman, SES, Gmail, etc.).
function extractRootReference(references?: string): string | undefined {
  if (!references) return undefined;
  const match = references.match(/<[^>]+>/);
  return match ? match[0] : undefined;
}

function extractEmail(from: string): string {
  // Extract email from "Name <email@example.com>" or plain "email@example.com"
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from.trim();
}

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
  const body = msg.body || msg.snippet || "";
  const strippedBody = stripQuotedReply(body);

  // Use first Message-ID from References as stable thread key.
  // Gmail may assign different threadIds when messages cross SMTP domains
  // (e.g. Superhuman → SES), but References preserves the real chain.
  const rootRef = extractRootReference(msg.references);
  const threadKey = rootRef || msg.messageId || msg.threadId || msg.id;
  const gmailThreadId = msg.threadId || msg.id;

  // Persist delivery context for use by the send function
  await writeDeliveryContext(threadKey, {
    threadId: gmailThreadId,
    messageId: msg.messageId,
    subject: msg.subject,
    references: msg.references,
    from: msg.from,
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
