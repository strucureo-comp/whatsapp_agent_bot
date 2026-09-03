-- Per-tenant third-party credentials (BYOK) for a multi-tenant product.
-- A single global GROQ/ANTHROPIC key in env does not survive 1000 tenants:
-- billing, rate limits and revocation must all be per tenant.
-- Values are NaCl secretbox ciphertext (base64 nonce+ciphertext), keyed by
-- the CREDENTIALS_ENC_KEY env var which lives ONLY on the server.
CREATE TABLE IF NOT EXISTS tenant_secrets (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('groq', 'anthropic')),
  label TEXT NOT NULL DEFAULT '',
  key_encrypted TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

ALTER TABLE tenant_secrets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tenant_secrets' AND policyname = 'tenant_secrets_tenant_isolation'
  ) THEN
    CREATE POLICY tenant_secrets_tenant_isolation ON tenant_secrets
      USING (tenant_id = current_setting('app.tenant_id')::uuid);
  END IF;
END $$;
