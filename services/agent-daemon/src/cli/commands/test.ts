import inquirer from "inquirer";
import { withTenant } from "@/db/with-tenant.js";
import { getPool } from "@/db/pool.js";
import { getOrCreateConversation } from "@/repos/conversation.js";
import { handleMessage } from "@/agent/handle-message.js";
import { sendText } from "@/channel/index.js";
import { getLlmClient, type LlmProvider } from "@/llm/client.js";

/**
 * Test command — calls handleMessage in-process against a test conversation.
 * This is the same code path as production, ensuring test/prod parity.
 *
 * Options:
 *   --provider groq    Use Groq with groq/compound-mini (default for quick tests)
 *   --provider anthropic  Use Anthropic with Claude
 *   --message "text"   Message to send
 *   --tenant-id id     Tenant to test against
 */
export async function testCommand(options?: {
  message?: string;
  tenantId?: string;
  provider?: LlmProvider;
}) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // Get tenant
    let tenantId = options?.tenantId;
    if (!tenantId) {
      const result = await client.query("SELECT id, name FROM tenants ORDER BY name");
      if (result.rows.length === 0) {
        console.log("No tenants found. Run 'tenant create' first.");
        return;
      }
      const { tid } = await inquirer.prompt([
        {
          type: "list",
          name: "tid",
          message: "Select tenant:",
          choices: result.rows.map((r: any) => ({ name: r.name, value: r.id })),
        },
      ]);
      tenantId = tid;
    }

    // Get or create test conversation
    const conversation = await getOrCreateConversation(
      client,
      tenantId,
      "test-user",
      "test-user@s.whatsapp.net",
      true, // is_test = true
    );

    // Get provider selection
    let provider: LlmProvider = options?.provider ?? "anthropic";
    if (!options?.provider) {
      const { prov } = await inquirer.prompt([
        {
          type: "list",
          name: "prov",
          message: "LLM Provider:",
          choices: [
            { name: "Anthropic (Claude)", value: "anthropic" },
            { name: "Groq (groq/compound-mini)", value: "groq" },
          ],
        },
      ]);
      provider = prov;
    }

    // Get message
    let messageText = options?.message;
    if (!messageText) {
      const { msg } = await inquirer.prompt([
        { type: "input", name: "msg", message: "Test message:" },
      ]);
      messageText = msg;
    }

    // Override tenant's LLM settings for this test if provider is specified
    if (provider === "groq") {
      // Temporarily set the tenant to use Groq
      await client.query(
        "UPDATE tenants SET llm_provider = 'groq', llm_model = 'groq/compound-mini' WHERE id = $1",
        [tenantId],
      );
    }

    console.log(`\nSending to tenant ${tenantId} via ${provider}...`);

    const reply = await handleMessage(tenantId, conversation.id, [
      {
        message_id: `test-${Date.now()}`,
        content: messageText,
        role: "user",
      },
    ]);

    if (reply.skipped) {
      console.log("\n⏭️  Skipped — conversation is not bot-handled (human/escalated mode).");
      return;
    }
    console.log(`\n📝 Reply:\n${reply.content}`);
    if (reply.usage) {
      console.log(`\n📊 Usage: ${reply.usage.input_tokens} in / ${reply.usage.output_tokens} out`);
      if (reply.usage.cache_read_input_tokens) {
        console.log(`   Cache read: ${reply.usage.cache_read_input_tokens} tokens`);
      }
    }
  } finally {
    client.release();
  }
}
