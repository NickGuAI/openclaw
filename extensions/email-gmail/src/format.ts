import MarkdownIt from "markdown-it";
import type { EmailDeliveryContext } from "./types.js";

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

export function markdownToHtml(markdown: string): string {
  return md.render(markdown);
}

export function wrapHtmlEmail(bodyHtml: string, opts?: { fromName?: string }): string {
  const name = opts?.fromName || "OpenClaw";
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
  pre { background: #f4f4f4; padding: 12px; border-radius: 4px; overflow-x: auto; }
  code { background: #f4f4f4; padding: 2px 4px; border-radius: 2px; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #ccc; margin: 0; padding-left: 12px; color: #666; }
  a { color: #0066cc; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
  th { background: #f4f4f4; }
</style>
</head>
<body>
${bodyHtml}
<br>
<div style="color: #999; font-size: 0.85em; border-top: 1px solid #eee; padding-top: 8px; margin-top: 16px;">
  Sent by ${name}
</div>
</body>
</html>`;
}

export function buildSubject(deliveryContext?: EmailDeliveryContext | null): string {
  if (!deliveryContext?.subject) {
    return "Re: (no subject)";
  }

  const subject = deliveryContext.subject;
  // Deduplicate Re: prefix
  if (/^Re:\s/i.test(subject)) {
    return subject;
  }
  return `Re: ${subject}`;
}
