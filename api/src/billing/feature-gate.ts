/**
 * Feature gating by plan.
 * Resolves user → billing_account → plan → feature_flags.
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
// Supabase helper
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
// requireFeature
// ============================================

/**
 * Check if the authenticated user's plan includes a specific feature flag.
 * Returns null if allowed, or a 403 Response if gated.
 */
export async function requireFeature(
  env: BillingEnv,
  userId: string,
  featureFlag: string,
): Promise<Response | null> {
  const { data, error } = await supabaseRpc(env, 'admin_get_billing_summary', {
    p_user_id: userId,
  });

  if (error || !data) {
    // Fail-open: if we can't resolve billing, allow
    console.warn(`[feature-gate] Could not resolve billing for ${userId}: ${error}`);
    return null;
  }

  const summary = data as Record<string, unknown>;
  const plan = summary.plan as Record<string, unknown> | undefined;
  const featureFlags = (plan?.feature_flags ?? {}) as Record<string, boolean>;

  if (featureFlags[featureFlag]) {
    return null; // Allowed
  }

  return new Response(JSON.stringify({
    error: 'feature_gated',
    feature: featureFlag,
    message: `This feature requires a plan with ${featureFlag} enabled.`,
    upgrade_url: '/pricing',
  }), {
    status: 403,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ============================================
// GET /v1/billing/features
// ============================================

/**
 * Returns the authenticated user's plan capabilities
 * for frontend conditional rendering.
 */
export async function handleGetFeatures(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  // Ensure billing account exists
  await supabaseRpc(env, 'ensure_billing_account', {
    p_user_id: user.sub,
    p_email: user.email ?? '',
  });

  const { data, error } = await supabaseRpc(env, 'admin_get_billing_summary', {
    p_user_id: user.sub,
  });

  if (error || !data) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  const summary = data as Record<string, unknown>;
  const account = summary.account as Record<string, unknown> | undefined;
  const plan = summary.plan as Record<string, unknown> | undefined;

  return jsonResponse({
    plan_id: plan?.plan_id ?? 'plan-free',
    feature_flags: plan?.feature_flags ?? {},
    limits: plan?.limits ?? {},
    included_checks: plan?.included_checks ?? 0,
    check_count_this_period: account?.check_count_this_period ?? 0,
    subscription_status: account?.subscription_status ?? 'none',
  });
}
