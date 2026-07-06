// Package store persists local state behind an interface. Default impl is sqlite
// (pure-Go modernc, CGO-free). core never imports this directly.
package store

import (
	"context"
	"time"
)

// Account is one upstream credential (a provider's key/token set).
type Account struct {
	ID        int64
	Provider  string
	Label     string
	Secret    string            // single-token case (opaque here)
	Creds     map[string]string // multi-field credentials (opaque here)
	Status    string            // active | exhausted | banned (from upstream)
	Disabled  bool              // turned off by the user (independent of status)
	CreatedAt time.Time
}

// RequestLog is one served request record.
type RequestLog struct {
	ID           int64
	Provider     string
	Model        string
	Status       string // success | error
	Source       string // api | warmup
	InTokens     int64
	OutTokens    int64
	LatencyMS    int64
	ProxyUsed    string // proxy label if routed through the pool ("" = direct)
	AccountLabel string // the account that served the request
	CreatedAt    time.Time
}

// APIKey is a gateway key that protects /v1 and /anthropic when any exist.
type APIKey struct {
	ID            int64
	Label         string
	Secret        string
	TokenLimit    int64      // total tokens allowed; 0 = unlimited
	TokensUsed    int64      // running total of tokens spent
	MaxConcurrent int64      // simultaneous in-flight requests; 0 = unlimited
	ExpiresAt     *time.Time // nil = never expires
	Enabled       bool
	CreatedAt     time.Time
	LastUsed      *time.Time
}

// WarmupLog records one account warmup attempt (a real probe request).
type WarmupLog struct {
	ID         int64
	AccountID  int64
	Provider   string
	Label      string
	OK         bool
	Outcome    string
	Status     string
	Request    string
	Response   string
	Usage      string
	DurationMS int64
	CreatedAt  time.Time
}

type Store interface {
	Accounts() AccountStore
	Logs() LogStore
	Keys() KeyStore
	Warmups() WarmupStore
	Music() MusicStore
	Settings() SettingsStore
	Aliases() AliasStore
	ApiTest() ApiTestStore
	Proxies() ProxyStore
	Close() error
}

// --- API Test (Postman-style dev tool) ---

// ApiCollection groups saved requests.
type ApiCollection struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Sort int    `json:"sort"`
}

// ApiRequest is one saved request. Headers/Query/Auth are opaque JSON blobs the
// frontend owns; the store just persists them.
type ApiRequest struct {
	ID           int64  `json:"id"`
	CollectionID int64  `json:"collection_id"`
	Name         string `json:"name"`
	Method       string `json:"method"`
	BaseURL      string `json:"base_url"`
	URL          string `json:"url"`
	Headers      string `json:"headers"` // JSON: [{key,value,on}]
	Query        string `json:"query"`   // JSON: [{key,value,on}]
	Body         string `json:"body"`
	BodyType     string `json:"body_type"`
	Auth         string `json:"auth"` // JSON: {type,...}
	Sort         int    `json:"sort"`
}

// ApiEnvironment is a named set of {{var}} substitutions.
type ApiEnvironment struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	Vars   string `json:"vars"` // JSON: [{key,value}]
	Active bool   `json:"active"`
}

// ApiHistory is one executed request (most-recent first).
type ApiHistory struct {
	ID         int64  `json:"id"`
	Method     string `json:"method"`
	URL        string `json:"url"`
	Status     int    `json:"status"`
	DurationMS int64  `json:"duration_ms"`
	At         string `json:"at"`
}

// ApiTestStore persists the dev tool's collections, requests, environments and
// run history (all local, not synced).
type ApiTestStore interface {
	Collections(ctx context.Context) ([]ApiCollection, error)
	AddCollection(ctx context.Context, name string) (int64, error)
	RenameCollection(ctx context.Context, id int64, name string) error
	DeleteCollection(ctx context.Context, id int64) error

	Requests(ctx context.Context) ([]ApiRequest, error)
	SaveRequest(ctx context.Context, req ApiRequest) (int64, error) // insert if ID==0, else update
	DeleteRequest(ctx context.Context, id int64) error

	Environments(ctx context.Context) ([]ApiEnvironment, error)
	SaveEnvironment(ctx context.Context, env ApiEnvironment) (int64, error)
	DeleteEnvironment(ctx context.Context, id int64) error
	SetActiveEnvironment(ctx context.Context, id int64) error

	History(ctx context.Context, limit int) ([]ApiHistory, error)
	AddHistory(ctx context.Context, h ApiHistory) error
	ClearHistory(ctx context.Context) error
}

// ModelAlias is a per-user local alias: call `Alias` and it routes to `Target`.
type ModelAlias struct {
	Alias  string `json:"alias"`
	Target string `json:"target"`
}

// AliasStore holds the user's local model aliases (not synced to the cloud).
type AliasStore interface {
	List(ctx context.Context) ([]ModelAlias, error)
	Set(ctx context.Context, alias, target string) error // upsert
	Delete(ctx context.Context, alias string) error
	Map(ctx context.Context) map[string]string // alias→target, for the resolver
}

// ComboStrategy selects how a combo picks among its ordered targets.
type ComboStrategy int16

const (
	ComboFailover   ComboStrategy = 0
	ComboRoundRobin ComboStrategy = 1
)

// ModelCombo is a per-user local virtual model that resolves to an ordered list
// of real provider-prefixed targets (e.g. "kr/claude-sonnet-4-5"), tried in
// order (failover) or starting from a rotating position (round_robin).
type ModelCombo struct {
	ID       int64         `json:"id"`
	Name     string        `json:"name"`
	Targets  []string      `json:"targets"`
	Strategy ComboStrategy `json:"strategy"`
}

// ComboStore holds the user's local model combos.
type ComboStore interface {
	List(ctx context.Context) ([]ModelCombo, error)
	Add(ctx context.Context, c ModelCombo) (int64, error)
	Update(ctx context.Context, c ModelCombo) error // by ID: rename / reorder targets / change strategy
	Delete(ctx context.Context, id int64) error
	Map(ctx context.Context) map[string]ModelCombo // name -> combo, for the resolver cache
	// NextIndex reads the combo's persisted round-robin cursor and advances it,
	// returning the PRE-advance value to use as this request's start index. No
	// cursor is held in memory — every call is a fresh read+write on the row.
	NextIndex(ctx context.Context, id int64, mod int) (int, error)
	// SetByName upserts and DeleteByName removes a combo keyed by name (not id)
	// — used by the sync layer, where name is the only identity stable across
	// devices (ids are local auto-increments).
	SetByName(ctx context.Context, name string, targets []string, strategy ComboStrategy) error
	DeleteByName(ctx context.Context, name string) error
}

// CustomModel is one model exposed by a custom provider.
type CustomModel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// CustomProvider is a user-defined OpenAI/Anthropic-compatible provider.
type CustomProvider struct {
	ID           int64         `json:"id"`
	Name         string        `json:"name"`
	Prefix       string        `json:"prefix"`
	Format       string        `json:"format"` // openai | anthropic
	BaseURL      string        `json:"base_url"`
	DefaultModel string        `json:"default_model"`
	Models       []CustomModel `json:"models"`
}

// ContentFilter is one pattern→replacement rule.
type ContentFilter struct {
	ID          int64  `json:"id"`
	Pattern     string `json:"pattern"`
	Replacement string `json:"replacement"`
	IsRegex     bool   `json:"is_regex"`
	IsActive    bool   `json:"is_active"`
}

// FilterTemplate is a named saved set of content-filter rules.
type FilterTemplate struct {
	Name  string          `json:"name"`
	Rules []ContentFilter `json:"rules"`
}

// FilterStore persists content-filter rules + named templates (local only).
type FilterStore interface {
	List(ctx context.Context) ([]ContentFilter, error)
	Add(ctx context.Context, f ContentFilter) (int64, error)
	Update(ctx context.Context, f ContentFilter) error
	Delete(ctx context.Context, id int64) error
	// Templates: save the active set under a name, load one back, list, remove.
	ListTemplates(ctx context.Context) ([]FilterTemplate, error)
	SaveTemplate(ctx context.Context, name string, rules []ContentFilter) error
	LoadTemplate(ctx context.Context, name string) ([]ContentFilter, error)
	DeleteTemplate(ctx context.Context, name string) error
	// ReplaceAll swaps the active filter set (used when loading a template).
	ReplaceAll(ctx context.Context, rules []ContentFilter) error
	// MergeAll appends rules whose pattern isn't already present (template merge).
	MergeAll(ctx context.Context, rules []ContentFilter) error
}

// CustomProviderStore persists user-defined providers (local only).
type CustomProviderStore interface {
	List(ctx context.Context) ([]CustomProvider, error)
	Get(ctx context.Context, id int64) (*CustomProvider, error)
	Create(ctx context.Context, p CustomProvider) (int64, error)
	Update(ctx context.Context, p CustomProvider) error
	Delete(ctx context.Context, id int64) error
}

// SettingsStore is a tiny key/value store for gateway settings (e.g. the
// dashboard password hash). Values are opaque strings.
type SettingsStore interface {
	Get(ctx context.Context, key string) (string, error) // "" if unset
	Set(ctx context.Context, key, value string) error
}

// MusicTrack is one song stored in a playlist or returned from a playlist read.
type MusicTrack struct {
	VideoID   string `json:"id"`
	Title     string `json:"title"`
	Artist    string `json:"artist"`
	Album     string `json:"album"`
	Duration  string `json:"duration"`
	Thumbnail string `json:"thumbnail"`
}

// Playlist is a locally-stored playlist (not tied to any external account).
type Playlist struct {
	ID          int64        `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	ShareCode   string       `json:"share_code"`
	Count       int          `json:"count"`
	Tracks      []MusicTrack `json:"tracks,omitempty"`
	CreatedAt   time.Time    `json:"created_at"`
}

// PlayEvent is one recorded track play, used to compute the local "for you" feed.
type PlayEvent struct {
	VideoID string
	Title   string
	Artist  string
	Album   string
}

// ArtistCount is an artist with how many times the user has played their tracks.
type ArtistCount struct {
	Artist string
	Plays  int
}

// SyncedPlaylist is a playlist expressed as a sync item: identified by its
// stable share code, carrying the LWW metadata + full track list (or a
// tombstone when Deleted).
type SyncedPlaylist struct {
	ShareCode   string       `json:"share_code"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Tracks      []MusicTrack `json:"tracks"`
	UpdatedAt   int64        `json:"updated_at"` // unix millis
	Version     int64        `json:"version"`
	Deleted     bool         `json:"deleted"`
}

// MusicStore persists playlists and play history locally (no external account).
type MusicStore interface {
	// Playlists
	ListPlaylists(ctx context.Context) ([]Playlist, error)
	GetPlaylist(ctx context.Context, id int64) (*Playlist, error)            // nil if not found; includes tracks
	PlaylistByShareCode(ctx context.Context, code string) (*Playlist, error) // nil if not found; includes tracks
	CreatePlaylist(ctx context.Context, name, description, shareCode string) (int64, error)
	DeletePlaylist(ctx context.Context, id int64) error
	AddTrack(ctx context.Context, playlistID int64, t MusicTrack) error
	RemoveTrack(ctx context.Context, playlistID int64, videoID string) error

	// Sync (two-way, LWW by UpdatedAt). PlaylistsForSync returns every playlist
	// as a sync item including tombstones. ApplySyncedPlaylist upserts a remote
	// item (the syncer has already decided it wins).
	PlaylistsForSync(ctx context.Context) ([]SyncedPlaylist, error)
	ApplySyncedPlaylist(ctx context.Context, p SyncedPlaylist) error

	// History (feeds the local "for you" recommendations)
	RecordPlay(ctx context.Context, e PlayEvent) error
	RecentPlays(ctx context.Context, limit int) ([]MusicTrack, error)
	TopArtists(ctx context.Context, limit int) ([]ArtistCount, error)
	ClearHistory(ctx context.Context) error
}

type WarmupStore interface {
	Insert(ctx context.Context, l WarmupLog) error
	Recent(ctx context.Context, limit int) ([]WarmupLog, error)
	Clear(ctx context.Context) error
}

type KeyStore interface {
	List(ctx context.Context) ([]APIKey, error)
	Add(ctx context.Context, k APIKey) (int64, error)
	Delete(ctx context.Context, id int64) error
	BySecret(ctx context.Context, secret string) (*APIKey, error) // nil if not found
	AddUsage(ctx context.Context, id, tokens int64) error
	Count(ctx context.Context) (int, error)
}

type AccountStore interface {
	List(ctx context.Context, provider string) ([]Account, error)
	Add(ctx context.Context, a Account) (int64, error)
	SetStatus(ctx context.Context, id int64, status string) error
	SetDisabled(ctx context.Context, id int64, disabled bool) error
	SetLabel(ctx context.Context, id int64, label string) error
	UpdateCreds(ctx context.Context, id int64, creds map[string]string) error
	Delete(ctx context.Context, id int64) error
}

// Proxy is one outbound proxy in the pool.
type Proxy struct {
	ID          int64  `json:"id"`
	Label       string `json:"label"`
	Scheme      string `json:"scheme"` // http | https | socks5 | socks5h
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	Enabled     bool   `json:"enabled"`
	Status      string `json:"status"` // unknown | ok | dead
	LatencyMS   int    `json:"latency_ms"`
	LastChecked string `json:"last_checked,omitempty"`
	CreatedAt   string `json:"created_at"`
}

type ProxyStore interface {
	List(ctx context.Context) ([]Proxy, error)
	Add(ctx context.Context, p Proxy) (int64, error)
	Delete(ctx context.Context, id int64) error
	SetEnabled(ctx context.Context, id int64, enabled bool) error
	SetStatus(ctx context.Context, id int64, status string, latencyMS int) error
}

// LogSummary aggregates request_logs for the current day (server-local).
type LogSummary struct {
	Total     int64 `json:"total"`
	OK        int64 `json:"ok"`
	Errors    int64 `json:"errors"`
	InTokens  int64 `json:"in_tokens"`
	OutTokens int64 `json:"out_tokens"`
	AvgMS     int64 `json:"avg_ms"`
}

// SeriesPoint is one time bucket (hour or day) of request/token counts.
type SeriesPoint struct {
	Bucket    string `json:"bucket"`
	Requests  int64  `json:"requests"`
	InTokens  int64  `json:"in_tokens"`
	OutTokens int64  `json:"out_tokens"`
}

// SeriesRange selects the window + bucket granularity for Series.
type SeriesRange string

const (
	RangeDaily SeriesRange = "daily" // last 24h, hourly buckets
	Range7d    SeriesRange = "7d"    // last 7 days, daily buckets
	Range30d   SeriesRange = "30d"   // last 30 days, daily buckets
	RangeAll   SeriesRange = "all"   // everything, daily buckets
)

// ModelStat is per-model usage for the current day.
type ModelStat struct {
	Model     string `json:"model"`
	Requests  int64  `json:"requests"`
	InTokens  int64  `json:"in_tokens"`
	OutTokens int64  `json:"out_tokens"`
}

type LogStore interface {
	Insert(ctx context.Context, l RequestLog) error
	Recent(ctx context.Context, limit int) ([]RequestLog, error)
	SummaryToday(ctx context.Context) (LogSummary, error)
	SummaryAll(ctx context.Context) (LogSummary, error)
	TotalOutTokens(ctx context.Context) (int64, error)
	Series(ctx context.Context, r SeriesRange) ([]SeriesPoint, error)
	TopModels(ctx context.Context, limit int) ([]ModelStat, error)
	Totals(ctx context.Context) (requests, inTokens, outTokens int64, err error)
	Clear(ctx context.Context) error
}
