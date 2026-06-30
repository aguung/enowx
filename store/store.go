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
	ID        int64
	Provider  string
	Model     string
	Status    string // success | error
	Source    string // api | warmup
	InTokens  int64
	OutTokens int64
	LatencyMS int64
	CreatedAt time.Time
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
	Close() error
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
	UpdateCreds(ctx context.Context, id int64, creds map[string]string) error
	Delete(ctx context.Context, id int64) error
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
	TotalOutTokens(ctx context.Context) (int64, error)
	Series(ctx context.Context, r SeriesRange) ([]SeriesPoint, error)
	TopModels(ctx context.Context, limit int) ([]ModelStat, error)
	Clear(ctx context.Context) error
}
