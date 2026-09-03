import { listTenantSecretsMasked, SECRET_PROVIDERS } from "@/lib/tenant-secrets";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId");

  const providers: Record<
    string,
    { configured: boolean; source: "tenant" | "none"; masked?: string }
  > = {};

  // Default all providers to unconfigured
  for (const p of SECRET_PROVIDERS) {
    if (p.value === "ollama" || p.value === "custom") {
      // Self-hosted/custom may work without an API key
      providers[p.value] = { configured: true, source: "none" };
    } else {
      providers[p.value] = { configured: false, source: "none" };
    }
  }

  // Overlay tenant-specific encrypted keys from the DB
  if (tenantId) {
    try {
      const secrets = await listTenantSecretsMasked(tenantId);
      for (const s of secrets) {
        providers[s.provider] = {
          configured: true,
          source: "tenant",
          masked: s.key_masked,
        };
      }
    } catch {
      // Non-fatal, return defaults
    }
  }

  return Response.json({ providers });
}
