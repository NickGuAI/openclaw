import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { sendEmailGmail } from "./send.js";

export const emailGmailOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: null,

  sendText: async ({ cfg, to, text }) => {
    const result = await sendEmailGmail({ cfg, to, text });
    return { channel: "email-gmail", ...result };
  },

  sendMedia: async ({ cfg, to, text, mediaUrl }) => {
    const result = await sendEmailGmail({ cfg, to, text, mediaUrl });
    return { channel: "email-gmail", ...result };
  },
};
