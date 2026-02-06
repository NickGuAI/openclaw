import { describe, expect, it } from "vitest";
import { buildSubject, markdownToHtml, wrapHtmlEmail } from "./format.js";

describe("markdownToHtml", () => {
  it("converts markdown to HTML", () => {
    const result = markdownToHtml("**bold** and *italic*");
    expect(result).toContain("<strong>bold</strong>");
    expect(result).toContain("<em>italic</em>");
  });

  it("converts code blocks", () => {
    const result = markdownToHtml("```\nconst x = 1;\n```");
    expect(result).toContain("<code>");
    expect(result).toContain("const x = 1;");
  });

  it("converts links", () => {
    const result = markdownToHtml("[test](https://example.com)");
    expect(result).toContain('href="https://example.com"');
  });
});

describe("wrapHtmlEmail", () => {
  it("wraps body in HTML document", () => {
    const result = wrapHtmlEmail("<p>Hello</p>");
    expect(result).toContain("<!DOCTYPE html>");
    expect(result).toContain("<p>Hello</p>");
    expect(result).toContain("Sent by OpenClaw");
  });

  it("uses custom from name", () => {
    const result = wrapHtmlEmail("<p>Hello</p>", { fromName: "Athena" });
    expect(result).toContain("Sent by Athena");
  });
});

describe("buildSubject", () => {
  it("returns Re: (no subject) when no context", () => {
    expect(buildSubject(null)).toBe("Re: (no subject)");
    expect(buildSubject(undefined)).toBe("Re: (no subject)");
  });

  it("returns Re: (no subject) when context has no subject", () => {
    expect(buildSubject({ threadId: "t1" })).toBe("Re: (no subject)");
  });

  it("adds Re: prefix to subject", () => {
    expect(buildSubject({ threadId: "t1", subject: "Hello" })).toBe("Re: Hello");
  });

  it("does not duplicate Re: prefix", () => {
    expect(buildSubject({ threadId: "t1", subject: "Re: Hello" })).toBe("Re: Hello");
  });

  it("handles case-insensitive Re:", () => {
    expect(buildSubject({ threadId: "t1", subject: "RE: Hello" })).toBe("RE: Hello");
    expect(buildSubject({ threadId: "t1", subject: "re: Hello" })).toBe("re: Hello");
  });
});
