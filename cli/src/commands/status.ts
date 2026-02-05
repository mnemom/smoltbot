import { configExists, loadConfig } from "../lib/config.js";
import { getAgent, getIntegrity, getTraces, API_BASE } from "../lib/api.js";
import {
  detectOpenClaw,
  getCurrentModel,
  getSmoltbotProvider,
} from "../lib/openclaw.js";
import { formatModelName } from "../lib/models.js";

const GATEWAY_URL = "https://gateway.mnemom.ai";
const DASHBOARD_URL = "https://mnemom.ai";

interface StatusCheckResult {
  name: string;
  status: "ok" | "warning" | "error";
  message: string;
  details?: string;
}

export async function statusCommand(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("  smoltbot status");
  console.log("=".repeat(60) + "\n");

  const checks: StatusCheckResult[] = [];

  // 1. Check smoltbot config
  const configCheck = checkSmoltbotConfig();
  checks.push(configCheck);

  if (configCheck.status === "error") {
    printChecks(checks);
    console.log("\nRun `smoltbot init` to get started.\n");
    process.exit(1);
  }

  const config = loadConfig()!;

  // 2. Check OpenClaw configuration
  const openclawCheck = checkOpenClawConfig();
  checks.push(openclawCheck);

  // 3. Check current model
  const modelCheck = checkCurrentModel();
  checks.push(modelCheck);

  // 4. Test gateway connectivity
  const gatewayCheck = await checkGatewayConnectivity();
  checks.push(gatewayCheck);

  // 5. Test API connectivity
  const apiCheck = await checkApiConnectivity(config.agentId);
  checks.push(apiCheck);

  // Print all checks
  printChecks(checks);

  // Show configuration details
  console.log("\n" + "─".repeat(50));
  console.log("Configuration");
  console.log("─".repeat(50) + "\n");

  console.log(`Agent ID:  ${config.agentId}`);
  console.log(`Gateway:   ${config.gateway || GATEWAY_URL}`);
  console.log(`Dashboard: ${DASHBOARD_URL}/agents/${config.agentId}`);

  if (config.openclawConfigured) {
    console.log(`Configured: ${config.configuredAt || "yes"}`);
  }

  // Show current model info
  const { fullPath, provider, modelId } = getCurrentModel();
  if (fullPath) {
    console.log(`\nCurrent Model: ${fullPath}`);
    if (modelId) {
      console.log(`  (${formatModelName(modelId)})`);
    }
    if (provider === "smoltbot") {
      console.log("  Status: Traced mode ACTIVE");
    } else {
      console.log("  Status: Traced mode NOT ACTIVE");
      console.log(`\n  To enable: openclaw models set smoltbot/${modelId}`);
    }
  }

  // Show trace summary if available
  if (apiCheck.status === "ok") {
    await showTraceSummary(config.agentId);
  }

  // Show overall status
  const hasErrors = checks.some((c) => c.status === "error");
  const hasWarnings = checks.some((c) => c.status === "warning");

  console.log("\n" + "=".repeat(60));
  if (hasErrors) {
    console.log("  Status: ISSUES DETECTED");
    console.log("\n  Fix the errors above to ensure tracing works correctly.");
  } else if (hasWarnings) {
    console.log("  Status: OK (with warnings)");
  } else {
    console.log("  Status: ALL SYSTEMS GO");
  }
  console.log("=".repeat(60) + "\n");
}

function checkSmoltbotConfig(): StatusCheckResult {
  if (!configExists()) {
    return {
      name: "Smoltbot Config",
      status: "error",
      message: "Not initialized",
      details: "Run `smoltbot init` to configure",
    };
  }

  const config = loadConfig();
  if (!config) {
    return {
      name: "Smoltbot Config",
      status: "error",
      message: "Config file corrupted",
      details: "Delete ~/.smoltbot/config.json and run `smoltbot init`",
    };
  }

  return {
    name: "Smoltbot Config",
    status: "ok",
    message: `Agent ID: ${config.agentId}`,
  };
}

function checkOpenClawConfig(): StatusCheckResult {
  const detection = detectOpenClaw();

  if (!detection.installed) {
    return {
      name: "OpenClaw",
      status: "error",
      message: "Not installed",
      details: "Install from https://openclaw.ai",
    };
  }

  if (!detection.hasApiKey) {
    if (detection.isOAuth) {
      return {
        name: "OpenClaw",
        status: "error",
        message: "OAuth auth (not supported)",
        details: "smoltbot requires API key authentication",
      };
    }
    return {
      name: "OpenClaw",
      status: "error",
      message: "No API key configured",
      details: "Run `openclaw auth` to add your API key",
    };
  }

  if (!detection.smoltbotAlreadyConfigured) {
    return {
      name: "OpenClaw",
      status: "warning",
      message: "smoltbot provider not configured",
      details: "Run `smoltbot init` to configure",
    };
  }

  return {
    name: "OpenClaw",
    status: "ok",
    message: "smoltbot provider configured",
  };
}

function checkCurrentModel(): StatusCheckResult {
  const { fullPath, provider, modelId } = getCurrentModel();

  if (!fullPath) {
    return {
      name: "Current Model",
      status: "warning",
      message: "No default model set",
      details: "Run `openclaw models set smoltbot/<model>`",
    };
  }

  if (provider === "smoltbot") {
    return {
      name: "Current Model",
      status: "ok",
      message: `${modelId} (traced)`,
    };
  }

  return {
    name: "Current Model",
    status: "warning",
    message: `${fullPath} (not traced)`,
    details: `Switch with: openclaw models set smoltbot/${modelId}`,
  };
}

async function checkGatewayConnectivity(): Promise<StatusCheckResult> {
  try {
    const response = await fetch(`${GATEWAY_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = (await response.json()) as { status?: string; version?: string };
      return {
        name: "Gateway",
        status: "ok",
        message: `Connected (v${data.version || "unknown"})`,
      };
    }

    return {
      name: "Gateway",
      status: "error",
      message: `HTTP ${response.status}`,
      details: "Gateway returned an error",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("timeout") || message.includes("TIMEOUT")) {
      return {
        name: "Gateway",
        status: "error",
        message: "Connection timeout",
        details: "Check your network connection",
      };
    }

    return {
      name: "Gateway",
      status: "error",
      message: "Connection failed",
      details: message,
    };
  }
}

async function checkApiConnectivity(agentId: string): Promise<StatusCheckResult> {
  try {
    const agent = await getAgent(agentId);

    if (agent) {
      return {
        name: "API",
        status: "ok",
        message: "Agent registered",
      };
    }

    return {
      name: "API",
      status: "warning",
      message: "Agent not yet registered",
      details: "Will register on first traced API call",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("404") || message.includes("not found")) {
      return {
        name: "API",
        status: "warning",
        message: "Agent not yet registered",
        details: "Will register on first traced API call",
      };
    }

    if (message.includes("timeout") || message.includes("TIMEOUT")) {
      return {
        name: "API",
        status: "error",
        message: "Connection timeout",
        details: "Check your network connection",
      };
    }

    return {
      name: "API",
      status: "error",
      message: "Connection failed",
      details: message,
    };
  }
}

async function showTraceSummary(agentId: string): Promise<void> {
  try {
    const [integrityResult, tracesResult] = await Promise.allSettled([
      getIntegrity(agentId),
      getTraces(agentId, 1),
    ]);

    console.log("\n" + "─".repeat(50));
    console.log("Trace Summary");
    console.log("─".repeat(50) + "\n");

    if (integrityResult.status === "fulfilled") {
      const integrity = integrityResult.value;
      const score = (integrity.score * 100).toFixed(1);
      console.log(`Integrity Score: ${score}%`);
      console.log(`Total Traces:    ${integrity.total_traces}`);
      console.log(`Verified:        ${integrity.verified}`);
      if (integrity.violations > 0) {
        console.log(`Violations:      ${integrity.violations}`);
      }
    } else {
      console.log("Integrity: No data yet");
    }

    if (tracesResult.status === "fulfilled" && tracesResult.value.length > 0) {
      const lastTrace = tracesResult.value[0];
      const lastTime = new Date(lastTrace.timestamp).toLocaleString();
      console.log(`\nLast Activity:   ${lastTime}`);
    } else {
      console.log("\nLast Activity:   None");
    }
  } catch {
    // Silently skip if we can't get trace info
  }
}

function printChecks(checks: StatusCheckResult[]): void {
  console.log("System Checks");
  console.log("─".repeat(50) + "\n");

  for (const check of checks) {
    const icon =
      check.status === "ok" ? "✓" : check.status === "warning" ? "⚠" : "✗";
    const color =
      check.status === "ok"
        ? ""
        : check.status === "warning"
          ? ""
          : "";

    console.log(`${icon} ${check.name}: ${check.message}`);
    if (check.details) {
      console.log(`    ${check.details}`);
    }
  }
}
