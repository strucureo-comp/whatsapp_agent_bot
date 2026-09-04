ALTER TABLE tenants ADD COLUMN owner_uid VARCHAR(255);
CREATE INDEX idx_tenants_owner_uid ON tenants(owner_uid);
