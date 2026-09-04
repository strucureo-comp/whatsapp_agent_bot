import { GATEWAY_SECRET, GATEWAY_URL } from "./env";

export interface SessionStatus {
  tenant_id: string;
  status: string;
  qr: string;
  pairing_code: string;
  jid: string;
  expires_at?: string;
}

async function gatewayFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${GATEWAY_URL()}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GATEWAY_SECRET()}`,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getGatewayHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${GATEWAY_URL()}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getSessionStatus(tenantId: string): Promise<SessionStatus | null> {
  return gatewayFetch<SessionStatus>(
    `/qr?tenant_id=${encodeURIComponent(tenantId)}`,
  );
}

export async function requestPairingCode(tenantId: string, phone: string) {
  return gatewayFetch<{ status: string; pairing_code?: string; expires_at?: string }>(
    "/pair-code",
    { method: "POST", body: JSON.stringify({ tenant_id: tenantId, phone }) },
  );
}

export async function disconnectSession(tenantId: string, wipe = false) {
  return gatewayFetch<{ status: string }>(`/disconnect`, {
    method: "POST",
    body: JSON.stringify({ tenant_id: tenantId, wipe }),
  });
}

export async function sendGatewayMessage(tenantId: string, to: string, body: string) {
  return gatewayFetch<{ status: string; id?: string }>(
    "/messages/send",
    {
      method: "POST",
      body: JSON.stringify({
        tenant_id: tenantId,
        to,
        body,
        allow_unsolicited: true,
      }),
    }
  );
}
