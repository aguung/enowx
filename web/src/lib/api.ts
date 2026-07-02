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
  put: <T>(p: string, payload?: unknown) =>
    req<T>(p, { method: "PUT", body: JSON.stringify(payload ?? {}) }),
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
  custom?: boolean;
}

export interface CustomModel { id: string; name: string }
export interface CustomProvider {
  id: number;
  name: string;
  prefix: string;
  format: "openai" | "anthropic";
  base_url: string;
  default_model: string;
  models: CustomModel[];
}

export interface Account {
  id: number;
  provider: string;
  label: string;
  status: string;
  disabled: boolean;
  has: string[];
  can_apply?: boolean;
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

export interface ContentFilter {
  id: number;
  pattern: string;
  replacement: string;
  is_regex: boolean;
  is_active: boolean;
}
export interface FilterTemplate {
  name: string;
  rules: ContentFilter[];
}
export const filterApi = {
  list: () => api.get<{ filters: ContentFilter[] }>("/api/filters"),
  add: (f: Omit<ContentFilter, "id">) => api.post<{ id: number }>("/api/filters", f),
  update: (id: number, f: Omit<ContentFilter, "id">) => api.patch<{ ok: boolean }>(`/api/filters/${id}`, f),
  remove: (id: number) => api.del<{ ok: boolean }>(`/api/filters/${id}`),
  templates: () => api.get<{ templates: FilterTemplate[] }>("/api/filter-templates"),
  saveTemplate: (name: string) => api.post<{ ok: boolean }>("/api/filter-templates", { name }),
  loadTemplate: (name: string) => api.post<{ ok: boolean }>(`/api/filter-templates/${encodeURIComponent(name)}/load`, {}),
  removeTemplate: (name: string) => api.del<{ ok: boolean }>(`/api/filter-templates/${encodeURIComponent(name)}`),
};

export const customProviderApi = {
  list: () => api.get<{ providers: CustomProvider[] }>("/api/custom-providers"),
  create: (p: Omit<CustomProvider, "id"> & { api_key?: string }) => api.post<{ id: number }>("/api/custom-providers", p),
  update: (id: number, p: Omit<CustomProvider, "id">) => api.patch<{ ok: boolean }>(`/api/custom-providers/${id}`, p),
  remove: (id: number) => api.del<{ ok: boolean }>(`/api/custom-providers/${id}`),
  probe: (base_url: string, format: string, api_key: string) => api.post<{ models: CustomModel[] }>("/api/custom-providers/probe", { base_url, format, api_key }),
};

export interface UsageWindow {
  label: string;
  used_percent: number;
  reset_in_secs?: number;
}
export interface Usage {
  limit: number;
  used: number;
  remaining: number;
  plan?: string;
  message?: string;
  windows?: UsageWindow[];
}

// ProviderModel is one model an account can access (from live fetch or the
// cloud DB catalog).
export interface ProviderModel {
  id?: number; // present for DB catalog entries (admin editing)
  provider?: string;
  model_id: string;
  name: string;
  type: string; // chat | image
  owned_by?: string;
  enabled?: boolean;
  sort_order?: number;
  max_input?: number;
  max_output?: number;
}

// ModelAlias is a per-user local alias (call `alias` -> routes to `target`).
export interface ModelAlias {
  alias: string;
  target: string;
}

export const aliasesApi = {
  list: () => api.get<{ aliases: ModelAlias[] }>("/api/model-aliases"),
  set: (alias: string, target: string) => api.post<ModelAlias>("/api/model-aliases", { alias, target }),
  remove: (alias: string) => api.del<{ deleted: string }>(`/api/model-aliases/${encodeURIComponent(alias)}`),
};

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
  models: (id: number) => api.get<{ provider: string; source: string; models: ProviderModel[] }>(`/api/accounts/${id}/models`),
  allModels: () => api.get<{ models: ProviderModel[] }>("/api/models"),
  testModel: (id: number, model: string, type?: string) =>
    api.post<{ ok: boolean; model: string; latency: number; response?: string; error?: string }>(`/api/accounts/${id}/test-model`, { model, type }),
  warmup: (id: number) =>
    api.post<{ ok: boolean; status: string; error?: string; usage_supported?: boolean; usage?: Usage }>(
      `/api/accounts/${id}/warmup`,
    ),
  apply: (id: number, target: "desktop" | "cli" = "desktop", launch = true) =>
    api.post<{ applied: boolean; action: string; message: string; target_path: string; launch_error?: string }>(
      `/api/accounts/${id}/apply`,
      { target, launch },
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
  awsStart: (opts?: { region?: string; auth_method?: "builder-id" | "idc"; start_url?: string }) =>
    api.post<AwsStart>("/api/accounts/kiro/aws/start", opts ?? {}),
  awsPoll: (session: string) =>
    api.get<{ status: "pending" | "done"; id?: number }>(
      `/api/accounts/kiro/aws/poll?session=${encodeURIComponent(session)}`,
    ),
  oauthStart: () => api.post<{ session: string; authorize_url: string }>("/api/accounts/kiro/oauth/start"),
  oauthExchange: (session: string, code: string) =>
    api.post<{ id: number }>("/api/accounts/kiro/oauth/exchange", { session, code }),
};

export const codexApi = {
  oauthStart: () => api.post<{ session: string; authorize_url: string }>("/api/accounts/codex/oauth/start"),
  // code may be a raw code or the full callback URL — backend extracts it.
  oauthExchange: (session: string, code: string) =>
    api.post<{ id: number }>("/api/accounts/codex/oauth/exchange", { session, code }),
  manual: (json: string, label?: string) =>
    api.post<{ id: number }>("/api/accounts/codex/manual", { json, label }),
};

export interface PluginManifest {
  id: string;
  name: string;
  description: string;
  icon: string;
  runtime: string; // go | python | node | static
  entry: string;
  ui: string;
  running?: boolean;
  port?: number;
  error?: string;
  has_icon?: boolean;
}
export interface PluginRuntime { id: string; available: boolean; version?: string }

export const pluginsApi = {
  list: () => api.get<{ plugins: PluginManifest[]; runtimes: PluginRuntime[] }>("/api/plugins"),
  create: (id: string, name: string, runtime: string, starter: boolean) =>
    api.post<{ manifest: PluginManifest; path: string }>("/api/plugins", { id, name, runtime, starter }),
  start: (id: string) => api.post<{ ok: boolean }>(`/api/plugins/${id}/start`),
  stop: (id: string) => api.post<{ ok: boolean }>(`/api/plugins/${id}/stop`),
  reveal: (id: string) => api.post<{ ok: boolean; path: string }>(`/api/plugins/${id}/reveal`),
  remove: (id: string) => api.del<{ ok: boolean }>(`/api/plugins/${id}`),
  logs: (id: string) => api.get<{ lines: string[] }>(`/api/plugins/${id}/logs`),
  iconUrl: (id: string) => `/api/plugins/${id}/icon`,
  uploadIcon: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(`/api/plugins/${id}/icon`, { method: "POST", body: fd, credentials: "same-origin" }).then((r) => {
      if (!r.ok) throw new Error("upload failed");
      return r.json();
    });
  },
};

export interface MarketPlugin {
  id: number;
  slug: string;
  name: string;
  description: string;
  runtime: string;
  icon_url: string;
  version: string;
  install_count: number;
  username: string;
  display_name: string;
  avatar_url: string;
}

export const marketApi = {
  publish: (id: string) => api.post<{ status: string; reason?: string; id?: number; file?: string }>("/api/market/publish", { id }),
  list: (q = "") => api.get<{ plugins: MarketPlugin[] }>(`/api/market/plugins${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  install: (id: number) => api.post<{ installed: boolean; id: string }>(`/api/market/install/${id}`),
};

export interface PluginScanSettings { ai_review_endpoint: string; ai_review_model: string; ai_review_enabled: boolean; has_key: boolean }

export const leonardoApi = {
  fromCookie: (cookie: string, label?: string) =>
    api.post<{ id: number; email: string }>("/api/accounts/leonardo/cookie", { cookie, label }),
  browserStart: () => api.post<{ session: string }>("/api/accounts/leonardo/browser/start"),
  browserPoll: (session: string) =>
    api.post<{ ready: boolean; id?: number; email?: string; note?: string }>("/api/accounts/leonardo/browser/poll", { session }),
  browserCancel: (session: string) => api.post<{ ok: boolean }>("/api/accounts/leonardo/browser/cancel", { session }),
};

export const antigravityApi = {
  oauthStart: () => api.post<{ session: string; authorize_url: string }>("/api/accounts/antigravity/oauth/start"),
  oauthExchange: (session: string, code: string) =>
    api.post<{ id: number }>("/api/accounts/antigravity/oauth/exchange", { session, code }),
  manual: (json: string, label?: string) =>
    api.post<{ id: number }>("/api/accounts/antigravity/manual", { json, label }),
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

// --- API Test dev tool ---
export interface KV { key: string; value: string; on?: boolean }
export interface ApiCollection { id: number; name: string; sort: number }
export interface ApiSavedRequest {
  id: number;
  collection_id: number;
  name: string;
  method: string;
  base_url: string;
  url: string;
  headers: string; // JSON [{key,value,on}]
  query: string;   // JSON [{key,value,on}]
  body: string;
  body_type: string;
  auth: string;    // JSON {type,...}
  sort: number;
}
export interface ApiEnvironment { id: number; name: string; vars: string; active: boolean }
export interface ApiHistoryItem { id: number; method: string; url: string; status: number; duration_ms: number; at: string }
export interface ApiTestData {
  collections: ApiCollection[];
  requests: ApiSavedRequest[];
  environments: ApiEnvironment[];
  history: ApiHistoryItem[];
}

export const apitestApi = {
  all: () => api.get<ApiTestData>("/api/apitest"),
  addCollection: (name: string) => api.post<{ id: number }>("/api/apitest/collections", { name }),
  renameCollection: (id: number, name: string) => api.patch<{ ok: boolean }>(`/api/apitest/collections/${id}`, { name }),
  deleteCollection: (id: number) => api.del<{ ok: boolean }>(`/api/apitest/collections/${id}`),
  saveRequest: (r: Partial<ApiSavedRequest>) => api.post<{ id: number }>("/api/apitest/requests", r),
  deleteRequest: (id: number) => api.del<{ ok: boolean }>(`/api/apitest/requests/${id}`),
  saveEnv: (e: Partial<ApiEnvironment>) => api.post<{ id: number }>("/api/apitest/environments", e),
  deleteEnv: (id: number) => api.del<{ ok: boolean }>(`/api/apitest/environments/${id}`),
  activateEnv: (id: number) => api.post<{ ok: boolean }>(`/api/apitest/environments/${id}/activate`),
  addHistory: (h: Partial<ApiHistoryItem>) => api.post<{ ok: boolean }>("/api/apitest/history", h),
  clearHistory: () => api.del<{ ok: boolean }>("/api/apitest/history"),
};

// --- Coding agent tools (local) ---
export const agentApi = {
  fsRead: (cwd: string, path: string) => api.post<{ path: string; content: string; truncated: boolean }>("/api/agent/fs/read", { cwd, path }),
  fsList: (cwd: string, path: string) => api.post<{ path: string; entries: { name: string; is_dir: boolean; size: number; mod: string }[] }>("/api/agent/fs/list", { cwd, path }),
  fsWrite: (cwd: string, path: string, content: string) => api.post<{ path: string; old: string; new: string; created: boolean }>("/api/agent/fs/write", { cwd, path, content }),
  fsEdit: (cwd: string, path: string, oldStr: string, newStr: string) => api.post<{ path: string; old: string; new: string }>("/api/agent/fs/edit", { cwd, path, old: oldStr, new: newStr }),
  exec: (cwd: string, command: string, timeout_ms?: number) => api.post<{ stdout: string; stderr: string; exit_code: number; timed_out: boolean }>("/api/agent/exec", { cwd, command, timeout_ms }),
  http: (method: string, url: string, headers?: Record<string, string>, body?: string) => api.post<{ status: number; headers: Record<string, string>; body: string }>("/api/agent/http", { method, url, headers, body }),
};

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

export interface VersionInfo {
  current: string;
  latest?: string;
  update_available: boolean;
  notes?: string;
  published_at?: string;
  asset_url?: string;
}
export const versionApi = {
  get: (fresh = false) => api.get<VersionInfo>(`/api/version${fresh ? "?fresh=1" : ""}`),
  update: () => api.post<{ started: boolean }>("/api/update"),
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
  wears_tag?: boolean;
  guild_tag?: string;
  kleos?: number;
  is_moderator?: boolean;
  is_premium?: boolean;
  is_donor?: boolean;
  online?: boolean;
  last_seen?: string;
  rating_avg?: number;
  rating_count?: number;
  entitlements?: string[];
  display_name?: string;
  bio?: string;
  accent_color?: string;
  primary_color?: string;
  pronouns?: string;
  equipped?: Equipped;
  banner_url?: string;
  links?: ProfileLink[];
  created_at?: string;
}

export interface ProfileLink {
  label: string;
  url: string;
}

export interface ProfileEdit {
  display_name: string;
  bio: string;
  accent_color: string;
  primary_color: string;
  pronouns: string;
  links: ProfileLink[];
}

export const profileApi = {
  update: (e: ProfileEdit) => api.patch<SyncUser>("/api/profile", e),
  publicById: (id: string) => api.get<PublicProfile>(`/api/users/${encodeURIComponent(id)}/profile`),
  idByName: (name: string) => api.get<{ id: string }>(`/api/users/by-name/${encodeURIComponent(name)}`),
  posts: (id: string) => api.get<{ posts: Post[] }>(`/api/users/${encodeURIComponent(id)}/posts`),
  uploadAvatar: (file: File) => uploadFile<{ avatar_url: string }>("/api/profile/avatar", file),
  uploadBanner: (file: File) => uploadFile<{ banner_url: string }>("/api/profile/banner", file),
};

// uploadFile posts a single file as multipart/form-data. The server wraps
// responses in { data, error }, so unwrap like req() does.
async function uploadFile<T>(path: string, file: File): Promise<T> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(path, { method: "POST", body: fd });
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!res.ok) throw new Error(body.error || `upload failed (${res.status})`);
  return body.data as T;
}

// imageApi uploads a chat/post image and returns its CDN URL.
export const imageApi = {
  upload: (file: File) => uploadFile<{ url: string }>("/api/upload/image", file),
};

export interface Equipped {
  title: string;
  badge: string;
  effect: string;
  banner: string;
}

export interface CosmeticItem {
  id: string;
  kind: "title" | "badge" | "effect" | "banner";
  name: string;
  price: number;
  payload: string;
}

export interface ShopState {
  catalog: CosmeticItem[];
  owned: string[];
  kleos: number;
  equipped: Equipped;
}

export const shopApi = {
  get: () => api.get<ShopState>("/api/shop"),
  buy: (item_id: string) => api.post<{ kleos: number; owned: string[] }>("/api/shop/buy", { item_id }),
  equip: (kind: string, item_id: string) => api.post<{ equipped: Equipped }>("/api/shop/equip", { kind, item_id }),
};

// FlaggedLink is a suspected duplicate-account pair (moderator review queue).
export interface FlaggedLink {
  id: number;
  user_a: string;
  user_b: string;
  name_a: string;
  name_b: string;
  reasons: string;
  score: number;
  created_at: string;
}

// ModAction is one entry in the moderation audit log.
export interface ModAction {
  id: number;
  action: string;
  target: string;
  detail: string;
  actor_name: string;
  actor_display: string;
  created_at: string;
}

// AdminStats holds community-wide counters for the admin overview.
export interface AdminStats {
  users: number;
  moderators: number;
  messages: number;
  posts: number;
  open_flags: number;
}

// AdminUser is a user row in the admin user list.
export interface AdminUser {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  top_role_id: string;
  is_moderator: boolean;
  is_banned: boolean;
  muted_until?: string;
  kleos: number;
  created_at: string;
}

export const adminApi = {
  flags: () => api.get<{ links: FlaggedLink[] }>("/api/admin/flags"),
  review: (id: number) => api.post<{ reviewed: number }>(`/api/admin/flags/${id}/review`),
  log: () => api.get<{ actions: ModAction[] }>("/api/admin/log"),
  stats: () => api.get<AdminStats>("/api/admin/stats"),
  users: () => api.get<{ users: AdminUser[] }>("/api/admin/users"),
  models: (provider: string) => api.get<{ provider: string; models: ProviderModel[] }>(`/api/admin/models?provider=${encodeURIComponent(provider)}`),
  upsertModel: (m: ProviderModel) => api.post<{ id: number }>("/api/admin/models", m),
  updateModel: (id: number, m: ProviderModel) => api.patch<{ ok: boolean }>(`/api/admin/models/${id}`, m),
  deleteModel: (id: number) => api.del<{ deleted: number }>(`/api/admin/models/${id}`),
  ban: (id: string, on: boolean) => api.post<{ banned: boolean }>(`/api/admin/users/${id}/ban`, { on }),
  mute: (id: string, minutes: number) => api.post<{ muted_minutes: number }>(`/api/admin/users/${id}/mute`, { minutes }),
  warn: (id: string, message: string) => api.post<{ warned: boolean }>(`/api/admin/users/${id}/warn`, { message }),
  adjustKleos: (id: string, amount: number) => api.post<{ kleos: number }>(`/api/admin/users/${id}/kleos`, { amount }),
  pluginScan: () => api.get<PluginScanSettings>("/api/admin/plugin-scan"),
  savePluginScan: (s: { ai_review_endpoint: string; ai_review_model: string; ai_review_enabled: boolean; ai_review_api_key?: string }) =>
    api.put<{ ok: boolean }>("/api/admin/plugin-scan", s),
  pluginReviews: (verdict = "") => api.get<{ reviews: PluginReview[] }>(`/api/admin/plugin-reviews${verdict ? `?verdict=${verdict}` : ""}`),
  pluginReview: (id: number) => api.get<PluginReviewDetail>(`/api/admin/plugin-reviews/${id}`),
  // Marketplace moderation
  marketPlugins: (status = "") => api.get<{ plugins: AdminMarketPlugin[] }>(`/api/admin/marketplace${status ? `?status=${status}` : ""}`),
  marketSource: (id: number) => api.get<{ id: number; name: string; slug: string; runtime: string; sources: { path: string; content: string }[] }>(`/api/admin/marketplace/${id}/source`),
  marketApprove: (id: number, reason = "") => api.post<{ ok: boolean }>(`/api/admin/marketplace/${id}/approve`, { reason }),
  marketReject: (id: number, reason: string) => api.post<{ ok: boolean }>(`/api/admin/marketplace/${id}/reject`, { reason }),
  marketTakedown: (id: number) => api.del<{ ok: boolean }>(`/api/admin/marketplace/${id}`),
};

export interface AdminMarketPlugin {
  id: number;
  slug: string;
  name: string;
  description: string;
  runtime: string;
  icon_url: string;
  version: string;
  install_count: number;
  status: string; // approved | rejected | pending
  review_reason: string;
  created_at: string;
  username: string;
  display_name: string;
}

export interface PluginReview {
  id: number;
  name: string;
  slug: string;
  runtime: string;
  verdict: string; // approved | rejected
  reason: string;
  scan_stage: string; // heuristics | ai
  created_at: string;
  username: string;
  display_name: string;
}
export interface PluginReviewDetail extends PluginReview {
  sources: { path: string; content: string }[];
}

export interface PostCategory {
  key: string;
  label: string;
}

export interface Post {
  id: number;
  user_id: string;
  category: string;
  title: string;
  body: string;
  created_at: string;
  edited_at?: string | null;
  username: string;
  display_name?: string;
  avatar_url?: string;
  top_role?: TopRole | null;
  wears_tag?: boolean;
  guild_tag?: string;
  upvotes: number;
  upvoted: boolean;
  reactions?: Reaction[];
  comment_count?: number;
  images?: string[];
}

export interface Comment {
  id: number;
  post_id: number;
  user_id: string;
  body: string;
  created_at: string;
  edited_at?: string | null;
  reply_to?: number | null;
  username: string;
  display_name?: string;
  avatar_url?: string;
  top_role?: TopRole | null;
  wears_tag?: boolean;
  guild_tag?: string;
  reactions?: Reaction[];
}

export const commentsApi = {
  list: (postId: number) => api.get<{ comments: Comment[] }>(`/api/posts/${postId}/comments`),
  add: (postId: number, body: string, reply_to?: number) => api.post<Comment>(`/api/posts/${postId}/comments`, { body, reply_to: reply_to ?? null }),
  edit: (id: number, body: string) => api.patch<{ id: number }>(`/api/comments/${id}`, { body }),
  remove: (id: number) => api.del<{ deleted: number }>(`/api/comments/${id}`),
  react: (id: number, emoji: string) => api.post<{ id: number; reactions: Reaction[] }>(`/api/comments/${id}/reactions`, { emoji }),
};

export const postsApi = {
  list: (opts?: { sort?: string; category?: string; before?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (opts?.sort) q.set("sort", opts.sort);
    if (opts?.category) q.set("category", opts.category);
    if (opts?.before) q.set("before", String(opts.before));
    if (opts?.offset) q.set("offset", String(opts.offset));
    const s = q.toString();
    return api.get<{ posts: Post[]; categories: PostCategory[] }>(`/api/posts${s ? `?${s}` : ""}`);
  },
  create: (category: string, title: string, body: string, images?: string[]) => api.post<Post>("/api/posts", { category, title, body, images: images ?? [] }),
  edit: (id: number, title: string, body: string) => api.patch<{ id: number }>(`/api/posts/${id}`, { title, body }),
  remove: (id: number) => api.del<{ deleted: number }>(`/api/posts/${id}`),
  upvote: (id: number) => api.post<{ id: number; count: number; me: boolean }>(`/api/posts/${id}/upvote`),
  react: (id: number, emoji: string) => api.post<{ id: number; reactions: Reaction[] }>(`/api/posts/${id}/reactions`, { emoji }),
};

// Marketplace listing (author snapshot baked in).
export interface Listing {
  id: number;
  user_id: string;
  kind: "official" | "community";
  category: string;
  title: string;
  description: string;
  images: string[];
  price_amount: number;
  currency: string;
  status: string;
  stock: number;
  warranty: string;
  created_at: string;
  updated_at: string;
  username: string;
  display_name: string;
  avatar_url: string;
  top_role_id: string;
  wears_tag: boolean;
  guild_tag: string;
  // Seller social signals (marketplace trust).
  seller_online?: boolean;
  seller_last_seen?: string;
  seller_rating_avg?: number;
  seller_rating_count?: number;
}
export interface ListingCategory { key: string; label: string }
export interface SellerReview {
  id: number;
  reviewer_id: string;
  reviewer: string;
  reviewer_avatar: string;
  rating: number;
  body: string;
  created_at: string;
}
export const reviewApi = {
  submit: (threadId: number, rating: number, body: string) =>
    api.post<{ ok: boolean }>(`/api/marketplace/rekber/threads/${threadId}/review`, { rating, body }),
  seller: (sellerId: string, offset = 0) =>
    api.get<{ reviews: SellerReview[]; rating_avg: number; rating_count: number }>(`/api/marketplace/sellers/${sellerId}/reviews?offset=${offset}`),
};
export interface ListingInput {
  kind: "official" | "community";
  category: string;
  title: string;
  description: string;
  images: string[];
  price_amount: number;
  currency?: string;
  status?: string;
  stock: number;
  warranty?: string;
  delivery_payload?: string;
}

// Seller payout account (bank | ewallet | qris).
export interface PayoutAccount {
  kind: "bank" | "ewallet" | "qris";
  provider: string;
  number: string;
  holder: string;
  qris_url: string;
}

export const payoutApi = {
  get: () => api.get<{ set: boolean; account?: PayoutAccount }>("/api/marketplace/payout"),
  set: (a: Partial<PayoutAccount>) => api.put<{ ok: boolean }>("/api/marketplace/payout", a),
};

export const marketplaceApi = {
  list: (opts?: { kind?: string; category?: string; q?: string; before?: number }) => {
    const p = new URLSearchParams();
    if (opts?.kind) p.set("kind", opts.kind);
    if (opts?.category) p.set("category", opts.category);
    if (opts?.q) p.set("q", opts.q);
    if (opts?.before) p.set("before", String(opts.before));
    const s = p.toString();
    return api.get<{ listings: Listing[]; categories: ListingCategory[] }>(`/api/marketplace/listings${s ? `?${s}` : ""}`);
  },
  get: (id: number) => api.get<Listing>(`/api/marketplace/listings/${id}`),
  create: (in_: ListingInput) => api.post<Listing>("/api/marketplace/listings", in_),
  update: (id: number, in_: Partial<ListingInput>) => api.patch<Listing>(`/api/marketplace/listings/${id}`, in_),
  remove: (id: number) => api.del<{ ok: boolean }>(`/api/marketplace/listings/${id}`),
};

// Rekber (escrow) deal thread.
export interface RekberParty { username: string; display_name: string; avatar_url: string }
export interface RekberThread {
  id: number;
  listing_id?: number;
  buyer_id: string;
  seller_id: string;
  middleman_id?: string;
  title: string;
  amount: number;
  fee: number;
  currency: string;
  note: string;
  status: string; // open|buyer_paid|delivered|released|cancelled|disputed
  created_at: string;
  updated_at: string;
  buyer: RekberParty;
  seller: RekberParty;
  middleman?: RekberParty;
  seller_payout?: PayoutAccount;
}
export interface RekberMessage {
  id: number;
  thread_id: number;
  user_id: string;
  content: string;
  images: string[];
  kind: "chat" | "system";
  created_at: string;
  username: string;
  display_name: string;
  avatar_url: string;
}

export interface RekberOrder {
  id: number;
  title: string;
  amount: number;
  currency: string;
  status: string;
  content: string;
  images: string[];
  counterpart: string;
  role: "buyer" | "seller";
  created_at: string;
}

export const rekberApi = {
  fee: (amount: number) => api.get<{ amount: number; fee: number }>(`/api/marketplace/rekber/fee?amount=${amount}`),
  threads: () => api.get<{ threads: RekberThread[] }>("/api/marketplace/rekber/threads"),
  create: (listing_id: number, note = "") => api.post<RekberThread>("/api/marketplace/rekber/threads", { listing_id, note }),
  get: (id: number, after = 0) => api.get<{ thread: RekberThread; messages: RekberMessage[]; role: string; next_action: string }>(`/api/marketplace/rekber/threads/${id}?after=${after}`),
  send: (id: number, content: string, images: string[] = []) => api.post<RekberMessage>(`/api/marketplace/rekber/threads/${id}/messages`, { content, images }),
  action: (id: number, action: string, body: Record<string, unknown> = {}) => api.post<RekberThread>(`/api/marketplace/rekber/threads/${id}/${action}`, body),
  delivery: (id: number) => api.get<{ thread_id: number; content: string; images: string[] }>(`/api/marketplace/rekber/threads/${id}/delivery`),
  orders: () => api.get<{ orders: RekberOrder[] }>("/api/marketplace/rekber/orders"),
  cancel: (id: number) => api.post<RekberThread>(`/api/marketplace/rekber/threads/${id}/cancel`),
  account: {
    get: () => api.get<{ account: string; images: string[] }>("/api/marketplace/admin/rekber/account"),
    set: (account: string, images: string[] = []) => api.put<{ ok: boolean }>("/api/marketplace/admin/rekber/account", { account, images }),
  },
};

// Official-store order.
export interface Order {
  id: number;
  order_ref: string;
  listing_id?: number;
  title: string;
  amount: number;
  currency: string;
  status: string; // pending | paid | delivered | expired | failed
  pay_url?: string;
  delivered_payload?: string;
  created_at: string;
}

export const orderApi = {
  create: (service_code: string, data_no: string, data_zone = "") => api.post<{ order_id: number; order_ref: string; pay_url: string; amount: number; reused?: boolean }>("/api/marketplace/orders", { service_code, data_no, data_zone }),
  list: () => api.get<{ orders: Order[] }>("/api/marketplace/orders"),
  get: (id: number) => api.get<Order>(`/api/marketplace/orders/${id}`),
};

// Official Store (curated VIPayment products).
export interface OfficialProduct {
  id: number;
  kind: "prepaid" | "game";
  service_code: string;
  name: string;
  category: string;
  brand: string;
  needs_zone: boolean;
  sell_price: number;
}
export interface VIPService {
  code: string;
  name: string;
  price: number;
  status: string;
  brand: string;
  type: string;
  note?: string;
}
export interface VIPProduct extends OfficialProduct {
  cost_price: number;
  markup_percent: number;
  markup_flat: number;
  enabled: boolean;
  sort_order: number;
}

export const officialApi = {
  list: () => api.get<{ products: OfficialProduct[] }>("/api/marketplace/official"),
};

export const adminVipApi = {
  balance: () => api.get<{ balance: number }>("/api/marketplace/admin/vip/balance"),
  catalog: (kind: "prepaid" | "game", filterType = "", filterValue = "") => {
    const p = new URLSearchParams({ kind });
    if (filterType) p.set("filter_type", filterType);
    if (filterValue) p.set("filter_value", filterValue);
    return api.get<{ kind: string; services: VIPService[] }>(`/api/marketplace/admin/vip/catalog?${p}`);
  },
  products: () => api.get<{ products: VIPProduct[] }>("/api/marketplace/admin/vip/products"),
  upsert: (p: Partial<VIPProduct> & { service_code: string; name: string; kind: string }) => api.post<{ id: number }>("/api/marketplace/admin/vip/products", p),
  toggle: (id: number, enabled: boolean) => api.patch<{ ok: boolean }>(`/api/marketplace/admin/vip/products/${id}`, { enabled }),
  remove: (id: number) => api.del<{ ok: boolean }>(`/api/marketplace/admin/vip/products/${id}`),
};

// ChatMessage carries the message + a snapshot of the author's identity.
export interface ChatMessage {
  id: number;
  user_id: string;
  content: string;
  created_at: string;
  edited_at?: string | null;
  reply_to?: number | null;
  reply_content?: string;
  images?: string[];
  reply_author?: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  top_role?: TopRole | null;
  wears_tag?: boolean;
  guild_tag?: string;
  reactions?: Reaction[];
  channel?: string;
  music?: MusicShare;
}

// MusicShare is the payload of a shared track/playlist card in the music channel.
export interface MusicShare {
  kind: "track" | "playlist";
  title: string;
  subtitle?: string;
  cover?: string;
  ref?: string;
}

export interface Reaction {
  emoji: string;
  count: number;
  me: boolean;
}

export interface ChatChannel {
  key: string;
  label: string;
  read_only?: boolean;
}

export const chatApi = {
  list: (channel?: string, before?: number) => {
    const q = new URLSearchParams();
    if (channel) q.set("channel", channel);
    if (before) q.set("before", String(before));
    const s = q.toString();
    return api.get<{ messages: ChatMessage[]; channel: string; channels: ChatChannel[] }>(
      `/api/chat/messages${s ? `?${s}` : ""}`,
    );
  },
  send: (content: string, channel: string, reply_to?: number, images?: string[]) =>
    api.post<ChatMessage>("/api/chat/messages", { content, channel, reply_to: reply_to ?? null, images: images ?? [] }),
  edit: (id: number, content: string) => api.patch<{ id: number; content: string }>(`/api/chat/messages/${id}`, { content }),
  remove: (id: number) => api.del<{ deleted: number }>(`/api/chat/messages/${id}`),
  react: (id: number, emoji: string) => api.post<{ message_id: number; reactions: Reaction[] }>(`/api/chat/messages/${id}/reactions`, { emoji }),
  shareMusic: (music: MusicShare, message?: string) => api.post<ChatMessage>("/api/chat/share-music", { music, message: message ?? "" }),
};

export const modApi = {
  setModerator: (userId: string, on: boolean) => api.post<{ is_moderator: boolean }>(`/api/admin/users/${userId}/moderator`, { on }),
  setPremium: (userId: string, on: boolean) => api.post<{ is_premium: boolean }>(`/api/admin/users/${userId}/premium`, { on }),
  setDonor: (userId: string, on: boolean) => api.post<{ is_donor: boolean }>(`/api/admin/users/${userId}/donor`, { on }),
};

export interface Notification {
  id: number;
  type: "reply" | "upvote" | "reaction" | "mention" | "deal" | "middleman" | "shipped" | "purchase" | "released";
  actor_id: string;
  actor_name: string;
  ref_type: string;
  ref_id: number;
  preview: string;
  read: boolean;
  created_at: string;
}

export const notifApi = {
  list: () => api.get<{ notifications: Notification[]; unread: number }>("/api/notifications"),
  markRead: () => api.post<{ ok: boolean }>("/api/notifications/read"),
};

export interface SearchPostHit {
  id: number;
  category: string;
  title: string;
  body: string;
  username: string;
  upvotes: number;
  created_at: string;
}
export interface SearchUserHit {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  top_role_id: string;
  is_moderator?: boolean;
}

export const searchApi = {
  query: (q: string) => api.get<{ posts: SearchPostHit[]; users: SearchUserHit[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  // Mention autocomplete: empty q returns a default user list.
  mention: (q: string) => api.get<{ users: SearchUserHit[] }>(`/api/users/mention?q=${encodeURIComponent(q)}`),
};

// PublicProfile is what other members can see (social data only — no secrets).
export interface PublicProfile {
  id: string;
  username: string;
  avatar_url: string;
  plan: string;
  top_role_id: string;
  top_role?: TopRole | null;
  wears_tag: boolean;
  guild_tag: string;
  kleos: number;
  display_name: string;
  bio: string;
  accent_color: string;
  primary_color: string;
  pronouns: string;
  is_moderator?: boolean;
  is_premium?: boolean;
  is_donor?: boolean;
  online?: boolean;
  last_seen?: string;
  rating_avg?: number;
  rating_count?: number;
  equipped?: Equipped;
  banner_url?: string;
  links: ProfileLink[];
  created_at: string;
}

export interface SyncStatus {
  configured: boolean;
  enabled: boolean;
  auto: boolean;
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
  setAuto: (on: boolean) => api.post<{ auto: boolean }>("/api/sync/auto", { on }),
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

export interface SunoTrack { id: string; audio_url: string; stream_url: string; image_url: string; title: string; duration: number }
export interface SunoStatus { status: string; done: boolean; failed: boolean; tracks: SunoTrack[] }

export const sunoApi = {
  keyStatus: () => api.get<{ configured: boolean }>("/api/music/suno/key"),
  generate: (body: { prompt: string; style?: string; title?: string; model?: string; instrumental?: boolean; custom_mode?: boolean }) =>
    api.post<{ task_id: string }>("/api/music/generate", body),
  status: (taskId: string) => api.get<SunoStatus>(`/api/music/generate/status?task_id=${encodeURIComponent(taskId)}`),
};

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
