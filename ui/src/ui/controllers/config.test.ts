import { describe, expect, it, vi } from "vitest";
import {
  applyConfigSnapshot,
  applyConfig,
  refreshConfigSnapshotHash,
  runUpdate,
  updateConfigFormValue,
  type ConfigState,
} from "./config.ts";

function createState(): ConfigState {
  return {
    applySessionKey: "main",
    client: null,
    configActiveSection: null,
    configActiveSubsection: null,
    configApplying: false,
    configForm: null,
    configFormDirty: false,
    configFormMode: "form",
    configFormOriginal: null,
    configIssues: [],
    configLoading: false,
    configRaw: "",
    configRawOriginal: "",
    configSaving: false,
    configSchema: null,
    configSchemaLoading: false,
    configSchemaVersion: null,
    configSearchQuery: "",
    configSnapshot: null,
    configUiHints: {},
    configValid: null,
    connected: false,
    lastError: null,
    updateRunning: false,
  };
}

describe("applyConfigSnapshot", () => {
  it("does not clobber form edits while dirty", () => {
    const state = createState();
    state.configFormMode = "form";
    state.configFormDirty = true;
    state.configForm = { gateway: { mode: "local", port: 18789 } };
    state.configRaw = "{\n}\n";

    applyConfigSnapshot(state, {
      config: { gateway: { mode: "remote", port: 9999 } },
      valid: true,
      issues: [],
      raw: '{\n  "gateway": { "mode": "remote", "port": 9999 }\n}\n',
    });

    expect(state.configRaw).toBe(
      '{\n  "gateway": {\n    "mode": "local",\n    "port": 18789\n  }\n}\n',
    );
  });

  it("updates config form when clean", () => {
    const state = createState();
    applyConfigSnapshot(state, {
      config: { gateway: { mode: "local" } },
      valid: true,
      issues: [],
      raw: "{}",
    });

    expect(state.configForm).toEqual({ gateway: { mode: "local" } });
  });

  it("sets configRawOriginal when clean for change detection", () => {
    const state = createState();
    applyConfigSnapshot(state, {
      config: { gateway: { mode: "local" } },
      valid: true,
      issues: [],
      raw: '{ "gateway": { "mode": "local" } }',
    });

    expect(state.configRawOriginal).toBe('{ "gateway": { "mode": "local" } }');
    expect(state.configFormOriginal).toEqual({ gateway: { mode: "local" } });
  });

  it("preserves configRawOriginal when dirty", () => {
    const state = createState();
    state.configFormDirty = true;
    state.configRawOriginal = '{ "original": true }';
    state.configFormOriginal = { original: true };

    applyConfigSnapshot(state, {
      config: { gateway: { mode: "local" } },
      valid: true,
      issues: [],
      raw: '{ "gateway": { "mode": "local" } }',
    });

    // Original values should be preserved when dirty
    expect(state.configRawOriginal).toBe('{ "original": true }');
    expect(state.configFormOriginal).toEqual({ original: true });
  });
});

describe("updateConfigFormValue", () => {
  it("seeds from snapshot when form is null", () => {
    const state = createState();
    state.configSnapshot = {
      config: { channels: { telegram: { botToken: "t" } }, gateway: { mode: "local" } },
      valid: true,
      issues: [],
      raw: "{}",
    };

    updateConfigFormValue(state, ["gateway", "port"], 18789);

    expect(state.configFormDirty).toBe(true);
    expect(state.configForm).toEqual({
      channels: { telegram: { botToken: "t" } },
      gateway: { mode: "local", port: 18789 },
    });
  });

  it("keeps raw in sync while editing the form", () => {
    const state = createState();
    state.configSnapshot = {
      config: { gateway: { mode: "local" } },
      valid: true,
      issues: [],
      raw: "{\n}\n",
    };

    updateConfigFormValue(state, ["gateway", "port"], 18789);

    expect(state.configRaw).toBe(
      '{\n  "gateway": {\n    "mode": "local",\n    "port": 18789\n  }\n}\n',
    );
  });
});

describe("refreshConfigSnapshotHash", () => {
  it("does not update snapshot hash while dirty, but keeps validity diagnostics fresh", async () => {
    const request = vi.fn().mockResolvedValue({
      hash: "new-hash",
      config: { gateway: { mode: "local", port: 18789 } },
      valid: false,
      issues: [{ path: "gateway.port", message: "invalid port" }],
      raw: '{ "gateway": { "mode": "local", "port": 18789 } }',
    });
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.configFormDirty = true;
    state.configFormMode = "raw";
    state.configRaw = '{\n  // unsaved raw edit\n  gateway: { mode: "local", port: 18000 }\n}\n';
    state.configSnapshot = {
      hash: "old-hash",
      config: { gateway: { mode: "local", port: 18000 } },
      valid: true,
      issues: [],
      raw: "{}",
    };

    await refreshConfigSnapshotHash(state);

    expect(state.configSnapshot?.hash).toBe("old-hash");
    expect(state.configValid).toBe(false);
    expect(state.configIssues).toEqual([{ path: "gateway.port", message: "invalid port" }]);
    expect(state.configRaw).toBe(
      '{\n  // unsaved raw edit\n  gateway: { mode: "local", port: 18000 }\n}\n',
    );
  });

  it("updates snapshot hash when config is clean", async () => {
    const request = vi.fn().mockResolvedValue({
      hash: "new-hash",
      config: { gateway: { mode: "local", port: 18789 } },
      valid: true,
      issues: [],
      raw: '{ "gateway": { "mode": "local", "port": 18789 } }',
    });
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.configFormDirty = false;
    state.configSnapshot = {
      hash: "old-hash",
      config: { gateway: { mode: "local", port: 18000 } },
      valid: true,
      issues: [],
      raw: "{}",
    };

    await refreshConfigSnapshotHash(state);

    expect(state.configSnapshot?.hash).toBe("new-hash");
  });

  it("rebases dirty form edits and updates hash when requested", async () => {
    const request = vi.fn().mockResolvedValue({
      hash: "new-hash",
      config: {
        gateway: { mode: "local", port: 19000 },
        agents: { list: [{ id: "alpha" }] },
      },
      valid: true,
      issues: [],
      raw: '{ "gateway": { "mode": "local", "port": 19000 }, "agents": { "list": [{ "id": "alpha" }] } }',
    });
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.configFormDirty = true;
    state.configFormMode = "form";
    state.configFormOriginal = { gateway: { mode: "local", port: 18789 } };
    state.configForm = { gateway: { mode: "remote", port: 18789 } };
    state.configSnapshot = {
      hash: "old-hash",
      config: { gateway: { mode: "local", port: 18789 } },
      valid: true,
      issues: [],
      raw: "{}",
    };

    await refreshConfigSnapshotHash(state, { rebaseDirtyForm: true });

    expect(state.configSnapshot?.hash).toBe("new-hash");
    expect(state.configForm).toEqual({
      gateway: { mode: "remote", port: 19000 },
      agents: { list: [{ id: "alpha" }] },
    });
    expect(state.configRaw).toBe(
      '{\n  "gateway": {\n    "mode": "remote",\n    "port": 19000\n  },\n  "agents": {\n    "list": [\n      {\n        "id": "alpha"\n      }\n    ]\n  }\n}\n',
    );
  });

  it("preserves remote array additions while rebasing local array edits", async () => {
    const request = vi.fn().mockResolvedValue({
      hash: "new-hash",
      config: {
        agents: {
          list: [
            { id: "alpha", name: "Alpha" },
            { id: "beta", name: "Beta" },
          ],
        },
      },
      valid: true,
      issues: [],
      raw: '{ "agents": { "list": [{ "id": "alpha", "name": "Alpha" }, { "id": "beta", "name": "Beta" }] } }',
    });
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.configFormDirty = true;
    state.configFormMode = "form";
    state.configFormOriginal = {
      agents: {
        list: [{ id: "alpha", name: "Alpha" }],
      },
    };
    state.configForm = {
      agents: {
        list: [{ id: "alpha", name: "ALPHA OVERRIDE" }],
      },
    };
    state.configSnapshot = {
      hash: "old-hash",
      config: {
        agents: {
          list: [{ id: "alpha", name: "Alpha" }],
        },
      },
      valid: true,
      issues: [],
      raw: "{}",
    };

    await refreshConfigSnapshotHash(state, { rebaseDirtyForm: true });

    expect(state.configSnapshot?.hash).toBe("new-hash");
    expect(state.configForm).toEqual({
      agents: {
        list: [
          { id: "alpha", name: "ALPHA OVERRIDE" },
          { id: "beta", name: "Beta" },
        ],
      },
    });
  });

  it("rebases keyed agent list edits without duplicating ids when order diverges", async () => {
    const request = vi.fn().mockResolvedValue({
      hash: "new-hash",
      config: {
        agents: {
          list: [{ id: "alpha" }, { id: "beta" }],
        },
      },
      valid: true,
      issues: [],
      raw: '{ "agents": { "list": [{ "id": "alpha" }, { "id": "beta" }] } }',
    });
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.configFormDirty = true;
    state.configFormMode = "form";
    state.configFormOriginal = {
      agents: {
        list: [{ id: "alpha" }],
      },
    };
    state.configForm = {
      agents: {
        list: [{ id: "beta" }],
      },
    };
    state.configSnapshot = {
      hash: "old-hash",
      config: {
        agents: {
          list: [{ id: "alpha" }],
        },
      },
      valid: true,
      issues: [],
      raw: "{}",
    };

    await refreshConfigSnapshotHash(state, { rebaseDirtyForm: true });

    expect(state.configSnapshot?.hash).toBe("new-hash");
    expect(state.configForm).toEqual({
      agents: {
        list: [{ id: "beta" }],
      },
    });
  });
});

describe("applyConfig", () => {
  it("sends config.apply with raw and session key", async () => {
    const request = vi.fn().mockResolvedValue({});
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.applySessionKey = "agent:main:whatsapp:dm:+15555550123";
    state.configFormMode = "raw";
    state.configRaw = '{\n  agent: { workspace: "~/openclaw" }\n}\n';
    state.configSnapshot = {
      hash: "hash-123",
    };

    await applyConfig(state);

    expect(request).toHaveBeenCalledWith("config.apply", {
      raw: '{\n  agent: { workspace: "~/openclaw" }\n}\n',
      baseHash: "hash-123",
      sessionKey: "agent:main:whatsapp:dm:+15555550123",
    });
  });
});

describe("runUpdate", () => {
  it("sends update.run with session key", async () => {
    const request = vi.fn().mockResolvedValue({});
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.applySessionKey = "agent:main:whatsapp:dm:+15555550123";

    await runUpdate(state);

    expect(request).toHaveBeenCalledWith("update.run", {
      sessionKey: "agent:main:whatsapp:dm:+15555550123",
    });
  });
});
