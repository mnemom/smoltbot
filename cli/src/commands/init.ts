import {
  configExists,
  loadConfig,
  saveConfig,
  generateAgentId,
  type Config,
} from "../lib/config.js";

export async function initCommand(): Promise<void> {
  // Check if already initialized
  if (configExists()) {
    const existingConfig = loadConfig();
    if (existingConfig) {
      console.log("\n⚠️  smoltbot is already initialized\n");
      console.log(`Agent ID: ${existingConfig.agentId}`);
      console.log(
        `Gateway:  ${existingConfig.gateway || "https://gateway.mnemon.ai"}\n`
      );
      console.log("To reinitialize, delete ~/.smoltbot/config.json first\n");
      return;
    }
  }

  // Generate new agent ID
  const agentId = generateAgentId();
  const gateway = "https://gateway.mnemom.ai";

  const config: Config = {
    agentId,
    gateway,
  };

  saveConfig(config);

  console.log("\n✓ smoltbot initialized!\n");
  console.log("━".repeat(50));
  console.log(`Agent ID: ${agentId}`);
  console.log(`Gateway:  ${gateway}`);
  console.log("━".repeat(50));

  console.log("\n📋 Setup Instructions:\n");
  console.log("Add this to your shell profile (~/.bashrc or ~/.zshrc):\n");
  console.log(
    `  export ANTHROPIC_BASE_URL="${gateway}/anthropic"\n`
  );
  console.log("Then reload your shell:\n");
  console.log("  source ~/.zshrc  # or source ~/.bashrc\n");

  console.log("━".repeat(50));
  console.log("\n🔗 Links:\n");
  console.log(`  Dashboard: https://mnemom.ai/agents/${agentId}`);
  console.log(`  Claim:     https://mnemom.ai/claim/${agentId}\n`);

  console.log(
    "Your agent is identified by your API key hash - no additional config needed!\n"
  );
}
