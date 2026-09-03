-- Any-LLM platform model: tenants bring their own provider credentials.
-- Widen providers beyond groq/anthropic; custom OpenAI-compatible base URL
-- lives on the tenant row. Platform env keys remain the fallback.
ALTER TABLE tenant_secrets DROP CONSTRAINT IF EXISTS tenant_secrets_provider_check;
ALTER TABLE tenant_secrets
  ADD CONSTRAINT tenant_secrets_provider_check
  CHECK (provider IN (
    'anthropic', 'openai', 'groq', 'openrouter', 'together', 'fireworks',
    'gemini', 'deepseek', 'xai', 'ollama', 'custom'
  ));

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS llm_base_url TEXT;
