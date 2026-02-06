import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { EmailGmailChannelConfig } from "./types.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ENV_CLIENT_ID = "GMAIL_CLIENT_ID";
const ENV_CLIENT_SECRET = "GMAIL_CLIENT_SECRET";
const ENV_REFRESH_TOKEN = "GMAIL_REFRESH_TOKEN";

export type GmailCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
};

function resolveEmailGmailConfig(cfg: OpenClawConfig): EmailGmailChannelConfig | undefined {
  return (cfg.channels as Record<string, unknown> | undefined)?.["email-gmail"] as
    | EmailGmailChannelConfig
    | undefined;
}

function resolveUserPath(p: string): string {
  if (p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

function gogCredentialsPaths(): string[] {
  const paths: string[] = [];
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) {
    paths.push(join(xdg, "gogcli", "credentials.json"));
  }
  paths.push(resolveUserPath("~/.config/gogcli/credentials.json"));
  if (process.platform === "darwin") {
    paths.push(resolveUserPath("~/Library/Application Support/gogcli/credentials.json"));
  }
  return paths;
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeEpochMs(value: number): number {
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function extractClientSecrets(parsed: Record<string, unknown>): {
  clientId?: string;
  clientSecret?: string;
} {
  const installed = asRecord(parsed.installed);
  const web = asRecord(parsed.web);
  const candidate = installed ?? web ?? parsed;
  return {
    clientId: asString(candidate.client_id ?? candidate.clientId),
    clientSecret: asString(candidate.client_secret ?? candidate.clientSecret),
  };
}

function extractTokenFields(parsed: Record<string, unknown>): {
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: number;
} {
  const refreshToken = asString(parsed.refresh_token ?? parsed.refreshToken ?? parsed.refresh);
  const accessToken = asString(parsed.access_token ?? parsed.accessToken ?? parsed.access);
  let expiresAt = asNumber(parsed.expiry_date ?? parsed.expires_at ?? parsed.expiresAt);
  const expiresIn = asNumber(parsed.expires_in ?? parsed.expiresIn);
  if (!expiresAt && typeof expiresIn === "number") {
    expiresAt = Date.now() + expiresIn * 1000;
  }
  if (typeof expiresAt === "number") {
    expiresAt = normalizeEpochMs(expiresAt);
  }
  return { refreshToken, accessToken, expiresAt };
}

function findTokenInfo(parsed: Record<string, unknown>): {
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: number;
} {
  const direct = extractTokenFields(parsed);
  if (direct.refreshToken) {
    return direct;
  }

  const candidates = [
    "token",
    "tokens",
    "oauth",
    "credentials",
    "credential",
    "auth",
    "user",
    "userToken",
    "user_token",
  ];

  for (const key of candidates) {
    const value = parsed[key];
    if (Array.isArray(value)) {
      for (const entry of value) {
        const record = asRecord(entry);
        if (!record) {
          continue;
        }
        const token = extractTokenFields(record);
        if (token.refreshToken) {
          return token;
        }
      }
    } else {
      const record = asRecord(value);
      if (!record) {
        continue;
      }
      const token = extractTokenFields(record);
      if (token.refreshToken) {
        return token;
      }
    }
  }

  return direct;
}

async function resolveGogCredentials(): Promise<GmailCredentials | undefined> {
  const paths = gogCredentialsPaths();
  for (const credentialPath of paths) {
    const credentialData = await readJsonFile(credentialPath);
    if (!credentialData) {
      continue;
    }

    const { clientId, clientSecret } = extractClientSecrets(credentialData);
    if (!clientId || !clientSecret) {
      continue;
    }

    let tokenInfo = findTokenInfo(credentialData);
    if (!tokenInfo.refreshToken) {
      const dir = dirname(credentialPath);
      const tokenCandidates = ["token.json", "tokens.json", "oauth.json", "credentials.json"];
      for (const tokenFile of tokenCandidates) {
        const tokenData = await readJsonFile(join(dir, tokenFile));
        if (!tokenData) {
          continue;
        }
        const extracted = findTokenInfo(tokenData);
        if (extracted.refreshToken) {
          tokenInfo = extracted;
          break;
        }
      }
    }

    if (tokenInfo.refreshToken) {
      return {
        clientId,
        clientSecret,
        refreshToken: tokenInfo.refreshToken,
        accessToken: tokenInfo.accessToken,
        expiresAt: tokenInfo.expiresAt,
      };
    }
  }

  return undefined;
}

function resolveExplicitCredentials(cfg: OpenClawConfig): GmailCredentials | undefined {
  const channelCfg = resolveEmailGmailConfig(cfg);
  const clientId = channelCfg?.clientId ?? process.env[ENV_CLIENT_ID];
  const clientSecret = channelCfg?.clientSecret ?? process.env[ENV_CLIENT_SECRET];
  const refreshToken = channelCfg?.refreshToken ?? process.env[ENV_REFRESH_TOKEN];

  if (!clientId || !clientSecret || !refreshToken) {
    return undefined;
  }

  return {
    clientId,
    clientSecret,
    refreshToken,
  };
}

export async function resolveGmailCredentials(
  cfg: OpenClawConfig,
): Promise<GmailCredentials | undefined> {
  const gog = await resolveGogCredentials();
  if (gog) {
    return gog;
  }

  return resolveExplicitCredentials(cfg);
}

export async function refreshGmailAccessToken(creds: GmailCredentials): Promise<string> {
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const details = text ? `: ${text}` : "";
    throw new Error(`email-gmail: token refresh failed (${response.status})${details}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    expires_at?: number;
    expiry_date?: number;
  };

  if (!data.access_token) {
    throw new Error("email-gmail: token refresh missing access_token");
  }

  creds.accessToken = data.access_token;
  let expiresAt: number | undefined;
  if (typeof data.expires_in === "number") {
    expiresAt = Date.now() + data.expires_in * 1000;
  } else if (typeof data.expires_at === "number") {
    expiresAt = normalizeEpochMs(data.expires_at);
  } else if (typeof data.expiry_date === "number") {
    expiresAt = normalizeEpochMs(data.expiry_date);
  }
  if (expiresAt) {
    creds.expiresAt = expiresAt;
  }

  return data.access_token;
}
