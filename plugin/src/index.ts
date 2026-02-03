import { getConfig, getAgentUrl } from './config.js';
import { initializeApi, flushTraceQueue, getApiEndpoint } from './api.js';
import { clearPendingTraces } from './trace.js';

export type { AAPTrace, TraceMetadata, PendingTrace } from './trace.js';
export type { SmoltbotConfig, StoredConfig } from './config.js';
export type { HookEvent, HookHandler, HookContext, HookHandlerResult } from './types.js';

/**
 * OpenClaw plugin API interface
 */
interface OpenClawPluginApi {
  on(event: string, handler: (...args: unknown[]) => void): void;
  // Other methods may exist but we only need 'on'
}

/**
 * Plugin state
 */
let initialized = false;

/**
 * Register function called by OpenClaw
 *
 * This is the main entry point. OpenClaw calls this with its plugin API.
 *
 * Hooks are automatically loaded from the directory specified in openclaw.plugin.json
 * ("hooks": "dist/hooks"). This function just initializes the API client.
 *
 * Zero-config design:
 * - Reads agent ID from ~/.smoltbot/config.json (created by `smoltbot init`)
 * - Posts traces to https://api.mnemom.ai/v1/traces automatically
 * - No credentials needed from the user
 */
export default function register(api: OpenClawPluginApi): void {
  const config = getConfig();

  if (!config) {
    console.log('[smoltbot] No agent ID found. Run "smoltbot init" to get started.');
    return;
  }

  if (!config.enabled) {
    console.log('[smoltbot] Tracing disabled via SMOLTBOT_ENABLED=false');
    return;
  }

  // Initialize the API client with batching config
  initializeApi({
    batchSize: config.batchSize,
    timeout: config.timeout,
  });

  // Register shutdown handler to flush pending traces
  api.on('gateway:shutdown', async () => {
    await shutdown();
  });

  initialized = true;
  console.log(`[smoltbot] Tracing enabled for agent: ${config.agentId}`);
  console.log(`[smoltbot] Dashboard: ${getAgentUrl(config.agentId)}`);
  console.log(`[smoltbot] API: ${getApiEndpoint()}`);
}

/**
 * Shutdown the plugin gracefully
 */
async function shutdown(): Promise<void> {
  if (!initialized) {
    return;
  }

  // Flush any remaining traces
  await flushTraceQueue();

  // Clear pending traces
  clearPendingTraces();

  initialized = false;
  console.log('[smoltbot] Shutdown complete');
}

/**
 * Export for manual initialization if needed
 */
export { shutdown, getConfig, flushTraceQueue, getApiEndpoint };
