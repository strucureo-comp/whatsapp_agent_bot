import { getPool } from "./db";

export interface CompanyProfile {
  business_name?: string;
  industry?: string;
  about?: string;
  hours?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  services?: string;
  policies?: string;
}

export interface Tenant {
  id: string;
  name: string;
  persona_prompt: string;
  company_profile: CompanyProfile | null;
  status: "active" | "paused";
  llm_provider: string;
  llm_model: string;
  llm_base_url?: string | null;
  staff_whatsapp: string | null;
  google_calendar_id: string | null;
  max_monthly_spend_cents: number;
  reply_max_tokens: number;
  debounce_ms: number;
  created_at: string;
  updated_at: string;
  // aggregates
  conversation_count: number;
  open_escalations: number;
  spend_cents: number;
}

export type { ContactTag } from "./contact";
export { CONTACT_TAGS } from "./contact";
import type { ContactTag } from "./contact";

export interface Conversation {
  id: string;
  tenant_id: string;
  tenant_name: string;
  customer_number: string;
  customer_jid: string;
  customer_name: string;
  contact_tag: ContactTag;
  notes: string;
  status: "active" | "escalated" | "human_handling" | "closed";
  is_test: boolean;
  message_count: number;
  last_message_at: string | null;
  last_snippet: string | null;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  wa_message_id: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  usage_json: Record<string, number> | null;
  created_at: string;
}

export interface Escalation {
  id: string;
  conversation_id: string;
  tenant_id: string;
  tenant_name: string;
  customer_number: string;
  reason: string;
  summary: string | null;
  status: "open" | "resolved";
  created_at: string;
  resolved_at: string | null;
}

export interface TenantTool {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  endpoint: string;
  permission: "read" | "write";
  timeout_ms: number;
  rate_limit_per_min: number | null;
  enabled: boolean;
}

export interface OverviewStats {
  tenants: number;
  activeConversations: number;
  escalatedConversations: number;
  messagesToday: number;
  openEscalations: number;
  spendMonthCents: number;
}

const SPEND_SQL = `
  COALESCE(SUM(
    (m.usage_json->>'input_tokens')::int * 2 +
    (m.usage_json->>'output_tokens')::int * 10
  ), 0)::int
`;

export async function getOverviewStats(ownerUid: string): Promise<OverviewStats> {
  const pool = getPool();
  const [t, c, m, e, s] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n FROM tenants WHERE owner_uid = $1`, [ownerUid]),
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE c.status = 'active')::int AS active,
         COUNT(*) FILTER (WHERE c.status = 'escalated')::int AS escalated
        FROM conversations c JOIN tenants t ON c.tenant_id = t.id
        WHERE c.is_test = false AND t.owner_uid = $1`,
      [ownerUid]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN tenants t ON c.tenant_id = t.id
       WHERE m.created_at >= date_trunc('day', now()) AND t.owner_uid = $1`,
      [ownerUid]
    ),
    pool.query(`SELECT COUNT(*)::int AS n FROM escalations e JOIN tenants t ON e.tenant_id = t.id WHERE e.status = 'open' AND t.owner_uid = $1`, [ownerUid]),
    pool.query(
      `SELECT ${SPEND_SQL} AS n FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN tenants t ON c.tenant_id = t.id
       WHERE m.created_at >= date_trunc('month', now()) AND m.role = 'assistant' AND t.owner_uid = $1`,
      [ownerUid]
    ),
  ]);
  return {
    tenants: t.rows[0].n,
    activeConversations: c.rows[0].active,
    escalatedConversations: c.rows[0].escalated,
    messagesToday: m.rows[0].n,
    openEscalations: e.rows[0].n,
    spendMonthCents: s.rows[0].n,
  };
}

export async function getTenants(ownerUid: string): Promise<Tenant[]> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT t.*,
       (SELECT COUNT(*)::int FROM conversations c WHERE c.tenant_id = t.id AND c.is_test = false) AS conversation_count,
       (SELECT COUNT(*)::int FROM escalations e WHERE e.tenant_id = t.id AND e.status = 'open') AS open_escalations,
       (SELECT ${SPEND_SQL} FROM messages m
          JOIN conversations c ON c.id = m.conversation_id
         WHERE c.tenant_id = t.id
           AND m.created_at >= date_trunc('month', now())
           AND m.role = 'assistant') AS spend_cents
     FROM tenants t WHERE t.owner_uid = $1 ORDER BY t.created_at ASC`,
    [ownerUid]
  );
  return res.rows;
}

export async function getTenant(id: string, ownerUid: string): Promise<Tenant | null> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT t.*,
       (SELECT COUNT(*)::int FROM conversations c WHERE c.tenant_id = t.id AND c.is_test = false) AS conversation_count,
       (SELECT COUNT(*)::int FROM escalations e WHERE e.tenant_id = t.id AND e.status = 'open') AS open_escalations,
       (SELECT ${SPEND_SQL} FROM messages m
          JOIN conversations c ON c.id = m.conversation_id
         WHERE c.tenant_id = t.id
           AND m.created_at >= date_trunc('month', now())
           AND m.role = 'assistant') AS spend_cents
     FROM tenants t WHERE t.id = $1 AND t.owner_uid = $2`,
    [id, ownerUid],
  );
  return res.rows[0] ?? null;
}

export async function getConversations(ownerUid: string, opts?: {
  tenantId?: string;
  status?: string;
  includeTest?: boolean;
  limit?: number;
  search?: string;
}): Promise<Conversation[]> {
  const pool = getPool();
  const conds: string[] = [`t.owner_uid = $1`];
  const vals: unknown[] = [ownerUid];
  if (opts?.tenantId) {
    vals.push(opts.tenantId);
    conds.push(`c.tenant_id = $${vals.length}`);
  }
  if (opts?.status) {
    vals.push(opts.status);
    conds.push(`c.status = $${vals.length}`);
  }
  if (!opts?.includeTest) conds.push(`c.is_test = false`);
  if (opts?.search) {
    vals.push(`%${opts.search}%`);
    conds.push(`c.customer_number ILIKE $${vals.length}`);
  }
  vals.push(opts?.limit ?? 100);
  const res = await pool.query(
    `SELECT c.id, c.tenant_id, t.name AS tenant_name, c.customer_number, c.customer_jid,
            c.customer_name, c.contact_tag, c.notes,
            c.status, c.is_test, c.updated_at,
            (SELECT COUNT(*)::int FROM messages m WHERE m.conversation_id = c.id) AS message_count,
            (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id) AS last_message_at,
            (SELECT LEFT(m.content, 90) FROM messages m WHERE m.conversation_id = c.id
               ORDER BY m.created_at DESC LIMIT 1) AS last_snippet
       FROM conversations c
      JOIN tenants t ON c.tenant_id = t.id
      ${conds.length ? `WHERE ${conds.join(" AND ")}` : ""} ORDER BY c.updated_at DESC LIMIT $${vals.length}`,
    vals,
  );
  return res.rows;
}

export async function getConversation(id: string, ownerUid: string): Promise<Conversation | null> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT c.id, c.tenant_id, t.name AS tenant_name, c.customer_number, c.customer_jid,
            c.customer_name, c.contact_tag, c.notes,
            c.status, c.is_test, c.updated_at,
            (SELECT COUNT(*)::int FROM messages m WHERE m.conversation_id = c.id) AS message_count,
            (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id) AS last_message_at,
            (SELECT LEFT(m.content, 90) FROM messages m WHERE m.conversation_id = c.id
               ORDER BY m.created_at DESC LIMIT 1) AS last_snippet
       FROM conversations c JOIN tenants t ON t.id = c.tenant_id
       WHERE c.id = $1 AND t.owner_uid = $2`,
    [id, ownerUid],
  );
  return res.rows[0] ?? null;
}

export async function getMessages(conversationId: string, ownerUid: string): Promise<Message[]> {
  const pool = getPool();
  const check = await pool.query(`SELECT 1 FROM conversations c JOIN tenants t ON c.tenant_id = t.id WHERE c.id = $1 AND t.owner_uid = $2`, [conversationId, ownerUid]);
  if (check.rows.length === 0) return [];
  const res = await pool.query(
    `SELECT m.id, m.conversation_id, m.wa_message_id, m.role, m.content, m.usage_json, m.created_at
       FROM messages m WHERE m.conversation_id = $1 ORDER BY m.created_at ASC`,
    [conversationId],
  );
  return res.rows;
}

export async function getEscalations(ownerUid: string, status?: "open" | "resolved"): Promise<Escalation[]> {
  const pool = getPool();
  let query = `
    SELECT e.id, e.conversation_id, e.tenant_id, t.name AS tenant_name,
           c.customer_number, e.reason, e.summary, e.status, e.created_at, e.resolved_at
    FROM escalations e
    JOIN tenants t ON e.tenant_id = t.id
    JOIN conversations c ON c.id = e.conversation_id
    WHERE t.owner_uid = $1
  `;
  const vals: unknown[] = [ownerUid];
  
  if (status) {
    vals.push(status);
    query += ` AND e.status = $2`;
  }
  query += ` ORDER BY e.created_at DESC LIMIT 100`;
  const res = await pool.query(query, vals);
  return res.rows;
}

export async function getTools(ownerUid: string, tenantId?: string): Promise<(TenantTool & { tenant_name: string })[]> {
  const pool = getPool();
  let where = "WHERE t.owner_uid = $1";
  const vals: unknown[] = [ownerUid];
  if (tenantId) {
    vals.push(tenantId);
    where += " AND tt.tenant_id = $2";
  }
  const res = await pool.query(
    `SELECT tt.id, tt.tenant_id, t.name AS tenant_name, tt.name, tt.description,
            tt.endpoint, tt.permission, tt.timeout_ms, tt.rate_limit_per_min, tt.enabled
       FROM tenant_tools tt JOIN tenants t ON t.id = tt.tenant_id
       ${where} ORDER BY t.name, tt.name`,
    vals,
  );
  return res.rows;
}

export interface GoogleConnection {
  connected: boolean;
  google_email: string | null;
  expiry: string | null;
  scope: string | null;
  updated_at: string | null;
}

export async function getGoogleConnection(tenantId: string): Promise<GoogleConnection> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT google_email, expiry, scope, updated_at FROM tenant_google_tokens WHERE tenant_id = $1`,
    [tenantId]
  );
  if (res.rows.length === 0) {
    return { connected: false, google_email: null, expiry: null, scope: null, updated_at: null };
  }
  const r = res.rows[0];
  return {
    connected: true,
    google_email: r.google_email,
    expiry: r.expiry instanceof Date ? r.expiry.toISOString() : String(r.expiry),
    scope: r.scope,
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

export async function saveGoogleConnection(input: {
  tenantId: string;
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  scope: string;
  googleEmail?: string | null;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO tenant_google_tokens (tenant_id, access_token, refresh_token, expiry, scope, google_email, updated_at)
     VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::interval, $5, $6, NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       expiry = EXCLUDED.expiry,
       scope = EXCLUDED.scope,
       google_email = EXCLUDED.google_email,
       updated_at = NOW()`,
    [input.tenantId, input.accessToken, input.refreshToken, String(input.expiresInSec), input.scope, input.googleEmail ?? null]
  );
}

export async function deleteGoogleConnection(tenantId: string): Promise<void> {
  await getPool().query(`DELETE FROM tenant_google_tokens WHERE tenant_id = $1`, [tenantId]);
}

export type TicketStatus = "open" | "in_progress" | "resolved";
export type TicketPriority = "low" | "normal" | "high";

export interface Ticket {
  id: string;
  tenant_id: string;
  tenant_name: string;
  conversation_id: string | null;
  customer_number: string | null;
  customer_name: string | null;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  created_at: string;
  updated_at: string;
}

export async function getTickets(ownerUid: string, opts?: { tenantId?: string; status?: string; conversationId?: string; limit?: number }): Promise<Ticket[]> {
  const pool = getPool();
  const conds: string[] = ["t.owner_uid = $1"];
  const vals: unknown[] = [ownerUid];
  if (opts?.tenantId) {
    vals.push(opts.tenantId);
    conds.push(`tk.tenant_id = $${vals.length}`);
  }
  if (opts?.status) {
    vals.push(opts.status);
    conds.push(`tk.status = $${vals.length}`);
  }
  if (opts?.conversationId) {
    vals.push(opts.conversationId);
    conds.push(`tk.conversation_id = $${vals.length}`);
  }
  vals.push(opts?.limit ?? 100);
  const res = await pool.query(
    `SELECT tk.id, tk.tenant_id, t.name AS tenant_name, tk.conversation_id, tk.customer_number, tk.customer_name,
            tk.title, tk.status, tk.priority, tk.created_at, tk.updated_at
       FROM tickets tk JOIN tenants t ON t.id = tk.tenant_id
       WHERE ${conds.join(" AND ")} ORDER BY tk.updated_at DESC LIMIT $${vals.length}`,
    vals,
  );
  return res.rows;
}

export async function getTicket(ownerUid: string, id: string): Promise<Ticket | null> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT k.id, k.tenant_id, t.name AS tenant_name, k.conversation_id,
            c.customer_number, c.customer_name, k.title, k.status, k.priority,
            k.created_at, k.updated_at
       FROM tickets k
       JOIN tenants t ON t.id = k.tenant_id
       LEFT JOIN conversations c ON c.id = k.conversation_id
       WHERE k.id = $1 AND t.owner_uid = $2`,
    [id, ownerUid]
  );
  return res.rows[0] ?? null;
}

export async function getTicketCounts(tenantId?: string): Promise<Record<string, number>> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT status, COUNT(*)::int AS n FROM tickets
      ${tenantId ? "WHERE tenant_id = $1" : ""} GROUP BY status`,
    tenantId ? [tenantId] : []
  );
  const out: Record<string, number> = { open: 0, in_progress: 0, resolved: 0 };
  for (const r of res.rows) out[r.status] = r.n;
  return out;
}

export async function getRecentAudit(tenantId: string, limit = 20) {
  const pool = getPool();
  const res = await pool.query(
    `SELECT tool_name, allowed, created_at FROM audit_log
      WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [tenantId, limit],
  );
  return res.rows as { tool_name: string; allowed: boolean; created_at: string }[];
}
