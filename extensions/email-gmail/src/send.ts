import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { randomBytes } from "node:crypto";
import type { GmailCredentials } from "./gmail-auth.js";
import type { EmailDeliveryContext, EmailGmailChannelConfig } from "./types.js";
import {
  readDeliveryContext,
  updateDeliveryContextMessageId,
  writeMessageIdIndex,
} from "./delivery-context.js";
import { buildSubject, markdownToHtml, wrapHtmlEmail } from "./format.js";
import { refreshGmailAccessToken, resolveGmailCredentials } from "./gmail-auth.js";
import { buildRawMimeMessage } from "./mime.js";

const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const ACCESS_TOKEN_SKEW_MS = 60_000;

export type SendEmailGmailParams = {
  cfg: OpenClawConfig;
  to: string;
  text: string;
  mediaUrl?: string;
  accountId?: string;
};

export type SendEmailGmailResult = {
  channel: "email-gmail";
  messageId: string;
  conversationId: string;
};

function resolveEmailGmailConfig(cfg: OpenClawConfig): EmailGmailChannelConfig | undefined {
  return (cfg.channels as Record<string, unknown> | undefined)?.["email-gmail"] as
    | EmailGmailChannelConfig
    | undefined;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createMessageId(): string {
  return `<${randomBytes(16).toString("hex")}@openclaw.email>`;
}

function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from.trim();
}

function hasValidAccessToken(creds: GmailCredentials): boolean {
  if (!creds.accessToken) {
    return false;
  }
  if (!creds.expiresAt) {
    return true;
  }
  return Date.now() + ACCESS_TOKEN_SKEW_MS < creds.expiresAt;
}

async function ensureAccessToken(creds: GmailCredentials): Promise<string> {
  if (hasValidAccessToken(creds)) {
    return creds.accessToken as string;
  }
  return refreshGmailAccessToken(creds);
}

async function sendWithToken(token: string, payload: Record<string, unknown>): Promise<Response> {
  return fetch(GMAIL_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function buildReplyAllRecipients(
  deliveryCtx: EmailDeliveryContext,
  recipientEmail: string,
  fromAddress: string,
): { to: string; cc: string[] } {
  const primaryTo = (deliveryCtx.replyTo || extractEmailAddress(deliveryCtx.from || recipientEmail))
    .trim()
    .toLowerCase();
  const seen = new Set<string>([primaryTo, extractEmailAddress(fromAddress).trim().toLowerCase()]);
  const ccList: string[] = [];

  const addRecipient = (email: string) => {
    const normalized = extractEmailAddress(email).trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    ccList.push(normalized);
  };

  for (const addr of deliveryCtx.toRecipients || []) {
    addRecipient(addr);
  }
  for (const addr of deliveryCtx.ccRecipients || []) {
    addRecipient(addr);
  }

  return { to: primaryTo, cc: ccList };
}

export async function sendEmailGmail(params: SendEmailGmailParams): Promise<SendEmailGmailResult> {
  const { cfg, to, text, mediaUrl } = params;

  // Parse "to" field: "user@example.com##threadId" or plain email
  const sepIndex = to.indexOf("##");
  const recipientEmail = sepIndex >= 0 ? to.slice(0, sepIndex) : to;
  const threadId = sepIndex >= 0 ? to.slice(sepIndex + 2) : undefined;

  const gmailCfg = resolveEmailGmailConfig(cfg);
  const fromAddress = gmailCfg?.fromAddress;
  const fromName = gmailCfg?.fromName || "OpenClaw";

  if (!fromAddress) {
    throw new Error(
      "email-gmail: fromAddress not configured. Set channels.email-gmail.fromAddress in openclaw.yaml.",
    );
  }

  const creds = await resolveGmailCredentials(cfg);
  if (!creds) {
    throw new Error(
      "email-gmail: Gmail credentials not found. Configure gogcli OAuth with gmail.send scope or set GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN.",
    );
  }

  let accessToken = await ensureAccessToken(creds);

  const deliveryCtx = threadId ? await readDeliveryContext(threadId) : null;

  let body = text;
  if (mediaUrl) {
    body += `\n\n[Attachment](${mediaUrl})`;
  }

  const htmlBody = markdownToHtml(body);
  const fullHtml = wrapHtmlEmail(htmlBody, { fromName });
  const subject = buildSubject(deliveryCtx);

  const fromHeader = fromName ? `"${fromName}" <${fromAddress}>` : fromAddress;
  let toHeader: string;
  let ccHeader: string | undefined;
  if (deliveryCtx) {
    const { to: replyTo, cc } = buildReplyAllRecipients(deliveryCtx, recipientEmail, fromAddress);
    toHeader = replyTo;
    ccHeader = cc.length > 0 ? cc.join(", ") : undefined;
  } else {
    toHeader = recipientEmail;
  }

  const inReplyTo = deliveryCtx?.messageId || undefined;
  const references = deliveryCtx
    ? [deliveryCtx.references, deliveryCtx.messageId].filter(Boolean).join(" ")
    : undefined;

  const messageId = createMessageId();
  const rawMessage = buildRawMimeMessage({
    from: fromHeader,
    to: toHeader,
    cc: ccHeader,
    subject,
    textBody: body,
    htmlBody: fullHtml,
    inReplyTo,
    references: references || undefined,
    messageId,
  });

  const payload: Record<string, unknown> = {
    raw: base64UrlEncode(rawMessage),
  };
  // Use Gmail's native threadId from delivery context for the API call,
  // not the parsed thread key (which may be an RFC 2822 Message-ID).
  if (deliveryCtx?.threadId) {
    payload.threadId = deliveryCtx.threadId;
  }

  let response = await sendWithToken(accessToken, payload);
  if (response.status === 401) {
    accessToken = await refreshGmailAccessToken(creds);
    response = await sendWithToken(accessToken, payload);
  }

  if (!response.ok) {
    const textBody = await response.text().catch(() => "");
    const details = textBody ? `: ${textBody}` : "";
    throw new Error(`email-gmail: Gmail API send failed (${response.status})${details}`);
  }

  const data = (await response.json()) as { id?: string; threadId?: string };
  const responseMessageId = data.id || "unknown";

  if (threadId) {
    await updateDeliveryContextMessageId(threadId, messageId);
    // Index outbound Message-ID → threadKey so inbound replies can resolve
    await writeMessageIdIndex(messageId, threadId);
  }

  return {
    channel: "email-gmail",
    messageId: responseMessageId,
    conversationId: recipientEmail,
  };
}
