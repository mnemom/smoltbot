/**
 * Phase 7: License Key Handlers
 *
 * 6 admin endpoints for license management + 1 public validation endpoint.
 * Follows same pattern as admin/handlers.ts: local supabase helpers,
 * AdminGuard, jsonResponse/errorResponse.
 */

import type { BillingEnv } from '../billing/types';
import { sendEmail, licenseCreatedEmail, licenseRevokedEmail } from '../billing/email';
import { signLicenseJWT, verifyLicenseJWT, decodeLicenseJWT } from './jwt';
import type { LicenseJWTPayload } from './types';

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
// Supabase helpers (identical to admin/handlers)
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
// Audit log helper
// ============================================

async function logAudit(
  env: BillingEnv,
  adminUserId: string,
  action: string,
  targetUserId: string | null,
  targetAccountId: string | null,
  details: Record<string, unknown>,
  ipAddress: string | null,
): Promise<void> {
  await supabaseInsert(env, 'admin_audit_log', {
    id: generateId('aal'),
    admin_user_id: adminUserId,
    action,
    target_user_id: targetUserId,
    target_account_id: targetAccountId,
    details,
    ip_address: ipAddress,
  }).catch(() => {});
}

function getClientIp(request: Request): string | null {
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? null;
}

// ============================================
// 7.1 Admin: Create License
// ============================================

export async function handleAdminCreateLicense(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;
  const admin = adminOrError;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const accountId = body.account_id as string | undefined;
  if (!accountId) return errorResponse('account_id is required', 400);

  const expiresInDays = body.expires_in_days as number | undefined;
  const expiresAtStr = body.expires_at as string | undefined;
  if (!expiresInDays && !expiresAtStr) {
    return errorResponse('expires_in_days or expires_at is required', 400);
  }

  if (expiresInDays !== undefined && (typeof expiresInDays !== 'number' || expiresInDays < 1 || expiresInDays > 3650)) {
    return errorResponse('expires_in_days must be between 1 and 3650', 400);
  }

  const expiresAt = expiresAtStr
    ? new Date(expiresAtStr)
    : new Date(Date.now() + (expiresInDays as number) * 86400000);

  if (isNaN(expiresAt.getTime())) {
    return errorResponse('Invalid expires_at date', 400);
  }

  // Resolve account
  const { data: accounts, error: accountError } = await supabaseQuery(
    env,
    'billing_accounts',
    `account_id=eq.${accountId}&select=account_id,billing_email,plan_id,user_id`,
  );
  if (accountError) return errorResponse(`Database error: ${accountError}`, 500);
  const accountArr = accounts as Array<Record<string, unknown>>;
  if (!accountArr || accountArr.length === 0) {
    return errorResponse('Account not found', 404);
  }
  const account = accountArr[0];

  // Resolve plan
  const { data: plans, error: planError } = await supabaseQuery(
    env,
    'plans',
    `plan_id=eq.${account.plan_id}&select=plan_id,display_name,feature_flags,limits`,
  );
  if (planError) return errorResponse(`Database error: ${planError}`, 500);
  const planArr = plans as Array<Record<string, unknown>>;
  if (!planArr || planArr.length === 0) {
    return errorResponse('Plan not found', 500);
  }
  const plan = planArr[0];

  // Merge feature flags: plan defaults + overrides
  const planFeatureFlags = (plan.feature_flags || {}) as Record<string, boolean>;
  const overrideFlags = (body.feature_flags || {}) as Record<string, boolean>;
  const featureFlags = { ...planFeatureFlags, ...overrideFlags };

  // Merge limits
  const planLimits = (plan.limits || {}) as Record<string, unknown>;
  const overrideLimits = (body.limits || {}) as Record<string, unknown>;
  const limits = { ...planLimits, ...overrideLimits };

  const maxActivations = (body.max_activations as number) || 1;
  const isOffline = (body.is_offline as boolean) || false;
  const notes = (body.notes as string) || null;

  // Generate IDs
  const licenseId = generateId('lic');
  const kid = generateId('lsk');

  const signingSecret = (env as unknown as Record<string, string>).LICENSE_SIGNING_SECRET;
  if (!signingSecret) {
    return errorResponse('License signing not configured', 500);
  }

  // Compute secret hash for signing key record
  const secretHashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(signingSecret),
  );
  const secretHash = Array.from(new Uint8Array(secretHashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Insert signing key record
  const { error: skError } = await supabaseInsert(env, 'license_signing_keys', {
    kid,
    algorithm: 'HS256',
    secret_hash: secretHash,
    is_active: true,
  });
  if (skError) return errorResponse(`Failed to create signing key: ${skError}`, 500);

  // Sign JWT
  const now = Math.floor(Date.now() / 1000);
  const jwtPayload: LicenseJWTPayload = {
    license_id: licenseId,
    account_id: accountId,
    plan_id: account.plan_id as string,
    feature_flags: featureFlags,
    limits,
    max_activations: maxActivations,
    is_offline: isOffline,
    iat: now,
    exp: Math.floor(expiresAt.getTime() / 1000),
    kid,
  };

  const licenseJwt = await signLicenseJWT(jwtPayload, signingSecret);

  // Insert license record
  const { error: licError } = await supabaseInsert(env, 'license_keys', {
    license_id: licenseId,
    account_id: accountId,
    jwt_kid: kid,
    plan_id: account.plan_id,
    feature_flags: featureFlags,
    limits,
    max_activations: maxActivations,
    issued_at: new Date().toISOString(),
    expires_at: expiresAt.toISOString(),
    is_offline: isOffline,
    notes,
  });
  if (licError) return errorResponse(`Failed to create license: ${licError}`, 500);

  // Log billing event
  await supabaseInsert(env, 'billing_events', {
    event_id: generateId('be'),
    account_id: accountId,
    event_type: 'license_created',
    details: { license_id: licenseId, plan_id: account.plan_id, max_activations: maxActivations, is_offline: isOffline },
    performed_by: admin.sub,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

  // Audit log
  await logAudit(env, admin.sub, 'create_license', null, accountId, {
    license_id: licenseId,
    plan_id: account.plan_id,
    expires_at: expiresAt.toISOString(),
    max_activations: maxActivations,
  }, getClientIp(request));

  // Send email
  const billingEmail = account.billing_email as string;
  if (billingEmail) {
    sendEmail(
      billingEmail,
      licenseCreatedEmail({
        companyName: billingEmail,
        licenseId,
        expiresAt: expiresAt.toISOString(),
        features: Object.keys(featureFlags).filter((k) => featureFlags[k]),
      }),
      env,
    ).catch(() => {});
  }

  return jsonResponse({
    license_id: licenseId,
    license_jwt: licenseJwt,
    expires_at: expiresAt.toISOString(),
  }, 201);
}

// ============================================
// 7.2 Admin: List Licenses
// ============================================

export async function handleAdminListLicenses(
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

  const { data, error } = await supabaseRpc(env, 'admin_list_licenses', {
    p_limit: limit,
    p_offset: offset,
    p_status: status,
  });
  if (error) return errorResponse(`Database error: ${error}`, 500);

  return jsonResponse(data);
}

// ============================================
// 7.3 Admin: License Detail
// ============================================

export async function handleAdminLicenseDetail(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
  licenseId: string,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;

  const { data, error } = await supabaseRpc(env, 'admin_license_detail', {
    p_license_id: licenseId,
  });
  if (error) return errorResponse(`Database error: ${error}`, 500);

  const result = data as Record<string, unknown>;
  if (result && result.error === 'license_not_found') {
    return errorResponse('License not found', 404);
  }

  return jsonResponse(data);
}

// ============================================
// 7.4 Admin: Update License
// ============================================

export async function handleAdminUpdateLicense(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
  licenseId: string,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;
  const admin = adminOrError;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  // Fetch current license
  const { data: licenses, error: fetchError } = await supabaseQuery(
    env,
    'license_keys',
    `license_id=eq.${licenseId}&select=*`,
  );
  if (fetchError) return errorResponse(`Database error: ${fetchError}`, 500);
  const licArr = licenses as Array<Record<string, unknown>>;
  if (!licArr || licArr.length === 0) {
    return errorResponse('License not found', 404);
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const auditDetails: Record<string, unknown> = { license_id: licenseId };

  if (body.expires_at !== undefined) {
    updates.expires_at = body.expires_at;
    auditDetails.new_expires_at = body.expires_at;
  }

  if (body.max_activations !== undefined) {
    updates.max_activations = body.max_activations;
    auditDetails.new_max_activations = body.max_activations;
  }

  if (body.limits !== undefined) {
    updates.limits = body.limits;
    auditDetails.new_limits = body.limits;
  }

  if (body.feature_flags !== undefined) {
    updates.feature_flags = body.feature_flags;
    auditDetails.new_feature_flags = body.feature_flags;
  }

  if (body.notes !== undefined) {
    updates.notes = body.notes;
  }

  const { data: updated, error: updateError } = await supabaseUpdate(
    env,
    'license_keys',
    `license_id=eq.${licenseId}`,
    updates,
  );
  if (updateError) return errorResponse(`Failed to update license: ${updateError}`, 500);

  // Log billing event if expiry changed
  if (body.expires_at !== undefined) {
    await supabaseInsert(env, 'billing_events', {
      event_id: generateId('be'),
      account_id: licArr[0].account_id,
      event_type: 'license_extended',
      details: { license_id: licenseId, new_expires_at: body.expires_at },
      performed_by: admin.sub,
      timestamp: new Date().toISOString(),
    }).catch(() => {});
  }

  await logAudit(env, admin.sub, 'update_license', null, licArr[0].account_id as string, auditDetails, getClientIp(request));

  return jsonResponse({ license_id: licenseId, updated: true });
}

// ============================================
// 7.5 Admin: Revoke License
// ============================================

export async function handleAdminRevokeLicense(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
  licenseId: string,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;
  const admin = adminOrError;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // Body is optional for DELETE
  }

  const reason = (body.reason as string) || 'Admin revoked';

  // Fetch license
  const { data: licenses, error: fetchError } = await supabaseQuery(
    env,
    'license_keys',
    `license_id=eq.${licenseId}&select=*`,
  );
  if (fetchError) return errorResponse(`Database error: ${fetchError}`, 500);
  const licArr = licenses as Array<Record<string, unknown>>;
  if (!licArr || licArr.length === 0) {
    return errorResponse('License not found', 404);
  }

  if (licArr[0].revoked_at) {
    return errorResponse('License already revoked', 409);
  }

  const { error: updateError } = await supabaseUpdate(
    env,
    'license_keys',
    `license_id=eq.${licenseId}`,
    {
      revoked_at: new Date().toISOString(),
      revoked_by: admin.sub,
      revoked_reason: reason,
      updated_at: new Date().toISOString(),
    },
  );
  if (updateError) return errorResponse(`Failed to revoke license: ${updateError}`, 500);

  // Log billing event
  await supabaseInsert(env, 'billing_events', {
    event_id: generateId('be'),
    account_id: licArr[0].account_id,
    event_type: 'license_revoked',
    details: { license_id: licenseId, reason },
    performed_by: admin.sub,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

  await logAudit(env, admin.sub, 'revoke_license', null, licArr[0].account_id as string, {
    license_id: licenseId,
    reason,
  }, getClientIp(request));

  // Send revocation email
  const { data: accounts } = await supabaseQuery(
    env,
    'billing_accounts',
    `account_id=eq.${licArr[0].account_id}&select=billing_email`,
  );
  const acctArr = accounts as Array<Record<string, unknown>>;
  if (acctArr && acctArr.length > 0 && acctArr[0].billing_email) {
    sendEmail(
      acctArr[0].billing_email as string,
      licenseRevokedEmail({
        companyName: acctArr[0].billing_email as string,
        licenseId,
        reason,
      }),
      env,
    ).catch(() => {});
  }

  return jsonResponse({ license_id: licenseId, revoked: true });
}

// ============================================
// 7.6 Admin: Reissue License
// ============================================

export async function handleAdminReissueLicense(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
  licenseId: string,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;
  const admin = adminOrError;

  // Fetch license
  const { data: licenses, error: fetchError } = await supabaseQuery(
    env,
    'license_keys',
    `license_id=eq.${licenseId}&select=*`,
  );
  if (fetchError) return errorResponse(`Database error: ${fetchError}`, 500);
  const licArr = licenses as Array<Record<string, unknown>>;
  if (!licArr || licArr.length === 0) {
    return errorResponse('License not found', 404);
  }

  const license = licArr[0];
  const signingSecret = (env as unknown as Record<string, string>).LICENSE_SIGNING_SECRET;
  if (!signingSecret) {
    return errorResponse('License signing not configured', 500);
  }

  // Re-sign JWT with current license data
  const now = Math.floor(Date.now() / 1000);
  const jwtPayload: LicenseJWTPayload = {
    license_id: license.license_id as string,
    account_id: license.account_id as string,
    plan_id: license.plan_id as string,
    feature_flags: (license.feature_flags || {}) as Record<string, boolean>,
    limits: (license.limits || {}) as Record<string, unknown>,
    max_activations: license.max_activations as number,
    is_offline: license.is_offline as boolean,
    iat: now,
    exp: Math.floor(new Date(license.expires_at as string).getTime() / 1000),
    kid: license.jwt_kid as string,
  };

  const licenseJwt = await signLicenseJWT(jwtPayload, signingSecret);

  await logAudit(env, admin.sub, 'reissue_license', null, license.account_id as string, {
    license_id: licenseId,
  }, getClientIp(request));

  return jsonResponse({
    license_id: licenseId,
    license_jwt: licenseJwt,
    expires_at: license.expires_at,
  });
}

// ============================================
// 7.7 Public: Validate License
// ============================================

export async function handleLicenseValidate(
  env: BillingEnv,
  request: Request,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const licenseToken = body.license as string | undefined;
  const instanceId = body.instance_id as string | undefined;

  if (!licenseToken || typeof licenseToken !== 'string' || licenseToken.trim() === '') {
    return errorResponse('license is required', 400);
  }
  if (!instanceId || typeof instanceId !== 'string' || instanceId.trim() === '') {
    return errorResponse('instance_id is required', 400);
  }

  const signingSecret = (env as unknown as Record<string, string>).LICENSE_SIGNING_SECRET;
  if (!signingSecret) {
    return errorResponse('License validation not configured', 500);
  }

  // Verify JWT signature and expiry
  const jwtResult = await verifyLicenseJWT(licenseToken, signingSecret);
  if (!jwtResult.valid) {
    if (jwtResult.error === 'Token expired') {
      return errorResponse('License expired', 410);
    }
    return errorResponse('Invalid license', 401);
  }

  const claims = jwtResult.payload;

  // Validate against database (not revoked, activation limits)
  const { data, error } = await supabaseRpc(env, 'validate_license', {
    p_license_id: claims.license_id,
    p_instance_id: instanceId,
    p_instance_metadata: body.instance_metadata || {},
  });
  if (error) return errorResponse('Service temporarily unavailable', 503);

  const result = data as Record<string, unknown>;
  if (!result || !result.valid) {
    const reason = result?.reason as string;
    if (reason === 'license_revoked') return errorResponse('License revoked', 403);
    if (reason === 'license_expired') return errorResponse('License expired', 410);
    if (reason === 'max_activations_exceeded') {
      return jsonResponse({
        error: 'Maximum activations exceeded',
        activation_count: result.activation_count,
        max_activations: result.max_activations,
      }, 409);
    }
    return errorResponse(reason || 'License validation failed', 403);
  }

  // Check for expiring-soon warning (30 days)
  const expiresAt = new Date(result.expires_at as string);
  const daysRemaining = Math.floor((expiresAt.getTime() - Date.now()) / 86400000);
  const warning = daysRemaining <= 30 ? 'license_expiring_soon' : undefined;

  return jsonResponse({
    valid: true,
    license_id: claims.license_id,
    plan_id: result.plan_id,
    feature_flags: result.feature_flags,
    limits: result.limits,
    expires_at: result.expires_at,
    next_check_seconds: 86400,
    ...(warning ? { warning } : {}),
  });
}
