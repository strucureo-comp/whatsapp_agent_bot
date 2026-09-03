import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

// Dashboard runs from services/dashboard — load the shared root .env.
loadEnv({ path: resolve(process.cwd(), "../../.env") });

export function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const DATABASE_URL = () => env("DATABASE_URL");
export const GATEWAY_URL = () => env("GATEWAY_URL", "http://127.0.0.1:8080");
export const GATEWAY_SECRET = () => env("GATEWAY_SECRET");
