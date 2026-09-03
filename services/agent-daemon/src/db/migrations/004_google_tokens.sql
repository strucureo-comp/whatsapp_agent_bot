-- Per-tenant Google OAuth tokens (Calendar connect via dashboard).
-- One row per tenant; dashboard upserts on OAuth callback, daemon reads per call.
-- Tokens are secrets: same posture as tenant_tools.auth_config (DB access = secret access).
CREATE TABLE IF NOT EXISTS tenant_google_tokens (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expiry TIMESTAMPTZ NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  google_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
