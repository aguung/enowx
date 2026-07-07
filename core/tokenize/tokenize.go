// Package tokenize provides a lightweight, dependency-free token estimator. It's
// a fallback for upstreams that don't report usage: many providers (Kiro, Codex,
// some CodeBuddy variants) omit token counts, so we approximate from the text.
//
// It is NOT a real BPE tokenizer — it estimates. For typical English/code the
// estimate lands within ~10-15% of tiktoken (cl100k), which is fine for both
// usage stats and Kleos pricing (which floors to whole Kleos anyway).
package tokenize

import (
	"strings"
	"unicode"
)

// EstimateText estimates the number of tokens in a string. The heuristic blends
// two signals that bracket real tokenization: word count (tokens ≳ words) and a
// chars/4 estimate (the common rule of thumb). Whitespace/punctuation runs and
// CJK (roughly one token per character) are handled.
func EstimateText(s string) int {
	if s == "" {
		return 0
	}
	var chars, cjk, words int
	inWord := false
	for _, r := range s {
		if r > 0x3000 && (unicode.Is(unicode.Han, r) || unicode.Is(unicode.Hiragana, r) || unicode.Is(unicode.Katakana, r) || unicode.Is(unicode.Hangul, r)) {
			cjk++
			inWord = false
			continue
		}
		chars++
		if unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) {
			inWord = false
		} else if !inWord {
			words++
			inWord = true
		}
	}
	// Latin text: ~chars/4, but never fewer than ~0.75 tokens/word (subword
	// splitting means tokens ≳ words). Take the larger of the two estimates.
	byChars := chars / 4
	byWords := (words * 4) / 3 // ~1.33 tokens per word
	est := byChars
	if byWords > est {
		est = byWords
	}
	est += cjk // CJK ≈ 1 token/char
	if est == 0 && (chars > 0 || cjk > 0) {
		est = 1
	}
	return est
}

// Message is the minimal shape needed to estimate a chat request's prompt tokens.
type Message struct {
	Role    string
	Content string
}

// EstimatePromptTokens estimates the prompt-side tokens of a chat request,
// including a small per-message overhead the way chat formats add framing tokens.
func EstimatePromptTokens(msgs []Message) int {
	total := 0
	for _, m := range msgs {
		total += EstimateText(m.Role) + EstimateText(m.Content) + 4 // ~4 framing tokens/message
	}
	if len(msgs) > 0 {
		total += 2 // reply priming
	}
	return total
}

// ExtractText pulls concatenated text out of an OpenAI-style messages array
// (each item {role, content} where content is a string or an array of parts).
func ExtractText(messages []any) []Message {
	out := make([]Message, 0, len(messages))
	for _, mi := range messages {
		m, ok := mi.(map[string]any)
		if !ok {
			continue
		}
		role, _ := m["role"].(string)
		var content string
		switch c := m["content"].(type) {
		case string:
			content = c
		case []any:
			var sb strings.Builder
			for _, p := range c {
				if pm, ok := p.(map[string]any); ok {
					if t, ok := pm["text"].(string); ok {
						sb.WriteString(t)
						sb.WriteString(" ")
					}
				}
			}
			content = sb.String()
		}
		out = append(out, Message{Role: role, Content: content})
	}
	return out
}
