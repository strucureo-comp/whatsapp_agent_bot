import { execSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getEnv } from "@/config/env.js";
import { getLogger } from "@/lib/logger.js";

/**
 * Backup and restore using pg_dump.
 * Includes the whatsmeow schema for WhatsApp session data.
 * Supports restore rehearsal into a scratch database.
 */

export interface BackupOptions {
  outputDir?: string;
  includeWhatsmeow?: boolean;
}

export interface RestoreOptions {
  backupFile: string;
  targetDatabase?: string;
}

export interface RehearsalResult {
  success: boolean;
  backupFile: string;
  scratchDb: string;
  tablesCreated: number;
  rowsInserted: number;
  durationMs: number;
  error?: string;
}

/**
 * Create a backup using pg_dump.
 */
export function createBackup(options: BackupOptions = {}): string {
  const log = getLogger();
  const env = getEnv();

  const outputDir = options.outputDir ?? "./backups";
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `strucureo-backup-${timestamp}.sql`;
  const filepath = join(outputDir, filename);

  const schemas = ["public"];
  if (options.includeWhatsmeow) {
    schemas.push("whatsmeow");
  }

  const schemaArgs = schemas.map((s) => `--schema=${s}`).join(" ");

  try {
    execSync(
      `pg_dump "${env.DIRECT_DATABASE_URL}" ${schemaArgs} --no-owner --no-privileges > "${filepath}"`,
      { stdio: "pipe" },
    );

    log.info({ filepath, schemas }, "Backup created");
    return filepath;
  } catch (err) {
    log.error({ err }, "Backup failed");
    throw err;
  }
}

/**
 * Restore from a backup file.
 */
export function restoreBackup(options: RestoreOptions): void {
  const log = getLogger();
  const env = getEnv();

  const targetDb = options.targetDatabase ?? env.DIRECT_DATABASE_URL;

  try {
    execSync(`psql "${targetDb}" < "${options.backupFile}"`, {
      stdio: "pipe",
    });

    log.info({ backupFile: options.backupFile }, "Restore completed");
  } catch (err) {
    log.error({ err }, "Restore failed");
    throw err;
  }
}

/**
 * Verify backup integrity by checking the file exists and is non-empty.
 */
export function verifyBackup(filepath: string): boolean {
  const log = getLogger();

  if (!existsSync(filepath)) {
    log.error({ filepath }, "Backup file not found");
    return false;
  }

  try {
    const stats = statSync(filepath);
    if (stats.size === 0) {
      log.error({ filepath }, "Backup file is empty");
      return false;
    }

    log.info({ filepath, size: stats.size }, "Backup verified");
    return true;
  } catch (err) {
    log.error({ filepath, err }, "Backup verification failed");
    return false;
  }
}

/**
 * Restore rehearsal — restore a backup into a scratch database to validate it.
 * Creates a temporary database, restores the backup, counts tables and rows,
 * then drops the scratch database.
 */
export function restoreRehearsal(backupFile: string): RehearsalResult {
  const log = getLogger();
  const env = getEnv();
  const start = Date.now();

  // Parse the main database URL to build scratch DB URL
  const mainUrl = new URL(env.DIRECT_DATABASE_URL);
  const scratchDbName = `strucureo_rehearsal_${Date.now()}`;
  const scratchUrl = new URL(mainUrl.toString());
  scratchUrl.pathname = `/${scratchDbName}`;
  const scratchUrlStr = scratchUrl.toString();

  // Extract base connection (without database name) for createdb/dropdb
  const baseUrl = new URL(mainUrl.toString());
  baseUrl.pathname = "/postgres";
  const baseUrlStr = baseUrl.toString();

  try {
    // Create scratch database
    execSync(`createdb "${baseUrlStr}" "${scratchDbName}" 2>/dev/null || true`, {
      stdio: "pipe",
      env: { ...process.env, PGPASSWORD: mainUrl.password || undefined },
    });

    // Restore backup into scratch database
    execSync(`psql "${scratchUrlStr}" < "${backupFile}"`, {
      stdio: "pipe",
      env: { ...process.env, PGPASSWORD: mainUrl.password || undefined },
    });

    // Count tables
    const tablesResult = execSync(
      `psql "${scratchUrlStr}" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'"`,
      { stdio: "pipe", env: { ...process.env, PGPASSWORD: mainUrl.password || undefined } },
    );
    const tablesCreated = parseInt(tablesResult.toString().trim(), 10) || 0;

    // Count total rows across all public tables
    const rowsResult = execSync(
      `psql "${scratchUrlStr}" -t -c "SELECT COALESCE(SUM(n_live_tup), 0) FROM pg_stat_user_tables WHERE schemaname = 'public'"`,
      { stdio: "pipe", env: { ...process.env, PGPASSWORD: mainUrl.password || undefined } },
    );
    const rowsInserted = parseInt(rowsResult.toString().trim(), 10) || 0;

    // Drop scratch database
    execSync(`dropdb "${baseUrlStr}" "${scratchDbName}" 2>/dev/null || true`, {
      stdio: "pipe",
      env: { ...process.env, PGPASSWORD: mainUrl.password || undefined },
    });

    const durationMs = Date.now() - start;
    log.info({ backupFile, scratchDb: scratchDbName, tablesCreated, rowsInserted, durationMs }, "Restore rehearsal completed");

    return {
      success: true,
      backupFile,
      scratchDb: scratchDbName,
      tablesCreated,
      rowsInserted,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    log.error({ backupFile, error, durationMs }, "Restore rehearsal failed");

    // Try to clean up scratch database
    try {
      execSync(`dropdb "${baseUrlStr}" "${scratchDbName}" 2>/dev/null || true`, {
        stdio: "pipe",
        env: { ...process.env, PGPASSWORD: mainUrl.password || undefined },
      });
    } catch {
      // Ignore cleanup errors
    }

    return {
      success: false,
      backupFile,
      scratchDb: scratchDbName,
      tablesCreated: 0,
      rowsInserted: 0,
      durationMs,
      error,
    };
  }
}
