import type { GatewayBrowserClient } from "../gateway.ts";
import type { ConfigSchemaResponse, ConfigSnapshot, ConfigUiHints } from "../types.ts";
import {
  cloneConfigObject,
  removePathValue,
  serializeConfigForm,
  setPathValue,
} from "./config/form-utils.ts";

export type ConfigState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  applySessionKey: string;
  configLoading: boolean;
  configRaw: string;
  configRawOriginal: string;
  configValid: boolean | null;
  configIssues: unknown[];
  configSaving: boolean;
  configApplying: boolean;
  updateRunning: boolean;
  configSnapshot: ConfigSnapshot | null;
  configSchema: unknown;
  configSchemaVersion: string | null;
  configSchemaLoading: boolean;
  configUiHints: ConfigUiHints;
  configForm: Record<string, unknown> | null;
  configFormOriginal: Record<string, unknown> | null;
  configFormDirty: boolean;
  configFormMode: "form" | "raw";
  configSearchQuery: string;
  configActiveSection: string | null;
  configActiveSubsection: string | null;
  lastError: string | null;
};

type RefreshConfigSnapshotHashOptions = {
  rebaseDirtyForm?: boolean;
};

type ConfigPath = Array<string | number>;
type ConfigRebaseOp =
  | {
      kind: "set";
      path: ConfigPath;
      value: unknown;
    }
  | {
      kind: "remove";
      path: ConfigPath;
    }
  | {
      kind: "mergeStableArray";
      path: ConfigPath;
      base: unknown[];
      current: unknown[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!valuesEqual(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) {
      return false;
    }
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    for (const key of leftKeys) {
      if (!Object.hasOwn(right, key)) {
        return false;
      }
      if (!valuesEqual(left[key], right[key])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

type StableArrayIndex = {
  order: string[];
  keySet: Set<string>;
  byKey: Map<string, unknown>;
};

function resolveStableArrayKey(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const idRaw = value.id;
  if (typeof idRaw !== "string") {
    return null;
  }
  const id = idRaw.trim();
  return id.length > 0 ? id : null;
}

function indexStableArray(items: unknown[]): StableArrayIndex | null {
  const order: string[] = [];
  const keySet = new Set<string>();
  const byKey = new Map<string, unknown>();
  for (const item of items) {
    const key = resolveStableArrayKey(item);
    if (!key || keySet.has(key)) {
      return null;
    }
    keySet.add(key);
    order.push(key);
    byKey.set(key, cloneConfigObject(item));
  }
  return { order, keySet, byKey };
}

function collectRebaseOps(base: unknown, next: unknown, path: ConfigPath, ops: ConfigRebaseOp[]) {
  if (valuesEqual(base, next)) {
    return;
  }
  if (Array.isArray(base) && Array.isArray(next)) {
    const stableBase = indexStableArray(base);
    const stableNext = indexStableArray(next);
    if (stableBase && stableNext) {
      ops.push({
        kind: "mergeStableArray",
        path,
        base: cloneConfigObject(base),
        current: cloneConfigObject(next),
      });
      return;
    }
    const sharedLength = Math.min(base.length, next.length);
    for (let index = 0; index < sharedLength; index += 1) {
      collectRebaseOps(base[index], next[index], [...path, index], ops);
    }
    if (next.length > base.length) {
      for (let index = sharedLength; index < next.length; index += 1) {
        ops.push({
          kind: "set",
          path: [...path, index],
          value: cloneConfigObject(next[index]),
        });
      }
      return;
    }
    for (let index = base.length - 1; index >= next.length; index -= 1) {
      ops.push({ kind: "remove", path: [...path, index] });
    }
    return;
  }
  if (Array.isArray(base) || Array.isArray(next)) {
    ops.push({ kind: "set", path, value: cloneConfigObject(next) });
    return;
  }
  if (isRecord(base) && isRecord(next)) {
    for (const key of Object.keys(base)) {
      if (!Object.hasOwn(next, key)) {
        ops.push({ kind: "remove", path: [...path, key] });
      }
    }
    for (const key of Object.keys(next)) {
      if (!Object.hasOwn(base, key)) {
        ops.push({ kind: "set", path: [...path, key], value: cloneConfigObject(next[key]) });
        continue;
      }
      collectRebaseOps(base[key], next[key], [...path, key], ops);
    }
    return;
  }
  ops.push({ kind: "set", path, value: cloneConfigObject(next) });
}

function getPathValue(root: unknown, path: ConfigPath): unknown {
  if (path.length === 0) {
    return root;
  }
  let current: unknown = root;
  for (const part of path) {
    if (typeof part === "number") {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[part];
      continue;
    }
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function rebaseUnknown(base: unknown, current: unknown, latest: unknown): unknown {
  if (valuesEqual(base, current)) {
    return cloneConfigObject(latest);
  }
  const ops: ConfigRebaseOp[] = [];
  collectRebaseOps(base, current, [], ops);
  return applyRebaseOps({ latest, ops });
}

function mergeStableArray(params: {
  base: unknown[];
  current: unknown[];
  latest: unknown;
}): unknown[] {
  const baseIndex = indexStableArray(params.base);
  const currentIndex = indexStableArray(params.current);
  if (!baseIndex || !currentIndex) {
    return cloneConfigObject(params.current);
  }
  if (!Array.isArray(params.latest)) {
    return cloneConfigObject(params.current);
  }
  const latestIndex = indexStableArray(params.latest);
  if (!latestIndex) {
    return cloneConfigObject(params.current);
  }

  const resultByKey = new Map<string, unknown>();
  for (const key of latestIndex.order) {
    resultByKey.set(key, cloneConfigObject(latestIndex.byKey.get(key)));
  }

  for (const key of baseIndex.order) {
    if (!currentIndex.keySet.has(key)) {
      resultByKey.delete(key);
    }
  }

  for (const key of currentIndex.order) {
    const currentItem = cloneConfigObject(currentIndex.byKey.get(key));
    if (!baseIndex.keySet.has(key)) {
      if (resultByKey.has(key)) {
        const latestItem = resultByKey.get(key);
        resultByKey.set(key, rebaseUnknown({}, currentItem, latestItem));
      } else {
        resultByKey.set(key, currentItem);
      }
      continue;
    }
    const baseItem = baseIndex.byKey.get(key);
    if (valuesEqual(baseItem, currentItem)) {
      continue;
    }
    if (resultByKey.has(key)) {
      const latestItem = resultByKey.get(key);
      resultByKey.set(key, rebaseUnknown(baseItem, currentItem, latestItem));
    } else {
      resultByKey.set(key, currentItem);
    }
  }

  const rebased: unknown[] = [];
  const emitted = new Set<string>();
  for (const key of currentIndex.order) {
    if (!resultByKey.has(key) || emitted.has(key)) {
      continue;
    }
    rebased.push(cloneConfigObject(resultByKey.get(key)));
    emitted.add(key);
  }
  for (const key of latestIndex.order) {
    if (!resultByKey.has(key) || emitted.has(key)) {
      continue;
    }
    rebased.push(cloneConfigObject(resultByKey.get(key)));
    emitted.add(key);
  }
  for (const [key, value] of resultByKey.entries()) {
    if (emitted.has(key)) {
      continue;
    }
    rebased.push(cloneConfigObject(value));
  }
  return rebased;
}

function applyRebaseOps(params: { latest: unknown; ops: ConfigRebaseOp[] }): unknown {
  let rebased = cloneConfigObject(params.latest);
  for (const op of params.ops) {
    if (op.kind === "mergeStableArray") {
      const latestAtPath = getPathValue(rebased, op.path);
      const merged = mergeStableArray({
        base: op.base,
        current: op.current,
        latest: latestAtPath,
      });
      if (op.path.length === 0) {
        rebased = merged;
      } else if (Array.isArray(rebased) || isRecord(rebased)) {
        setPathValue(rebased, op.path, merged);
      }
      continue;
    }
    if (op.path.length === 0) {
      if (op.kind === "set") {
        rebased = cloneConfigObject(op.value);
      } else {
        rebased = {};
      }
      continue;
    }
    if (!Array.isArray(rebased) && !isRecord(rebased)) {
      continue;
    }
    if (op.kind === "set") {
      setPathValue(rebased, op.path, cloneConfigObject(op.value));
      continue;
    }
    removePathValue(rebased, op.path);
  }
  return rebased;
}

function rebaseFormEdits(params: {
  original: Record<string, unknown>;
  current: Record<string, unknown>;
  latest: Record<string, unknown>;
}): Record<string, unknown> {
  const ops: ConfigRebaseOp[] = [];
  collectRebaseOps(params.original, params.current, [], ops);
  const rebased = applyRebaseOps({ latest: params.latest, ops });
  return isRecord(rebased) ? rebased : cloneConfigObject(params.latest);
}

export async function loadConfig(state: ConfigState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.configLoading = true;
  state.lastError = null;
  try {
    const res = await state.client.request<ConfigSnapshot>("config.get", {});
    applyConfigSnapshot(state, res);
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.configLoading = false;
  }
}

export async function refreshConfigSnapshotHash(
  state: ConfigState,
  options: RefreshConfigSnapshotHashOptions = {},
) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<ConfigSnapshot>("config.get", {});
    const shouldRebaseDirtyForm =
      state.configFormDirty && state.configFormMode === "form" && options.rebaseDirtyForm === true;
    if (state.configFormDirty && !shouldRebaseDirtyForm) {
      // Keep the original base hash while edits are dirty so optimistic-lock checks still detect
      // out-of-date saves instead of silently accepting stale local content.
      state.configValid = typeof res.valid === "boolean" ? res.valid : state.configValid;
      state.configIssues = Array.isArray(res.issues) ? res.issues : state.configIssues;
      return;
    }
    if (shouldRebaseDirtyForm) {
      const latestConfig = cloneConfigObject(
        res.config && typeof res.config === "object" ? res.config : {},
      ) as Record<string, unknown>;
      const originalConfig = cloneConfigObject(
        state.configFormOriginal ??
          (state.configSnapshot?.config && typeof state.configSnapshot.config === "object"
            ? state.configSnapshot.config
            : {}),
      ) as Record<string, unknown>;
      const currentForm = cloneConfigObject(state.configForm ?? {}) as Record<string, unknown>;
      const rebasedForm = rebaseFormEdits({
        original: originalConfig,
        current: currentForm,
        latest: latestConfig,
      });

      state.configSnapshot = res;
      state.configForm = rebasedForm;
      state.configRaw = serializeConfigForm(rebasedForm);
      state.configFormOriginal = latestConfig;
      state.configRawOriginal =
        typeof res.raw === "string" ? res.raw : serializeConfigForm(latestConfig);
      state.configValid = typeof res.valid === "boolean" ? res.valid : state.configValid;
      state.configIssues = Array.isArray(res.issues) ? res.issues : state.configIssues;
      return;
    }
    applyConfigSnapshot(state, res);
  } catch (err) {
    state.lastError = String(err);
  }
}

export async function loadConfigSchema(state: ConfigState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.configSchemaLoading) {
    return;
  }
  state.configSchemaLoading = true;
  try {
    const res = await state.client.request<ConfigSchemaResponse>("config.schema", {});
    applyConfigSchema(state, res);
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.configSchemaLoading = false;
  }
}

export function applyConfigSchema(state: ConfigState, res: ConfigSchemaResponse) {
  state.configSchema = res.schema ?? null;
  state.configUiHints = res.uiHints ?? {};
  state.configSchemaVersion = res.version ?? null;
}

export function applyConfigSnapshot(state: ConfigState, snapshot: ConfigSnapshot) {
  state.configSnapshot = snapshot;
  const rawFromSnapshot =
    typeof snapshot.raw === "string"
      ? snapshot.raw
      : snapshot.config && typeof snapshot.config === "object"
        ? serializeConfigForm(snapshot.config)
        : state.configRaw;
  if (!state.configFormDirty || state.configFormMode === "raw") {
    state.configRaw = rawFromSnapshot;
  } else if (state.configForm) {
    state.configRaw = serializeConfigForm(state.configForm);
  } else {
    state.configRaw = rawFromSnapshot;
  }
  state.configValid = typeof snapshot.valid === "boolean" ? snapshot.valid : null;
  state.configIssues = Array.isArray(snapshot.issues) ? snapshot.issues : [];

  if (!state.configFormDirty) {
    state.configForm = cloneConfigObject(snapshot.config ?? {});
    state.configFormOriginal = cloneConfigObject(snapshot.config ?? {});
    state.configRawOriginal = rawFromSnapshot;
  }
}

export async function saveConfig(state: ConfigState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.configSaving = true;
  state.lastError = null;
  try {
    const raw =
      state.configFormMode === "form" && state.configForm
        ? serializeConfigForm(state.configForm)
        : state.configRaw;
    const baseHash = state.configSnapshot?.hash;
    if (!baseHash) {
      state.lastError = "Config hash missing; reload and retry.";
      return;
    }
    await state.client.request("config.set", { raw, baseHash });
    state.configFormDirty = false;
    await loadConfig(state);
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.configSaving = false;
  }
}

export async function applyConfig(state: ConfigState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.configApplying = true;
  state.lastError = null;
  try {
    const raw =
      state.configFormMode === "form" && state.configForm
        ? serializeConfigForm(state.configForm)
        : state.configRaw;
    const baseHash = state.configSnapshot?.hash;
    if (!baseHash) {
      state.lastError = "Config hash missing; reload and retry.";
      return;
    }
    await state.client.request("config.apply", {
      raw,
      baseHash,
      sessionKey: state.applySessionKey,
    });
    state.configFormDirty = false;
    await loadConfig(state);
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.configApplying = false;
  }
}

export async function runUpdate(state: ConfigState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.updateRunning = true;
  state.lastError = null;
  try {
    await state.client.request("update.run", {
      sessionKey: state.applySessionKey,
    });
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.updateRunning = false;
  }
}

export function updateConfigFormValue(
  state: ConfigState,
  path: Array<string | number>,
  value: unknown,
) {
  const base = cloneConfigObject(state.configForm ?? state.configSnapshot?.config ?? {});
  setPathValue(base, path, value);
  state.configForm = base;
  state.configFormDirty = true;
  if (state.configFormMode === "form") {
    state.configRaw = serializeConfigForm(base);
  }
}

export function removeConfigFormValue(state: ConfigState, path: Array<string | number>) {
  const base = cloneConfigObject(state.configForm ?? state.configSnapshot?.config ?? {});
  removePathValue(base, path);
  state.configForm = base;
  state.configFormDirty = true;
  if (state.configFormMode === "form") {
    state.configRaw = serializeConfigForm(base);
  }
}
