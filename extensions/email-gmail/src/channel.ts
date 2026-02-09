import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk";
import { buildChannelConfigSchema, DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { EmailGmailChannelConfig, ResolvedEmailGmailAccount } from "./types.js";
import { EmailGmailConfigSchema } from "./config-schema.js";
import { resolveGmailCredentials } from "./gmail-auth.js";
import { emailGmailOutbound } from "./outbound.js";

const ENV_CLIENT_ID = "GMAIL_CLIENT_ID";
const ENV_CLIENT_SECRET = "GMAIL_CLIENT_SECRET";
const ENV_REFRESH_TOKEN = "GMAIL_REFRESH_TOKEN";

function resolveEmailGmailConfig(cfg: OpenClawConfig): EmailGmailChannelConfig | undefined {
  return (cfg.channels as Record<string, unknown> | undefined)?.["email-gmail"] as
    | EmailGmailChannelConfig
    | undefined;
}

function hasFromAddress(cfg: OpenClawConfig): boolean {
  const gmailCfg = resolveEmailGmailConfig(cfg);
  return Boolean(gmailCfg?.fromAddress);
}

function hasExplicitCredentials(cfg: OpenClawConfig): boolean {
  const gmailCfg = resolveEmailGmailConfig(cfg);
  const clientId = gmailCfg?.clientId ?? process.env[ENV_CLIENT_ID];
  const clientSecret = gmailCfg?.clientSecret ?? process.env[ENV_CLIENT_SECRET];
  const refreshToken = gmailCfg?.refreshToken ?? process.env[ENV_REFRESH_TOKEN];
  return Boolean(clientId && clientSecret && refreshToken);
}

async function isConfigured(cfg: OpenClawConfig): Promise<boolean> {
  if (!hasFromAddress(cfg)) {
    return false;
  }
  if (hasExplicitCredentials(cfg)) {
    return true;
  }
  const creds = await resolveGmailCredentials(cfg);
  return Boolean(creds?.refreshToken);
}

const meta = {
  id: "email-gmail",
  label: "Email (Gmail)",
  selectionLabel: "Email via Gmail API",
  docsPath: "/channels/email-gmail",
  docsLabel: "email-gmail",
  blurb: "Send email replies via Gmail API",
  aliases: ["gmail-send"],
  order: 81,
} as const;

export const emailGmailPlugin: ChannelPlugin<ResolvedEmailGmailAccount> = {
  id: "email-gmail",
  meta: { ...meta },

  capabilities: {
    chatTypes: ["direct"],
    media: true,
    reactions: false,
    edit: false,
    threads: true,
  },

  reload: { configPrefixes: ["channels.email-gmail"] },
  configSchema: buildChannelConfigSchema(EmailGmailConfigSchema),

  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg) => ({
      accountId: DEFAULT_ACCOUNT_ID,
      enabled: resolveEmailGmailConfig(cfg)?.enabled !== false,
      configured: hasFromAddress(cfg) && hasExplicitCredentials(cfg),
    }),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    setAccountEnabled: ({ cfg, enabled }) => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        "email-gmail": {
          ...resolveEmailGmailConfig(cfg),
          enabled,
        },
      },
    }),
    deleteAccount: ({ cfg }) => {
      const next = { ...cfg } as OpenClawConfig;
      const nextChannels = { ...cfg.channels } as Record<string, unknown>;
      delete nextChannels["email-gmail"];
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
    resolveAllowFrom: ({ cfg }) => resolveEmailGmailConfig(cfg)?.allowFrom ?? [],
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },

  security: {
    collectWarnings: async ({ cfg }) => {
      const warnings: string[] = [];
      if (!hasFromAddress(cfg)) {
        warnings.push(
          "- Email Gmail: no fromAddress configured. Set channels.email-gmail.fromAddress in openclaw.yaml.",
        );
      }
      const creds = await resolveGmailCredentials(cfg);
      if (!creds?.refreshToken) {
        warnings.push(
          "- Email Gmail: no Gmail OAuth credentials found. Re-auth gogcli with gmail.send scope or set GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN.",
        );
      }
      return warnings;
    },
  },

  setup: {
    resolveAccountId: () => DEFAULT_ACCOUNT_ID,
    applyAccountConfig: ({ cfg }) => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        "email-gmail": {
          ...resolveEmailGmailConfig(cfg),
          enabled: true,
        },
      },
    }),
  },

  outbound: emailGmailOutbound,
};
