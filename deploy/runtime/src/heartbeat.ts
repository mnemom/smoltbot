/**
 * Heartbeat Client — Self-hosted deployment phone-home
 *
 * Periodically sends a heartbeat to the Mnemom API to report:
 *   - Deployment identity (deployment_id, license_jwt)
 *   - Runtime metadata (version, uptime, health status)
 *
 * Strictly fail-open: heartbeat failures are logged but never affect
 * gateway operation. The heartbeat is used for license compliance
 * monitoring and aggregate deployment telemetry only.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HeartbeatConfig {
  deploymentId: string;
  licenseJwt?: string;
  version: string;
  heartbeatUrl?: string;
  intervalMs?: number;
}

interface HeartbeatData {
  uptime_seconds: number;
  health_status: 'healthy' | 'degraded' | 'unknown';
  node_version: string;
  platform: string;
  memory_usage_mb: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let intervalHandle: ReturnType<typeof setInterval> | null = null;
const startTime = Date.now();

// ---------------------------------------------------------------------------
// Core heartbeat
// ---------------------------------------------------------------------------

async function sendHeartbeat(config: HeartbeatConfig): Promise<void> {
  const url =
    config.heartbeatUrl ?? 'https://api.mnemom.ai/v1/deployments/heartbeat';

  const heartbeatData: HeartbeatData = {
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    health_status: 'healthy',
    node_version: process.version,
    platform: process.platform,
    memory_usage_mb: Math.round(process.memoryUsage.rss() / 1024 / 1024),
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.licenseJwt
          ? { Authorization: `Bearer ${config.licenseJwt}` }
          : {}),
      },
      body: JSON.stringify({
        deployment_id: config.deploymentId,
        license_jwt: config.licenseJwt ?? null,
        version: config.version,
        heartbeat_data: heartbeatData,
        timestamp: new Date().toISOString(),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(
        `[heartbeat] Server returned ${response.status} — continuing operation`,
      );
    }
  } catch (err) {
    // Fail-open: log and continue
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[heartbeat] Failed to send heartbeat: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the heartbeat interval.
 * Sends an initial heartbeat immediately, then repeats every `intervalMs` ms.
 *
 * @param config Heartbeat configuration
 * @returns A cleanup function that stops the interval
 */
export function startHeartbeat(config: HeartbeatConfig): () => void {
  const intervalMs = config.intervalMs ?? 60_000;

  // Send initial heartbeat (non-blocking)
  sendHeartbeat(config).catch(() => {});

  intervalHandle = setInterval(() => {
    sendHeartbeat(config).catch(() => {});
  }, intervalMs);

  // Allow the Node.js process to exit even if the timer is pending
  if (intervalHandle && typeof intervalHandle === 'object' && 'unref' in intervalHandle) {
    intervalHandle.unref();
  }

  return () => stopHeartbeat();
}

/**
 * Stop the heartbeat interval.
 */
export function stopHeartbeat(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
