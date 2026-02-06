import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { SESClient, SendRawEmailCommand } from "@aws-sdk/client-ses";
import type { EmailSesChannelConfig } from "./types.js";
import {
  readDeliveryContext,
  updateDeliveryContextMessageId,
  writeMessageIdIndex,
} from "./delivery-context.js";
import { buildSubject, markdownToHtml, wrapHtmlEmail } from "./format.js";
import { buildRawMimeMessage } from "./mime.js";

export type SendEmailSesParams = {
  cfg: OpenClawConfig;
  to: string;
  text: string;
  mediaUrl?: string;
  accountId?: string;
};

export type SendEmailSesResult = {
  channel: "email-ses";
  messageId: string;
  conversationId: string;
};

function resolveEmailSesConfig(cfg: OpenClawConfig): EmailSesChannelConfig | undefined {
  return (cfg.channels as Record<string, unknown> | undefined)?.["email-ses"] as
    | EmailSesChannelConfig
    | undefined;
}

export async function sendEmailSes(params: SendEmailSesParams): Promise<SendEmailSesResult> {
  const { cfg, to, text, mediaUrl } = params;

  // Parse "to" field: "user@example.com##threadId" or plain email
  const sepIndex = to.indexOf("##");
  const recipientEmail = sepIndex >= 0 ? to.slice(0, sepIndex) : to;
  const threadId = sepIndex >= 0 ? to.slice(sepIndex + 2) : undefined;

  // Resolve account config
  const sesCfg = resolveEmailSesConfig(cfg);
  const region = sesCfg?.region || process.env.AWS_REGION || "us-east-1";
  const fromAddress = sesCfg?.fromAddress || process.env.SES_FROM_ADDRESS;
  const fromName = sesCfg?.fromName || "OpenClaw";

  if (!fromAddress) {
    throw new Error(
      "email-ses: fromAddress not configured. Set channels.email-ses.fromAddress in openclaw.yaml or SES_FROM_ADDRESS env var.",
    );
  }

  // Load delivery context for threading
  const deliveryCtx = threadId ? await readDeliveryContext(threadId) : null;

  // Build email content
  let body = text;
  if (mediaUrl) {
    body += `\n\n[Attachment](${mediaUrl})`;
  }

  const htmlBody = markdownToHtml(body);
  const fullHtml = wrapHtmlEmail(htmlBody, { fromName });
  const subject = buildSubject(deliveryCtx);

  const fromHeader = fromName ? `"${fromName}" <${fromAddress}>` : fromAddress;
  const toHeader = recipientEmail;

  // Build threading headers from delivery context
  const inReplyTo = deliveryCtx?.messageId || undefined;
  const references = deliveryCtx
    ? [deliveryCtx.references, deliveryCtx.messageId].filter(Boolean).join(" ")
    : undefined;

  const rawMessage = buildRawMimeMessage({
    from: fromHeader,
    to: toHeader,
    subject,
    textBody: body,
    htmlBody: fullHtml,
    inReplyTo,
    references: references || undefined,
  });

  // Send via SES
  const sesClient = new SESClient({ region });
  const command = new SendRawEmailCommand({
    RawMessage: {
      Data: Buffer.from(rawMessage, "utf-8"),
    },
    Source: fromAddress,
    Destinations: [recipientEmail],
  });

  const response = await sesClient.send(command);
  const messageId = response.MessageId || "unknown";

  // Update delivery context with new message ID for threading chain
  const fullMessageId = `<${messageId}@email.amazonses.com>`;
  if (threadId) {
    await updateDeliveryContextMessageId(threadId, fullMessageId);
    // Index outbound Message-ID → threadKey so inbound replies can resolve
    await writeMessageIdIndex(fullMessageId, threadId);
  }

  return {
    channel: "email-ses",
    messageId,
    conversationId: recipientEmail,
  };
}
