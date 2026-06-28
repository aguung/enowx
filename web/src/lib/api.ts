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

export interface AwsStart {
  session: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  interval: number;
  expires_in: number;
}

export const kiroApi = {
  manual: (json: string, label?: string) =>
    api.post<{ id: number }>("/api/accounts/kiro/manual", { json, label }),
  refresh: (refresh_token: string, region?: string, label?: string) =>
    api.post<{ id: number }>("/api/accounts/kiro/refresh", { refresh_token, region, label }),
  awsStart: (region?: string) => api.post<AwsStart>("/api/accounts/kiro/aws/start", { region }),
  awsPoll: (session: string) =>
    api.get<{ status: "pending" | "done"; id?: number }>(
      `/api/accounts/kiro/aws/poll?session=${encodeURIComponent(session)}`,
    ),
  oauthStart: () => api.post<{ session: string; authorize_url: string }>("/api/accounts/kiro/oauth/start"),
  oauthExchange: (session: string, code: string) =>
    api.post<{ id: number }>("/api/accounts/kiro/oauth/exchange", { session, code }),
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
  bucket: string;
  requests: number;
  in_tokens: number;
  out_tokens: number;
}

export type SeriesRange = "daily" | "7d" | "30d" | "all";

export interface ModelStat {
  model: string;
  requests: number;
  in_tokens: number;
  out_tokens: number;
}

export const requestsApi = {
  summary: () => api.get<RequestSummary>("/api/requests/summary"),
  list: (limit = 100) => api.get<RequestRow[]>(`/api/requests?limit=${limit}`),
  series: (range: SeriesRange = "daily") =>
    api.get<SeriesPoint[]>(`/api/requests/series?range=${range}`),
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

export interface DebugInfo {
  process: { cpu_percent: number; rss: number; pid: number };
  memory: {
    heap_alloc: number;
    heap_sys: number;
    heap_objects: number;
    stack_inuse: number;
    sys: number;
    total_alloc: number;
    live_objects: number;
  };
  gc: {
    num_gc: number;
    gc_cpu_fraction: number;
    last_gc: string;
    next_gc_target: number;
    pause_total_ns: number;
  };
  goroutines: number;
  build: {
    version: string;
    go_version: string;
    os: string;
    arch: string;
    num_cpu: number;
    max_procs: number;
  };
  uptime_seconds: number;
  now: string;
}

export const debugApi = {
  get: () => api.get<DebugInfo>("/api/debug"),
};
