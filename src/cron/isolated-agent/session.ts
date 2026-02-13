import crypto from "node:crypto";
import type { OpenClawConfig } from "../../config/config.js";
import { loadSessionStore, resolveStorePath, type SessionEntry } from "../../config/sessions.js";

export function resolveCronSession(params: {
  cfg: OpenClawConfig;
  sessionKey: string;
  nowMs: number;
  agentId: string;
  reuseExistingSession?: boolean;
}) {
  const sessionCfg = params.cfg.session;
  const storePath = resolveStorePath(sessionCfg?.store, {
    agentId: params.agentId,
  });
  const store = loadSessionStore(storePath);
  const entry = store[params.sessionKey];
  const existingSessionId =
    typeof entry?.sessionId === "string" && entry.sessionId.trim().length > 0
      ? entry.sessionId.trim()
      : undefined;
  const shouldReuse = params.reuseExistingSession === true && !!existingSessionId;
  const sessionId = shouldReuse ? (existingSessionId as string) : crypto.randomUUID();
  const systemSent = shouldReuse ? entry?.systemSent === true : false;
  const sessionEntry: SessionEntry = {
    sessionId,
    updatedAt: params.nowMs,
    systemSent,
    thinkingLevel: entry?.thinkingLevel,
    verboseLevel: entry?.verboseLevel,
    model: entry?.model,
    modelOverride: entry?.modelOverride,
    providerOverride: entry?.providerOverride,
    contextTokens: entry?.contextTokens,
    sendPolicy: entry?.sendPolicy,
    lastChannel: entry?.lastChannel,
    lastTo: entry?.lastTo,
    lastAccountId: entry?.lastAccountId,
    label: entry?.label,
    displayName: entry?.displayName,
    skillsSnapshot: entry?.skillsSnapshot,
  };
  return { storePath, store, sessionEntry, systemSent, isNewSession: !shouldReuse };
}
