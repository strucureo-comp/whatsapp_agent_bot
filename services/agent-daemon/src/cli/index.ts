import inquirer from "inquirer";
import { tenantCreate, tenantList, tenantUse } from "./commands/tenant.js";
import { configLoad, configShow } from "./commands/config.js";
import { testCommand } from "./commands/test.js";
import { toolsAdd, toolsList, toolsRemove } from "./commands/tools.js";
import { jailbreakTest } from "./commands/jailbreak.js";
import { logsCommand } from "./commands/logs.js";
import { getTenantStats } from "./commands/stats.js";
import { escalationsList, escalationsResolve } from "./commands/escalations.js";
import { whatsappStatus, whatsappConnect, whatsappDisconnect } from "./commands/whatsapp.js";
import { evalCommand } from "./commands/eval.js";
import { createBackup, restoreBackup, verifyBackup } from "./commands/backup.js";

const commands: Record<string, () => Promise<void>> = {
  "tenant create": tenantCreate,
  "tenant list": tenantList,
  "tenant use": tenantUse,
  "config load": configLoad,
  "config show": configShow,
  "tools add": toolsAdd,
  "tools list": toolsList,
  "tools remove": toolsRemove,
  test: testCommand,
  "test --scenario jailbreak": jailbreakTest,
  logs: logsCommand,
  stats: async () => {
    const stats = await getTenantStats();
    if (stats.length === 0) {
      console.log("No data found.");
      return;
    }
    console.log("\nTenant Statistics:\n");
    for (const s of stats) {
      console.log(`${s.tenantName} (${s.tenantId}):`);
      console.log(`  Conversations: ${s.totalConversations} (${s.activeConversations} active, ${s.escalatedConversations} escalated)`);
      console.log(`  Messages: ${s.totalMessages} (${s.assistantMessages} from assistant)`);
      console.log(`  Tokens: ${s.totalTokens.toLocaleString()} (input: ${s.inputTokens.toLocaleString()}, output: ${s.outputTokens.toLocaleString()})`);
      console.log(`  Cache: ${s.cacheReadTokens.toLocaleString()} read, ${s.cacheCreationTokens.toLocaleString()} created`);
      console.log(`  Estimated cost: $${s.estimatedCostCents.toFixed(2)}`);
      console.log();
    }
  },
  "escalations list": escalationsList,
  "escalations resolve": escalationsResolve,
  "whatsapp status": whatsappStatus,
  "whatsapp connect": whatsappConnect,
  "whatsapp disconnect": whatsappDisconnect,
  eval: evalCommand,
  "backup create": async () => {
    const filepath = createBackup();
    console.log(`✅ Backup created: ${filepath}`);
  },
  "backup restore": async () => {
    const { backupFile } = await inquirer.prompt([
      { type: "input", name: "backupFile", message: "Backup file path:" },
    ]);
    restoreBackup({ backupFile });
    console.log("✅ Restore completed.");
  },
  "backup verify": async () => {
    const { backupFile } = await inquirer.prompt([
      { type: "input", name: "backupFile", message: "Backup file path:" },
    ]);
    const valid = verifyBackup(backupFile);
    console.log(valid ? "✅ Backup is valid." : "❌ Backup verification failed.");
  },
};

export async function runRepl() {
  console.log("Strucureo REPL — type 'help' for commands\n");

  const running = true;
  while (running) {
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "Command:",
        choices: [
          ...Object.keys(commands),
          new inquirer.Separator(),
          "help",
          "exit",
        ],
      },
    ]);

    if (action === "exit") break;

    if (action === "help") {
      console.log("\nAvailable commands:");
      for (const cmd of Object.keys(commands)) {
        console.log(`  ${cmd}`);
      }
      console.log();
      continue;
    }

    const handler = commands[action];
    if (handler) {
      try {
        await handler();
      } catch (err) {
        console.error(`❌ Error:`, err);
      }
    }
  }
}
