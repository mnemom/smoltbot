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
  detectProviders,
  configureSmoltbotProviders,
  configureSmoltbotProviderForType,
  setDefaultModel,
  getCurrentModel,
  PROVIDER_CONFIG_KEYS,
  type Provider,
  type ModelDefinition,
  type ProviderDetectionResult,
} from "../lib/openclaw.js";
import {
  detectProvider,
  getModelDefinition,
  isAnthropicModel,
  formatModelName,
  MODEL_REGISTRY,
  getLatestModels,
} from "../lib/models.js";
import { refreshModelCache } from "../lib/model-cache.js";
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
  const detection = detectProviders();

  if (!detection.installed) {
    console.log("✗ OpenClaw not found\n");
    console.log(detection.error || "OpenClaw is not installed.");
    console.log("\nInstall OpenClaw first: https://openclaw.ai\n");
    process.exit(1);
  }
  console.log("✓ OpenClaw installation detected\n");

  // Step 3: Scan all providers for API keys
  const availableProviders: { provider: Provider; apiKey: string }[] = [];
  const providerLabels: Record<Provider, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    gemini: "Gemini",
  };

  for (const provider of ["anthropic", "openai", "gemini"] as Provider[]) {
    const info = detection.providers[provider];
    if (info.isOAuth) {
      console.log(`  ${providerLabels[provider]}: OAuth detected (not supported, skipping)`);
    } else if (info.invalidFormat) {
      console.log(`  ${providerLabels[provider]}: Invalid API key format (skipping)`);
    } else if (info.hasApiKey && info.apiKey) {
      console.log(`✓ ${providerLabels[provider]} API key found`);
      availableProviders.push({ provider, apiKey: info.apiKey });
    } else {
      console.log(`  ${providerLabels[provider]}: No API key found`);
    }
  }
  console.log();

  // Step 3b: Require at least one provider to have an API key
  if (availableProviders.length === 0) {
    console.log("✗ No provider API keys found\n");
    console.log("smoltbot requires at least one provider API key.");
    console.log("Configure API keys in OpenClaw:\n");
    console.log("  Anthropic: https://console.anthropic.com/settings/keys");
    console.log("  OpenAI:    https://platform.openai.com/api-keys");
    console.log("  Gemini:    https://aistudio.google.com/apikey\n");
    console.log("Then run `openclaw auth` to add your key(s).\n");
    process.exit(1);
  }

  console.log(`  ${availableProviders.length} provider(s) with API keys\n`);

  // Step 3c: Verify each provider's API key
  const verifiedProviders: { provider: Provider; apiKey: string }[] = [];

  for (const { provider, apiKey } of availableProviders) {
    console.log(`Verifying ${providerLabels[provider]} API key...`);
    const verification = await verifyProviderApiKey(provider, apiKey);
    if (!verification.valid) {
      console.log(`  ✗ ${verification.error} (skipping ${providerLabels[provider]})\n`);
    } else {
      console.log(`✓ ${providerLabels[provider]} API key verified\n`);
      verifiedProviders.push({ provider, apiKey });
    }
  }

  if (verifiedProviders.length === 0) {
    console.log("✗ No valid API keys found\n");
    console.log("All detected API keys failed verification.");
    console.log("Check your API keys and try again.\n");
    process.exit(1);
  }

  // Step 4: Detect current model
  const { modelId, provider: currentProvider } = parseCurrentModel(detection);

  if (!modelId) {
    console.log("✗ No default model configured in OpenClaw\n");
    console.log("Configure a default model first:");
    console.log("  openclaw models set anthropic/claude-opus-4-5-20251101\n");
    process.exit(1);
  }

  console.log(`✓ Current model: ${currentProvider}/${modelId}`);
  console.log(`  (${formatModelName(modelId)})\n`);

  // Step 5: Determine models to add per provider
  const verifiedProviderSet = new Set(verifiedProviders.map((p) => p.provider));
  const modelsPerProvider = determineModelsToAdd(modelId, detection, verifiedProviderSet);

  console.log("Models to configure for smoltbot providers:");
  for (const [provider, models] of Object.entries(modelsPerProvider) as [Provider, ModelDefinition[]][]) {
    if (models.length === 0) continue;
    const configKey = PROVIDER_CONFIG_KEYS[provider];
    for (const model of models) {
      console.log(`  - ${configKey}/${model.id} (${model.name})`);
    }
  }
  console.log();

  // Step 6: Configure all providers that have verified keys
  const alreadyConfigured = detection.smoltbotConfiguredProviders;
  if (alreadyConfigured.length > 0 && !options.force) {
    const configuredNames = alreadyConfigured.map((p) => providerLabels[p]).join(", ");
    console.log(`⚠ smoltbot already configured for: ${configuredNames}\n`);
    if (isInteractive() && !options.yes) {
      const reconfigure = await askYesNo("Reconfigure smoltbot providers?", true);
      if (!reconfigure) {
        console.log("\nKeeping existing configuration.\n");
        // Still create/update smoltbot config
        const firstApiKey = verifiedProviders[0]?.apiKey;
        const agentId = await createSmoltbotConfig(existingConfig, firstApiKey);
        showSuccessMessage(agentId, modelId, currentProvider, verifiedProviders.map((p) => p.provider), modelsPerProvider);
        return;
      }
    }
    console.log("Reconfiguring smoltbot providers...\n");
  }

  console.log("Configuring smoltbot providers in OpenClaw...");

  const providerKeys: Partial<Record<Provider, { apiKey: string; models: ModelDefinition[] }>> = {};
  for (const { provider, apiKey } of verifiedProviders) {
    const models = modelsPerProvider[provider] || [];
    if (models.length > 0) {
      providerKeys[provider] = { apiKey, models };
    }
  }

  const configuredProviders = configureSmoltbotProviders(providerKeys);
  for (const provider of configuredProviders) {
    console.log(`✓ ${providerLabels[provider]} provider configured (${PROVIDER_CONFIG_KEYS[provider]})`);
  }
  console.log();

  // Step 7: Offer to switch default model (showing options from all configured providers)
  const modelProvider = detectProvider(modelId);
  const smoltbotConfigKey = modelProvider ? PROVIDER_CONFIG_KEYS[modelProvider] : PROVIDER_CONFIG_KEYS.anthropic;
  const smoltbotModelPath = `${smoltbotConfigKey}/${modelId}`;
  const alreadyUsingSmoltbot = currentProvider !== null &&
    Object.values(PROVIDER_CONFIG_KEYS).includes(currentProvider);

  let shouldSwitch = false;
  if (!alreadyUsingSmoltbot) {
    shouldSwitch = await promptModelSwitch(
      modelId,
      currentProvider,
      smoltbotModelPath,
      configuredProviders,
      modelsPerProvider,
      options
    );

    if (shouldSwitch) {
      console.log(`Setting default model to ${smoltbotModelPath}...`);
      setDefaultModel(smoltbotModelPath);
      console.log(`✓ Default model set to ${smoltbotModelPath}\n`);
    } else {
      console.log(`Default model unchanged (${currentProvider}/${modelId})\n`);
      console.log("To enable traced mode later:");
      console.log(`  openclaw models set ${smoltbotModelPath}\n`);
    }
  }

  // Step 8: Create smoltbot config (use first available API key for agent ID derivation)
  const firstApiKey = verifiedProviders[0]?.apiKey;
  const agentId = await createSmoltbotConfig(existingConfig, firstApiKey);

  // Step 9: Show success with all configured providers listed
  const tracedModeActive = shouldSwitch || alreadyUsingSmoltbot;
  showSuccessMessage(agentId, modelId, currentProvider, configuredProviders, modelsPerProvider, tracedModeActive);

  // Trigger model cache refresh in background (non-blocking)
  refreshModelCache().catch(() => {
    // Silently ignore cache refresh errors
  });
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
 * Parse the current model from detection results.
 * Handles all providers (not just Anthropic).
 */
function parseCurrentModel(detection: ProviderDetectionResult): {
  modelId: string | null;
  provider: string | null;
} {
  let modelId = detection.currentModelId || null;
  let provider = detection.currentProvider || null;

  // If current model is already a smoltbot provider, keep the underlying model ID
  if (provider && Object.values(PROVIDER_CONFIG_KEYS).includes(provider)) {
    // The model is already using a smoltbot provider, that's fine
    // modelId should be the actual model ID
  } else if (!provider && modelId) {
    // No provider prefix — detect from model ID
    const detected = detectProvider(modelId);
    provider = detected || "anthropic"; // fall back to anthropic for backward compat
  }

  return { modelId, provider };
}

/**
 * Determine which models to add per provider.
 * Returns a record mapping each provider to its list of model definitions.
 */
function determineModelsToAdd(
  currentModelId: string,
  detection: ProviderDetectionResult,
  verifiedProviders: Set<Provider>
): Record<Provider, ModelDefinition[]> {
  const result: Record<Provider, ModelDefinition[]> = {
    anthropic: [],
    openai: [],
    gemini: [],
  };

  const latestModels = getLatestModels();

  // For each verified provider, add its latest models
  for (const provider of verifiedProviders) {
    const addedIds = new Set<string>();
    const models: ModelDefinition[] = [];

    // If the current model belongs to this provider, ensure it's included first
    const currentModelProvider = detectProvider(currentModelId);
    if (currentModelProvider === provider) {
      const modelDef = getModelDefinition(currentModelId);
      models.push(modelDef);
      addedIds.add(currentModelId);
    }

    // Add latest models for this provider
    for (const model of latestModels[provider]) {
      if (!addedIds.has(model.id)) {
        models.push(model);
        addedIds.add(model.id);
      }
    }

    result[provider] = models;
  }

  return result;
}

/**
 * Prompt user to switch default model.
 * Now shows options from all configured providers.
 */
async function promptModelSwitch(
  modelId: string,
  currentProvider: string | null,
  smoltbotModelPath: string,
  configuredProviders: Provider[],
  modelsPerProvider: Record<Provider, ModelDefinition[]>,
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
  console.log(`  Traced:   ${smoltbotModelPath}\n`);
  console.log("When using smoltbot models, all API calls are logged for");
  console.log("transparency and alignment verification.\n");

  if (configuredProviders.length > 1) {
    console.log("Available traced models across providers:");
    const providerLabels: Record<Provider, string> = {
      anthropic: "Anthropic",
      openai: "OpenAI",
      gemini: "Gemini",
    };
    for (const provider of configuredProviders) {
      const models = modelsPerProvider[provider] || [];
      if (models.length > 0) {
        const configKey = PROVIDER_CONFIG_KEYS[provider];
        console.log(`  ${providerLabels[provider]}:`);
        for (const model of models) {
          console.log(`    openclaw models set ${configKey}/${model.id}`);
        }
      }
    }
    console.log();
  }

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
 * Show success message with all configured providers listed.
 */
function showSuccessMessage(
  agentId: string,
  modelId: string,
  currentProvider: string | null,
  configuredProviders: Provider[],
  modelsPerProvider: Record<Provider, ModelDefinition[]>,
  switched: boolean = true
): void {
  const providerLabels: Record<Provider, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    gemini: "Gemini",
  };

  console.log("=".repeat(60));
  console.log("  smoltbot initialized successfully!");
  console.log("=".repeat(60) + "\n");

  console.log(`Agent ID: ${agentId}\n`);

  // List all configured providers
  console.log("Configured providers:");
  for (const provider of configuredProviders) {
    const configKey = PROVIDER_CONFIG_KEYS[provider];
    const models = modelsPerProvider[provider] || [];
    const modelNames = models.map((m) => m.name).join(", ");
    console.log(`  ✓ ${providerLabels[provider]} (${configKey}) — ${modelNames}`);
  }
  console.log();

  if (switched) {
    console.log("✓ Traced mode is now active\n");
    console.log("All OpenClaw API calls will be traced. Your traces will");
    console.log("appear at:\n");
  } else {
    console.log("Traced mode is ready but not active.\n");
    const modelProvider = detectProvider(modelId);
    const tracedConfigKey = modelProvider ? PROVIDER_CONFIG_KEYS[modelProvider] : PROVIDER_CONFIG_KEYS.anthropic;
    console.log("To enable traced mode, run:");
    console.log(`  openclaw models set ${tracedConfigKey}/${modelId}\n`);
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

  // Show switch commands for all configured providers
  for (const provider of configuredProviders) {
    const configKey = PROVIDER_CONFIG_KEYS[provider];
    const models = modelsPerProvider[provider] || [];
    if (models.length > 0) {
      const firstModel = models[0];
      console.log(`  Traced (${providerLabels[provider]}):   openclaw models set ${configKey}/${firstModel.id}`);
      console.log(`  Untraced (${providerLabels[provider]}): openclaw models set ${provider}/${firstModel.id}`);
    }
  }
  console.log();
}

/**
 * Verify an API key for a given provider.
 * Dispatches to provider-specific verification logic.
 * Fail-open: network errors and 5xx responses don't block init.
 */
async function verifyProviderApiKey(
  provider: Provider,
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  switch (provider) {
    case "anthropic":
      return verifyAnthropicApiKey(apiKey);
    case "openai":
      return verifyOpenAIApiKey(apiKey);
    case "gemini":
      return verifyGeminiApiKey(apiKey);
    default:
      return { valid: true };
  }
}

/**
 * Verify an Anthropic API key by making a minimal API call.
 * Fail-open: network errors and 5xx responses don't block init.
 */
async function verifyAnthropicApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
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
        error: "Anthropic API key is invalid or has been revoked.",
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

/**
 * Verify an OpenAI API key by making a minimal API call.
 * Fail-open: network errors and 5xx responses don't block init.
 */
async function verifyOpenAIApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
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
        error: "OpenAI API key is invalid or has been revoked.",
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

/**
 * Verify a Gemini API key by making a minimal API call.
 * Fail-open: network errors and 5xx responses don't block init.
 */
async function verifyGeminiApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "hi" }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
        signal: AbortSignal.timeout(10000),
      }
    );

    if (response.ok || response.status === 429) {
      return { valid: true };
    }

    if (response.status === 400 || response.status === 401 || response.status === 403) {
      return {
        valid: false,
        error: "Gemini API key is invalid or has been revoked.",
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
