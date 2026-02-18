/**
 * Self-Hosted Deployment Management Handlers
 *
 * 8 endpoints for deployment lifecycle: register, list, get, update, delete,
 * heartbeat (license JWT auth), plus admin list/detail.
 * Follows same pattern as licensing/handlers.ts: local supabase helpers,
 * AdminGuard, jsonResponse/errorResponse.
 */

import type { BillingEnv } from '../billing/types';
import { verifyLicenseJWT } from '../licensing/jwt';
import type { RegisterDeploymentRequest, HeartbeatRequest } from './types';

// ============================================
// Types
// ============================================

interface JWTPayload {
  sub: string;
  email?: string;
  role?: string;
  app_metadata?: { is_admin?: boolean };
  exp: number;
  iat: number;
}

/** Function signature matching requireAdmin in index.ts */
export type AdminGuard = (request: Request, env: BillingEnv) => Promise<JWTPayload | Response>;

/** Function signature matching getAuthUser in index.ts */
export type AuthGuard = (request: Request, env: BillingEnv) => Promise<JWTPayload | Response>;

// ============================================
// Response helpers
// ============================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

// ============================================
// Supabase helpers (identical to licensing/handlers)
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
  table: string,
  queryString: string,
): Promise<{ data: unknown; error: string | null }> {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${queryString}`, {
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
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
  filterString: string,
  data: Record<string, unknown>,
): Promise<{ data: unknown; error: string | null }> {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${filterString}`, {
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
  filterString: string,
): Promise<{ data: unknown; error: string | null }> {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${filterString}`, {
      method: 'DELETE',
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
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
// ID generator
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
// Org membership helpers
// ============================================

async function requireOrgMember(
  env: BillingEnv,
  user: JWTPayload,
  orgId: string,
): Promise<{ role: string } | Response> {
  const { data, error } = await supabaseRpc(env, 'get_org_member_role', {
    p_org_id: orgId,
    p_user_id: user.sub,
  });
  if (error) return errorResponse(`Database error: ${error}`, 500);

  const result = data as string | null;
  if (!result) {
    return errorResponse('Not a member of this organization', 403);
  }

  return { role: result };
}

async function requireOrgAdminOrOwner(
  env: BillingEnv,
  user: JWTPayload,
  orgId: string,
): Promise<{ role: string } | Response> {
  const memberOrError = await requireOrgMember(env, user, orgId);
  if (memberOrError instanceof Response) return memberOrError;

  if (memberOrError.role !== 'admin' && memberOrError.role !== 'owner') {
    return errorResponse('Admin or owner role required', 403);
  }

  return memberOrError;
}

// ============================================
// 10.1 Register Deployment
// POST /v1/orgs/:org_id/deployments
// ============================================

export async function handleRegisterDeployment(
  env: BillingEnv,
  request: Request,
  getAuthUser: AuthGuard,
  orgId: string,
): Promise<Response> {
  const userOrError = await getAuthUser(request, env);
  if (userOrError instanceof Response) return userOrError;
  const user = userOrError;

  const roleOrError = await requireOrgAdminOrOwner(env, user, orgId);
  if (roleOrError instanceof Response) return roleOrError;

  let body: RegisterDeploymentRequest;
  try {
    body = (await request.json()) as RegisterDeploymentRequest;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.instance_name || typeof body.instance_name !== 'string' || body.instance_name.trim() === '') {
    return errorResponse('instance_name is required', 400);
  }
  if (!body.instance_id || typeof body.instance_id !== 'string' || body.instance_id.trim() === '') {
    return errorResponse('instance_id is required', 400);
  }
  if (!body.license_id || typeof body.license_id !== 'string' || body.license_id.trim() === '') {
    return errorResponse('license_id is required', 400);
  }

  // Verify the license exists and belongs to the org
  const { data: licenses, error: licError } = await supabaseRpc(env, 'verify_org_license', {
    p_org_id: orgId,
    p_license_id: body.license_id,
  });
  if (licError) return errorResponse(`Database error: ${licError}`, 500);

  const licResult = licenses as Record<string, unknown> | null;
  if (!licResult || licResult.valid !== true) {
    return errorResponse('License not found or does not belong to this organization', 404);
  }

  const deploymentId = generateId('dep');
  const now = new Date().toISOString();

  const { data: inserted, error: insertError } = await supabaseInsert(env, 'self_hosted_deployments', {
    deployment_id: deploymentId,
    org_id: orgId,
    license_id: body.license_id,
    instance_name: body.instance_name.trim(),
    instance_id: body.instance_id.trim(),
    region: body.region || null,
    status: 'active',
    version: body.version || null,
    heartbeat_data: {},
    instance_metadata: body.instance_metadata || {},
    created_at: now,
    updated_at: now,
  });
  if (insertError) return errorResponse(`Failed to register deployment: ${insertError}`, 500);

  const result = Array.isArray(inserted) ? inserted[0] : inserted;

  return jsonResponse({
    deployment_id: deploymentId,
    instance_name: body.instance_name.trim(),
    instance_id: body.instance_id.trim(),
    status: 'active',
    created_at: now,
    ...result,
  }, 201);
}

// ============================================
// 10.2 List Org Deployments
// GET /v1/orgs/:org_id/deployments
// ============================================

export async function handleListOrgDeployments(
  env: BillingEnv,
  request: Request,
  getAuthUser: AuthGuard,
  orgId: string,
): Promise<Response> {
  const userOrError = await getAuthUser(request, env);
  if (userOrError instanceof Response) return userOrError;
  const user = userOrError;

  const roleOrError = await requireOrgMember(env, user, orgId);
  if (roleOrError instanceof Response) return roleOrError;

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const status = url.searchParams.get('status') || null;

  const { data, error } = await supabaseRpc(env, 'list_org_deployments', {
    p_org_id: orgId,
    p_limit: limit,
    p_offset: offset,
    p_status: status,
  });
  if (error) return errorResponse(`Database error: ${error}`, 500);

  return jsonResponse(data);
}

// ============================================
// 10.3 Get Deployment
// GET /v1/orgs/:org_id/deployments/:id
// ============================================

export async function handleGetDeployment(
  env: BillingEnv,
  request: Request,
  getAuthUser: AuthGuard,
  orgId: string,
  deploymentId: string,
): Promise<Response> {
  const userOrError = await getAuthUser(request, env);
  if (userOrError instanceof Response) return userOrError;
  const user = userOrError;

  const roleOrError = await requireOrgMember(env, user, orgId);
  if (roleOrError instanceof Response) return roleOrError;

  const { data, error } = await supabaseRpc(env, 'get_org_deployment', {
    p_org_id: orgId,
    p_deployment_id: deploymentId,
  });
  if (error) return errorResponse(`Database error: ${error}`, 500);

  const result = data as Record<string, unknown> | null;
  if (!result || result.error === 'deployment_not_found') {
    return errorResponse('Deployment not found', 404);
  }

  return jsonResponse(data);
}

// ============================================
// 10.4 Update Deployment
// PUT /v1/orgs/:org_id/deployments/:id
// ============================================

export async function handleUpdateDeployment(
  env: BillingEnv,
  request: Request,
  getAuthUser: AuthGuard,
  orgId: string,
  deploymentId: string,
): Promise<Response> {
  const userOrError = await getAuthUser(request, env);
  if (userOrError instanceof Response) return userOrError;
  const user = userOrError;

  const roleOrError = await requireOrgAdminOrOwner(env, user, orgId);
  if (roleOrError instanceof Response) return roleOrError;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  // Verify deployment exists and belongs to org
  const { data: existing, error: fetchError } = await supabaseQuery(
    env,
    'self_hosted_deployments',
    `deployment_id=eq.${deploymentId}&org_id=eq.${orgId}&select=*`,
  );
  if (fetchError) return errorResponse(`Database error: ${fetchError}`, 500);
  const depArr = existing as Array<Record<string, unknown>>;
  if (!depArr || depArr.length === 0) {
    return errorResponse('Deployment not found', 404);
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.instance_name !== undefined) {
    if (typeof body.instance_name !== 'string' || body.instance_name.trim() === '') {
      return errorResponse('instance_name must be a non-empty string', 400);
    }
    updates.instance_name = (body.instance_name as string).trim();
  }

  if (body.region !== undefined) {
    updates.region = body.region;
  }

  if (body.status !== undefined) {
    const validStatuses = ['active', 'inactive', 'degraded'];
    if (!validStatuses.includes(body.status as string)) {
      return errorResponse('status must be one of: active, inactive, degraded', 400);
    }
    updates.status = body.status;
  }

  if (body.version !== undefined) {
    updates.version = body.version;
  }

  if (body.instance_metadata !== undefined) {
    updates.instance_metadata = body.instance_metadata;
  }

  const { error: updateError } = await supabaseUpdate(
    env,
    'self_hosted_deployments',
    `deployment_id=eq.${deploymentId}&org_id=eq.${orgId}`,
    updates,
  );
  if (updateError) return errorResponse(`Failed to update deployment: ${updateError}`, 500);

  return jsonResponse({ deployment_id: deploymentId, updated: true });
}

// ============================================
// 10.5 Delete Deployment
// DELETE /v1/orgs/:org_id/deployments/:id
// ============================================

export async function handleDeleteDeployment(
  env: BillingEnv,
  request: Request,
  getAuthUser: AuthGuard,
  orgId: string,
  deploymentId: string,
): Promise<Response> {
  const userOrError = await getAuthUser(request, env);
  if (userOrError instanceof Response) return userOrError;
  const user = userOrError;

  const roleOrError = await requireOrgAdminOrOwner(env, user, orgId);
  if (roleOrError instanceof Response) return roleOrError;

  // Verify deployment exists and belongs to org
  const { data: existing, error: fetchError } = await supabaseQuery(
    env,
    'self_hosted_deployments',
    `deployment_id=eq.${deploymentId}&org_id=eq.${orgId}&select=deployment_id`,
  );
  if (fetchError) return errorResponse(`Database error: ${fetchError}`, 500);
  const depArr = existing as Array<Record<string, unknown>>;
  if (!depArr || depArr.length === 0) {
    return errorResponse('Deployment not found', 404);
  }

  const { error: deleteError } = await supabaseDelete(
    env,
    'self_hosted_deployments',
    `deployment_id=eq.${deploymentId}&org_id=eq.${orgId}`,
  );
  if (deleteError) return errorResponse(`Failed to delete deployment: ${deleteError}`, 500);

  return jsonResponse({ deployment_id: deploymentId, deleted: true });
}

// ============================================
// 10.6 Deployment Heartbeat
// POST /v1/deployments/heartbeat
// ============================================

export async function handleDeploymentHeartbeat(
  env: BillingEnv,
  request: Request,
): Promise<Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return errorResponse('Authorization header with Bearer token required', 401);
  }

  const token = authHeader.slice(7);
  const jwtResult = await verifyLicenseJWT(token, env.SUPABASE_JWT_SECRET);
  if (!jwtResult.valid) {
    if (jwtResult.error === 'Token expired') {
      return errorResponse('License token expired', 401);
    }
    return errorResponse('Invalid license token', 401);
  }

  let body: HeartbeatRequest;
  try {
    body = (await request.json()) as HeartbeatRequest;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.deployment_id || typeof body.deployment_id !== 'string') {
    return errorResponse('deployment_id is required', 400);
  }
  if (!body.instance_id || typeof body.instance_id !== 'string') {
    return errorResponse('instance_id is required', 400);
  }

  const { data, error } = await supabaseRpc(env, 'deployment_heartbeat', {
    p_deployment_id: body.deployment_id,
    p_instance_id: body.instance_id,
    p_license_id: jwtResult.payload.license_id,
    p_version: body.version || null,
    p_heartbeat_data: body.heartbeat_data || {},
  });
  if (error) return errorResponse('Service temporarily unavailable', 503);

  const result = data as Record<string, unknown> | null;
  if (!result || result.error === 'deployment_not_found') {
    return errorResponse('Deployment not found or instance_id mismatch', 404);
  }

  return jsonResponse({
    deployment_id: body.deployment_id,
    status: result.status || 'active',
    next_heartbeat_seconds: result.next_heartbeat_seconds || 300,
    server_time: new Date().toISOString(),
  });
}

// ============================================
// 10.7 Admin: List All Deployments
// GET /v1/admin/deployments
// ============================================

export async function handleAdminListDeployments(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
  url: URL,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;

  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const status = url.searchParams.get('status') || null;
  const orgId = url.searchParams.get('org_id') || null;

  const { data, error } = await supabaseRpc(env, 'admin_list_deployments', {
    p_limit: limit,
    p_offset: offset,
    p_status: status,
    p_org_id: orgId,
  });
  if (error) return errorResponse(`Database error: ${error}`, 500);

  return jsonResponse(data);
}

// ============================================
// 10.8 Admin: Get Deployment Detail
// GET /v1/admin/deployments/:id
// ============================================

export async function handleAdminGetDeployment(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
  deploymentId: string,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;

  const { data, error } = await supabaseRpc(env, 'admin_deployment_detail', {
    p_deployment_id: deploymentId,
  });
  if (error) return errorResponse(`Database error: ${error}`, 500);

  const result = data as Record<string, unknown>;
  if (result && result.error === 'deployment_not_found') {
    return errorResponse('Deployment not found', 404);
  }

  return jsonResponse(data);
}
