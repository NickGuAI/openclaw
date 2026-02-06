import { describe, expect, it } from "vitest";
import { stripQuotedReply } from "./strip-quotes.js";

describe("stripQuotedReply", () => {
  it("returns original text when no quotes present", () => {
    expect(stripQuotedReply("Hello, how are you?")).toBe("Hello, how are you?");
  });

  it("returns empty string for empty input", () => {
    expect(stripQuotedReply("")).toBe("");
  });

  it("strips Gmail-style quoted reply", () => {
    const body = `Thanks for the info!

On Mon, Jan 1, 2026 at 10:00 AM John <john@example.com> wrote:
> Here is the previous message
> with multiple lines`;

    expect(stripQuotedReply(body)).toBe("Thanks for the info!");
  });

  it("strips Outlook underscore delimiter", () => {
    const body = `Got it, will do.

_____
From: someone@example.com
Sent: Monday, January 1, 2026
To: me@example.com
Subject: RE: Test`;

    expect(stripQuotedReply(body)).toBe("Got it, will do.");
  });

  it("strips standard signature delimiter", () => {
    const body = `Here is my reply.

--
John Doe
CEO, Example Corp`;

    expect(stripQuotedReply(body)).toBe("Here is my reply.");
  });

  it("preserves forwarded message body", () => {
    const body = `FYI see below.

---------- Forwarded message ----------
From: someone@example.com
Sent: Monday, January 1, 2026 10:00 AM
To: me@example.com
Subject: Original

This is the forwarded content.`;

    const result = stripQuotedReply(body);
    expect(result).toContain("FYI see below.");
    expect(result).toContain("This is the forwarded content.");
  });

  it("strips Outlook From/Sent/To block", () => {
    const body = `Acknowledged.

From: sender@example.com
Sent: Monday, January 1, 2026 10:00 AM
To: recipient@example.com
Subject: RE: Topic`;

    expect(stripQuotedReply(body)).toBe("Acknowledged.");
  });

  it("strips trailing > quoted lines", () => {
    const body = `My response here.

> Some quoted content
> More quoted content`;

    expect(stripQuotedReply(body)).toBe("My response here.");
  });

  it("handles HTML blockquote stripping", () => {
    const body = `<p>New content here</p><blockquote>Old quoted stuff</blockquote>`;
    const result = stripQuotedReply(body);
    expect(result).toContain("New content here");
    expect(result).not.toContain("Old quoted stuff");
  });

  it("handles Gmail HTML quote div", () => {
    const body = `<div>My reply</div><div class="gmail_quote">Previous message content</div>`;
    const result = stripQuotedReply(body);
    expect(result).toContain("My reply");
    expect(result).not.toContain("Previous message");
  });

  it("preserves multi-line new content before quotes", () => {
    const body = `Line 1 of reply.
Line 2 of reply.
Line 3 of reply.

On Tue, Feb 4, 2026 at 3:00 PM Agent <agent@test.com> wrote:
> Previous reply`;

    const result = stripQuotedReply(body);
    expect(result).toContain("Line 1 of reply.");
    expect(result).toContain("Line 2 of reply.");
    expect(result).toContain("Line 3 of reply.");
    expect(result).not.toContain("Previous reply");
  });
});
