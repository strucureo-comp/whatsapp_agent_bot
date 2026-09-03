import { existsSync } from "node:fs";

export async function GET() {
  // Presence only — values never leave the server.
  const saPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  return Response.json({
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    groq: Boolean(process.env.GROQ_API_KEY),
    serviceAccount: Boolean(saPath && existsSync(saPath)),
  });
}
