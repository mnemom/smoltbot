/**
 * Prometheus Metrics — prom-client integration
 *
 * Exposes a /metrics endpoint via a Hono sub-app and provides helper
 * functions for instrumenting the gateway, AIP checks, and cache operations.
 *
 * Metrics:
 *   gateway_requests_total{provider,status}        — Counter
 *   gateway_request_duration_seconds{provider}      — Histogram
 *   gateway_aip_checks_total{verdict}               — Counter
 *   gateway_cache_operations_total{operation,result} — Counter
 *   + default process_* and nodejs_* metrics
 */

import { Hono } from 'hono';
import client from 'prom-client';

// ---------------------------------------------------------------------------
// Registry & default metrics
// ---------------------------------------------------------------------------

const register = new client.Registry();

// Collect default Node.js process metrics (GC, event loop, memory, etc.)
client.collectDefaultMetrics({ register });

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const requestsTotal = new client.Counter({
  name: 'gateway_requests_total',
  help: 'Total number of gateway proxy requests',
  labelNames: ['provider', 'status'] as const,
  registers: [register],
});

const requestDuration = new client.Histogram({
  name: 'gateway_request_duration_seconds',
  help: 'Duration of gateway proxy requests in seconds',
  labelNames: ['provider'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [register],
});

const aipChecksTotal = new client.Counter({
  name: 'gateway_aip_checks_total',
  help: 'Total number of AIP integrity checks',
  labelNames: ['verdict'] as const,
  registers: [register],
});

const cacheOpsTotal = new client.Counter({
  name: 'gateway_cache_operations_total',
  help: 'Total KV cache operations',
  labelNames: ['operation', 'result'] as const,
  registers: [register],
});

const backgroundTasksTotal = new client.Counter({
  name: 'gateway_background_tasks_total',
  help: 'Total background tasks dispatched via waitUntil',
  labelNames: ['task'] as const,
  registers: [register],
});

const cronRunsTotal = new client.Counter({
  name: 'gateway_cron_runs_total',
  help: 'Total cron job executions',
  labelNames: ['job', 'result'] as const,
  registers: [register],
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

export function incRequests(provider: string, status: number): void {
  requestsTotal.inc({ provider, status: String(status) });
}

export function observeRequestDuration(
  provider: string,
  durationSeconds: number,
): void {
  requestDuration.observe({ provider }, durationSeconds);
}

export function incAipCheck(verdict: string): void {
  aipChecksTotal.inc({ verdict });
}

export function incCacheOp(
  operation: 'get' | 'put' | 'delete' | 'list',
  result: 'hit' | 'miss' | 'error',
): void {
  cacheOpsTotal.inc({ operation, result });
}

export function incBackgroundTask(task: string): void {
  backgroundTasksTotal.inc({ task });
}

export function incCronRun(job: string, result: 'success' | 'error'): void {
  cronRunsTotal.inc({ job, result });
}

/**
 * Create a timer that records request duration when stopped.
 * Usage:
 *   const end = startRequestTimer('anthropic');
 *   // ... handle request ...
 *   end();
 */
export function startRequestTimer(provider: string): () => void {
  const end = requestDuration.startTimer({ provider });
  return end;
}

// ---------------------------------------------------------------------------
// Hono sub-app
// ---------------------------------------------------------------------------

export const metricsApp = new Hono();

metricsApp.get('/metrics', async (c) => {
  const metrics = await register.metrics();
  return c.text(metrics, 200, {
    'Content-Type': register.contentType,
  });
});
