import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { sendEmailSes } from "./send.js";

export const emailSesOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: null,

  sendText: async ({ cfg, to, text }) => {
    const result = await sendEmailSes({ cfg, to, text });
    return { channel: "email-ses", ...result };
  },

  sendMedia: async ({ cfg, to, text, mediaUrl }) => {
    const result = await sendEmailSes({ cfg, to, text, mediaUrl });
    return { channel: "email-ses", ...result };
  },
};
