import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { emailGmailPlugin } from "./src/channel.js";
import { setEmailGmailRuntime } from "./src/runtime.js";

const plugin = {
  id: "email-gmail",
  name: "Email (Gmail)",
  description: "Email channel plugin via Gmail API",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setEmailGmailRuntime(api.runtime);
    api.registerChannel({ plugin: emailGmailPlugin });
  },
};

export default plugin;
