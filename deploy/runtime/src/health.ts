/**
 * Health Endpoints — Kubernetes-standard probes
 *
 * Exposes three probe paths as a Hono sub-app:
 *   /health/live    — Liveness: always 200 (process is alive)
 *   /health/ready   — Readiness: checks Redis + Supabase + license
 *   /health/startup — Startup: 503 until initialization completes, then 200
 *
 * Usage:
 *   import { healthApp, markReady } from './health.js';
 *   app.route('/', healthApp);
 *   // after initialization completes:
 *   markReady();
 */

import { Hono } from 'hono';
import type { KVNamespace } from './kv-adapter.js';
import { RedisKVAdapter } from './kv-adapter.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let isReady = false;
let startupComplete = false;
let supabaseUrl = '';
let kvAdapter: KVNamespace | undefined;
let licenseJwt: string | undefined;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Call once initialization is complete to flip startup/ready probes. */
export function markReady(): void {
  isReady = true;
  startupComplete = true;
}

/** Provide dependencies for readiness checks. */
export function configureHealth(opts: {
  supabaseUrl: string;
  kv?: KVNamespace;
  licenseJwt?: string;
}): void {
  supabaseUrl = opts.supabaseUrl;
  kvAdapter = opts.kv;
  licenseJwt = opts.licenseJwt;
}

// ---------------------------------------------------------------------------
// Readiness checks
// ---------------------------------------------------------------------------

async function checkRedis(): Promise<{ ok: boolean; latencyMs?: number }> {
  if (!kvAdapter) return { ok: true }; // no Redis = in-memory, always ok
  if (!(kvAdapter instanceof RedisKVAdapter)) return { ok: true };

  const start = Date.now();
  try {
    const client = kvAdapter.getRedisClient();
    const pong = await client.ping();
    return { ok: pong === 'PONG', latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

async function checkSupabase(): Promise<{ ok: boolean; latencyMs?: number }> {
  if (!supabaseUrl) return { ok: false };
  const start = Date.now();
  try {
    const resp = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    return { ok: resp.status < 500, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

function checkLicense(): { ok: boolean; warning?: string } {
  if (!licenseJwt) return { ok: true }; // no license = not licensed deployment

  try {
    const parts = licenseJwt.split('.');
    if (parts.length !== 3) return { ok: false };

    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const claims = JSON.parse(atob(padded + padding)) as Record<string, unknown>;

    const now = Math.floor(Date.now() / 1000);
    if (claims.exp && (claims.exp as number) < now) {
      return { ok: false, warning: 'license_expired' };
    }

    return { ok: true };
  } catch {
    return { ok: false, warning: 'license_parse_error' };
  }
}

// ---------------------------------------------------------------------------
// Hono sub-app
// ---------------------------------------------------------------------------

export const healthApp = new Hono();

healthApp.get('/health/live', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() }, 200);
});

healthApp.get('/health/ready', async (c) => {
  if (!isReady) {
    return c.json({ status: 'not_ready' }, 503);
  }

  const [redis, supa] = await Promise.all([checkRedis(), checkSupabase()]);
  const license = checkLicense();

  const allOk = redis.ok && supa.ok && license.ok;

  return c.json(
    {
      status: allOk ? 'ok' : 'degraded',
      checks: { redis, supabase: supa, license },
      timestamp: new Date().toISOString(),
    },
    allOk ? 200 : 503,
  );
});

healthApp.get('/health/startup', (c) => {
  if (!startupComplete) {
    return c.json({ status: 'starting' }, 503);
  }
  return c.json({ status: 'ok', timestamp: new Date().toISOString() }, 200);
});
