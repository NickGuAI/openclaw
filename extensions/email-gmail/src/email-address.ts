export function extractEmail(from: string): string {
  // Extract email from "Name <email@example.com>" or plain "email@example.com"
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from.trim();
}

export function parseAddressList(header: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inQuotes = false;
  let escaped = false;

  for (const char of header) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if (char === "," && !inQuotes) {
      segments.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  segments.push(current);
  return segments.map((segment) => extractEmail(segment).trim().toLowerCase()).filter(Boolean);
}
