import { getPool } from "@/db/pool.js";
import { getLogger } from "@/lib/logger.js";

/**
 * SQL aggregates for stats command, including cost derived from usage_json.
 */

export interface TenantStats {
  tenantId: string;
  tenantName: string;
  totalConversations: number;
  activeConversations: number;
  escalatedConversations: number;
  totalMessages: number;
  assistantMessages: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  estimatedCostCents: number;
}

export async function getTenantStats(tenantId?: string): Promise<TenantStats[]> {
  const pool = getPool();
  const log = getLogger();

  try {
    const whereClause = tenantId ? "WHERE c.tenant_id = $1" : "";
    const params = tenantId ? [tenantId] : [];

    const result = await pool.query(
      `SELECT
        t.id as tenant_id,
        t.name as tenant_name,
        COUNT(DISTINCT c.id) as total_conversations,
        COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'active') as active_conversations,
        COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'escalated') as escalated_conversations,
        COUNT(m.id) as total_messages,
        COUNT(m.id) FILTER (WHERE m.role = 'assistant') as assistant_messages,
        COALESCE(SUM((m.usage_json->>'input_tokens')::int), 0) as input_tokens,
        COALESCE(SUM((m.usage_json->>'output_tokens')::int), 0) as output_tokens,
        COALESCE(SUM((m.usage_json->>'cache_read_input_tokens')::int), 0) as cache_read_tokens,
        COALESCE(SUM((m.usage_json->>'cache_creation_input_tokens')::int), 0) as cache_creation_tokens
       FROM tenants t
       LEFT JOIN conversations c ON c.tenant_id = t.id
       LEFT JOIN messages m ON m.conversation_id = c.id
       ${whereClause}
       GROUP BY t.id, t.name
       ORDER BY t.name`,
      params,
    );

    return result.rows.map((row) => ({
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      totalConversations: parseInt(row.total_conversations),
      activeConversations: parseInt(row.active_conversations),
      escalatedConversations: parseInt(row.escalated_conversations),
      totalMessages: parseInt(row.total_messages),
      assistantMessages: parseInt(row.assistant_messages),
      inputTokens: parseInt(row.input_tokens),
      outputTokens: parseInt(row.output_tokens),
      totalTokens: parseInt(row.input_tokens) + parseInt(row.output_tokens),
      cacheReadTokens: parseInt(row.cache_read_tokens),
      cacheCreationTokens: parseInt(row.cache_creation_tokens),
      // Cost estimate: $0.25/M input, $1.25/M output, $0.025/M cache read, $3.75/M cache creation (Claude Sonnet 5)
      estimatedCostCents: Math.round(
        (parseInt(row.input_tokens) * 0.025 +
          parseInt(row.output_tokens) * 0.125 +
          parseInt(row.cache_read_tokens) * 0.0025 +
          parseInt(row.cache_creation_tokens) * 0.375) * 100
      ) / 100,
    }));
  } catch (err) {
    log.error({ err }, "Failed to get tenant stats");
    return [];
  }
}
