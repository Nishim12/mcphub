import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---- Types ----
export type Upstream = {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  status: string;
  enabled: boolean;
  connectedAt: string | null;
  lastError: string | null;
  circuit: { state: string; failures: number } | null;
};

export type Tool = {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, { type?: string; default?: unknown; description?: string }>; required?: string[] };
};

export type HealthData = {
  status: string;
  version: string;
  startedAt: string;
  healthy: number;
  total: number;
  cacheTtlSeconds: number;
};

export type StatsData = {
  servers: Record<string, { toolCount: number; toolListTokenEstimate: number; tools: Record<string, { calls: number; successes: number; failures: number; totalLatencyMs: number }> }>;
  analysis: {
    totalTokens: number;
    wastedTokens: number;
    wastedPercent: number;
    topTools: { tool: string; server: string; calls: number; avgLatencyMs: number }[];
    deadTools: { tool: string; server: string; tokenCost: number }[];
    errorProne: { tool: string; server: string; failureRate: number; failures: number }[];
  };
};

export type RegistryServer = {
  id: string;
  name: string;
  author: string;
  author_avatar: string;
  description: string;
  github_url: string;
  stars: number;
  license: string | null;
  tags: string[];
  metadata: { is_verified?: boolean };
  run_config: { command: string; args: string[]; env: string[]; user_input: { key: string; type: string; description: string }[] } | null;
};

// ---- Fetchers ----
const get = <T>(url: string): Promise<T> => fetch(url).then((r) => r.json());
const post = <T>(url: string, body?: unknown): Promise<T> =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const del = <T>(url: string): Promise<T> => fetch(url, { method: "DELETE" }).then((r) => r.json());

// ---- Hooks ----
export const useHealth = () => useQuery({ queryKey: ["health"], queryFn: () => get<HealthData>("/health") });
export const useStats = () => useQuery({ queryKey: ["stats"], queryFn: () => get<StatsData>("/stats") });
export const useTools = () => useQuery({ queryKey: ["tools"], queryFn: () => get<Tool[]>("/api/tools") });
export const useUpstreams = () => useQuery({ queryKey: ["upstreams"], queryFn: () => get<Upstream[]>("/api/upstreams") });

export const useRegistrySearch = (q: string) =>
  useQuery({
    queryKey: ["registry", q],
    queryFn: () => get<{ list: RegistryServer[]; total_count: number }>(`/api/registry/search?q=${encodeURIComponent(q)}&per_page=20&sort=trending`),
    enabled: q.length >= 2,
    refetchInterval: false,
    staleTime: 60_000,
  });

export function useServerActions() {
  const qc = useQueryClient();
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["upstreams"] }); qc.invalidateQueries({ queryKey: ["health"] }); };

  const add = useMutation({ mutationFn: (body: { name: string; command: string; args: string[]; env?: Record<string, string> }) => post("/api/upstreams", body), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (name: string) => del(`/api/upstreams/${encodeURIComponent(name)}`), onSuccess: invalidate });
  const toggle = useMutation({ mutationFn: (name: string) => post(`/api/upstreams/${encodeURIComponent(name)}/toggle`), onSuccess: invalidate });
  const restart = useMutation({ mutationFn: (name: string) => post(`/api/upstreams/${encodeURIComponent(name)}/restart`), onSuccess: invalidate });
  const callTool = useMutation({ mutationFn: (body: { name: string; arguments: Record<string, unknown> }) => post("/api/tools/call", body) });

  return { add, remove, toggle, restart, callTool };
}

/** Strip markdown formatting → plain text */
export function stripMd(s: string) {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
