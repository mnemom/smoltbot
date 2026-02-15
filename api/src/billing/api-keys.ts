/**
 * API key management handlers.
 * Follows the exact handler pattern from handlers.ts:
 * BillingEnv typing, AuthGetter for JWT, local Supabase helpers.
 */

import type { BillingEnv } from './types';

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
// Supabase helpers
// ============================================

async function supabaseRpc(
  env: BillingEnv,
  functionName: string,
  params: Record<string, unknown> = {}
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

async function supabaseInsert(
  env: BillingEnv,
  table: string,
  data: Record<string, unknown>
): Promise<{ error: string | null }> {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      return { error: await response.text() };
    }
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function supabaseQuery(
  env: BillingEnv,
  table: string,
  params: { filters: Record<string, string>; select?: string; order?: string }
): Promise<{ data: unknown[]; error: string | null }> {
  try {
    const url = new URL(`${env.SUPABASE_URL}/rest/v1/${table}`);
    if (params.select) url.searchParams.set('select', params.select);
    for (const [key, value] of Object.entries(params.filters)) {
      url.searchParams.set(key, `eq.${value}`);
    }
    if (params.order) url.searchParams.set('order', params.order);
    const response = await fetch(url.toString(), {
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
      },
    });
    if (!response.ok) {
      return { data: [], error: await response.text() };
    }
    return { data: (await response.json()) as unknown[], error: null };
  } catch (err) {
    return { data: [], error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function supabaseUpdate(
  env: BillingEnv,
  table: string,
  filters: Record<string, string>,
  data: Record<string, unknown>
): Promise<{ error: string | null }> {
  try {
    const url = new URL(`${env.SUPABASE_URL}/rest/v1/${table}`);
    for (const [key, value] of Object.entries(filters)) {
      url.searchParams.set(key, `eq.${value}`);
    }
    const response = await fetch(url.toString(), {
      method: 'PATCH',
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      return { error: await response.text() };
    }
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' };
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
// Crypto helpers
// ============================================

function randomHex(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================
// POST /v1/api-keys
// ============================================

export async function handleCreateApiKey(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  // Ensure billing account exists
  const { data: ensureResult, error: ensureError } = await supabaseRpc(env, 'ensure_billing_account', {
    p_user_id: user.sub,
    p_email: user.email ?? '',
  });
  if (ensureError) return errorResponse(`Billing setup failed: ${ensureError}`, 500);

  const ensured = ensureResult as Record<string, unknown>;
  const accountId = ensured.account_id as string;
  if (!accountId) return errorResponse('Could not resolve billing account', 500);

  // Parse optional name from body
  let name = 'Default';
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.name && typeof body.name === 'string') {
      name = body.name.slice(0, 100); // Cap length
    }
  } catch {
    // No body or invalid JSON — use default name
  }

  // Generate key: mnm_ + 32 random hex chars
  const keySecret = `mnm_${randomHex(16)}`;
  const keyHash = await sha256(keySecret);
  const keyPrefix = keySecret.slice(0, 8); // 'mnm_xxxx'
  const keyId = `mk-${randomHex(8)}`;

  // Store in mnemom_api_keys
  const { error: insertError } = await supabaseInsert(env, 'mnemom_api_keys', {
    key_id: keyId,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    user_id: user.sub,
    account_id: accountId,
    name,
    scopes: ['gateway', 'api'],
    is_active: true,
  });

  if (insertError) {
    return errorResponse(`Failed to create API key: ${insertError}`, 500);
  }

  // Log billing event
  await supabaseInsert(env, 'billing_events', {
    event_id: `evt-${randomHex(12)}`,
    account_id: accountId,
    event_type: 'api_key_created',
    details: JSON.stringify({ key_id: keyId, key_prefix: keyPrefix }),
  });

  return jsonResponse({
    key_id: keyId,
    key: keySecret, // Full key — only returned once
    key_prefix: keyPrefix,
    name,
    scopes: ['gateway', 'api'],
    created_at: new Date().toISOString(),
  }, 201);
}

// ============================================
// GET /v1/api-keys
// ============================================

export async function handleListApiKeys(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const { data, error } = await supabaseQuery(env, 'mnemom_api_keys', {
    filters: { user_id: user.sub, is_active: 'true' },
    select: 'key_id,key_prefix,name,scopes,created_at,last_used_at',
    order: 'created_at.desc',
  });

  if (error) return errorResponse(`Database error: ${error}`, 500);

  return jsonResponse({ keys: data });
}

// ============================================
// DELETE /v1/api-keys/:key_id
// ============================================

export async function handleRevokeApiKey(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  keyId: string,
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  // Verify ownership: only revoke keys belonging to this user
  const { data: keys } = await supabaseQuery(env, 'mnemom_api_keys', {
    filters: { key_id: keyId, user_id: user.sub, is_active: 'true' },
    select: 'key_id,account_id',
  });

  if (!keys || keys.length === 0) {
    return errorResponse('API key not found', 404);
  }

  const key = keys[0] as Record<string, unknown>;

  // Soft-delete
  const { error } = await supabaseUpdate(env, 'mnemom_api_keys', { key_id: keyId }, {
    is_active: false,
    revoked_at: new Date().toISOString(),
  });

  if (error) return errorResponse(`Failed to revoke key: ${error}`, 500);

  // Log billing event
  await supabaseInsert(env, 'billing_events', {
    event_id: `evt-${randomHex(12)}`,
    account_id: key.account_id as string,
    event_type: 'api_key_revoked',
    details: JSON.stringify({ key_id: keyId }),
  });

  return jsonResponse({ revoked: true, key_id: keyId });
}
