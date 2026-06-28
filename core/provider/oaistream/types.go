package oaistream

import "github.com/enowdev/enowx/core/model"

type usageBlock struct {
	PromptTokens     int64   `json:"prompt_tokens"`
	CompletionTokens int64   `json:"completion_tokens"`
	Credit           float64 `json:"credit"`
}

type chatChunk struct {
	Model   string `json:"model"`
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
	} `json:"choices"`
	Usage *usageBlock `json:"usage"`
}

func (c chatChunk) delta() string {
	if len(c.Choices) == 0 {
		return ""
	}
	return c.Choices[0].Delta.Content
}

// usage returns the usage block as a model.Usage, or nil if absent/empty.
func (c chatChunk) usage() *model.Usage {
	if c.Usage == nil {
		return nil
	}
	if c.Usage.PromptTokens == 0 && c.Usage.CompletionTokens == 0 && c.Usage.Credit == 0 {
		return nil
	}
	return &model.Usage{
		PromptTokens:     c.Usage.PromptTokens,
		CompletionTokens: c.Usage.CompletionTokens,
		Credit:           c.Usage.Credit,
	}
}

type chatResponse struct {
	Model   string `json:"model"`
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

func (c chatResponse) text() string {
	if len(c.Choices) == 0 {
		return ""
	}
	return c.Choices[0].Message.Content
}
