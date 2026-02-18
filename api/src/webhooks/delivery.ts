/**
 * Webhook delivery engine.
 * Processes pending deliveries (cron + inline), signs payloads, delivers via HTTP POST.
 * Exponential backoff: [10s, 30s, 2m, 10m, 1h]. Auto-disable at 100 consecutive failures.
 */

import type { BillingEnv } from '../billing/types';
import type { PendingDelivery } from './types';
import { signPayload } from './signing';

// ============================================
// Supabase helpers (match module pattern)
// ============================================

async function supabaseRpc(
  env: BillingEnv,
  functionName: string,
  params: Record<string, unknown> = {},
): Promise<{ data: unknown; error: string | null }> {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });
    if (!response.ok) {
      return { data: null, error: await response.text() };
    }
    return { data: await response.json(), error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function supabaseUpdate(
  env: BillingEnv,
  table: string,
  filters: Record<string, string | number | boolean>,
  data: Record<string, unknown>,
): Promise<{ data: unknown; error: string | null }> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, `eq.${value}`);
  }
  try {
    const response = await fetch(url.toString(), {
      method: 'PATCH',
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      return { data: null, error: await response.text() };
    }
    return { data: await response.json(), error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function supabaseQuery(
  env: BillingEnv,
  queryPath: string,
): Promise<unknown[]> {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${queryPath}`, {
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) return [];
    return (await response.json()) as unknown[];
  } catch {
    return [];
  }
}

// ============================================
// Backoff schedule (seconds)
// ============================================

const BACKOFF_SCHEDULE = [10, 30, 120, 600, 3600]; // 10s, 30s, 2m, 10m, 1h

function getBackoffSeconds(attemptCount: number): number {
  const idx = Math.min(attemptCount, BACKOFF_SCHEDULE.length - 1);
  return BACKOFF_SCHEDULE[idx];
}

// ============================================
// deliverSingle — shared by inline + cron
// ============================================

export async function deliverSingle(
  env: BillingEnv,
  delivery: PendingDelivery,
): Promise<{ success: boolean; status?: number; error?: string; latencyMs?: number }> {
  const timestamp = Math.floor(Date.now() / 1000);
  const rawBody = JSON.stringify(delivery.payload);

  let signature: string;
  try {
    signature = await signPayload(rawBody, delivery.signing_secret, timestamp);
  } catch (err) {
    return { success: false, error: `Signing error: ${err instanceof Error ? err.message : 'unknown'}` };
  }

  const startMs = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(delivery.endpoint_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Id': delivery.event_id,
        'X-Webhook-Timestamp': timestamp.toString(),
        'X-Webhook-Signature': signature,
        'User-Agent': 'Mnemom-Webhooks/1.0',
      },
      body: rawBody,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startMs;

    // Truncate response body to 1KB
    let responseBody = '';
    try {
      responseBody = (await response.text()).slice(0, 1024);
    } catch {
      // ignore
    }

    // Record delivery result
    await recordDeliveryResult(env, delivery, {
      status: response.status,
      responseBody,
      latencyMs,
    });

    if (response.ok) {
      return { success: true, status: response.status, latencyMs };
    }

    return { success: false, status: response.status, error: responseBody, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - startMs;
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';

    await recordDeliveryResult(env, delivery, {
      status: undefined,
      error: errorMsg,
      latencyMs,
    });

    return { success: false, error: errorMsg, latencyMs };
  }
}

// ============================================
// Record delivery result + endpoint health
// ============================================

async function recordDeliveryResult(
  env: BillingEnv,
  delivery: PendingDelivery,
  result: { status?: number; responseBody?: string; error?: string; latencyMs: number },
): Promise<void> {
  const now = new Date().toISOString();
  const isSuccess = result.status !== undefined && result.status >= 200 && result.status < 300;
  const isPermanentFailure = result.status !== undefined && result.status >= 400 && result.status < 500 && result.status !== 429;
  const isRateLimited = result.status === 429;

  const newAttemptCount = delivery.attempt_count + 1;
  const reachedMax = newAttemptCount >= delivery.max_attempts;

  let newStatus: string;
  let nextAttemptAt: string | null = null;

  if (isSuccess) {
    newStatus = 'delivered';
  } else if (isPermanentFailure || reachedMax) {
    newStatus = 'failed';
  } else {
    newStatus = 'retrying';
    if (isRateLimited) {
      // Respect a minimum 60s backoff for rate limits
      const backoff = Math.max(60, getBackoffSeconds(newAttemptCount));
      nextAttemptAt = new Date(Date.now() + backoff * 1000).toISOString();
    } else {
      const backoff = getBackoffSeconds(newAttemptCount);
      nextAttemptAt = new Date(Date.now() + backoff * 1000).toISOString();
    }
  }

  // Update delivery row
  await supabaseUpdate(env, 'webhook_deliveries', { delivery_id: delivery.delivery_id }, {
    status: newStatus,
    attempt_count: newAttemptCount,
    last_attempt_at: now,
    last_response_status: result.status ?? null,
    last_response_body: result.responseBody?.slice(0, 1024) ?? null,
    last_error: result.error ?? null,
    latency_ms: result.latencyMs,
    next_attempt_at: nextAttemptAt,
  });

  // Update endpoint consecutive_failures
  if (isSuccess) {
    // Reset failure counter
    await supabaseUpdate(env, 'webhook_endpoints', { endpoint_id: delivery.endpoint_id }, {
      consecutive_failures: 0,
    });
  } else {
    // Increment failure counter — fetch current count first
    const endpoints = await supabaseQuery(
      env,
      `webhook_endpoints?endpoint_id=eq.${delivery.endpoint_id}&select=consecutive_failures,billing_account_id`,
    );
    if (endpoints.length > 0) {
      const ep = endpoints[0] as Record<string, unknown>;
      const failures = ((ep.consecutive_failures as number) || 0) + 1;
      const updateData: Record<string, unknown> = { consecutive_failures: failures };

      // Auto-disable at 100 consecutive failures
      if (failures >= 100) {
        updateData.is_active = false;
        updateData.disabled_at = now;
        updateData.disabled_reason = `Auto-disabled after ${failures} consecutive delivery failures`;

        // Send notification email (best-effort)
        try {
          const { sendEmail, webhookDisabledEmail } = await import('../billing/email');
          const accounts = await supabaseQuery(
            env,
            `billing_accounts?account_id=eq.${ep.billing_account_id}&select=billing_email`,
          );
          if (accounts.length > 0) {
            const account = accounts[0] as Record<string, unknown>;
            const email = account.billing_email as string;
            if (email) {
              await sendEmail(email, webhookDisabledEmail({
                endpointUrl: delivery.endpoint_url,
                endpointId: delivery.endpoint_id,
                failureCount: failures,
              }), env);
            }
          }
        } catch (err) {
          console.error('[webhooks] Failed to send disabled email:', err);
        }
      }

      await supabaseUpdate(env, 'webhook_endpoints', { endpoint_id: delivery.endpoint_id }, updateData);
    }
  }
}

// ============================================
// processWebhookDeliveries — cron entry point
// ============================================

export async function processWebhookDeliveries(env: BillingEnv): Promise<void> {
  try {
    const { data, error } = await supabaseRpc(env, 'get_pending_webhook_deliveries', { p_limit: 100 });
    if (error || !data) {
      console.warn('[webhooks] Failed to fetch pending deliveries:', error);
      return;
    }

    const deliveries = data as PendingDelivery[];
    if (deliveries.length === 0) return;

    console.log(`[webhooks] Processing ${deliveries.length} pending deliveries`);

    for (const delivery of deliveries) {
      try {
        await deliverSingle(env, delivery);
      } catch (err) {
        console.error(`[webhooks] Delivery ${delivery.delivery_id} error:`, err);
      }
    }

    // Cleanup old deliveries
    try {
      await supabaseRpc(env, 'cleanup_old_webhook_deliveries');
    } catch {
      // non-critical
    }
  } catch (err) {
    console.error('[webhooks] processWebhookDeliveries error:', err);
  }
}
