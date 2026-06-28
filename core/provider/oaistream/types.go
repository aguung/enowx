package oaistream

type chatChunk struct {
	Model   string `json:"model"`
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
	} `json:"choices"`
}

func (c chatChunk) delta() string {
	if len(c.Choices) == 0 {
		return ""
	}
	return c.Choices[0].Delta.Content
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
