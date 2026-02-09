import { z } from "zod";

export const EmailGmailConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    fromAddress: z.string().optional().describe("Gmail address to send replies from"),
    fromName: z.string().optional().describe("Display name for outgoing emails"),
    allowFrom: z
      .array(z.string())
      .optional()
      .describe("Email addresses allowed to message the assistant. Empty = allow all."),
    dmHistoryLimit: z.number().int().min(0).optional(),
  })
  .strict();
