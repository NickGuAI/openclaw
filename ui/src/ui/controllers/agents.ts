import type { GatewayBrowserClient } from "../gateway.ts";
import type { AgentsCreateResult, AgentsListResult } from "../types.ts";

export type AgentsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  agentsLoading: boolean;
  agentsError: string | null;
  agentsList: AgentsListResult | null;
  agentsSelectedId: string | null;
  agentCreateDialogOpen: boolean;
  agentCreateId: string;
  agentCreateName: string;
  agentCreateError: string | null;
  agentCreateLoading: boolean;
};

export async function loadAgents(state: AgentsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.agentsLoading) {
    return;
  }
  state.agentsLoading = true;
  state.agentsError = null;
  try {
    const res = await state.client.request<AgentsListResult>("agents.list", {});
    if (res) {
      state.agentsList = res;
      const selected = state.agentsSelectedId;
      const known = res.agents.some((entry) => entry.id === selected);
      if (!selected || !known) {
        state.agentsSelectedId = res.defaultId ?? res.agents[0]?.id ?? null;
      }
    }
  } catch (err) {
    state.agentsError = String(err);
  } finally {
    state.agentsLoading = false;
  }
}

export async function createAgent(
  state: AgentsState,
  params: { id: string; name?: string },
): Promise<AgentsCreateResult | null> {
  if (!state.client || !state.connected || state.agentCreateLoading) {
    return null;
  }

  const id = params.id.trim();
  const name = params.name?.trim();
  if (!id) {
    state.agentCreateError = "Agent ID is required.";
    return null;
  }

  state.agentCreateLoading = true;
  state.agentCreateError = null;
  try {
    const res = await state.client.request<AgentsCreateResult>("agents.create", {
      id,
      ...(name ? { name } : {}),
    });
    if (!res) {
      return null;
    }
    await loadAgents(state);
    state.agentsSelectedId = res.agentId;
    state.agentCreateDialogOpen = false;
    state.agentCreateId = "";
    state.agentCreateName = "";
    return res;
  } catch (err) {
    state.agentCreateError = String(err);
    return null;
  } finally {
    state.agentCreateLoading = false;
  }
}
