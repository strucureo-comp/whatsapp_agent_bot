-- Structured company profile per tenant, edited from the dashboard.
-- handleMessage renders this into the system prompt so company facts
-- (hours, location, services) reach the model without stuffing persona_prompt.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS company_profile JSONB NOT NULL DEFAULT '{}';
