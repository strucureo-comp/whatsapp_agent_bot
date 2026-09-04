export type SecretProvider =
  | "anthropic"
  | "openai"
  | "groq"
  | "openrouter"
  | "together"
  | "fireworks"
  | "gemini"
  | "deepseek"
  | "xai"
  | "ollama"
  | "custom";

export const SECRET_PROVIDERS: {
  value: SecretProvider;
  label: string;
  defaultModel: string;
  defaultBaseUrl?: string;
  requiresKey: boolean;
  models: { id: string; label: string }[];
}[] = [
  {
    value: "groq",
    label: "Groq (Ultra-fast, Llama & Mixtral)",
    defaultModel: "llama-3.3-70b-versatile",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    requiresKey: true,
    models: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile (Recommended)" },
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant (Fastest)" },
      { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B (32k context)" },
      { id: "gemma2-9b-it", label: "Gemma 2 9B" },
    ],
  },
  {
    value: "openai",
    label: "OpenAI (GPT-4o, GPT-4o-mini)",
    defaultModel: "gpt-4o-mini",
    defaultBaseUrl: "https://api.openai.com/v1",
    requiresKey: true,
    models: [
      { id: "gpt-4o", label: "GPT-4o (Flagship omni)" },
      { id: "gpt-4o-mini", label: "GPT-4o Mini (Fast & affordable)" },
      { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
      { id: "o1-mini", label: "o1 Mini (Reasoning)" },
    ],
  },
  {
    value: "anthropic",
    label: "Anthropic Claude",
    defaultModel: "claude-3-5-sonnet-20241022",
    requiresKey: true,
    models: [
      { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet (State of the art)" },
      { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku (Ultra-fast)" },
      { id: "claude-3-opus-20240229", label: "Claude 3 Opus (High capability)" },
    ],
  },
  {
    value: "openrouter",
    label: "OpenRouter (Aggregate 200+ models)",
    defaultModel: "meta-llama/llama-3.3-70b-instruct",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    requiresKey: true,
    models: [
      { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B Instruct" },
      { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet (via OpenRouter)" },
      { id: "google/gemini-2.0-flash-exp:free", label: "Gemini 2.0 Flash (Free)" },
      { id: "deepseek/deepseek-chat", label: "DeepSeek V3" },
      { id: "deepseek/deepseek-r1", label: "DeepSeek R1 (Reasoning)" },
    ],
  },
  {
    value: "deepseek",
    label: "DeepSeek (V3 & R1 Reasoning)",
    defaultModel: "deepseek-chat",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    requiresKey: true,
    models: [
      { id: "deepseek-chat", label: "DeepSeek Chat (V3)" },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner (R1)" },
    ],
  },
  {
    value: "gemini",
    label: "Google Gemini (OpenAI-compatible)",
    defaultModel: "gemini-1.5-flash",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    requiresKey: true,
    models: [
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
      { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
      { id: "gemini-2.0-flash-exp", label: "Gemini 2.0 Flash Exp" },
    ],
  },
  {
    value: "xai",
    label: "xAI Grok",
    defaultModel: "grok-2-latest",
    defaultBaseUrl: "https://api.x.ai/v1",
    requiresKey: true,
    models: [
      { id: "grok-2-latest", label: "Grok 2" },
      { id: "grok-beta", label: "Grok Beta" },
    ],
  },
  {
    value: "together",
    label: "Together AI",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    defaultBaseUrl: "https://api.together.xyz/v1",
    requiresKey: true,
    models: [
      { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", label: "Llama 3.3 70B Turbo" },
      { id: "mistralai/Mixtral-8x7B-Instruct-v0.1", label: "Mixtral 8x7B Instruct" },
      { id: "Qwen/Qwen2.5-72B-Instruct-Turbo", label: "Qwen 2.5 72B Turbo" },
    ],
  },
  {
    value: "fireworks",
    label: "Fireworks AI",
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    defaultBaseUrl: "https://api.fireworks.ai/inference/v1",
    requiresKey: true,
    models: [
      { id: "accounts/fireworks/models/llama-v3p3-70b-instruct", label: "Llama 3.3 70B Instruct" },
      { id: "accounts/fireworks/models/qwen2p5-72b-instruct", label: "Qwen 2.5 72B Instruct" },
    ],
  },
  {
    value: "ollama",
    label: "Ollama (Self-Hosted / Local)",
    defaultModel: "llama3.2",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    requiresKey: false,
    models: [
      { id: "llama3.2", label: "Llama 3.2" },
      { id: "llama3.1", label: "Llama 3.1" },
      { id: "mistral", label: "Mistral" },
      { id: "qwen2.5", label: "Qwen 2.5" },
    ],
  },
  {
    value: "custom",
    label: "Custom OpenAI-Compatible Endpoint",
    defaultModel: "default",
    requiresKey: false,
    models: [
      { id: "default", label: "Default Model" },
    ],
  },
];

export interface TenantSecretMasked {
  tenant_id: string;
  provider: SecretProvider;
  label: string;
  key_masked: string;
  created_at: string;
  updated_at: string;
}
