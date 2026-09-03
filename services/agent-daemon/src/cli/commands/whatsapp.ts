import inquirer from "inquirer";
import { getActiveTenantId } from "../active-tenant.js";
import { selectTenant } from "@/cli/lib/select-tenant.js";
import { gatewayRequest } from "@/lib/gateway.js";

/**
 * WhatsApp connect/status/disconnect commands wired through to the gateway API.
 *
 * The gateway takes tenant ids in a JSON body on POST routes and in the query
 * string on GET routes; mixing those up is answered with a bare 400.
 */

// The gateway waits up to 30s for WhatsApp's pair-device IQ on a fresh device, so
// the client has to outlast that or it reports a timeout for a pairing that is
// still on its way. Deliberately not retried: a failure here may mean PairPhone
// already ran, and asking twice invalidates the code the user is reading.
const PAIR_TIMEOUT_MS = 40_000;

interface PairCodeResponse {
  status: string;
  tenant_id: string;
  pairing_code?: string;
  expires_at?: string;
  jid?: string;
  connected?: boolean;
}

export async function whatsappStatus() {
  const tenantId = await selectTenant();
  if (!tenantId) return;

  // The gateway has no /status route — /qr is the house contract's status
  // endpoint and returns {status, qr, pairing_code, jid}.
  const result = await gatewayRequest(
    `/qr?tenant_id=${encodeURIComponent(tenantId)}`,
  );

  if (!result.ok) {
    console.log(`❌ Error: ${result.error}`);
    return;
  }

  console.log(`\nWhatsApp status for ${tenantId}:`);
  console.log(JSON.stringify(result.data, null, 2));
}

export async function whatsappConnect() {
  const tenantId = await selectTenant();
  if (!tenantId) return;

  const { phone } = await inquirer.prompt([
    {
      type: "input",
      name: "phone",
      message: "Phone number (with country code):",
      validate: (input: string) =>
        /^\+?[1-9]\d{7,14}$/.test(input.replace(/[\s-]/g, ""))
          ? true
          : "Enter an E.164 number, e.g. +919344275731",
    },
  ]);

  // whatsmeow's PairPhone wants the international number as digits only: no
  // leading +, no separators. A raw + in a query string would also decode to a
  // space, which is half of why this used to fail.
  const msisdn = phone.replace(/[\s+-]/g, "");

  console.log(`\nPairing ${tenantId} with phone +${msisdn}...`);

  const result = await gatewayRequest<PairCodeResponse>("/pair-code", {
    method: "POST",
    body: { tenant_id: tenantId, phone: msisdn },
    timeoutMs: PAIR_TIMEOUT_MS,
  });

  if (!result.ok) {
    console.log(`❌ Error: ${result.error}`);
    return;
  }

  const data = result.data;

  if (data?.status === "already_paired") {
    console.log(`✅ Already paired as ${data.jid ?? "unknown"} — nothing to do.`);
    console.log(
      "   To pair a different number, run 'whatsapp disconnect' and choose to wipe\n" +
        "   the stored credentials first.",
    );
    return;
  }

  // Print the code from this response rather than sending the user off to
  // 'whatsapp status' for it — it is in the body already.
  if (data?.pairing_code) {
    console.log(`\n✅ Pairing code: ${data.pairing_code}`);
    if (data.expires_at) console.log(`   Expires: ${data.expires_at}`);
    console.log(
      "\n   Enter it on the phone under WhatsApp → Settings → Linked devices →\n" +
        "   Link with phone number.",
    );
    return;
  }

  console.log(`✅ Pairing requested: ${JSON.stringify(data)}`);
  console.log("   Run 'whatsapp status' for the pairing code.");
}

export async function whatsappDisconnect() {
  const tenantId = await selectTenant();
  if (!tenantId) return;

  // Wiping DROPs the tenant's whatsmeow database and cannot be undone, so it is
  // opt-in and defaulted to no.
  const { wipe } = await inquirer.prompt([
    {
      type: "confirm",
      name: "wipe",
      message:
        "Also erase the stored WhatsApp credentials? (required to pair a different number, cannot be undone)",
      default: false,
    },
  ]);

  const result = await gatewayRequest<{ status: string }>("/disconnect", {
    method: "POST",
    body: { tenant_id: tenantId, wipe },
  });

  if (!result.ok) {
    console.log(`❌ Error: ${result.error}`);
    return;
  }

  console.log(
    wipe
      ? `✅ WhatsApp disconnected and credentials erased for ${tenantId}.`
      : `✅ WhatsApp disconnected for ${tenantId}. Credentials kept — 'whatsapp connect' will log back in.`,
  );
}
