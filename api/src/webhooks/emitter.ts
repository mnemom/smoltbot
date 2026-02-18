/**
 * Webhook event emitter.
 * Builds standard envelope, calls emit_webhook_event RPC,
 * then attempts inline first delivery for near-real-time dispatch.
 * Fail-open: never blocks the primary operation.
 */

import type { BillingEnv } from '../billing/types';
import type { WebhookEventType, WebhookEventPayload, PendingDelivery } from './types';
import { deliverSingle } from './delivery';

// ============================================
// Supabase helpers
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

// ============================================
// ID generation (matches codebase pattern)
// ============================================

function generateId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}-${id}`;
}

// ============================================
// emitWebhookEvent
// ============================================

/**
 * Emit a webhook event for a billing account.
 * 1. Builds the standard envelope
 * 2. Calls emit_webhook_event RPC (inserts event + fans out deliveries)
 * 3. Attempts inline first delivery for immediate dispatch
 *
 * Wrapped in try/catch — fail-open, never blocks the primary operation.
 */
export async function emitWebhookEvent(
  env: BillingEnv,
  accountId: string,
  eventType: WebhookEventType,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const eventId = generateId('evt');
    const now = new Date().toISOString();

    const payload: WebhookEventPayload = {
      id: eventId,
      type: eventType,
      created_at: now,
      account_id: accountId,
      data,
    };

    // Insert event + fan out deliveries via RPC
    const { error } = await supabaseRpc(env, 'emit_webhook_event', {
      p_event_id: eventId,
      p_account_id: accountId,
      p_event_type: eventType,
      p_payload: payload,
    });

    if (error) {
      console.warn(`[webhooks] emit_webhook_event RPC failed: ${error}`);
      return;
    }

    // Attempt inline first delivery: fetch newly-created pending deliveries for this event
    const { data: pendingData } = await supabaseRpc(env, 'get_pending_webhook_deliveries', { p_limit: 20 });
    if (!pendingData) return;

    const allPending = pendingData as PendingDelivery[];
    const eventDeliveries = allPending.filter(d => d.event_id === eventId);

    for (const delivery of eventDeliveries) {
      try {
        await deliverSingle(env, delivery);
      } catch {
        // Left for cron retry
      }
    }
  } catch (err) {
    // Fail-open: never block the primary operation
    console.warn('[webhooks] emitWebhookEvent error:', err);
  }
}
