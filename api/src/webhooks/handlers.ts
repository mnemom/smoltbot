/**
 * HTTP route handlers for webhook notification endpoints.
 * Follows the exact handler pattern from org/handlers.ts:
 * local Supabase helpers, AuthGetter type, exported async handler functions.
 */

import type { BillingEnv } from '../billing/types';
import { requireOrgRole, requireOrgFeature } from '../org/rbac';
import { WEBHOOK_EVENT_TYPES } from './types';
import type { WebhookEventPayload } from './types';
import { deliverSingle } from './delivery';

// ============================================
// Response helpers (match handlers.ts pattern)
// ============================================

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

// ============================================
// Supabase helpers (same pattern as org/handlers.ts)
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

async function supabaseInsert(
  env: BillingEnv,
  table: string,
  data: Record<string, unknown>,
): Promise<{ data: unknown; error: string | null }> {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
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

async function supabaseDelete(
  env: BillingEnv,
  table: string,
  filters: Record<string, string | number | boolean>,
): Promise<{ count: number; error: string | null }> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, `eq.${value}`);
  }
  try {
    const response = await fetch(url.toString(), {
      method: 'DELETE',
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
    });
    if (!response.ok) {
      return { count: 0, error: await response.text() };
    }
    const result = (await response.json()) as unknown[];
    return { count: result.length, error: null };
  } catch (err) {
    return { count: 0, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ============================================
// Auth helper type
// ============================================

interface JWTPayload {
  sub: string;
  email?: string;
  role?: string;
  app_metadata?: { is_admin?: boolean };
  exp: number;
  iat: number;
}

type AuthGetter = (request: Request, env: BillingEnv) => Promise<JWTPayload | null>;

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

/**
 * Generate a random 32-byte hex signing secret.
 */
function generateSigningSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================
// Endpoint limit
// ============================================

const MAX_ENDPOINTS_PER_ACCOUNT = 5;

// ============================================
// 1. POST /v1/orgs/:org_id/webhooks
// ============================================

export async function handleCreateWebhookEndpoint(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string,
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const roleCheck = await requireOrgRole(env, user.sub, orgId, ['owner', 'admin']);
  if (roleCheck instanceof Response) return roleCheck;

  const featureGate = await requireOrgFeature(env, orgId, 'webhook_notifications');
  if (featureGate) return featureGate;

  const { org } = roleCheck;

  let body: { url?: string; description?: string; event_types?: string[] };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.url || typeof body.url !== 'string') {
    return errorResponse('url is required', 400);
  }

  // Validate HTTPS
  try {
    const parsed = new URL(body.url);
    if (parsed.protocol !== 'https:') {
      return errorResponse('Webhook URL must use HTTPS', 400);
    }
  } catch {
    return errorResponse('Invalid URL', 400);
  }

  // Validate event_types if provided
  if (body.event_types && body.event_types.length > 0) {
    for (const et of body.event_types) {
      if (!(WEBHOOK_EVENT_TYPES as readonly string[]).includes(et)) {
        return errorResponse(`Invalid event type: ${et}. Valid types: ${WEBHOOK_EVENT_TYPES.join(', ')}`, 400);
      }
    }
  }

  // Enforce endpoint limit
  const existing = await supabaseQuery(
    env,
    `webhook_endpoints?billing_account_id=eq.${org.billing_account_id}&select=endpoint_id`,
  );
  if (existing.length >= MAX_ENDPOINTS_PER_ACCOUNT) {
    return errorResponse(`Maximum of ${MAX_ENDPOINTS_PER_ACCOUNT} webhook endpoints allowed`, 400);
  }

  const endpointId = generateId('whe');
  const signingSecret = generateSigningSecret();

  const { data, error } = await supabaseInsert(env, 'webhook_endpoints', {
    endpoint_id: endpointId,
    billing_account_id: org.billing_account_id,
    url: body.url,
    description: body.description || '',
    signing_secret: signingSecret,
    event_types: body.event_types || [],
    is_active: true,
  });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  // Return with signing_secret (shown once)
  const result = Array.isArray(data) ? data[0] : data;
  return jsonResponse(result, 201);
}

// ============================================
// 2. GET /v1/orgs/:org_id/webhooks
// ============================================

export async function handleListWebhookEndpoints(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string,
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const roleCheck = await requireOrgRole(env, user.sub, orgId, ['owner', 'admin', 'auditor']);
  if (roleCheck instanceof Response) return roleCheck;

  const featureGate = await requireOrgFeature(env, orgId, 'webhook_notifications');
  if (featureGate) return featureGate;

  const { org } = roleCheck;

  const endpoints = await supabaseQuery(
    env,
    `webhook_endpoints?billing_account_id=eq.${org.billing_account_id}&select=endpoint_id,billing_account_id,url,description,event_types,is_active,consecutive_failures,disabled_at,disabled_reason,created_at,updated_at&order=created_at.desc`,
  );

  return jsonResponse(endpoints);
}

// ============================================
// 3. GET /v1/orgs/:org_id/webhooks/:endpoint_id
// ============================================

export async function handleGetWebhookEndpoint(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string,
  endpointId: string,
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const roleCheck = await requireOrgRole(env, user.sub, orgId, ['owner', 'admin', 'auditor']);
  if (roleCheck instanceof Response) return roleCheck;

  const featureGate = await requireOrgFeature(env, orgId, 'webhook_notifications');
  if (featureGate) return featureGate;

  const { org } = roleCheck;

  const endpoints = await supabaseQuery(
    env,
    `webhook_endpoints?endpoint_id=eq.${endpointId}&billing_account_id=eq.${org.billing_account_id}&select=endpoint_id,billing_account_id,url,description,event_types,is_active,consecutive_failures,disabled_at,disabled_reason,created_at,updated_at`,
  );

  if (endpoints.length === 0) {
    return errorResponse('Webhook endpoint not found', 404);
  }

  return jsonResponse(endpoints[0]);
}

// ============================================
// 4. PATCH /v1/orgs/:org_id/webhooks/:endpoint_id
// ============================================

export async function handleUpdateWebhookEndpoint(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string,
  endpointId: string,
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const roleCheck = await requireOrgRole(env, user.sub, orgId, ['owner', 'admin']);
  if (roleCheck instanceof Response) return roleCheck;

  const featureGate = await requireOrgFeature(env, orgId, 'webhook_notifications');
  if (featureGate) return featureGate;

  const { org } = roleCheck;

  // Verify endpoint belongs to this org
  const existing = await supabaseQuery(
    env,
    `webhook_endpoints?endpoint_id=eq.${endpointId}&billing_account_id=eq.${org.billing_account_id}&select=endpoint_id,is_active`,
  );
  if (existing.length === 0) {
    return errorResponse('Webhook endpoint not found', 404);
  }

  let body: { url?: string; description?: string; event_types?: string[]; is_active?: boolean };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const updateData: Record<string, unknown> = {};

  if (body.url !== undefined) {
    try {
      const parsed = new URL(body.url);
      if (parsed.protocol !== 'https:') {
        return errorResponse('Webhook URL must use HTTPS', 400);
      }
    } catch {
      return errorResponse('Invalid URL', 400);
    }
    updateData.url = body.url;
  }

  if (body.description !== undefined) {
    updateData.description = body.description;
  }

  if (body.event_types !== undefined) {
    for (const et of body.event_types) {
      if (!(WEBHOOK_EVENT_TYPES as readonly string[]).includes(et)) {
        return errorResponse(`Invalid event type: ${et}`, 400);
      }
    }
    updateData.event_types = body.event_types;
  }

  if (body.is_active !== undefined) {
    updateData.is_active = body.is_active;
    // Re-enabling resets failure counter
    const ep = existing[0] as Record<string, unknown>;
    if (body.is_active && !ep.is_active) {
      updateData.consecutive_failures = 0;
      updateData.disabled_at = null;
      updateData.disabled_reason = null;
    }
  }

  if (Object.keys(updateData).length === 0) {
    return errorResponse('No fields to update', 400);
  }

  const { data, error } = await supabaseUpdate(
    env,
    'webhook_endpoints',
    { endpoint_id: endpointId },
    updateData,
  );

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  const result = Array.isArray(data) ? data[0] : data;
  return jsonResponse(result);
}

// ============================================
// 5. DELETE /v1/orgs/:org_id/webhooks/:endpoint_id
// ============================================

export async function handleDeleteWebhookEndpoint(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string,
  endpointId: string,
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const roleCheck = await requireOrgRole(env, user.sub, orgId, ['owner', 'admin']);
  if (roleCheck instanceof Response) return roleCheck;

  const featureGate = await requireOrgFeature(env, orgId, 'webhook_notifications');
  if (featureGate) return featureGate;

  const { org } = roleCheck;

  // Verify endpoint belongs to this org
  const existing = await supabaseQuery(
    env,
    `webhook_endpoints?endpoint_id=eq.${endpointId}&billing_account_id=eq.${org.billing_account_id}&select=endpoint_id`,
  );
  if (existing.length === 0) {
    return errorResponse('Webhook endpoint not found', 404);
  }

  const { error } = await supabaseDelete(env, 'webhook_endpoints', { endpoint_id: endpointId });
  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  return jsonResponse({ deleted: true, endpoint_id: endpointId });
}

// ============================================
// 6. POST /v1/orgs/:org_id/webhooks/:endpoint_id/rotate-secret
// ============================================

export async function handleRotateWebhookSecret(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string,
  endpointId: string,
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const roleCheck = await requireOrgRole(env, user.sub, orgId, ['owner', 'admin']);
  if (roleCheck instanceof Response) return roleCheck;

  const featureGate = await requireOrgFeature(env, orgId, 'webhook_notifications');
  if (featureGate) return featureGate;

  const { org } = roleCheck;

  // Verify endpoint belongs to this org
  const existing = await supabaseQuery(
    env,
    `webhook_endpoints?endpoint_id=eq.${endpointId}&billing_account_id=eq.${org.billing_account_id}&select=endpoint_id`,
  );
  if (existing.length === 0) {
    return errorResponse('Webhook endpoint not found', 404);
  }

  const newSecret = generateSigningSecret();

  const { data, error } = await supabaseUpdate(
    env,
    'webhook_endpoints',
    { endpoint_id: endpointId },
    { signing_secret: newSecret },
  );

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  // Return the new secret (shown once)
  return jsonResponse({
    endpoint_id: endpointId,
    signing_secret: newSecret,
  });
}

// ============================================
// 7. POST /v1/orgs/:org_id/webhooks/:endpoint_id/test
// ============================================

export async function handleTestWebhookEndpoint(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string,
  endpointId: string,
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const roleCheck = await requireOrgRole(env, user.sub, orgId, ['owner', 'admin']);
  if (roleCheck instanceof Response) return roleCheck;

  const featureGate = await requireOrgFeature(env, orgId, 'webhook_notifications');
  if (featureGate) return featureGate;

  const { org } = roleCheck;

  // Fetch endpoint with signing secret
  const endpoints = await supabaseQuery(
    env,
    `webhook_endpoints?endpoint_id=eq.${endpointId}&billing_account_id=eq.${org.billing_account_id}&select=endpoint_id,url,signing_secret`,
  );
  if (endpoints.length === 0) {
    return errorResponse('Webhook endpoint not found', 404);
  }

  const ep = endpoints[0] as Record<string, unknown>;
  const testEventId = generateId('evt');
  const now = new Date().toISOString();

  const testPayload: WebhookEventPayload = {
    id: testEventId,
    type: 'integrity.checkpoint',
    created_at: now,
    account_id: org.billing_account_id,
    data: {
      test: true,
      message: 'This is a test webhook delivery from Mnemom.',
    },
  };

  const testDelivery = {
    delivery_id: generateId('whd'),
    event_id: testEventId,
    endpoint_id: endpointId,
    attempt_count: 0,
    max_attempts: 1,
    endpoint_url: ep.url as string,
    signing_secret: ep.signing_secret as string,
    payload: testPayload,
    event_type: 'webhook.test',
  };

  const result = await deliverSingle(env, testDelivery);

  return jsonResponse({
    success: result.success,
    status: result.status ?? null,
    latency_ms: result.latencyMs ?? null,
    error: result.error ?? null,
  });
}

// ============================================
// 8. GET /v1/orgs/:org_id/webhooks/deliveries
// ============================================

export async function handleGetDeliveryLog(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string,
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const roleCheck = await requireOrgRole(env, user.sub, orgId, ['owner', 'admin', 'auditor']);
  if (roleCheck instanceof Response) return roleCheck;

  const featureGate = await requireOrgFeature(env, orgId, 'webhook_notifications');
  if (featureGate) return featureGate;

  const { org } = roleCheck;

  const url = new URL(request.url);
  const endpointId = url.searchParams.get('endpoint_id') || null;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  const { data, error } = await supabaseRpc(env, 'webhook_delivery_log', {
    p_account_id: org.billing_account_id,
    p_endpoint_id: endpointId,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  return jsonResponse(data);
}

// ============================================
// 9. POST /v1/orgs/:org_id/webhooks/deliveries/:delivery_id/redeliver
// ============================================

export async function handleRedeliverWebhookEvent(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string,
  deliveryId: string,
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const roleCheck = await requireOrgRole(env, user.sub, orgId, ['owner', 'admin']);
  if (roleCheck instanceof Response) return roleCheck;

  const featureGate = await requireOrgFeature(env, orgId, 'webhook_notifications');
  if (featureGate) return featureGate;

  const { org } = roleCheck;

  // Fetch the original delivery to get event_id + endpoint_id
  const deliveries = await supabaseQuery(
    env,
    `webhook_deliveries?delivery_id=eq.${deliveryId}&select=delivery_id,event_id,endpoint_id`,
  );
  if (deliveries.length === 0) {
    return errorResponse('Delivery not found', 404);
  }

  const original = deliveries[0] as Record<string, unknown>;

  // Verify endpoint belongs to this org
  const endpoints = await supabaseQuery(
    env,
    `webhook_endpoints?endpoint_id=eq.${original.endpoint_id}&billing_account_id=eq.${org.billing_account_id}&select=endpoint_id`,
  );
  if (endpoints.length === 0) {
    return errorResponse('Delivery not found', 404);
  }

  // Create a new delivery row
  const newDeliveryId = generateId('whd');
  const { data, error } = await supabaseInsert(env, 'webhook_deliveries', {
    delivery_id: newDeliveryId,
    event_id: original.event_id,
    endpoint_id: original.endpoint_id,
    status: 'pending',
    next_attempt_at: new Date().toISOString(),
  });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  return jsonResponse({
    delivery_id: newDeliveryId,
    event_id: original.event_id,
    status: 'pending',
  }, 201);
}

// ============================================
// 10. GET /v1/admin/webhooks/health
// ============================================

export async function handleAdminWebhookHealth(
  env: BillingEnv,
  request: Request,
  requireAdmin: (request: Request, env: BillingEnv) => Promise<JWTPayload | Response>,
): Promise<Response> {
  const adminResult = await requireAdmin(request, env);
  if (adminResult instanceof Response) return adminResult;

  const { data, error } = await supabaseRpc(env, 'admin_webhook_health');

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  return jsonResponse(data);
}
