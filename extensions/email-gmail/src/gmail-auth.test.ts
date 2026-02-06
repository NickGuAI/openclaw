import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadFile = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

vi.mock("node:os", () => ({
  homedir: () => "/home/test",
}));

import { refreshGmailAccessToken, resolveGmailCredentials } from "./gmail-auth.js";

describe("gmail-auth", () => {
  const baseCfg = { channels: {} } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.GMAIL_CLIENT_ID;
    delete process.env.GMAIL_CLIENT_SECRET;
    delete process.env.GMAIL_REFRESH_TOKEN;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resolves credentials from gog paths", async () => {
    process.env.XDG_CONFIG_HOME = "/config";

    mockReadFile.mockImplementation(async (path: string) => {
      if (path === "/config/gogcli/credentials.json") {
        return JSON.stringify({
          installed: {
            client_id: "client-123",
            client_secret: "secret-xyz",
          },
        });
      }
      if (path === "/config/gogcli/token.json") {
        return JSON.stringify({
          refresh_token: "refresh-abc",
          access_token: "access-123",
          expiry_date: 1_800_000_000_000,
        });
      }
      throw new Error("ENOENT");
    });

    const creds = await resolveGmailCredentials(baseCfg);
    expect(creds).toBeDefined();
    expect(creds!.clientId).toBe("client-123");
    expect(creds!.clientSecret).toBe("secret-xyz");
    expect(creds!.refreshToken).toBe("refresh-abc");
    expect(creds!.accessToken).toBe("access-123");
    expect(creds!.expiresAt).toBe(1_800_000_000_000);
  });

  it("resolves credentials from explicit config", async () => {
    mockReadFile.mockImplementation(async () => {
      throw new Error("ENOENT");
    });

    const cfg = {
      channels: {
        "email-gmail": {
          clientId: "cfg-client",
          clientSecret: "cfg-secret",
          refreshToken: "cfg-refresh",
        },
      },
    } as any;

    const creds = await resolveGmailCredentials(cfg);
    expect(creds).toBeDefined();
    expect(creds!.clientId).toBe("cfg-client");
    expect(creds!.clientSecret).toBe("cfg-secret");
    expect(creds!.refreshToken).toBe("cfg-refresh");
  });

  it("returns undefined when no credentials found", async () => {
    mockReadFile.mockImplementation(async () => {
      throw new Error("ENOENT");
    });

    const creds = await resolveGmailCredentials(baseCfg);
    expect(creds).toBeUndefined();
  });

  it("refreshes access token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "new-access", expires_in: 3600 }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const creds = {
      clientId: "id",
      clientSecret: "secret",
      refreshToken: "refresh",
    };

    const token = await refreshGmailAccessToken(creds);
    expect(token).toBe("new-access");
    expect(creds.accessToken).toBe("new-access");
    expect(creds.expiresAt).toBeGreaterThan(Date.now());
  });

  it("throws on invalid refresh token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({}),
      text: async () => "invalid_grant",
    });
    vi.stubGlobal("fetch", fetchMock);

    const creds = {
      clientId: "id",
      clientSecret: "secret",
      refreshToken: "refresh",
    };

    await expect(refreshGmailAccessToken(creds)).rejects.toThrow("token refresh failed");
  });
});
