import {
  configExists,
  loadConfig,
  saveConfig,
  generateAgentId,
  deriveAgentId,
  type Config,
} from "../lib/config.js";
import {
  detectOpenClaw,
  configureSmoltbotProvider,
  setDefaultModel,
  getCurrentModel,
  type ModelDefinition,
} from "../lib/openclaw.js";
import {
  getModelDefinition,
  isAnthropicModel,
  formatModelName,
} from "../lib/models.js";
import { askYesNo, isInteractive } from "../lib/prompt.js";

const GATEWAY_URL = "https://gateway.mnemom.ai";
const DASHBOARD_URL = "https://mnemom.ai";

export interface InitOptions {
  yes?: boolean; // Skip confirmation prompts
  force?: boolean; // Force reconfiguration even if already configured
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("  smoltbot init - Transparent AI Agent Tracing");
  console.log("=".repeat(60) + "\n");

  // Step 1: Check for existing smoltbot config
  const existingConfig = await handleExistingConfig(options);
  if (existingConfig === "abort") {
    return;
  }

  // Step 2: Detect OpenClaw installation
  console.log("Detecting OpenClaw installation...\n");
  const detection = detectOpenClaw();

  if (!detection.installed) {
    console.log("✗ OpenClaw not found\n");
    console.log(detection.error || "OpenClaw is not installed.");
    console.log("\nInstall OpenClaw first: https://openclaw.ai\n");
    process.exit(1);
  }
  console.log("✓ OpenClaw installation detected\n");

  // Step 3: Check auth method
  if (detection.isOAuth) {
    console.log("✗ OAuth authentication detected\n");
    console.log(
      "smoltbot only supports API key authentication (not OAuth).\n"
    );
    console.log("To use smoltbot:");
    console.log("  1. Get an API key from https://console.anthropic.com");
    console.log("  2. Run `openclaw auth` and add your API key\n");
    process.exit(1);
  }

  if (!detection.hasApiKey || !detection.apiKey) {
    console.log("✗ No Anthropic API key found\n");
    console.log(detection.error || "No API key in auth-profiles.json.");
    console.log("\nTo configure your API key:");
    console.log("  Run `openclaw auth`\n");
    process.exit(1);
  }
  console.log("✓ Anthropic API key found in auth-profiles.json\n");
  console.log("  Note: Only API key auth is supported (not OAuth)\n");

  // Step 3b: Verify API key works with Anthropic
  console.log("Verifying API key with Anthropic...");
  const verification = await verifyApiKey(detection.apiKey);
  if (!verification.valid) {
    console.log(`\n✗ ${verification.error}\n`);
    console.log("Get a valid API key from https://console.anthropic.com/settings/keys\n");
    process.exit(1);
  }
  console.log("✓ API key verified\n");

  // Step 4: Detect current model
  const { modelId, provider } = parseCurrentModel(detection);

  if (!modelId) {
    console.log("✗ No default model configured in OpenClaw\n");
    console.log("Configure a default model first:");
    console.log("  openclaw models set anthropic/claude-opus-4-5-20251101\n");
    process.exit(1);
  }

  console.log(`✓ Current model: ${provider}/${modelId}`);
  console.log(`  (${formatModelName(modelId)})\n`);

  // Step 5: Determine models to configure
  const modelsToAdd = determineModelsToAdd(modelId, detection);
  console.log("Models to configure for smoltbot provider:");
  for (const model of modelsToAdd) {
    console.log(`  - smoltbot/${model.id} (${model.name})`);
  }
  console.log();

  // Step 6: Configure smoltbot provider
  if (detection.smoltbotAlreadyConfigured && !options.force) {
    console.log("⚠ smoltbot provider already exists in OpenClaw config\n");
    if (isInteractive() && !options.yes) {
      const reconfigure = await askYesNo("Reconfigure smoltbot provider?", true);
      if (!reconfigure) {
        console.log("\nKeeping existing configuration.\n");
        // Still create/update smoltbot config
        const agentId = await createSmoltbotConfig(existingConfig, detection.apiKey);
        showSuccessMessage(agentId, modelId);
        return;
      }
    }
    console.log("Reconfiguring smoltbot provider...\n");
  }

  console.log("Configuring smoltbot provider in OpenClaw...");
  configureSmoltbotProvider(detection.apiKey, modelsToAdd);
  console.log("✓ smoltbot provider configured\n");

  // Step 7: Offer to switch default model
  const smoltbotModelPath = `smoltbot/${modelId}`;
  const alreadyUsingSmoltbot = provider === "smoltbot";

  let shouldSwitch = false;
  if (!alreadyUsingSmoltbot) {
    shouldSwitch = await promptModelSwitch(
      modelId,
      provider,
      options
    );

    if (shouldSwitch) {
      console.log(`Setting default model to ${smoltbotModelPath}...`);
      setDefaultModel(smoltbotModelPath);
      console.log(`✓ Default model set to ${smoltbotModelPath}\n`);
    } else {
      console.log(`Default model unchanged (${provider}/${modelId})\n`);
      console.log("To enable traced mode later:");
      console.log(`  openclaw models set ${smoltbotModelPath}\n`);
    }
  }

  // Step 8: Create smoltbot config
  const agentId = await createSmoltbotConfig(existingConfig, detection.apiKey);

  // Step 9: Show success
  // Traced mode is active if we just switched OR if already using smoltbot
  const tracedModeActive = shouldSwitch || alreadyUsingSmoltbot;
  showSuccessMessage(agentId, modelId, tracedModeActive);
}

/**
 * Handle existing smoltbot config
 * Returns "abort" if user doesn't want to reconfigure, or the existing config
 */
async function handleExistingConfig(
  options: InitOptions
): Promise<Config | null | "abort"> {
  if (!configExists()) {
    return null;
  }

  const existingConfig = loadConfig();
  if (!existingConfig) {
    return null;
  }

  console.log("⚠ smoltbot is already initialized\n");
  console.log(`  Agent ID: ${existingConfig.agentId}`);
  console.log(`  Gateway:  ${existingConfig.gateway || GATEWAY_URL}\n`);

  if (options.force) {
    console.log("Reconfiguring (--force)...\n");
    return existingConfig;
  }

  if (isInteractive() && !options.yes) {
    const reconfigure = await askYesNo("Reconfigure smoltbot?", true);
    if (!reconfigure) {
      console.log("\nNo changes made.\n");
      return "abort";
    }
    console.log();
  }

  return existingConfig;
}

/**
 * Parse the current model from detection results
 */
function parseCurrentModel(detection: ReturnType<typeof detectOpenClaw>): {
  modelId: string | null;
  provider: string | null;
} {
  let modelId = detection.currentModelId || null;
  let provider = detection.currentProvider || null;

  // If current model is already smoltbot, get the underlying model
  if (provider === "smoltbot") {
    // The model is already using smoltbot, that's fine
    // modelId should be the actual model ID
  } else if (!provider && modelId) {
    // No provider prefix, assume anthropic
    provider = "anthropic";
  }

  return { modelId, provider };
}

/**
 * Determine which models to add to the smoltbot provider
 */
function determineModelsToAdd(
  currentModelId: string,
  detection: ReturnType<typeof detectOpenClaw>
): ModelDefinition[] {
  const models: ModelDefinition[] = [];
  const addedIds = new Set<string>();

  // Always add the current model
  if (currentModelId && isAnthropicModel(currentModelId)) {
    const modelDef = getModelDefinition(currentModelId);
    models.push(modelDef);
    addedIds.add(currentModelId);
  }

  // If smoltbot was already configured, preserve any additional models
  if (detection.smoltbotAlreadyConfigured) {
    const existingProvider = detection.smoltbotAlreadyConfigured;
    // We'd need to read the existing config here, but for simplicity
    // we just focus on the current model
  }

  return models;
}

/**
 * Prompt user to switch default model
 */
async function promptModelSwitch(
  modelId: string,
  currentProvider: string | null,
  options: InitOptions
): Promise<boolean> {
  // If --yes flag, default to switching
  if (options.yes) {
    return true;
  }

  // If non-interactive, default to switching
  if (!isInteractive()) {
    return true;
  }

  console.log("─".repeat(50));
  console.log("\nSwitch to traced mode now?");
  console.log(`  Current:  ${currentProvider}/${modelId}`);
  console.log(`  Traced:   smoltbot/${modelId}\n`);
  console.log("When using smoltbot models, all API calls are logged for");
  console.log("transparency and alignment verification.\n");

  return askYesNo("Switch to traced model?", true);
}

/**
 * Create or update smoltbot config
 */
async function createSmoltbotConfig(
  existingConfig: Config | null,
  apiKey?: string
): Promise<string> {
  const agentId = apiKey
    ? deriveAgentId(apiKey)
    : existingConfig?.agentId || generateAgentId();

  const config: Config = {
    agentId,
    gateway: GATEWAY_URL,
    openclawConfigured: true,
    configuredAt: new Date().toISOString(),
  };

  saveConfig(config);
  console.log("✓ Created ~/.smoltbot/config.json\n");

  return agentId;
}

/**
 * Show success message
 */
function showSuccessMessage(
  agentId: string,
  modelId: string,
  switched: boolean = true
): void {
  console.log("=".repeat(60));
  console.log("  smoltbot initialized successfully!");
  console.log("=".repeat(60) + "\n");

  console.log(`Agent ID: ${agentId}\n`);

  if (switched) {
    console.log("✓ Traced mode is now active\n");
    console.log("All OpenClaw API calls will be traced. Your traces will");
    console.log("appear at:\n");
  } else {
    console.log("Traced mode is ready but not active.\n");
    console.log("To enable traced mode, run:");
    console.log(`  openclaw models set smoltbot/${modelId}\n`);
    console.log("Once enabled, your traces will appear at:\n");
  }

  console.log(`  ${DASHBOARD_URL}/agents/${agentId}\n`);

  console.log("─".repeat(50));
  console.log("\nClaim your agent:\n");
  console.log("  smoltbot claim\n");
  console.log("  This links your agent to your Mnemom account so");
  console.log("  you can manage traces and keep your data private.\n");
  console.log(`  Or visit: ${DASHBOARD_URL}/claim/${agentId}\n`);

  console.log("─".repeat(50));
  console.log("\nUseful commands:\n");
  console.log("  smoltbot status     - Check configuration and connectivity");
  console.log("  smoltbot claim      - Claim agent and link to your account");
  console.log("  smoltbot logs       - View recent traces");
  console.log("  smoltbot integrity  - View integrity score\n");

  console.log("─".repeat(50));
  console.log("\nTo switch between traced and untraced mode:\n");
  console.log(`  Traced:   openclaw models set smoltbot/${modelId}`);
  console.log(`  Untraced: openclaw models set anthropic/${modelId}\n`);
}

/**
 * Verify an API key works with Anthropic by making a minimal API call.
 * Fail-open: network errors and 5xx responses don't block init.
 */
async function verifyApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok || response.status === 429) {
      return { valid: true };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        error: "API key is invalid or has been revoked.",
      };
    }

    // Other errors (500, etc.) — don't block init
    return { valid: true };
  } catch {
    // Network error or timeout — don't block init
    console.log("  Could not verify API key (network error). Proceeding anyway.\n");
    return { valid: true };
  }
}
