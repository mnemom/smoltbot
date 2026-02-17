/**
 * HTTP route handlers for org SSO endpoints.
 * Follows the exact handler pattern from org/handlers.ts:
 * local Supabase helpers, AuthGetter type, exported async handler functions.
 */

import type { BillingEnv } from '../billing/types';
import type { OrgRole } from './types';
import { requireOrgRole, requireOrgFeature } from './rbac';
import { ssoEnabledEmail, ssoMemberAddedEmail, sendEmail } from '../billing/email';

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
// Supabase helpers (same pattern as handlers.ts)
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

async function supabaseDelete(
  env: BillingEnv,
  table: string,
  filters: Record<string, string>
): Promise<{ error: string | null }> {
  try {
    const url = new URL(`${env.SUPABASE_URL}/rest/v1/${table}`);
    for (const [key, value] of Object.entries(filters)) {
      url.searchParams.set(key, `eq.${value}`);
    }
    const response = await fetch(url.toString(), {
      method: 'DELETE',
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        Prefer: 'return=minimal',
      },
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

export type AuthGetter = (request: Request, env: BillingEnv) => Promise<JWTPayload | null>;

// ============================================
// Crypto helpers
// ============================================

function randomHex(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================
// Billing event logger
// ============================================

async function logBillingEvent(
  env: BillingEnv,
  accountId: string,
  eventType: string,
  details: Record<string, unknown>
): Promise<void> {
  await supabaseInsert(env, 'billing_events', {
    event_id: `evt-${randomHex(12)}`,
    account_id: accountId,
    event_type: eventType,
    details: JSON.stringify(details),
  });
}

// ============================================
// Supabase SSO API helper
// ============================================

async function supabaseSsoApi(
  env: BillingEnv,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ data: unknown; error: string | null }> {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/auth/v1/sso/${path}`, {
      method,
      headers: {
        'apikey': env.SUPABASE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      return { data: null, error: await response.text() };
    }
    const text = await response.text();
    return { data: text ? JSON.parse(text) : null, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ============================================
// SSO audit log helper
// ============================================

async function logSsoAudit(
  env: BillingEnv,
  orgId: string,
  actorUserId: string | null,
  action: string,
  details: Record<string, unknown>
): Promise<void> {
  await supabaseInsert(env, 'sso_audit_log', {
    id: `sso-${randomHex(8)}`,
    org_id: orgId,
    actor_user_id: actorUserId,
    action,
    details: JSON.stringify(details),
  });
}

// ============================================
// 1. GET /v1/auth/sso/check-domain?email=...
// ============================================

export async function handleCheckDomain(
  env: BillingEnv,
  request: Request,
  _getAuth: AuthGetter
): Promise<Response> {
  const url = new URL(request.url);
  const email = (url.searchParams.get('email') || '').trim().toLowerCase();

  if (!email || !email.includes('@') || !email.includes('.')) {
    return errorResponse('A valid email address is required', 400);
  }

  const domain = email.split('@')[1].toLowerCase();

  const { data, error } = await supabaseRpc(env, 'check_sso_domain', {
    p_email_domain: domain,
  });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  if (!data) {
    return jsonResponse({ sso_enabled: false });
  }

  // Strip supabase_sso_provider_id from the response and expose it as provider_id
  const record = data as Record<string, unknown>;
  const { supabase_sso_provider_id, ...rest } = record;

  return jsonResponse({
    ...rest,
    ...(supabase_sso_provider_id ? { provider_id: supabase_sso_provider_id } : {}),
  });
}

// ============================================
// 2. GET /v1/orgs/:org_id/sso
// ============================================

export async function handleGetSsoConfig(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  // Owner or admin only
  const roleCheck = await requireOrgRole(env, user.sub, orgId, ['owner', 'admin']);
  if (roleCheck instanceof Response) return roleCheck;

  const { data, error } = await supabaseQuery(env, 'org_sso_configs', {
    filters: { org_id: orgId },
  });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  if (!data || data.length === 0) {
    return jsonResponse({ configured: false });
  }

  // Omit supabase_sso_provider_id (internal)
  const config = data[0] as Record<string, unknown>;
  const { supabase_sso_provider_id, ...safeConfig } = config;

  return jsonResponse(safeConfig);
}

// ============================================
// 3. PUT /v1/orgs/:org_id/sso
// ============================================

export async function handleConfigureSso(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  // Owner only
  const roleCheck = await requireOrgRole(env, user.sub, orgId, ['owner']);
  if (roleCheck instanceof Response) return roleCheck;

  const { org } = roleCheck;

  // Feature gate: sso_saml
  const featureGate = await requireOrgFeature(env, orgId, 'sso_saml');
  if (featureGate) return featureGate;

  // Parse body
  const body = await request.json() as {
    metadata_url?: string;
    idp_name?: string;
    default_role?: string;
    allowed_domains?: string[];
    enforced?: boolean;
  };

  const metadataUrl = (body.metadata_url || '').trim();
  const idpName = (body.idp_name || '').trim();
  const defaultRole = (body.default_role || 'member') as string;
  const allowedDomains = body.allowed_domains || [];
  const enforced = body.enforced === true;

  // Validate metadata_url
  if (!metadataUrl.startsWith('https://')) {
    return errorResponse('metadata_url must start with https://', 400);
  }

  // Validate allowed_domains
  if (!Array.isArray(allowedDomains) || allowedDomains.length === 0) {
    return errorResponse('allowed_domains must be a non-empty array', 400);
  }

  // Validate default_role
  if (defaultRole === 'owner') {
    return errorResponse('default_role cannot be owner', 400);
  }

  const validRoles = ['admin', 'member', 'viewer', 'auditor'];
  if (!validRoles.includes(defaultRole)) {
    return errorResponse(`default_role must be one of: ${validRoles.join(', ')}`, 400);
  }

  // Check for existing config
  const { data: existingConfigs } = await supabaseQuery(env, 'org_sso_configs', {
    filters: { org_id: orgId },
  });

  const existingConfig = existingConfigs && existingConfigs.length > 0
    ? existingConfigs[0] as Record<string, unknown>
    : null;

  let providerId: string;
  const now = new Date().toISOString();

  if (existingConfig && existingConfig.supabase_sso_provider_id) {
    // UPDATE existing Supabase SSO provider
    const existingProviderId = existingConfig.supabase_sso_provider_id as string;
    const { data: ssoData, error: ssoError } = await supabaseSsoApi(
      env,
      'PUT',
      `providers/${existingProviderId}`,
      {
        type: 'saml',
        metadata_url: metadataUrl,
        domains: allowedDomains,
      }
    );

    if (ssoError) {
      return errorResponse(`Failed to update SSO provider: ${ssoError}`, 502);
    }

    const ssoResult = ssoData as Record<string, unknown>;
    providerId = (ssoResult.id as string) || existingProviderId;
  } else {
    // CREATE new Supabase SSO provider
    const { data: ssoData, error: ssoError } = await supabaseSsoApi(
      env,
      'POST',
      'providers',
      {
        type: 'saml',
        metadata_url: metadataUrl,
        domains: allowedDomains,
      }
    );

    if (ssoError) {
      return errorResponse(`Failed to create SSO provider: ${ssoError}`, 502);
    }

    const ssoResult = ssoData as Record<string, unknown>;
    providerId = ssoResult.id as string;

    if (!providerId) {
      return errorResponse('SSO provider creation returned no provider ID', 502);
    }
  }

  // Upsert org_sso_configs
  const configData: Record<string, unknown> = {
    org_id: orgId,
    enabled: true,
    enforced,
    supabase_sso_provider_id: providerId,
    metadata_url: metadataUrl,
    idp_name: idpName || null,
    default_role: defaultRole,
    allowed_domains: allowedDomains,
    updated_at: now,
  };

  if (existingConfig) {
    const { error: updateError } = await supabaseUpdate(
      env,
      'org_sso_configs',
      { org_id: orgId },
      configData
    );

    if (updateError) {
      return errorResponse(`Failed to update SSO config: ${updateError}`, 500);
    }
  } else {
    configData.created_at = now;
    const { error: insertError } = await supabaseInsert(env, 'org_sso_configs', configData);

    if (insertError) {
      return errorResponse(`Failed to save SSO config: ${insertError}`, 500);
    }
  }

  // Log to sso_audit_log
  await logSsoAudit(env, orgId, user.sub, 'sso_configured', {
    metadata_url: metadataUrl,
    idp_name: idpName,
    default_role: defaultRole,
    allowed_domains: allowedDomains,
    enforced,
    provider_id: providerId,
  });

  // Log billing event
  await logBillingEvent(env, org.billing_account_id, 'sso_configured', {
    org_id: orgId,
    metadata_url: metadataUrl,
    idp_name: idpName,
    default_role: defaultRole,
    allowed_domains: allowedDomains,
    enforced,
  });

  // Send ssoEnabledEmail to org's billing_email (best-effort)
  try {
    const billingEmail = org.billing_email;
    if (billingEmail) {
      const template = ssoEnabledEmail({
        orgName: org.name,
        idpName: idpName || 'SAML IdP',
        domains: allowedDomains,
      });
      await sendEmail(billingEmail, template, env);
    }
  } catch (emailErr) {
    console.error('[sso] SSO enabled email failed:', emailErr);
  }

  // Return the config (omitting supabase_sso_provider_id)
  return jsonResponse({
    org_id: orgId,
    enabled: true,
    enforced,
    metadata_url: metadataUrl,
    idp_name: idpName || null,
    default_role: defaultRole,
    allowed_domains: allowedDomains,
    updated_at: now,
    ...(existingConfig ? {} : { created_at: now }),
  });
}

// ============================================
// 4. DELETE /v1/orgs/:org_id/sso
// ============================================

export async function handleRemoveSso(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  // Owner only
  const roleCheck = await requireOrgRole(env, user.sub, orgId, ['owner']);
  if (roleCheck instanceof Response) return roleCheck;

  const { org } = roleCheck;

  // Feature gate: sso_saml
  const featureGate = await requireOrgFeature(env, orgId, 'sso_saml');
  if (featureGate) return featureGate;

  // Query existing config
  const { data: existingConfigs, error: queryError } = await supabaseQuery(env, 'org_sso_configs', {
    filters: { org_id: orgId },
  });

  if (queryError) {
    return errorResponse(`Database error: ${queryError}`, 500);
  }

  if (!existingConfigs || existingConfigs.length === 0) {
    return errorResponse('No SSO configuration found for this organization', 404);
  }

  const config = existingConfigs[0] as Record<string, unknown>;
  const providerId = config.supabase_sso_provider_id as string | undefined;

  // If config has a Supabase SSO provider, delete it
  if (providerId) {
    const { error: ssoError } = await supabaseSsoApi(env, 'DELETE', `providers/${providerId}`);
    if (ssoError) {
      console.error('[sso] Failed to delete Supabase SSO provider:', ssoError);
      // Continue with local cleanup even if Supabase provider deletion fails
    }
  }

  // Delete the config row
  const { error: deleteError } = await supabaseDelete(env, 'org_sso_configs', { org_id: orgId });
  if (deleteError) {
    return errorResponse(`Failed to remove SSO config: ${deleteError}`, 500);
  }

  // Log to sso_audit_log
  await logSsoAudit(env, orgId, user.sub, 'sso_removed', {
    provider_id: providerId || null,
    metadata_url: config.metadata_url || null,
    idp_name: config.idp_name || null,
  });

  // Log billing event
  await logBillingEvent(env, org.billing_account_id, 'sso_removed', {
    org_id: orgId,
    provider_id: providerId || null,
  });

  return jsonResponse({
    removed: true,
    note: 'SSO members who signed in via SAML will need to use password reset to regain access.',
  });
}

// ============================================
// 5. POST /v1/orgs/:org_id/sso/test
// ============================================

export async function handleTestSso(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  // Owner or admin
  const roleCheck = await requireOrgRole(env, user.sub, orgId, ['owner', 'admin']);
  if (roleCheck instanceof Response) return roleCheck;

  const { org } = roleCheck;

  // Feature gate: sso_saml
  const featureGate = await requireOrgFeature(env, orgId, 'sso_saml');
  if (featureGate) return featureGate;

  // Parse body
  let metadataUrl: string | undefined;
  try {
    const body = await request.json() as { metadata_url?: string };
    metadataUrl = body.metadata_url ? body.metadata_url.trim() : undefined;
  } catch {
    // No body or invalid JSON
  }

  // If no metadata_url provided, use existing config
  if (!metadataUrl) {
    const { data: existingConfigs } = await supabaseQuery(env, 'org_sso_configs', {
      filters: { org_id: orgId },
      select: 'metadata_url',
    });

    if (existingConfigs && existingConfigs.length > 0) {
      const config = existingConfigs[0] as Record<string, unknown>;
      metadataUrl = config.metadata_url as string | undefined;
    }
  }

  if (!metadataUrl) {
    return errorResponse('metadata_url is required (either in the request body or from existing SSO config)', 400);
  }

  if (!metadataUrl.startsWith('https://')) {
    return errorResponse('metadata_url must start with https://', 400);
  }

  // Fetch the metadata URL (dry run validation)
  let metadataText: string;
  try {
    const metadataRes = await fetch(metadataUrl, {
      headers: { 'Accept': 'application/xml, text/xml' },
    });

    if (!metadataRes.ok) {
      // Log audit even on failure
      await logSsoAudit(env, orgId, user.sub, 'sso_test', {
        metadata_url: metadataUrl,
        valid: false,
        error: 'metadata_url is unreachable',
        http_status: metadataRes.status,
      });

      await logBillingEvent(env, org.billing_account_id, 'sso_test', {
        org_id: orgId,
        metadata_url: metadataUrl,
        valid: false,
      });

      return jsonResponse({ valid: false, error: 'metadata_url is unreachable' });
    }

    metadataText = await metadataRes.text();
  } catch (fetchErr) {
    // Log audit on fetch error
    await logSsoAudit(env, orgId, user.sub, 'sso_test', {
      metadata_url: metadataUrl,
      valid: false,
      error: 'metadata_url is unreachable',
    });

    await logBillingEvent(env, org.billing_account_id, 'sso_test', {
      org_id: orgId,
      metadata_url: metadataUrl,
      valid: false,
    });

    return jsonResponse({ valid: false, error: 'metadata_url is unreachable' });
  }

  // Check content contains SAML markers
  const hasSamlMarkers =
    metadataText.includes('EntityDescriptor') ||
    metadataText.includes('IDPSSODescriptor');

  if (!hasSamlMarkers) {
    await logSsoAudit(env, orgId, user.sub, 'sso_test', {
      metadata_url: metadataUrl,
      valid: false,
      error: 'Response does not appear to be valid SAML metadata',
    });

    await logBillingEvent(env, org.billing_account_id, 'sso_test', {
      org_id: orgId,
      metadata_url: metadataUrl,
      valid: false,
    });

    return jsonResponse({ valid: false, error: 'Response does not appear to be valid SAML metadata' });
  }

  // Valid metadata
  await logSsoAudit(env, orgId, user.sub, 'sso_test', {
    metadata_url: metadataUrl,
    valid: true,
  });

  await logBillingEvent(env, org.billing_account_id, 'sso_test', {
    org_id: orgId,
    metadata_url: metadataUrl,
    valid: true,
  });

  return jsonResponse({ valid: true, metadata_url: metadataUrl });
}
