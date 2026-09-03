import pg from "pg";
import { DATABASE_URL } from "./env";

const { Pool } = pg;

let _pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!_pool) {
    const connectionString = DATABASE_URL();
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set (root .env missing?)");
    }
    _pool = new Pool({ connectionString, max: 5 });
  }
  return _pool;
}
