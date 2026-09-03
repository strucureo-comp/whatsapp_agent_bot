import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("RLS enforcement (integration)", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("returns zero rows when no tenant context is set", async () => {
    const client = await pool.connect();
    try {
      const result = await client.query("SELECT * FROM conversations LIMIT 10");
      expect(result.rows.length).toBe(0);
    } finally {
      client.release();
    }
  });

  it("returns rows when tenant context is set", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000001'",
      );
      await client.query(
        "INSERT INTO tenants (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'test-rls')",
      );
      await client.query(
        `INSERT INTO conversations (tenant_id, customer_number, customer_jid)
         VALUES ('00000000-0000-0000-0000-000000000001', '+1234567890', '1234567890@s.whatsapp.net')`,
      );

      const result = await client.query("SELECT * FROM conversations");
      expect(result.rows.length).toBe(1);

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
