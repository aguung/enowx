// Package oaistream parses OpenAI-format chat responses (SSE + plain JSON) into
// normalized model events. Shared by every upstream that speaks OpenAI on the
// wire, so each such provider only differs in how it builds the request.
package oaistream

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"

	"github.com/enowdev/enowx/core/model"
)

// Parse returns a stream over the response in the shape the request asked for.
func Parse(resp *http.Response, streaming bool) (model.Stream, error) {
	if streaming {
		return newSSE(resp), nil
	}
	return newJSON(resp)
}

// UsageFromBody scans an SSE or JSON body for the usage block (tokens + credit).
func UsageFromBody(body []byte) *model.Usage {
	// Try SSE data lines first.
	for _, line := range bytes.Split(body, []byte("\n")) {
		line = bytes.TrimSpace(line)
		if !bytes.HasPrefix(line, dataPrefix) {
			continue
		}
		payload := bytes.TrimSpace(line[len(dataPrefix):])
		if bytes.Equal(payload, doneMarker) {
			continue
		}
		var chunk chatChunk
		if json.Unmarshal(payload, &chunk) == nil {
			if u := chunk.usage(); u != nil {
				return u
			}
		}
	}
	// Fall back to a plain JSON object with a usage field.
	var chunk chatChunk
	if json.Unmarshal(bytes.TrimSpace(body), &chunk) == nil {
		return chunk.usage()
	}
	return nil
}

type sseStream struct {
	resp *http.Response
	sc   *bufio.Scanner
	done bool
}

func newSSE(resp *http.Response) *sseStream {
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<21)
	return &sseStream{resp: resp, sc: sc}
}

func (s *sseStream) Recv() (model.Event, error) {
	if s.done {
		return model.Event{}, io.EOF
	}
	for s.sc.Scan() {
		line := bytes.TrimSpace(s.sc.Bytes())
		if !bytes.HasPrefix(line, dataPrefix) {
			continue
		}
		payload := bytes.TrimSpace(line[len(dataPrefix):])
		if bytes.Equal(payload, doneMarker) {
			s.done = true
			return model.Event{Type: model.EventDone}, nil
		}
		var chunk chatChunk
		if err := json.Unmarshal(payload, &chunk); err != nil {
			continue
		}
		txt := chunk.delta()
		usage := chunk.usage()
		// The final chunk often carries usage with empty choices; surface it.
		if txt != "" || usage != nil {
			return model.Event{Type: model.EventDelta, Text: txt, Model: chunk.Model, Usage: usage}, nil
		}
	}
	if err := s.sc.Err(); err != nil {
		return model.Event{}, err
	}
	s.done = true
	return model.Event{Type: model.EventDone}, nil
}

func (s *sseStream) Close() error { return s.resp.Body.Close() }

type jsonStream struct {
	ev       model.Event
	sent     bool
	doneSent bool
}

func newJSON(resp *http.Response) (*jsonStream, error) {
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var parsed chatResponse
	_ = json.Unmarshal(b, &parsed)
	return &jsonStream{ev: model.Event{Type: model.EventDelta, Text: parsed.text(), Model: parsed.Model}}, nil
}

func (s *jsonStream) Recv() (model.Event, error) {
	if !s.sent {
		s.sent = true
		return s.ev, nil
	}
	if !s.doneSent {
		s.doneSent = true
		return model.Event{Type: model.EventDone}, nil
	}
	return model.Event{}, io.EOF
}

func (s *jsonStream) Close() error { return nil }

var (
	dataPrefix = []byte("data:")
	doneMarker = []byte("[DONE]")
)
