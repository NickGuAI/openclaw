import { randomBytes } from "node:crypto";

export type MimeMessageParams = {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  inReplyTo?: string;
  references?: string;
  messageId?: string;
};

export function buildRawMimeMessage(params: MimeMessageParams): string {
  const boundary = `----=_Part_${randomBytes(12).toString("hex")}`;
  const messageId = params.messageId || `<${randomBytes(16).toString("hex")}@openclaw.email>`;

  const headers: string[] = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  if (params.cc) {
    headers.push(`Cc: ${params.cc}`);
  }
  if (params.inReplyTo) {
    headers.push(`In-Reply-To: ${params.inReplyTo}`);
  }
  if (params.references) {
    headers.push(`References: ${params.references}`);
  }

  const parts = [
    headers.join("\r\n"),
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    encodeQuotedPrintable(params.textBody),
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    encodeQuotedPrintable(params.htmlBody),
    "",
    `--${boundary}--`,
  ];

  return parts.join("\r\n");
}

function encodeQuotedPrintable(text: string): string {
  return text.replace(/[^\t\n\r\x20-\x7e]/gu, (char) => {
    const bytes = Buffer.from(char, "utf-8");
    return Array.from(bytes)
      .map((b) => `=${b.toString(16).toUpperCase().padStart(2, "0")}`)
      .join("");
  });
}
