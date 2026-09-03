-- Contact management + tickets (mini-CRM per tenant).
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_tag TEXT NOT NULL DEFAULT 'new_lead',
  ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';

-- Backfill guard: only known tags allowed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_contact_tag_check') THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_contact_tag_check
      CHECK (contact_tag IN ('new_lead', 'prospect', 'converted', 'vip', 'blocked'));
  END IF;
END $$;

-- Tickets: work items attached to a tenant, optionally to a chat.
CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_status ON tickets (tenant_id, status);
