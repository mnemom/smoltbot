export const API_BASE = "https://api.mnemom.ai";

export interface Agent {
  id: string;
  gateway: string;
  last_seen: string | null;
  claimed: boolean;
  email?: string;
  created_at: string;
}

export interface IntegrityScore {
  agent_id: string;
  score: number;
  total_traces: number;
  verified: number;
  violations: number;
  last_updated: string;
}

export interface Trace {
  id: string;
  agent_id: string;
  timestamp: string;
  action: string;
  verified: boolean;
  reasoning?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

export interface ApiError {
  error: string;
  message: string;
}

async function fetchApi<T>(endpoint: string): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = (await response.json().catch(() => ({
      error: "unknown",
      message: response.statusText,
    }))) as ApiError;
    throw new Error(error.message || `API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function getAgent(id: string): Promise<Agent> {
  return fetchApi<Agent>(`/v1/agents/${id}`);
}

export async function getIntegrity(id: string): Promise<IntegrityScore> {
  return fetchApi<IntegrityScore>(`/v1/integrity/${id}`);
}

export async function getTraces(
  id: string,
  limit: number = 10
): Promise<Trace[]> {
  return fetchApi<Trace[]>(`/v1/traces?agent_id=${id}&limit=${limit}`);
}
