import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestContext } from "./types.js";
import { agentsHandlers } from "./agents.js";

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  loadConfig: vi.fn(),
  readConfigFileSnapshot: vi.fn(),
  resolveConfigSnapshotHash: vi.fn(),
  writeConfigFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: (...args: unknown[]) => mocks.mkdir(...args),
    stat: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: (...args: unknown[]) => mocks.loadConfig(...args),
  readConfigFileSnapshot: (...args: unknown[]) => mocks.readConfigFileSnapshot(...args),
  resolveConfigSnapshotHash: (...args: unknown[]) => mocks.resolveConfigSnapshotHash(...args),
  writeConfigFile: (...args: unknown[]) => mocks.writeConfigFile(...args),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds: (cfg: { agents?: { list?: unknown[] } }) => {
    const list = cfg?.agents?.list;
    if (!Array.isArray(list)) {
      return [];
    }
    return list
      .map((entry) => (entry && typeof entry === "object" ? (entry as { id?: unknown }).id : null))
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  },
  resolveAgentWorkspaceDir: (_cfg: unknown, agentId: string) => `/tmp/workspaces/${agentId}`,
}));

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deferred<T = void>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeSnapshot(config: Record<string, unknown>) {
  const raw = JSON.stringify(config);
  return {
    exists: true,
    valid: true,
    config: cloneJson(config),
    raw,
    hash: raw,
    issues: [],
    warnings: [],
    legacyIssues: [],
    parsed: cloneJson(config),
    path: "/tmp/config.json",
  };
}

function makeContext(): GatewayRequestContext {
  return {
    dedupe: new Map(),
    addChatRun: vi.fn(),
    logGateway: { info: vi.fn(), error: vi.fn() },
  } as unknown as GatewayRequestContext;
}

async function callAgentsCreate(id: string, respond: ReturnType<typeof vi.fn>) {
  await agentsHandlers["agents.create"]({
    params: { id },
    respond,
    context: makeContext(),
    client: null,
    req: { id: `req-${id}`, type: "req", method: "agents.create" } as never,
    isWebchatConnect: () => false,
  });
}

describe("agents.create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serializes concurrent creates so both new agents are preserved", async () => {
    let configState: Record<string, unknown> = { agents: { list: [] } };
    const firstWriteStarted = deferred();
    const releaseFirstWrite = deferred();
    let writeCount = 0;

    mocks.mkdir.mockResolvedValue(undefined);
    mocks.loadConfig.mockImplementation(() => cloneJson(configState));
    mocks.readConfigFileSnapshot.mockImplementation(async () => makeSnapshot(configState));
    mocks.resolveConfigSnapshotHash.mockImplementation((snapshot: { hash?: unknown }) =>
      typeof snapshot.hash === "string" ? snapshot.hash : null,
    );
    mocks.writeConfigFile.mockImplementation(async (next: Record<string, unknown>) => {
      writeCount += 1;
      if (writeCount === 1) {
        firstWriteStarted.resolve();
        await releaseFirstWrite.promise;
      }
      configState = cloneJson(next);
    });

    const respondAlpha = vi.fn();
    const alphaPromise = callAgentsCreate("alpha", respondAlpha);

    await firstWriteStarted.promise;

    const respondBeta = vi.fn();
    const betaPromise = callAgentsCreate("beta", respondBeta);

    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseFirstWrite.resolve();

    await Promise.all([alphaPromise, betaPromise]);

    const finalIds = ((configState.agents as { list?: Array<{ id?: string }> }).list ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === "string");

    expect(finalIds).toEqual(["alpha", "beta"]);
    expect(respondAlpha).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true, agentId: "alpha" }),
      undefined,
    );
    expect(respondBeta).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true, agentId: "beta" }),
      undefined,
    );
  });
});
