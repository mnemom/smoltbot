import * as crypto from "node:crypto";
import { configExists, loadConfig } from "../lib/config.js";
import { detectOpenClaw } from "../lib/openclaw.js";
import { claimAgent } from "../lib/api.js";

const DASHBOARD_URL = "https://mnemom.ai";

export async function claimCommand(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("  smoltbot claim - Link agent to your Mnemom account");
  console.log("=".repeat(60) + "\n");

  // Step 1: Check smoltbot config exists
  if (!configExists()) {
    console.log("✗ smoltbot is not initialized\n");
    console.log("Run `smoltbot init` first.\n");
    process.exit(1);
  }

  const config = loadConfig();
  if (!config) {
    console.log("✗ Could not load smoltbot config\n");
    console.log("Run `smoltbot init` to reconfigure.\n");
    process.exit(1);
  }

  console.log(`Agent ID: ${config.agentId}\n`);

  // Step 2: Read API key from OpenClaw
  const detection = detectOpenClaw();
  if (!detection.hasApiKey || !detection.apiKey) {
    console.log("✗ No API key found\n");
    console.log(detection.error || "Run `openclaw auth` to configure your API key.\n");
    process.exit(1);
  }

  // Step 3: Compute SHA-256 hash proof
  console.log("Computing ownership proof...");
  const hashProof = crypto
    .createHash("sha256")
    .update(detection.apiKey)
    .digest("hex");

  // Step 4: Claim via API
  console.log("Claiming agent...\n");

  try {
    const result = await claimAgent(config.agentId, hashProof);

    console.log("✓ Agent claimed successfully!\n");
    console.log(`  Claimed at: ${new Date(result.claimed_at).toLocaleString()}\n`);
    console.log("─".repeat(50));
    console.log("\nNext: Create a Mnemom account to link your agent\n");
    console.log(`  Visit: ${DASHBOARD_URL}/claim/${config.agentId}\n`);
    console.log("  This lets you manage traces privately and access");
    console.log("  your full transparency dashboard.\n");
    console.log("─".repeat(50));
    console.log(`\nDashboard: ${DASHBOARD_URL}/agents/${config.agentId}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("already been claimed")) {
      console.log("Agent has already been claimed.\n");
      console.log(`  Dashboard: ${DASHBOARD_URL}/agents/${config.agentId}\n`);
      console.log("  If this is your agent, sign in at:");
      console.log(`  ${DASHBOARD_URL}/login\n`);
    } else if (message.includes("not found")) {
      console.log("✗ Agent not found on server\n");
      console.log("  Your agent will be registered after its first traced API call.");
      console.log("  Make sure you're using a smoltbot model:\n");
      console.log("  openclaw models set smoltbot/<model-id>\n");
    } else {
      console.log(`✗ Claim failed: ${message}\n`);
    }

    process.exit(1);
  }
}
