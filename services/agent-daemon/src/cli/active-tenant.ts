import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const STATE_FILE = resolve(process.cwd(), ".active-tenant");

let _activeTenantId: string | null = null;

export function getActiveTenantId(): string | null {
  if (_activeTenantId) return _activeTenantId;
  if (existsSync(STATE_FILE)) {
    _activeTenantId = readFileSync(STATE_FILE, "utf-8").trim() || null;
  }
  return _activeTenantId;
}

export function setActiveTenantId(tenantId: string): void {
  _activeTenantId = tenantId;
  writeFileSync(STATE_FILE, tenantId);
}

export function clearActiveTenantId(): void {
  _activeTenantId = null;
  try {
    unlinkSync(STATE_FILE);
  } catch {}
}
