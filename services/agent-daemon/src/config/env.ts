import { z } from "zod";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

// Load .env from project root — CWD is always services/agent-daemon/
loadEnv({ path: resolve(process.cwd(), "../../.env") });

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  DIRECT_DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  REDIS_PASSWORD: z.string().optional().default(""),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  GROQ_API_KEY: z.string().optional().default(""),
  LLM_PROVIDER: z.enum(["anthropic", "groq"]).default("anthropic"),
  DEFAULT_LLM_MODEL: z.string().default("claude-opus-5"),
  GATEWAY_URL: z.string().url(),
  GATEWAY_SECRET: z.string().default("change-me-to-a-random-secret"),
  GOOGLE_SERVICE_ACCOUNT_KEY_PATH: z.string().optional(),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | undefined;

export function getEnv(): Env {
  if (!_env) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      console.error("❌ Invalid environment configuration:");
      console.error(result.error.format());
      process.exit(1);
    }
    _env = result.data;
  }
  return _env;
}
