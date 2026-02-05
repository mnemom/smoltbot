import { configExists, loadConfig } from "../lib/config.js";
import { getIntegrity } from "../lib/api.js";

export async function integrityCommand(): Promise<void> {
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

  console.log("\n🔍 Fetching integrity score...\n");

  try {
    const integrity = await getIntegrity(config.agentId);

    const scorePercent = (integrity.score * 100).toFixed(1);
    const scoreBar = generateScoreBar(integrity.score);

    console.log("━".repeat(50));
    console.log("Integrity Score");
    console.log("━".repeat(50));
    console.log(`  Score:      ${scorePercent}% ${scoreBar}`);
    console.log(`  Total:      ${integrity.total_traces} traces`);
    console.log(`  Verified:   ${integrity.verified} ✓`);
    console.log(`  Violations: ${integrity.violations} ✗`);
    console.log(`  Updated:    ${integrity.last_updated}`);
    console.log("━".repeat(50));

    if (integrity.violations > 0) {
      console.log("\n⚠️  You have integrity violations. Run `smoltbot logs` to investigate.\n");
    } else if (integrity.total_traces === 0) {
      console.log("\n💡 No traces recorded yet. Start using Claude to build your integrity score.\n");
    } else {
      console.log("\n✓ Your agent has a clean integrity record!\n");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("404") || message.includes("not found")) {
      console.log("━".repeat(50));
      console.log("Integrity Score");
      console.log("━".repeat(50));
      console.log("  Score:      N/A");
      console.log("  Total:      0 traces");
      console.log("  Verified:   0 ✓");
      console.log("  Violations: 0 ✗");
      console.log("━".repeat(50));
      console.log("\n💡 No traces recorded yet. Start using Claude to build your integrity score.\n");
    } else {
      console.log(`\n✗ Failed to fetch integrity score: ${message}\n`);
      process.exit(1);
    }
  }
}

function generateScoreBar(score: number): string {
  const filled = Math.round(score * 10);
  const empty = 10 - filled;
  const filledChar = "█";
  const emptyChar = "░";

  return `[${filledChar.repeat(filled)}${emptyChar.repeat(empty)}]`;
}
