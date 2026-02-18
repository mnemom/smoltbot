/**
 * Webhook notification types and interfaces.
 */

// ============================================
// Event types
// ============================================

export const WEBHOOK_EVENT_TYPES = [
  'integrity.violation',
  'integrity.checkpoint',
  'drift.detected',
  'drift.resolved',
  'conscience.escalation',
  'quota.warning',
  'quota.exceeded',
  'subscription.status_changed',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

// ============================================
// Entities
// ============================================

export interface WebhookEndpoint {
  endpoint_id: string;
  billing_account_id: string;
  url: string;
  description: string;
  signing_secret?: string; // Only returned on create / rotate
  event_types: string[];
  is_active: boolean;
  consecutive_failures: number;
  disabled_at: string | null;
  disabled_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookEventPayload {
  id: string;
  type: WebhookEventType;
  created_at: string;
  account_id: string;
  data: Record<string, unknown>;
}

export interface WebhookDelivery {
  delivery_id: string;
  event_id: string;
  endpoint_id: string;
  event_type?: string;
  status: 'pending' | 'delivering' | 'delivered' | 'failed' | 'retrying';
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  last_response_status: number | null;
  last_response_body: string | null;
  last_error: string | null;
  latency_ms: number | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// Delivery result (used by delivery engine)
// ============================================

export interface PendingDelivery {
  delivery_id: string;
  event_id: string;
  endpoint_id: string;
  attempt_count: number;
  max_attempts: number;
  endpoint_url: string;
  signing_secret: string;
  payload: WebhookEventPayload;
  event_type: string;
}
