/**
 * Strips quoted reply content from incoming emails so the agent only sees new user content.
 * Handles Gmail, Outlook, standard signature delimiters, and common quoting patterns.
 */
export function stripQuotedReply(body: string): string {
  if (!body) {
    return "";
  }

  // First try HTML stripping if it looks like HTML
  let text = body;
  if (/<[a-z][\s\S]*>/i.test(text)) {
    text = stripHtmlQuotes(text);
  }

  const lines = text.split("\n");
  let cutIndex = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Gmail: "On <date>, <name> wrote:" or "On <date> at <time> <name> wrote:"
    if (/^On .+ wrote:\s*$/.test(line)) {
      cutIndex = i;
      break;
    }

    // Outlook separator
    if (/^_{5,}/.test(line)) {
      cutIndex = i;
      break;
    }

    // Forwarded message
    if (/^-{5,}\s*Forwarded message\s*-{5,}/.test(line)) {
      cutIndex = i;
      break;
    }

    // Standard signature delimiter (exactly "-- " on its own line)
    if (line === "--") {
      cutIndex = i;
      break;
    }

    // Outlook-style "From: ... Sent: ... To: ... Subject: ..." block
    if (/^From:\s/.test(line) && i + 3 < lines.length) {
      const nextLines = lines.slice(i + 1, i + 4).map((l) => l.trim());
      if (nextLines.some((l) => /^Sent:\s/.test(l)) && nextLines.some((l) => /^To:\s/.test(l))) {
        cutIndex = i;
        break;
      }
    }
  }

  // Take only lines before the cut point
  let result = lines.slice(0, cutIndex).join("\n");

  // Strip leading ">" quoted lines from the end (trailing quotes without a header)
  const resultLines = result.split("\n");
  while (resultLines.length > 0 && /^>\s?/.test(resultLines[resultLines.length - 1])) {
    resultLines.pop();
  }

  result = resultLines.join("\n").trim();
  return result || body.trim();
}

function stripHtmlQuotes(html: string): string {
  // Remove <blockquote> elements
  let text = html.replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "");

  // Remove Gmail quote divs
  text = text.replace(/<div\s+class\s*=\s*["']gmail_quote["'][\s\S]*?<\/div>/gi, "");

  // Remove Outlook quote divs
  text = text.replace(/<div\s+id\s*=\s*["']appendonsend["'][\s\S]*$/gi, "");

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Normalize whitespace
  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
