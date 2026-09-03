import { revalidatePath } from "next/cache";
import {
  listTenantSecretsMasked,
  upsertTenantSecret,
  deleteTenantSecret,
  SecretProvider,
  SECRET_PROVIDERS,
} from "@/lib/tenant-secrets";

const VALID_PROVIDERS = new Set<string>(SECRET_PROVIDERS.map((p) => p.value));

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const secrets = await listTenantSecretsMasked(id);
    return Response.json({ secrets });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: { provider?: string; label?: string; key?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { provider, label = "", key } = body;
  if (!provider || !VALID_PROVIDERS.has(provider)) {
    return Response.json(
      { error: `Invalid provider. Must be one of: ${Array.from(VALID_PROVIDERS).join(", ")}` },
      { status: 400 }
    );
  }

  if (!key || typeof key !== "string" || key.trim().length === 0) {
    return Response.json({ error: "API key cannot be empty" }, { status: 400 });
  }

  try {
    await upsertTenantSecret(id, provider as SecretProvider, label, key.trim());
    revalidatePath(`/tenants/${id}`);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  let provider = url.searchParams.get("provider");

  if (!provider) {
    try {
      const body = await request.json();
      provider = body?.provider;
    } catch {
      // Body may be empty on query-param DELETE
    }
  }

  if (!provider || !VALID_PROVIDERS.has(provider)) {
    return Response.json({ error: "Provider is required to delete secret" }, { status: 400 });
  }

  try {
    const deleted = await deleteTenantSecret(id, provider as SecretProvider);
    revalidatePath(`/tenants/${id}`);
    return Response.json({ ok: true, deleted });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
