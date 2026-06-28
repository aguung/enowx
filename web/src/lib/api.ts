async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!res.ok) throw new Error(body.error || `request failed (${res.status})`);
  return body.data as T;
}

export const api = {
  get: <T>(p: string) => req<T>(p),
  post: <T>(p: string, payload?: unknown) =>
    req<T>(p, { method: "POST", body: JSON.stringify(payload ?? {}) }),
  patch: <T>(p: string, payload?: unknown) =>
    req<T>(p, { method: "PATCH", body: JSON.stringify(payload ?? {}) }),
  del: <T>(p: string) => req<T>(p, { method: "DELETE" }),
};

export interface Provider {
  name: string;
  label: string;
  icon: string;
  chat: boolean;
  images: boolean;
}

export interface Account {
  id: number;
  provider: string;
  label: string;
  status: string;
  has: string[];
  created_at: string;
}

export interface NewAccount {
  provider: string;
  label?: string;
  secret?: string;
  creds?: Record<string, string>;
}

export const providersApi = {
  list: () => api.get<Provider[]>("/api/providers"),
};

export const accountsApi = {
  list: (provider?: string) =>
    api.get<Account[]>(`/api/accounts${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`),
  add: (a: NewAccount) => api.post<{ id: number }>("/api/accounts", a),
  setStatus: (id: number, status: string) =>
    api.patch<{ ok: boolean }>(`/api/accounts/${id}/status`, { status }),
  remove: (id: number) => api.del<{ ok: boolean }>(`/api/accounts/${id}`),
};

export interface RequestSummary {
  total: number;
  ok: number;
  errors: number;
  in_tokens: number;
  out_tokens: number;
  avg_ms: number;
}

export interface RequestRow {
  id: number;
  provider: string;
  model: string;
  status: string;
  in_tokens: number;
  out_tokens: number;
  latency_ms: number;
  created_at: string;
}

export interface SeriesPoint {
  hour: string;
  requests: number;
  in_tokens: number;
  out_tokens: number;
}

export interface ModelStat {
  model: string;
  requests: number;
  in_tokens: number;
  out_tokens: number;
}

export const requestsApi = {
  summary: () => api.get<RequestSummary>("/api/requests/summary"),
  list: (limit = 100) => api.get<RequestRow[]>(`/api/requests?limit=${limit}`),
  series: () => api.get<SeriesPoint[]>("/api/requests/series"),
  topModels: (limit = 5) => api.get<ModelStat[]>(`/api/requests/top-models?limit=${limit}`),
};

export interface ApiKey {
  id: number;
  label: string;
  secret: string;
  created_at: string;
  last_used: string | null;
}

export const keysApi = {
  list: () => api.get<ApiKey[]>("/api/keys"),
  add: (label?: string) => api.post<{ id: number; secret: string }>("/api/keys", { label }),
  remove: (id: number) => api.del<{ ok: boolean }>(`/api/keys/${id}`),
};

export interface Settings {
  version: string;
  host: string;
  port: number;
  runtime_dir: string;
  uptime_sec: number;
}

export const settingsApi = {
  get: () => api.get<Settings>("/api/settings"),
};
