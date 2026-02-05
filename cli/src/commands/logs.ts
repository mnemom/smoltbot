import { configExists, loadConfig } from "../lib/config.js";
import { getTraces, type Trace } from "../lib/api.js";

export interface LogsOptions {
  limit?: number;
}

export async function logsCommand(options: LogsOptions = {}): Promise<void> {
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

  const limit = options.limit || 10;

  console.log("\n🔍 Fetching traces...\n");

  try {
    const traces = await getTraces(config.agentId, limit);

    if (traces.length === 0) {
      console.log("━".repeat(60));
      console.log("No traces found");
      console.log("━".repeat(60));
      console.log("\n💡 Start using Claude to generate traces.\n");
      console.log("Make sure ANTHROPIC_BASE_URL is set correctly:\n");
      console.log(
        `  export ANTHROPIC_BASE_URL="${config.gateway || "https://gateway.mnemon.ai"}/v1/proxy/${config.agentId}"\n`
      );
      return;
    }

    console.log("━".repeat(60));
    console.log(`Recent Traces (${traces.length})`);
    console.log("━".repeat(60));

    for (const trace of traces) {
      displayTrace(trace);
    }

    console.log("━".repeat(60));
    console.log(`\n💡 View more: smoltbot logs --limit ${limit + 10}\n`);
    console.log(`📊 Dashboard: https://mnemon.ai/dashboard/${config.agentId}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("404") || message.includes("not found")) {
      console.log("━".repeat(60));
      console.log("No traces found");
      console.log("━".repeat(60));
      console.log("\n💡 Start using Claude to generate traces.\n");
    } else {
      console.log(`\n✗ Failed to fetch traces: ${message}\n`);
      process.exit(1);
    }
  }
}

function displayTrace(trace: Trace): void {
  const timestamp = formatTimestamp(trace.timestamp);
  const status = trace.verified ? "✓" : "✗";
  const statusColor = trace.verified ? "" : " [VIOLATION]";

  console.log(`\n  ${timestamp} ${status}${statusColor}`);
  console.log(`  Action: ${trace.action}`);

  if (trace.tool_name) {
    console.log(`  Tool:   ${trace.tool_name}`);
  }

  if (trace.reasoning) {
    const preview = truncate(trace.reasoning, 60);
    console.log(`  Reason: ${preview}`);
  }
}

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function truncate(text: string, maxLength: number): string {
  const cleaned = text.replace(/\n/g, " ").trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return cleaned.slice(0, maxLength - 3) + "...";
}
