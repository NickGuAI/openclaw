import { describe, expect, it } from "vitest";
import { buildRawMimeMessage } from "./mime.js";

describe("buildRawMimeMessage", () => {
  it("builds a valid multipart/alternative MIME message", () => {
    const msg = buildRawMimeMessage({
      from: '"Agent" <agent@test.com>',
      to: "user@example.com",
      subject: "Re: Test",
      textBody: "Hello world",
      htmlBody: "<p>Hello world</p>",
    });

    expect(msg).toContain('From: "Agent" <agent@test.com>');
    expect(msg).toContain("To: user@example.com");
    expect(msg).toContain("Subject: Re: Test");
    expect(msg).toContain("MIME-Version: 1.0");
    expect(msg).toContain("Content-Type: multipart/alternative");
    expect(msg).toContain("Content-Type: text/plain; charset=utf-8");
    expect(msg).toContain("Content-Type: text/html; charset=utf-8");
    expect(msg).toContain("Hello world");
    expect(msg).toContain("<p>Hello world</p>");
  });

  it("includes In-Reply-To and References headers when provided", () => {
    const msg = buildRawMimeMessage({
      from: "agent@test.com",
      to: "user@example.com",
      subject: "Re: Test",
      textBody: "Reply",
      htmlBody: "<p>Reply</p>",
      inReplyTo: "<abc123@mail.gmail.com>",
      references: "<xyz789@mail.gmail.com> <abc123@mail.gmail.com>",
    });

    expect(msg).toContain("In-Reply-To: <abc123@mail.gmail.com>");
    expect(msg).toContain("References: <xyz789@mail.gmail.com> <abc123@mail.gmail.com>");
  });

  it("includes Cc header when provided", () => {
    const msg = buildRawMimeMessage({
      from: "agent@test.com",
      to: "user@example.com",
      cc: "copy@example.com, team@example.com",
      subject: "Re: Test",
      textBody: "Reply",
      htmlBody: "<p>Reply</p>",
    });

    expect(msg).toContain("Cc: copy@example.com, team@example.com");
    expect(msg.indexOf("Cc: copy@example.com, team@example.com")).toBeLessThan(
      msg.indexOf("Content-Type: multipart/alternative"),
    );
  });

  it("omits threading headers when not provided", () => {
    const msg = buildRawMimeMessage({
      from: "agent@test.com",
      to: "user@example.com",
      subject: "Test",
      textBody: "Hello",
      htmlBody: "<p>Hello</p>",
    });

    expect(msg).not.toContain("In-Reply-To:");
    expect(msg).not.toContain("References:");
  });

  it("omits Cc header when not provided", () => {
    const msg = buildRawMimeMessage({
      from: "agent@test.com",
      to: "user@example.com",
      subject: "Test",
      textBody: "Hello",
      htmlBody: "<p>Hello</p>",
    });

    expect(msg).not.toContain("Cc:");
  });

  it("includes Message-ID and Date headers", () => {
    const msg = buildRawMimeMessage({
      from: "agent@test.com",
      to: "user@example.com",
      subject: "Test",
      textBody: "Hello",
      htmlBody: "<p>Hello</p>",
    });

    expect(msg).toContain("Message-ID:");
    expect(msg).toContain("Date:");
  });

  it("uses custom messageId when provided", () => {
    const msg = buildRawMimeMessage({
      from: "agent@test.com",
      to: "user@example.com",
      subject: "Test",
      textBody: "Hello",
      htmlBody: "<p>Hello</p>",
      messageId: "<custom-id@test.com>",
    });

    expect(msg).toContain("Message-ID: <custom-id@test.com>");
  });

  it("correctly encodes emoji in body text", () => {
    const msg = buildRawMimeMessage({
      from: "agent@test.com",
      to: "user@example.com",
      subject: "Test",
      textBody: "Hey! \u{1F3AF}",
      htmlBody: "<p>Hey! \u{1F3AF}</p>",
    });

    // U+1F3AF = F0 9F 8E AF in UTF-8 → =F0=9F=8E=AF in quoted-printable
    expect(msg).toContain("=F0=9F=8E=AF");
    // Must NOT contain replacement character U+FFFD (=EF=BF=BD)
    expect(msg).not.toContain("=EF=BF=BD");
  });

  it("generates unique boundary for each call", () => {
    const msg1 = buildRawMimeMessage({
      from: "a@b.com",
      to: "c@d.com",
      subject: "T",
      textBody: "x",
      htmlBody: "x",
    });
    const msg2 = buildRawMimeMessage({
      from: "a@b.com",
      to: "c@d.com",
      subject: "T",
      textBody: "x",
      htmlBody: "x",
    });

    // Extract boundaries
    const b1 = msg1.match(/boundary="([^"]+)"/)?.[1];
    const b2 = msg2.match(/boundary="([^"]+)"/)?.[1];
    expect(b1).toBeDefined();
    expect(b2).toBeDefined();
    expect(b1).not.toBe(b2);
  });
});
