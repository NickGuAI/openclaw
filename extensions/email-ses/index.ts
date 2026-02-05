import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { emailSesPlugin } from "./src/channel.js";
import { setEmailSesRuntime } from "./src/runtime.js";

const plugin = {
  id: "email-ses",
  name: "Email (AWS SES)",
  description: "Email channel plugin via AWS SES",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setEmailSesRuntime(api.runtime);
    api.registerChannel({ plugin: emailSesPlugin });
  },
};

export default plugin;
