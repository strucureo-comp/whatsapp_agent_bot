-- Migration 008: Omnichannel support (Inbound & Outbound Email, multi-channel conversations)

-- 1. Extend conversations for multi-channel support
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel VARCHAR(32) NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS customer_email TEXT,
  ADD COLUMN IF NOT EXISTS customer_name TEXT,
  ADD COLUMN IF NOT EXISTS channel_metadata JSONB DEFAULT '{}'::jsonb;

-- Allow customer_number and customer_jid to be nullable for non-phone channels (e.g., email, webchat)
ALTER TABLE conversations ALTER COLUMN customer_number DROP NOT NULL;
ALTER TABLE conversations ALTER COLUMN customer_jid DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations (channel);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_tenant_channel_email 
  ON conversations (tenant_id, channel, customer_email) 
  WHERE customer_email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_tenant_channel_number 
  ON conversations (tenant_id, channel, customer_number) 
  WHERE customer_number IS NOT NULL;

-- 2. Extend messages with email threading & metadata
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS channel VARCHAR(32) NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS email_message_id TEXT,
  ADD COLUMN IF NOT EXISTS in_reply_to TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_messages_email_message_id ON messages (email_message_id);

-- 3. Extend tenants with inbound & outbound email settings
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS inbound_email_slug TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS custom_email_address TEXT,
  ADD COLUMN IF NOT EXISTS email_signature TEXT,
  ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT true;

-- Seed inbound_email_slug for existing tenants using safe slugified name or substring of ID
UPDATE tenants
SET inbound_email_slug = LOWER(
  SUBSTRING(
    REGEXP_REPLACE(COALESCE(name, 'agent'), '[^a-zA-Z0-9]+', '-', 'g') || '-' || SUBSTRING(id::text, 1, 8),
    1, 48
  )
)
WHERE inbound_email_slug IS NULL;
