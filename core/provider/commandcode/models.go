package commandcode

import "github.com/enowdev/enowx/core/provider"

// catalog is the static CommandCode model list (mirrors the CommandCode CLI
// backend). Ids keep the vendor/model form the upstream expects.
func catalog() []provider.Model {
	return []provider.Model{
		{ID: "deepseek/deepseek-v4-pro", Name: "DeepSeek V4 Pro", Type: "chat"},
		{ID: "deepseek/deepseek-v4-flash", Name: "DeepSeek V4 Flash", Type: "chat"},
		{ID: "moonshotai/Kimi-K2.6", Name: "Kimi K2.6", Type: "chat"},
		{ID: "moonshotai/Kimi-K2.5", Name: "Kimi K2.5", Type: "chat"},
		{ID: "zai-org/GLM-5.1", Name: "GLM 5.1", Type: "chat"},
		{ID: "zai-org/GLM-5", Name: "GLM 5", Type: "chat"},
		{ID: "MiniMaxAI/MiniMax-M2.7", Name: "MiniMax M2.7", Type: "chat"},
		{ID: "MiniMaxAI/MiniMax-M2.5", Name: "MiniMax M2.5", Type: "chat"},
		{ID: "Qwen/Qwen3.6-Max-Preview", Name: "Qwen 3.6 Max Preview", Type: "chat"},
		{ID: "Qwen/Qwen3.6-Plus", Name: "Qwen 3.6 Plus", Type: "chat"},
		{ID: "stepfun/Step-3.5-Flash", Name: "Step 3.5 Flash", Type: "chat"},
	}
}
