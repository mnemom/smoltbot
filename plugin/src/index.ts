import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getConfig } from './config.js';
import { initializeApi, flushTraceQueue } from './api.js';
import { clearPendingTraces } from './trace.js';

export type { AAPTrace, TraceMetadata, PendingTrace } from './trace.js';
export type { SmoltbotConfig, StoredConfig } from './config.js';
export type { HookEvent, HookHandler, HookContext, HookHandlerResult } from './types.js';

/**
 * OpenClaw plugin API interface
 */
interface OpenClawPluginApi {
  registerHooksFromDir(dir: string): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  // Add other API methods as needed
}

/**
 * Plugin state
 */
let initialized = false;

/**
 * Get the hooks directory path
 */
function getHooksDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return join(__dirname, '..', 'hooks');
}

/**
 * Register function called by OpenClaw
 *
 * This is the main entry point. OpenClaw calls this with its plugin API.
 */
export default function register(api: OpenClawPluginApi): void {
  const config = getConfig();

  if (!config) {
    console.error('[smoltbot] Failed to load configuration. Run "smoltbot init" to set up.');
    return;
  }

  if (!config.enabled) {
    console.log('[smoltbot] Plugin is disabled (missing API URL or key)');
    return;
  }

  // Initialize the API client
  initializeApi(config);

  // Register hooks from the hooks directory
  const hooksDir = getHooksDir();
  api.registerHooksFromDir(hooksDir);

  // Register shutdown handler
  api.on('gateway:shutdown', async () => {
    await shutdown();
  });

  initialized = true;
  console.log(`[smoltbot] Initialized for agent ${config.agentId}`);
  console.log(`[smoltbot] Dashboard: https://mnemom.ai/agent/${config.agentId}`);
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
export { shutdown, getConfig, flushTraceQueue };
