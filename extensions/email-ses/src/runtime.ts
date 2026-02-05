import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setEmailSesRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getEmailSesRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Email SES runtime not initialized");
  }
  return runtime;
}
