-- Row-Level Security on every tenant-scoped table
ALTER TABLE tenant_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;

-- Policies: enforce tenant isolation via app.tenant_id
CREATE POLICY tenant_tools_tenant_isolation ON tenant_tools
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY conversations_tenant_isolation ON conversations
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY messages_tenant_isolation ON messages
  USING (
    conversation_id IN (
      SELECT id FROM conversations
      WHERE tenant_id = current_setting('app.tenant_id')::uuid
    )
  );

CREATE POLICY escalations_tenant_isolation ON escalations
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY audit_log_tenant_isolation ON audit_log
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY whatsapp_sessions_tenant_isolation ON whatsapp_sessions
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
