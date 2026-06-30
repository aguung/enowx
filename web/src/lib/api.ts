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
  disabled: boolean;
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

export interface Usage {
  limit: number;
  used: number;
  remaining: number;
  plan?: string;
  message?: string;
}

export const accountsApi = {
  list: (provider?: string) =>
    api.get<Account[]>(`/api/accounts${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`),
  add: (a: NewAccount) => api.post<{ id: number }>("/api/accounts", a),
  setStatus: (id: number, status: string) =>
    api.patch<{ ok: boolean }>(`/api/accounts/${id}/status`, { status }),
  setDisabled: (id: number, disabled: boolean) =>
    api.patch<{ ok: boolean }>(`/api/accounts/${id}/disabled`, { disabled }),
  remove: (id: number) => api.del<{ ok: boolean }>(`/api/accounts/${id}`),
  usage: (id: number) => api.get<{ supported: boolean; usage?: Usage }>(`/api/accounts/${id}/usage`),
  warmup: (id: number) =>
    api.post<{ ok: boolean; status: string; error?: string; usage_supported?: boolean; usage?: Usage }>(
      `/api/accounts/${id}/warmup`,
    ),
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

export interface LocalSource {
  provider: string;
  target: string;
  path: string;
}

export const localApi = {
  scan: () => api.get<LocalSource[]>("/api/local-sources"),
  import: (provider: string, target: string) =>
    api.post<{ id: number }>("/api/local-sources/import", { provider, target }),
};

export interface FileEntry {
  name: string;
  is_dir: boolean;
  size: number;
  mod: string;
}

export interface DirListing {
  path: string;
  parent: string;
  home: string;
  entries: FileEntry[];
}

export interface FileContent {
  path: string;
  size: number;
  truncated: boolean;
  binary: boolean;
  content: string;
}

export const filesApi = {
  list: (path?: string) =>
    api.get<DirListing>(`/api/files${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  read: (path: string) => api.get<FileContent>(`/api/files/read?path=${encodeURIComponent(path)}`),
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
  source: string;
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
  clear: () => api.del<{ ok: boolean }>("/api/requests"),
};

export interface ApiKey {
  id: number;
  label: string;
  secret: string;
  token_limit: number;
  tokens_used: number;
  max_concurrent: number;
  expires_at: string | null;
  enabled: boolean;
  created_at: string;
  last_used: string | null;
}

export interface NewApiKey {
  label?: string;
  token_limit?: number;
  max_concurrent?: number;
  expires_in_days?: number;
}

export const keysApi = {
  list: () => api.get<ApiKey[]>("/api/keys"),
  add: (k: NewApiKey = {}) => api.post<{ id: number; secret: string }>("/api/keys", k),
  remove: (id: number) => api.del<{ ok: boolean }>(`/api/keys/${id}`),
};

export interface WarmupLog {
  id: number;
  account_id: number;
  provider: string;
  label: string;
  ok: boolean;
  outcome: string;
  status: string;
  request: string;
  response: string;
  usage: string;
  duration_ms: number;
  created_at: string;
}

export const warmupLogsApi = {
  list: (limit = 100) => api.get<WarmupLog[]>(`/api/warmup-logs?limit=${limit}`),
  clear: () => api.del<{ ok: boolean }>("/api/warmup-logs"),
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

export interface DocParam {
  name: string;
  in: string;
  desc: string;
}
export interface DocEndpoint {
  method: string;
  path: string;
  desc: string;
  params?: DocParam[];
}
export interface DocGroup {
  name: string;
  desc: string;
  endpoints: DocEndpoint[];
}
export interface Shortcut {
  keys: string;
  desc: string;
}
export interface ShortcutGroup {
  name: string;
  items: Shortcut[];
}
export interface Docs {
  version: string;
  overview: Record<string, string>;
  plugins: Record<string, string>;
  shortcuts: { summary: string; groups: ShortcutGroup[] };
  groups: DocGroup[];
}

export const docsApi = {
  get: () => api.get<Docs>("/api/docs"),
};

export interface TopRole {
  name: string;
  icon_url: string;
  color: number; // legacy single color (decimal)
  primary: number; // gradient primary (decimal)
  secondary: number | null; // gradient secondary (decimal)
}

export interface SyncUser {
  discord_id: string;
  username: string;
  avatar_url: string;
  roles: string[];
  plan: string;
  top_role?: TopRole | null;
}

export interface SyncStatus {
  configured: boolean;
  enabled: boolean;
  server_url: string;
  user: SyncUser | null;
}

export const syncApi = {
  status: () => api.get<SyncStatus>("/api/sync/status"),
  loginStart: (server_url?: string) =>
    api.post<{ authorize_url: string; state: string }>("/api/sync/login", { server_url }),
  loginPoll: (state: string) =>
    api.get<{ done: boolean; user: SyncUser | null }>(`/api/sync/login/poll?state=${encodeURIComponent(state)}`),
  logout: () => api.post<{ ok: boolean }>("/api/sync/logout"),
  now: () => api.post<{ pushed: number; pulled: number }>("/api/sync/now"),
};

export interface AuthStatus {
  password_set: boolean;
  loopback: boolean;
  logged_in: boolean;
  authorized: boolean;
}

export const authApi = {
  status: () => api.get<AuthStatus>("/api/auth/status"),
  setup: (password: string) => api.post<{ ok: boolean }>("/api/auth/setup", { password }),
  login: (password: string) => api.post<{ ok: boolean }>("/api/auth/login", { password }),
  logout: () => api.post<{ ok: boolean }>("/api/auth/logout"),
  change: (current: string, next: string) => api.post<{ ok: boolean }>("/api/auth/change", { current, new: next }),
};

export interface TunnelStatus {
  enabled: boolean;
  mode: "" | "quick" | "named";
  url: string;
  hostname: string;
  logged_in: boolean;
  downloading: boolean;
  download_pct: number;
}

export const tunnelApi = {
  status: () => api.get<TunnelStatus>("/api/tunnel/status"),
  enableQuick: () => api.post<TunnelStatus>("/api/tunnel/enable"),
  disable: () => api.post<TunnelStatus>("/api/tunnel/disable"),
  named: (hostname: string) => api.post<TunnelStatus>("/api/tunnel/named", { hostname }),
  // login is SSE — consumed directly in the tunnel store, not here.
  loginUrl: () => "/api/tunnel/login",
};

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: string;
  thumbnail: string;
}

export interface Playlist {
  id: number;
  name: string;
  description: string;
  share_code: string;
  count: number;
  tracks?: Track[];
  created_at: string;
}

export interface PlaylistExport {
  version: number;
  name: string;
  description: string;
  share_code: string;
  tracks: Track[];
}

export const musicApi = {
  search: (q: string) => api.get<Track[]>(`/api/music/search?q=${encodeURIComponent(q)}`),
  // The stream URL is used directly as an <audio> src (it proxies + supports Range).
  streamUrl: (id: string) => `/api/music/stream?id=${encodeURIComponent(id)}`,
  discover: () => api.get<Track[]>("/api/music/discover"),
  recordPlay: (t: Track) =>
    api.post<{ ok: boolean }>("/api/music/history", { id: t.id, title: t.title, artist: t.artist, album: t.album }),
  history: (limit = 50) => api.get<Track[]>(`/api/music/history?limit=${limit}`),
  clearHistory: () => api.del<{ ok: boolean }>("/api/music/history"),
  playlists: () => api.get<Playlist[]>("/api/music/playlists"),
  playlist: (id: number) => api.get<Playlist>(`/api/music/playlists/${id}`),
  createPlaylist: (name: string, description = "") =>
    api.post<{ id: number }>("/api/music/playlists", { name, description }),
  deletePlaylist: (id: number) => api.del<{ ok: boolean }>(`/api/music/playlists/${id}`),
  addTrack: (id: number, t: Track) => api.post<{ ok: boolean }>(`/api/music/playlists/${id}/tracks`, t),
  removeTrack: (id: number, videoId: string) =>
    api.del<{ ok: boolean }>(`/api/music/playlists/${id}/tracks/${encodeURIComponent(videoId)}`),
  exportUrl: (id: number) => `/api/music/playlists/${id}/export`,
  exportPlaylist: (id: number) => api.get<PlaylistExport>(`/api/music/playlists/${id}/export`),
  importPlaylist: (data: PlaylistExport) => api.post<{ id: number }>("/api/music/playlists/import", data),
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
