import { configExists, loadConfig } from "../lib/config.js";
import { getAgent } from "../lib/api.js";

export async function statusCommand(): Promise<void> {
  if (!configExists()) {
    console.log("\n✗ smoltbot is not initialized\n");
    console.log("Run `smoltbot init` to get started.\n");
    process.exit(1);
  }

  const config = loadConfig();
  if (!config) {
    console.log("\n✗ Failed to load configuration\n");
    process.exit(1);
  }

  console.log("\n🔍 Fetching agent status...\n");

  try {
    const agent = await getAgent(config.agentId);

    console.log("━".repeat(50));
    console.log("Agent Status");
    console.log("━".repeat(50));
    console.log(`  ID:        ${agent.id}`);
    console.log(`  Gateway:   ${agent.gateway}`);
    console.log(`  Last Seen: ${agent.last_seen || "Never"}`);
    console.log(`  Claimed:   ${agent.claimed ? "Yes" : "No"}`);
    if (agent.email) {
      console.log(`  Email:     ${agent.email}`);
    }
    console.log(`  Created:   ${agent.created_at}`);
    console.log("━".repeat(50));

    if (!agent.claimed) {
      console.log(
        `\n💡 Claim your agent: https://mnemon.ai/claim/${agent.id}\n`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("404") || message.includes("not found")) {
      console.log("━".repeat(50));
      console.log("Agent Status (Local)");
      console.log("━".repeat(50));
      console.log(`  ID:        ${config.agentId}`);
      console.log(`  Gateway:   ${config.gateway || "https://gateway.mnemon.ai"}`);
      console.log(`  Status:    Not yet registered`);
      console.log("━".repeat(50));
      console.log("\n💡 The agent will be registered on first API request.\n");
      console.log("Make sure ANTHROPIC_BASE_URL is set correctly:\n");
      console.log(
        `  export ANTHROPIC_BASE_URL="${config.gateway || "https://gateway.mnemon.ai"}/v1/proxy/${config.agentId}"\n`
      );
    } else {
      console.log(`\n✗ Failed to fetch agent status: ${message}\n`);
      process.exit(1);
    }
  }
}
