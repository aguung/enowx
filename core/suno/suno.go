// Package suno is a small client for the Suno AI music-generation API
// (docs.sunoapi.org). Generation is async: create a task, then poll for the
// result (we poll rather than host a callback, since enowx runs locally).
package suno

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/enowdev/enowx/core/transport"
)

const baseURL = "https://api.sunoapi.org"

// placeholderCallback satisfies the API's required callBackUrl field; we poll
// instead of receiving callbacks.
const placeholderCallback = "https://enowx.local/callback"

// GenerateRequest is a normalized music-generation request.
type GenerateRequest struct {
	Prompt       string
	Style        string
	Title        string
	Model        string
	Instrumental bool
	CustomMode   bool
	NegativeTags string
	VocalGender  string // "m" | "f" | ""
}

// Track is one generated song.
type Track struct {
	ID        string  `json:"id"`
	AudioURL  string  `json:"audio_url"`
	StreamURL string  `json:"stream_url"`
	ImageURL  string  `json:"image_url"`
	Title     string  `json:"title"`
	Duration  float64 `json:"duration"`
}

// TaskResult is the polled state of a generation task.
type TaskResult struct {
	Status string  `json:"status"`
	Done   bool    `json:"done"`
	Failed bool    `json:"failed"`
	Tracks []Track `json:"tracks"`
}

// Client talks to the Suno API with a given doer.
type Client struct{ doer transport.Doer }

func New(doer transport.Doer) *Client { return &Client{doer: doer} }

// Generate creates a music-generation task and returns its id.
func (c *Client) Generate(key string, req GenerateRequest) (string, error) {
	model := strings.TrimSpace(req.Model)
	if model == "" {
		model = "V4_5"
	}
	body := map[string]any{
		"customMode":   req.CustomMode,
		"instrumental": req.Instrumental,
		"model":        model,
		"callBackUrl":  placeholderCallback,
	}
	if req.Prompt != "" {
		body["prompt"] = req.Prompt
	}
	if req.Style != "" {
		body["style"] = req.Style
	}
	if req.Title != "" {
		body["title"] = req.Title
	}
	if req.NegativeTags != "" {
		body["negativeTags"] = req.NegativeTags
	}
	if req.VocalGender == "m" || req.VocalGender == "f" {
		body["vocalGender"] = req.VocalGender
	}

	raw, err := c.post(key, "/api/v1/generate", body)
	if err != nil {
		return "", err
	}
	var out struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			TaskID string `json:"taskId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("suno generate decode: %w", err)
	}
	if out.Code != 200 {
		return "", fmt.Errorf("suno generate: %s", nonEmpty(out.Msg, fmt.Sprintf("code %d", out.Code)))
	}
	if out.Data.TaskID == "" {
		return "", fmt.Errorf("suno generate: empty taskId")
	}
	return out.Data.TaskID, nil
}

// Poll fetches the current state of a generation task.
func (c *Client) Poll(key, taskID string) (*TaskResult, error) {
	u := baseURL + "/api/v1/generate/record-info?" + url.Values{"taskId": {taskID}}.Encode()
	r, _ := http.NewRequest(http.MethodGet, u, nil)
	r.Header.Set("Authorization", "Bearer "+key)
	resp, err := c.doer.Do(r)
	if err != nil {
		return nil, fmt.Errorf("suno poll: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("suno poll %d: %s", resp.StatusCode, truncate(raw))
	}
	var out struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			Status   string `json:"status"`
			Response struct {
				SunoData []struct {
					ID             string  `json:"id"`
					AudioURL       string  `json:"audioUrl"`
					StreamAudioURL string  `json:"streamAudioUrl"`
					ImageURL       string  `json:"imageUrl"`
					Title          string  `json:"title"`
					Duration       float64 `json:"duration"`
				} `json:"sunoData"`
			} `json:"response"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("suno poll decode: %w", err)
	}
	status := out.Data.Status
	res := &TaskResult{Status: status}
	switch status {
	case "SUCCESS":
		res.Done = true
	case "CREATE_TASK_FAILED", "GENERATE_AUDIO_FAILED", "CALLBACK_EXCEPTION", "SENSITIVE_WORD_ERROR":
		res.Failed = true
	}
	for _, d := range out.Data.Response.SunoData {
		res.Tracks = append(res.Tracks, Track{
			ID: d.ID, AudioURL: d.AudioURL, StreamURL: d.StreamAudioURL,
			ImageURL: d.ImageURL, Title: d.Title, Duration: d.Duration,
		})
	}
	return res, nil
}

func (c *Client) post(key, path string, body any) ([]byte, error) {
	b, _ := json.Marshal(body)
	r, err := http.NewRequest(http.MethodPost, baseURL+path, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	r.Header.Set("Authorization", "Bearer "+key)
	r.Header.Set("Content-Type", "application/json")
	resp, err := c.doer.Do(r)
	if err != nil {
		return nil, fmt.Errorf("suno request: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("suno %s %d: %s", path, resp.StatusCode, truncate(raw))
	}
	return raw, nil
}

func nonEmpty(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return b
}

func truncate(b []byte) string {
	s := strings.TrimSpace(string(b))
	if len(s) > 200 {
		return s[:200]
	}
	return s
}
