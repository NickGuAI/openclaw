import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk";
import { buildChannelConfigSchema, DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { EmailSesChannelConfig, ResolvedEmailSesAccount } from "./types.js";
import { EmailSesConfigSchema } from "./config-schema.js";
import { emailSesOutbound } from "./outbound.js";

function resolveEmailSesConfig(cfg: OpenClawConfig): EmailSesChannelConfig | undefined {
  return (cfg.channels as Record<string, unknown> | undefined)?.["email-ses"] as
    | EmailSesChannelConfig
    | undefined;
}

function isConfigured(cfg: OpenClawConfig): boolean {
  const sesCfg = resolveEmailSesConfig(cfg);
  return Boolean(sesCfg?.fromAddress || process.env.SES_FROM_ADDRESS);
}

const meta = {
  id: "email-ses",
  label: "Email (AWS SES)",
  selectionLabel: "Email via AWS SES",
  docsPath: "/channels/email-ses",
  docsLabel: "email-ses",
  blurb: "Send email replies via AWS SES",
  aliases: ["email", "ses"],
  order: 80,
} as const;

export const emailSesPlugin: ChannelPlugin<ResolvedEmailSesAccount> = {
  id: "email-ses",
  meta: { ...meta },

  capabilities: {
    chatTypes: ["direct"],
    media: true,
    reactions: false,
    edit: false,
    threads: true,
  },

  reload: { configPrefixes: ["channels.email-ses"] },
  configSchema: buildChannelConfigSchema(EmailSesConfigSchema),

  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg) => ({
      accountId: DEFAULT_ACCOUNT_ID,
      enabled: resolveEmailSesConfig(cfg)?.enabled !== false,
      configured: isConfigured(cfg),
    }),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    setAccountEnabled: ({ cfg, enabled }) => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        "email-ses": {
          ...resolveEmailSesConfig(cfg),
          enabled,
        },
      },
    }),
    deleteAccount: ({ cfg }) => {
      const next = { ...cfg } as OpenClawConfig;
      const nextChannels = { ...cfg.channels } as Record<string, unknown>;
      delete nextChannels["email-ses"];
      if (Object.keys(nextChannels).length > 0) {
        next.channels = nextChannels as OpenClawConfig["channels"];
      } else {
        delete next.channels;
      }
      return next;
    },
    isConfigured: (_account, cfg) => isConfigured(cfg),
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
    }),
    resolveAllowFrom: ({ cfg }) => resolveEmailSesConfig(cfg)?.allowFrom ?? [],
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },

  security: {
    collectWarnings: ({ cfg }) => {
      const sesCfg = resolveEmailSesConfig(cfg);
      if (!sesCfg?.fromAddress && !process.env.SES_FROM_ADDRESS) {
        return [
          "- Email SES: no fromAddress configured. Set channels.email-ses.fromAddress or SES_FROM_ADDRESS env var.",
        ];
      }
      return [];
    },
  },

  setup: {
    resolveAccountId: () => DEFAULT_ACCOUNT_ID,
    applyAccountConfig: ({ cfg }) => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        "email-ses": {
          ...resolveEmailSesConfig(cfg),
          enabled: true,
        },
      },
    }),
  },

  outbound: emailSesOutbound,
};
