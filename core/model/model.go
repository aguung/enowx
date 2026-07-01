// Package model holds the normalized, provider-agnostic types every layer
// speaks. No net/http, SQL, or provider imports.
package model

import "encoding/json"

type API string

const (
	APIOpenAIChat API = "openai.chat"
	APIOpenAIResp API = "openai.responses"
	APIAnthropic  API = "anthropic"
	APIImages     API = "openai.images"
)

type Role string

const (
	RoleSystem    Role = "system"
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
	RoleTool      Role = "tool"
)

type Part struct {
	Type       string          `json:"type"`
	Text       string          `json:"text,omitempty"`
	ImageURL   string          `json:"image_url,omitempty"`
	ToolCallID string          `json:"tool_call_id,omitempty"`
	ToolName   string          `json:"tool_name,omitempty"`
	Raw        json.RawMessage `json:"raw,omitempty"`
}

type Message struct {
	Role  Role   `json:"role"`
	Parts []Part `json:"parts"`
}

type Tool struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Parameters  json.RawMessage `json:"parameters,omitempty"`
}

// Request is the normalized inbound request. Source records the wire format so
// the proxy can encode the reply the same way. Raw keeps the original body.
type Request struct {
	Source      API             `json:"source"`
	Model       string          `json:"model"`
	Messages    []Message       `json:"messages,omitempty"`
	Tools       []Tool          `json:"tools,omitempty"`
	Stream      bool            `json:"stream"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
	Temperature *float64        `json:"temperature,omitempty"`
	Raw         json.RawMessage `json:"-"`
}

type Usage struct {
	PromptTokens     int64   `json:"prompt_tokens"`
	CompletionTokens int64   `json:"completion_tokens"`
	Credit           float64 `json:"credit,omitempty"`
}

type EventType string

const (
	EventDelta EventType = "delta"
	EventDone  EventType = "done"
	EventError EventType = "error"
)

type Event struct {
	Type         EventType       `json:"type"`
	Text         string          `json:"text,omitempty"`
	Reasoning    string          `json:"reasoning,omitempty"` // model "thinking" delta (client may show/hide)
	Model        string          `json:"model,omitempty"`
	Usage        *Usage          `json:"usage,omitempty"`
	Err          string          `json:"error,omitempty"`
	ToolCalls    []ToolCallDelta `json:"tool_calls,omitempty"`    // streamed function-call fragments
	FinishReason string          `json:"finish_reason,omitempty"` // e.g. "stop", "tool_calls"
}

// ToolCallDelta is one streamed fragment of an OpenAI tool (function) call. The
// name/id arrive once; arguments stream in as ArgsDelta fragments keyed by Index.
type ToolCallDelta struct {
	Index     int    `json:"index"`
	ID        string `json:"id,omitempty"`
	Name      string `json:"name,omitempty"`
	ArgsDelta string `json:"args_delta,omitempty"`
}

// Stream yields normalized events; Recv returns one EventDone then io.EOF.
type Stream interface {
	Recv() (Event, error)
	Close() error
}
