/**
 * Org RBAC (role-based access control).
 * Follows the exact handler pattern from billing/feature-gate.ts and billing/api-keys.ts:
 * BillingEnv typing, local Supabase helpers, local response helpers.
 */

import type { BillingEnv } from '../billing/types';
import type { Org, OrgMember, OrgRole, RolePermissions } from './types';

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
// RBAC Permission Matrix
// ============================================

export const ROLE_PERMISSIONS: Record<OrgRole, RolePermissions> = {
  owner: {
    dashboard: 'full',
    agents: 'full',
    billing: 'full',
    settings: 'full',
    compliance: 'full',
  },
  admin: {
    dashboard: 'full',
    agents: 'full',
    billing: 'view',
    settings: 'edit',
    compliance: 'full',
  },
  member: {
    dashboard: 'full',
    agents: 'own',
    billing: 'none',
    settings: 'none',
    compliance: 'view',
  },
  viewer: {
    dashboard: 'view',
    agents: 'view',
    billing: 'none',
    settings: 'none',
    compliance: 'view',
  },
  auditor: {
    dashboard: 'view',
    agents: 'view',
    billing: 'view',
    settings: 'none',
    compliance: 'full+export',
  },
};

// ============================================
// requireOrgRole
// ============================================

/**
 * Verify that the user belongs to the specified org and holds one of the allowed roles.
 * Uses the `get_org_for_user` RPC, then confirms the org_id matches.
 * Returns `{ org, member }` on success, or a 403 Response if denied.
 */
export async function requireOrgRole(
  env: BillingEnv,
  userId: string,
  orgId: string,
  allowedRoles: OrgRole[],
): Promise<{ org: Org; member: OrgMember } | Response> {
  const { data, error } = await supabaseRpc(env, 'get_org_for_user', {
    p_user_id: userId,
  });

  if (error || !data) {
    console.warn(`[rbac] Could not resolve org for user ${userId}: ${error}`);
    return errorResponse('Organization not found', 404);
  }

  const record = data as Record<string, unknown>;

  // Verify the returned org matches the requested orgId
  if (record.org_id !== orgId) {
    return errorResponse('Access denied: not a member of this organization', 403);
  }

  const role = record.role as OrgRole;

  if (!allowedRoles.includes(role)) {
    return errorResponse(
      `Access denied: role '${role}' is not permitted for this action. Required: ${allowedRoles.join(', ')}`,
      403,
    );
  }

  const org: Org = {
    org_id: record.org_id as string,
    name: record.name as string,
    slug: record.slug as string,
    billing_account_id: record.billing_account_id as string,
    owner_user_id: record.owner_user_id as string,
    billing_email: record.billing_email as string | undefined,
    company_name: record.company_name as string | undefined,
    created_at: record.created_at as string,
    updated_at: record.updated_at as string,
  };

  const member: OrgMember = {
    org_id: record.org_id as string,
    user_id: userId,
    role,
    invited_by: record.invited_by as string | undefined,
    invited_at: record.invited_at as string | undefined,
    accepted_at: record.accepted_at as string | undefined,
  };

  return { org, member };
}

// ============================================
// requireOrgFeature
// ============================================

/**
 * Check if the org's billing plan includes a specific feature flag.
 * Resolves org -> billing_account_id -> plan -> feature_flags.
 * Returns null if allowed, or a 403 Response if gated.
 */
export async function requireOrgFeature(
  env: BillingEnv,
  orgId: string,
  featureFlag: string,
): Promise<Response | null> {
  // Look up the org to get its billing_account_id
  const { data: orgs, error: orgError } = await supabaseQuery(env, 'orgs', {
    filters: { org_id: orgId },
    select: 'billing_account_id',
  });

  if (orgError || !orgs || orgs.length === 0) {
    console.warn(`[rbac] Could not resolve org ${orgId}: ${orgError}`);
    return null; // Fail-open
  }

  const org = orgs[0] as Record<string, unknown>;
  const billingAccountId = org.billing_account_id as string;

  if (!billingAccountId) {
    console.warn(`[rbac] Org ${orgId} has no billing_account_id`);
    return null; // Fail-open
  }

  // Resolve the billing account's plan
  const { data, error } = await supabaseRpc(env, 'admin_get_billing_summary', {
    p_account_id: billingAccountId,
  });

  if (error || !data) {
    console.warn(`[rbac] Could not resolve billing for org ${orgId}: ${error}`);
    return null; // Fail-open
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
// getOrgMembership
// ============================================

/**
 * Utility to fetch a user's org membership.
 * Returns the org and member record, or null if the user is not in any org.
 */
export async function getOrgMembership(
  env: BillingEnv,
  userId: string,
): Promise<{ org: Org; member: OrgMember } | null> {
  const { data, error } = await supabaseRpc(env, 'get_org_for_user', {
    p_user_id: userId,
  });

  if (error || !data) {
    return null;
  }

  const record = data as Record<string, unknown>;

  if (!record.org_id) {
    return null;
  }

  const org: Org = {
    org_id: record.org_id as string,
    name: record.name as string,
    slug: record.slug as string,
    billing_account_id: record.billing_account_id as string,
    owner_user_id: record.owner_user_id as string,
    billing_email: record.billing_email as string | undefined,
    company_name: record.company_name as string | undefined,
    created_at: record.created_at as string,
    updated_at: record.updated_at as string,
  };

  const member: OrgMember = {
    org_id: record.org_id as string,
    user_id: userId,
    role: record.role as OrgRole,
    invited_by: record.invited_by as string | undefined,
    invited_at: record.invited_at as string | undefined,
    accepted_at: record.accepted_at as string | undefined,
  };

  return { org, member };
}

// ============================================
// canAssignRole
// ============================================

/**
 * Validate whether the caller can assign a target role.
 * Rules:
 *   - Only the owner can change roles.
 *   - The 'owner' role cannot be assigned (ownership transfer not supported).
 *   - The 'viewer' and 'auditor' roles require the `rbac` feature flag (hasRbac).
 */
export function canAssignRole(
  callerRole: OrgRole,
  targetRole: OrgRole,
  hasRbac: boolean,
): { allowed: boolean; reason?: string } {
  if (callerRole !== 'owner') {
    return { allowed: false, reason: 'Only the organization owner can change roles' };
  }

  if (targetRole === 'owner') {
    return { allowed: false, reason: 'Ownership transfer is not supported' };
  }

  if ((targetRole === 'viewer' || targetRole === 'auditor') && !hasRbac) {
    return {
      allowed: false,
      reason: `The '${targetRole}' role requires the RBAC feature. Upgrade your plan to enable advanced roles.`,
    };
  }

  return { allowed: true };
}
