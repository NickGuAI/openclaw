import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setEmailGmailRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getEmailGmailRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Email Gmail runtime not initialized");
  }
  return runtime;
}
