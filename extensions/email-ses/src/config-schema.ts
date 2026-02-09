import { z } from "zod";

export const EmailSesConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    fromAddress: z.string().optional().describe("SES verified email address to send from"),
    fromName: z.string().optional().describe("Display name for outgoing emails"),
    replyToAddress: z.string().optional().describe("Reply-to address"),
    region: z.string().optional().describe("AWS region for SES"),
    allowFrom: z
      .array(z.string())
      .optional()
      .describe("Email addresses allowed to message the assistant. Empty = allow all."),
    dmHistoryLimit: z.number().int().min(0).optional(),
  })
  .strict();
