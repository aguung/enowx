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
  wears_tag?: boolean;
  guild_tag?: string;
  kleos?: number;
  is_moderator?: boolean;
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
};

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
  list: (channel?: string) =>
    api.get<{ messages: ChatMessage[]; channel: string; channels: ChatChannel[] }>(
      `/api/chat/messages${channel ? `?channel=${encodeURIComponent(channel)}` : ""}`,
    ),
  send: (content: string, channel: string, reply_to?: number, images?: string[]) =>
    api.post<ChatMessage>("/api/chat/messages", { content, channel, reply_to: reply_to ?? null, images: images ?? [] }),
  edit: (id: number, content: string) => api.patch<{ id: number; content: string }>(`/api/chat/messages/${id}`, { content }),
  remove: (id: number) => api.del<{ deleted: number }>(`/api/chat/messages/${id}`),
  react: (id: number, emoji: string) => api.post<{ message_id: number; reactions: Reaction[] }>(`/api/chat/messages/${id}/reactions`, { emoji }),
  shareMusic: (music: MusicShare, message?: string) => api.post<ChatMessage>("/api/chat/share-music", { music, message: message ?? "" }),
};

export const modApi = {
  setModerator: (userId: string, on: boolean) => api.post<{ is_moderator: boolean }>(`/api/admin/users/${userId}/moderator`, { on }),
};

export interface Notification {
  id: number;
  type: "reply" | "upvote" | "reaction" | "mention";
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
