/**
 * HTTP route handlers for org endpoints.
 * Follows the exact handler pattern from billing/handlers.ts:
 * local Supabase helpers, AuthGetter type, exported async handler functions.
 */

import type { BillingEnv } from '../billing/types';
import type { OrgRole } from './types';
import { requireOrgRole, requireOrgFeature, canAssignRole } from './rbac';
import { orgInviteEmail, orgRoleChangeEmail, sendEmail } from '../billing/email';

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
// Supabase helpers (same pattern as api-keys.ts)
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
// Crypto helpers (same as api-keys.ts)
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
// Slug validation
// ============================================

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const RESERVED_SLUGS = ['api', 'admin', 'billing', 'settings', 'app', 'www', 'org', 'orgs'];

function isValidSlug(slug: string): boolean {
  if (slug.length < 3 || slug.length > 48) return false;
  if (!SLUG_REGEX.test(slug)) return false;
  if (slug.includes('--')) return false;
  if (RESERVED_SLUGS.includes(slug)) return false;
  return true;
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
// 1. POST /v1/orgs — Create Org
// ============================================

export async function handleCreateOrg(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  // Verify Team+ plan
  const { data: accounts, error: accountError } = await supabaseQuery(env, 'billing_accounts', {
    filters: { user_id: user.sub },
    select: 'account_id,plan_id,org_id',
  });

  if (accountError || !accounts || accounts.length === 0) {
    return errorResponse('No billing account found', 404);
  }

  const account = accounts[0] as Record<string, unknown>;
  const planId = account.plan_id as string;

  if (planId === 'plan-free' || planId === 'plan-developer') {
    return errorResponse('Organization features require a Team or Enterprise plan', 403);
  }

  // Check if user already has an org
  if (account.org_id) {
    return errorResponse('You already belong to an organization. Each user can belong to one organization.', 409);
  }

  // Parse body
  const body = await request.json() as { name?: string; slug?: string };
  const name = (body.name || '').trim();
  const slug = (body.slug || '').trim().toLowerCase();

  if (!name || name.length < 2 || name.length > 100) {
    return errorResponse('name is required (2-100 characters)', 400);
  }

  if (!slug) {
    return errorResponse('slug is required', 400);
  }

  if (!isValidSlug(slug)) {
    return errorResponse(
      'Invalid slug: must be 3-48 characters, lowercase alphanumeric and hyphens only, cannot start/end with hyphen or contain consecutive hyphens',
      400
    );
  }

  // Check slug uniqueness
  const { data: existingSlugs } = await supabaseQuery(env, 'orgs', {
    filters: { slug },
    select: 'org_id',
  });

  if (existingSlugs && existingSlugs.length > 0) {
    return errorResponse('This slug is already taken', 409);
  }

  const orgId = `org-${crypto.randomUUID().slice(0, 8)}`;
  const accountId = account.account_id as string;
  const now = new Date().toISOString();

  // Create org row
  const { error: orgInsertError } = await supabaseInsert(env, 'orgs', {
    org_id: orgId,
    name,
    slug,
    billing_account_id: accountId,
    owner_user_id: user.sub,
    created_at: now,
    updated_at: now,
  });

  if (orgInsertError) {
    return errorResponse(`Failed to create organization: ${orgInsertError}`, 500);
  }

  // Create owner member row
  const { error: memberInsertError } = await supabaseInsert(env, 'org_members', {
    org_id: orgId,
    user_id: user.sub,
    role: 'owner',
    accepted_at: now,
  });

  if (memberInsertError) {
    console.error('[org] Failed to create owner member row:', memberInsertError);
    // Clean up the org we just created
    await supabaseDelete(env, 'orgs', { org_id: orgId });
    return errorResponse(`Failed to create organization: ${memberInsertError}`, 500);
  }

  // Set billing_accounts.org_id
  const { error: updateError } = await supabaseUpdate(
    env,
    'billing_accounts',
    { account_id: accountId },
    { org_id: orgId, updated_at: now }
  );

  if (updateError) {
    console.error('[org] Failed to set billing_accounts.org_id:', updateError);
  }

  // Log billing event
  await logBillingEvent(env, accountId, 'org_created', {
    org_id: orgId,
    name,
    slug,
    owner_user_id: user.sub,
  });

  return jsonResponse({
    org_id: orgId,
    name,
    slug,
    billing_account_id: accountId,
    owner_user_id: user.sub,
    created_at: now,
    updated_at: now,
  }, 201);
}

// ============================================
// 2. GET /v1/orgs — List My Orgs
// ============================================

export async function handleListMyOrgs(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const { data, error } = await supabaseRpc(env, 'get_org_for_user', {
    p_user_id: user.sub,
  });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  // RPC returns a single record or null
  if (!data) {
    return jsonResponse({ orgs: [] });
  }

  const record = data as Record<string, unknown>;

  // If no org_id, user isn't in any org
  if (!record.org_id) {
    return jsonResponse({ orgs: [] });
  }

  return jsonResponse({
    orgs: [{
      org_id: record.org_id,
      name: record.name,
      slug: record.slug,
      billing_account_id: record.billing_account_id,
      owner_user_id: record.owner_user_id,
      billing_email: record.billing_email ?? null,
      company_name: record.company_name ?? null,
      role: record.role,
      created_at: record.created_at,
      updated_at: record.updated_at,
    }],
  });
}

// ============================================
// 3. GET /v1/orgs/:org_id — Get Org
// ============================================

export async function handleGetOrg(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  // Any member can view org details
  const roleCheck = await requireOrgRole(env, user.sub, orgId, [
    'owner', 'admin', 'member', 'viewer', 'auditor',
  ]);
  if (roleCheck instanceof Response) return roleCheck;

  const { org } = roleCheck;

  // Get member count
  const { data: members } = await supabaseQuery(env, 'org_members', {
    filters: { org_id: orgId },
    select: 'user_id',
  });

  const memberCount = members ? members.length : 0;

  return jsonResponse({
    org_id: org.org_id,
    name: org.name,
    slug: org.slug,
    billing_account_id: org.billing_account_id,
    owner_user_id: org.owner_user_id,
    billing_email: org.billing_email ?? null,
    company_name: org.company_name ?? null,
    member_count: memberCount,
    created_at: org.created_at,
    updated_at: org.updated_at,
  });
}

// ============================================
// 4. PATCH /v1/orgs/:org_id — Update Org
// ============================================

export async function handleUpdateOrg(
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

  const body = await request.json() as Record<string, unknown>;
  const updates: Record<string, unknown> = {};

  // Validate and collect updates
  if (body.name !== undefined) {
    const name = (body.name as string || '').trim();
    if (name.length < 2 || name.length > 100) {
      return errorResponse('name must be 2-100 characters', 400);
    }
    updates.name = name;
  }

  if (body.slug !== undefined) {
    const slug = (body.slug as string || '').trim().toLowerCase();
    if (!isValidSlug(slug)) {
      return errorResponse(
        'Invalid slug: must be 3-48 characters, lowercase alphanumeric and hyphens only',
        400
      );
    }

    // Check uniqueness (excluding current org)
    const { data: existingSlugs } = await supabaseQuery(env, 'orgs', {
      filters: { slug },
      select: 'org_id',
    });

    if (existingSlugs && existingSlugs.length > 0) {
      const existing = existingSlugs[0] as Record<string, unknown>;
      if (existing.org_id !== orgId) {
        return errorResponse('This slug is already taken', 409);
      }
    }

    updates.slug = slug;
  }

  if (body.billing_email !== undefined) {
    const billingEmail = (body.billing_email as string || '').trim();
    if (billingEmail && (!billingEmail.includes('@') || !billingEmail.includes('.'))) {
      return errorResponse('Invalid billing email address', 400);
    }
    updates.billing_email = billingEmail || null;
  }

  if (body.company_name !== undefined) {
    const companyName = (body.company_name as string || '').trim();
    if (companyName && companyName.length > 200) {
      return errorResponse('company_name must be 200 characters or fewer', 400);
    }
    updates.company_name = companyName || null;
  }

  if (Object.keys(updates).length === 0) {
    return errorResponse('No valid fields to update', 400);
  }

  updates.updated_at = new Date().toISOString();

  const { error } = await supabaseUpdate(env, 'orgs', { org_id: orgId }, updates);
  if (error) {
    return errorResponse(`Failed to update organization: ${error}`, 500);
  }

  // Return the updated org by merging updates with current data
  const { org } = roleCheck;
  return jsonResponse({
    org_id: org.org_id,
    name: (updates.name as string) ?? org.name,
    slug: (updates.slug as string) ?? org.slug,
    billing_account_id: org.billing_account_id,
    owner_user_id: org.owner_user_id,
    billing_email: updates.billing_email !== undefined ? updates.billing_email : (org.billing_email ?? null),
    company_name: updates.company_name !== undefined ? updates.company_name : (org.company_name ?? null),
    created_at: org.created_at,
    updated_at: updates.updated_at,
  });
}

// ============================================
// 5. DELETE /v1/orgs/:org_id — Delete Org
// ============================================

export async function handleDeleteOrg(
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

  // Check subscription status — no active billing should remain
  const { data: billingAccounts } = await supabaseQuery(env, 'billing_accounts', {
    filters: { account_id: org.billing_account_id },
    select: 'subscription_status,stripe_subscription_id',
  });

  if (billingAccounts && billingAccounts.length > 0) {
    const billing = billingAccounts[0] as Record<string, unknown>;
    const subStatus = billing.subscription_status as string | null;
    if (subStatus && subStatus !== 'canceled' && subStatus !== 'none' && subStatus !== 'inactive') {
      return errorResponse(
        'Cannot delete organization with an active subscription. Cancel the subscription first.',
        409
      );
    }
  }

  // Revert all member agents' billing_account_id to personal billing accounts
  const { data: members } = await supabaseQuery(env, 'org_members', {
    filters: { org_id: orgId },
    select: 'user_id',
  });

  if (members) {
    for (const m of members) {
      const member = m as Record<string, unknown>;
      const memberUserId = member.user_id as string;

      // Find the member's personal billing account
      const { data: personalAccounts } = await supabaseQuery(env, 'billing_accounts', {
        filters: { user_id: memberUserId },
        select: 'account_id',
      });

      if (personalAccounts && personalAccounts.length > 0) {
        const personalAccount = personalAccounts[0] as Record<string, unknown>;
        const personalAccountId = personalAccount.account_id as string;

        // Revert agents owned by this user to their personal billing account
        await supabaseUpdate(
          env,
          'agents',
          { user_id: memberUserId, billing_account_id: org.billing_account_id },
          { billing_account_id: personalAccountId }
        );
      }
    }
  }

  // Delete org (CASCADE deletes members and invitations)
  const { error: deleteError } = await supabaseDelete(env, 'orgs', { org_id: orgId });
  if (deleteError) {
    return errorResponse(`Failed to delete organization: ${deleteError}`, 500);
  }

  // Clear billing_accounts.org_id
  await supabaseUpdate(
    env,
    'billing_accounts',
    { account_id: org.billing_account_id },
    { org_id: null, updated_at: new Date().toISOString() }
  );

  // Log billing event
  await logBillingEvent(env, org.billing_account_id, 'org_deleted', {
    org_id: orgId,
    name: org.name,
    slug: org.slug,
  });

  return jsonResponse({ deleted: true });
}

// ============================================
// 6. GET /v1/orgs/:org_id/members — List Members
// ============================================

export async function handleListMembers(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  // Any member can list members
  const roleCheck = await requireOrgRole(env, user.sub, orgId, [
    'owner', 'admin', 'member', 'viewer', 'auditor',
  ]);
  if (roleCheck instanceof Response) return roleCheck;

  const { data, error } = await supabaseRpc(env, 'get_org_members', {
    p_org_id: orgId,
  });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  return jsonResponse({ members: data ?? [] });
}

// ============================================
// 7. POST /v1/orgs/:org_id/invitations — Invite Member
// ============================================

export async function handleInviteMember(
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

  const { org, member: callerMember } = roleCheck;

  const body = await request.json() as { email?: string; role?: string };
  const email = (body.email || '').trim().toLowerCase();
  const role = (body.role || 'member') as OrgRole;

  if (!email || !email.includes('@') || !email.includes('.')) {
    return errorResponse('A valid email address is required', 400);
  }

  // Cannot invite as owner
  if (role === 'owner') {
    return errorResponse('Cannot invite as owner. Ownership transfer is not supported.', 400);
  }

  // Validate role is a known role
  const validRoles: OrgRole[] = ['admin', 'member', 'viewer', 'auditor'];
  if (!validRoles.includes(role)) {
    return errorResponse(`Invalid role: ${role}. Must be one of: ${validRoles.join(', ')}`, 400);
  }

  // Viewer and auditor require rbac feature
  if (role === 'viewer' || role === 'auditor') {
    const featureGate = await requireOrgFeature(env, orgId, 'rbac');
    if (featureGate) return featureGate;
  }

  // Check if the email is already a member
  const { data: existingMembers } = await supabaseRpc(env, 'get_org_members', {
    p_org_id: orgId,
  });

  if (existingMembers) {
    const membersList = existingMembers as Array<Record<string, unknown>>;
    const alreadyMember = membersList.find(
      m => (m.email as string || '').toLowerCase() === email
    );
    if (alreadyMember) {
      return errorResponse('This user is already a member of the organization', 409);
    }
  }

  // Check for existing pending invitation
  const { data: existingInvitations } = await supabaseQuery(env, 'org_invitations', {
    filters: { org_id: orgId, email, status: 'pending' },
    select: 'invitation_id',
  });

  if (existingInvitations && existingInvitations.length > 0) {
    return errorResponse('A pending invitation already exists for this email address', 409);
  }

  // Generate token: UUID + random hex for high entropy
  const plainToken = `${crypto.randomUUID()}${randomHex(16)}`;
  const tokenHash = await sha256(plainToken);

  const invitationId = `inv-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const { error: insertError } = await supabaseInsert(env, 'org_invitations', {
    invitation_id: invitationId,
    org_id: orgId,
    email,
    role,
    token_hash: tokenHash,
    invited_by: user.sub,
    status: 'pending',
    expires_at: expiresAt.toISOString(),
    created_at: now.toISOString(),
  });

  if (insertError) {
    return errorResponse(`Failed to create invitation: ${insertError}`, 500);
  }

  // Send invitation email (best-effort)
  try {
    const acceptUrl = `https://mnemom.ai/org/accept-invite?token=${plainToken}`;
    const inviterName = user.email?.split('@')[0] || 'A team member';
    const template = orgInviteEmail({
      inviterName,
      orgName: org.name,
      acceptUrl,
    });
    await sendEmail(email, template, env);
  } catch (emailErr) {
    console.error('[org] Invitation email failed:', emailErr);
    // Don't fail — the invitation was created
  }

  // Log billing event
  await logBillingEvent(env, org.billing_account_id, 'org_invitation_sent', {
    invitation_id: invitationId,
    org_id: orgId,
    email,
    role,
    invited_by: user.sub,
  });

  return jsonResponse({
    invitation_id: invitationId,
    org_id: orgId,
    email,
    role,
    token: plainToken,
    status: 'pending',
    expires_at: expiresAt.toISOString(),
    created_at: now.toISOString(),
  }, 201);
}

// ============================================
// 8. GET /v1/orgs/:org_id/invitations — List Invitations
// ============================================

export async function handleListInvitations(
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

  const { data, error } = await supabaseQuery(env, 'org_invitations', {
    filters: { org_id: orgId },
    select: 'invitation_id,org_id,email,role,invited_by,status,expires_at,created_at',
    order: 'created_at.desc',
  });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  return jsonResponse({ invitations: data ?? [] });
}

// ============================================
// 9. DELETE /v1/orgs/:org_id/invitations/:id — Revoke Invitation
// ============================================

export async function handleRevokeInvitation(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string,
  invitationId: string
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  // Owner or admin only
  const roleCheck = await requireOrgRole(env, user.sub, orgId, ['owner', 'admin']);
  if (roleCheck instanceof Response) return roleCheck;

  const { org } = roleCheck;

  // Verify the invitation exists and belongs to this org
  const { data: invitations } = await supabaseQuery(env, 'org_invitations', {
    filters: { invitation_id: invitationId, org_id: orgId },
    select: 'invitation_id,status',
  });

  if (!invitations || invitations.length === 0) {
    return errorResponse('Invitation not found', 404);
  }

  const invitation = invitations[0] as Record<string, unknown>;
  if (invitation.status !== 'pending') {
    return errorResponse(`Cannot revoke invitation with status '${invitation.status}'`, 400);
  }

  const { error } = await supabaseUpdate(
    env,
    'org_invitations',
    { invitation_id: invitationId },
    { status: 'revoked' }
  );

  if (error) {
    return errorResponse(`Failed to revoke invitation: ${error}`, 500);
  }

  // Log billing event
  await logBillingEvent(env, org.billing_account_id, 'org_invitation_revoked', {
    invitation_id: invitationId,
    org_id: orgId,
    revoked_by: user.sub,
  });

  return jsonResponse({ revoked: true, invitation_id: invitationId });
}

// ============================================
// 10. POST /v1/orgs/invitations/accept — Accept Invitation
// ============================================

export async function handleAcceptInvitation(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const body = await request.json() as { token?: string };
  const token = (body.token || '').trim();

  if (!token) {
    return errorResponse('token is required', 400);
  }

  // Hash the token
  const tokenHash = await sha256(token);

  // Call the accept_org_invitation RPC
  const { data, error } = await supabaseRpc(env, 'accept_org_invitation', {
    p_token_hash: tokenHash,
    p_user_id: user.sub,
    p_email: user.email ?? '',
  });

  if (error) {
    return errorResponse(`Failed to accept invitation: ${error}`, 500);
  }

  const result = data as Record<string, unknown>;

  // Handle RPC error codes
  if (result.error_code) {
    const errorCode = result.error_code as string;
    const errorMessages: Record<string, { message: string; status: number }> = {
      invitation_not_found: { message: 'Invitation not found or already used', status: 404 },
      invitation_expired: { message: 'This invitation has expired', status: 410 },
      email_mismatch: { message: 'This invitation was sent to a different email address', status: 403 },
      already_in_org: { message: 'You are already a member of an organization', status: 409 },
    };

    const err = errorMessages[errorCode] || { message: `Invitation error: ${errorCode}`, status: 400 };
    return errorResponse(err.message, err.status);
  }

  const orgId = result.org_id as string;
  const orgName = result.org_name as string;
  const role = result.role as string;
  const orgBillingAccountId = result.billing_account_id as string;

  // Update all user's agents' billing_account_id to org's billing account
  if (orgBillingAccountId) {
    // Find user's personal billing account to get current agents
    const { data: personalAccounts } = await supabaseQuery(env, 'billing_accounts', {
      filters: { user_id: user.sub },
      select: 'account_id',
    });

    if (personalAccounts && personalAccounts.length > 0) {
      const personalAccount = personalAccounts[0] as Record<string, unknown>;
      const personalAccountId = personalAccount.account_id as string;

      // Update agents from personal to org billing
      await supabaseUpdate(
        env,
        'agents',
        { user_id: user.sub, billing_account_id: personalAccountId },
        { billing_account_id: orgBillingAccountId }
      );

      // Set org_id on personal billing account
      await supabaseUpdate(
        env,
        'billing_accounts',
        { account_id: personalAccountId },
        { org_id: orgId, updated_at: new Date().toISOString() }
      );
    }

    // Purge KV cache for affected agents
    if (env.BILLING_CACHE) {
      try {
        const { data: userAgents } = await supabaseQuery(env, 'agents', {
          filters: { user_id: user.sub },
          select: 'agent_id',
        });

        if (userAgents) {
          for (const agent of userAgents) {
            const a = agent as Record<string, unknown>;
            await env.BILLING_CACHE.delete(`billing:${a.agent_id}`);
          }
        }
      } catch (cacheErr) {
        console.warn('[org] KV cache purge failed:', cacheErr);
      }
    }
  }

  // Check if user has an active personal subscription
  let personalSubscriptionWarning: string | null = null;
  const { data: personalBilling } = await supabaseQuery(env, 'billing_accounts', {
    filters: { user_id: user.sub },
    select: 'subscription_status,stripe_subscription_id',
  });

  if (personalBilling && personalBilling.length > 0) {
    const pb = personalBilling[0] as Record<string, unknown>;
    const subStatus = pb.subscription_status as string | null;
    if (subStatus === 'active' || subStatus === 'trialing') {
      personalSubscriptionWarning =
        'You have an active personal subscription. Your agents are now billed under the organization. ' +
        'You may want to cancel your personal subscription to avoid double billing.';
    }
  }

  // Log billing event
  if (orgBillingAccountId) {
    await logBillingEvent(env, orgBillingAccountId, 'org_invitation_accepted', {
      org_id: orgId,
      user_id: user.sub,
      role,
    });
  }

  return jsonResponse({
    org_id: orgId,
    org_name: orgName,
    role,
    ...(personalSubscriptionWarning ? { personal_subscription_warning: personalSubscriptionWarning } : {}),
  });
}

// ============================================
// 11. PATCH /v1/orgs/:org_id/members/:user_id — Update Member Role
// ============================================

export async function handleUpdateMemberRole(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string,
  targetUserId: string
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  // Owner only
  const roleCheck = await requireOrgRole(env, user.sub, orgId, ['owner']);
  if (roleCheck instanceof Response) return roleCheck;

  const { org, member: callerMember } = roleCheck;

  // Cannot change own role
  if (targetUserId === user.sub) {
    return errorResponse('Cannot change your own role', 400);
  }

  const body = await request.json() as { role?: string };
  const newRole = body.role as OrgRole;

  if (!newRole) {
    return errorResponse('role is required', 400);
  }

  // Validate using canAssignRole
  // Check if rbac feature is enabled for advanced roles
  const rbacGate = await requireOrgFeature(env, orgId, 'rbac');
  const hasRbac = rbacGate === null; // null means allowed

  const { allowed, reason } = canAssignRole(callerMember.role, newRole, hasRbac);
  if (!allowed) {
    return errorResponse(reason || 'Role assignment not permitted', 403);
  }

  // Get the target member's current role
  const { data: targetMembers } = await supabaseQuery(env, 'org_members', {
    filters: { org_id: orgId, user_id: targetUserId },
    select: 'role,user_id',
  });

  if (!targetMembers || targetMembers.length === 0) {
    return errorResponse('Member not found in this organization', 404);
  }

  const targetMember = targetMembers[0] as Record<string, unknown>;
  const oldRole = targetMember.role as string;

  if (oldRole === newRole) {
    return errorResponse(`Member already has role '${newRole}'`, 400);
  }

  // Check for last-owner demotion
  if (oldRole === 'owner') {
    const { data: owners } = await supabaseQuery(env, 'org_members', {
      filters: { org_id: orgId, role: 'owner' },
      select: 'user_id',
    });

    if (!owners || owners.length <= 1) {
      return errorResponse('Cannot demote the last owner. Transfer ownership first or add another owner.', 400);
    }
  }

  // Update role
  const { error } = await supabaseUpdate(
    env,
    'org_members',
    { org_id: orgId, user_id: targetUserId },
    { role: newRole }
  );

  if (error) {
    return errorResponse(`Failed to update role: ${error}`, 500);
  }

  // Send role change email (best-effort)
  try {
    // Get target user's email
    const { data: targetAccounts } = await supabaseQuery(env, 'billing_accounts', {
      filters: { user_id: targetUserId },
      select: 'email',
    });

    if (targetAccounts && targetAccounts.length > 0) {
      const targetAccount = targetAccounts[0] as Record<string, unknown>;
      const targetEmail = targetAccount.email as string;
      if (targetEmail) {
        const template = orgRoleChangeEmail({
          orgName: org.name,
          oldRole,
          newRole,
        });
        await sendEmail(targetEmail, template, env);
      }
    }
  } catch (emailErr) {
    console.error('[org] Role change email failed:', emailErr);
  }

  // Log billing event
  await logBillingEvent(env, org.billing_account_id, 'org_member_role_changed', {
    org_id: orgId,
    target_user_id: targetUserId,
    old_role: oldRole,
    new_role: newRole,
    changed_by: user.sub,
  });

  return jsonResponse({
    org_id: orgId,
    user_id: targetUserId,
    old_role: oldRole,
    new_role: newRole,
  });
}

// ============================================
// 12. DELETE /v1/orgs/:org_id/members/:user_id — Remove Member
// ============================================

export async function handleRemoveMember(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string,
  targetUserId: string
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const isSelfLeave = targetUserId === user.sub;

  // Owner or admin can remove others; anyone can remove themselves (self-leave)
  const requiredRoles: OrgRole[] = isSelfLeave
    ? ['owner', 'admin', 'member', 'viewer', 'auditor']
    : ['owner', 'admin'];

  const roleCheck = await requireOrgRole(env, user.sub, orgId, requiredRoles);
  if (roleCheck instanceof Response) return roleCheck;

  const { org } = roleCheck;

  // Get the target member
  const { data: targetMembers } = await supabaseQuery(env, 'org_members', {
    filters: { org_id: orgId, user_id: targetUserId },
    select: 'role,user_id',
  });

  if (!targetMembers || targetMembers.length === 0) {
    return errorResponse('Member not found in this organization', 404);
  }

  const targetMember = targetMembers[0] as Record<string, unknown>;
  const targetRole = targetMember.role as string;

  // Cannot remove the last owner
  if (targetRole === 'owner') {
    const { data: owners } = await supabaseQuery(env, 'org_members', {
      filters: { org_id: orgId, role: 'owner' },
      select: 'user_id',
    });

    if (!owners || owners.length <= 1) {
      return errorResponse('Cannot remove the last owner. Transfer ownership or delete the organization.', 400);
    }
  }

  // Revert target user's agents' billing_account_id to their personal billing account
  const { data: personalAccounts } = await supabaseQuery(env, 'billing_accounts', {
    filters: { user_id: targetUserId },
    select: 'account_id',
  });

  if (personalAccounts && personalAccounts.length > 0) {
    const personalAccount = personalAccounts[0] as Record<string, unknown>;
    const personalAccountId = personalAccount.account_id as string;

    await supabaseUpdate(
      env,
      'agents',
      { user_id: targetUserId, billing_account_id: org.billing_account_id },
      { billing_account_id: personalAccountId }
    );

    // Clear org_id on the personal billing account
    await supabaseUpdate(
      env,
      'billing_accounts',
      { account_id: personalAccountId },
      { org_id: null, updated_at: new Date().toISOString() }
    );
  }

  // Revoke any org API keys created by this user
  await supabaseUpdate(
    env,
    'mnemom_api_keys',
    { org_id: orgId, user_id: targetUserId, is_active: 'true' } as Record<string, string>,
    { is_active: false, revoked_at: new Date().toISOString() }
  );

  // Delete org_members row
  const { error: deleteError } = await supabaseDelete(env, 'org_members', {
    org_id: orgId,
    user_id: targetUserId,
  });

  if (deleteError) {
    return errorResponse(`Failed to remove member: ${deleteError}`, 500);
  }

  // Purge KV cache for affected agents
  if (env.BILLING_CACHE) {
    try {
      const { data: userAgents } = await supabaseQuery(env, 'agents', {
        filters: { user_id: targetUserId },
        select: 'agent_id',
      });

      if (userAgents) {
        for (const agent of userAgents) {
          const a = agent as Record<string, unknown>;
          await env.BILLING_CACHE.delete(`billing:${a.agent_id}`);
        }
      }
    } catch (cacheErr) {
      console.warn('[org] KV cache purge failed:', cacheErr);
    }
  }

  // Log billing event
  await logBillingEvent(env, org.billing_account_id, 'org_member_removed', {
    org_id: orgId,
    target_user_id: targetUserId,
    target_role: targetRole,
    removed_by: user.sub,
    self_leave: isSelfLeave,
  });

  return jsonResponse({
    removed: true,
    org_id: orgId,
    user_id: targetUserId,
  });
}

// ============================================
// 13. GET /v1/orgs/:org_id/agents — Get Org Agents
// ============================================

export async function handleGetOrgAgents(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  // Any member can view agents
  const roleCheck = await requireOrgRole(env, user.sub, orgId, [
    'owner', 'admin', 'member', 'viewer', 'auditor',
  ]);
  if (roleCheck instanceof Response) return roleCheck;

  // Feature gate: fleet_dashboard
  const featureGate = await requireOrgFeature(env, orgId, 'fleet_dashboard');
  if (featureGate) return featureGate;

  const { data, error } = await supabaseRpc(env, 'get_org_agent_fleet', {
    p_org_id: orgId,
  });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  let agents = (data ?? []) as Array<Record<string, unknown>>;

  // Filter to current user's agents if ?mine=true
  const url = new URL(request.url);
  const mineOnly = url.searchParams.get('mine') === 'true';

  if (mineOnly) {
    agents = agents.filter(a => a.owner_email === user.email);
  }

  return jsonResponse({ agents });
}

// ============================================
// 14. POST /v1/orgs/:org_id/api-keys — Create Org API Key
// ============================================

export async function handleCreateOrgApiKey(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  // Owner, admin, or member
  const roleCheck = await requireOrgRole(env, user.sub, orgId, ['owner', 'admin', 'member']);
  if (roleCheck instanceof Response) return roleCheck;

  const { org } = roleCheck;

  // Parse optional name from body
  let name = 'Default';
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.name && typeof body.name === 'string') {
      name = body.name.slice(0, 100);
    }
  } catch {
    // No body or invalid JSON — use default name
  }

  // Generate key: mnm_ + 32 random hex chars (same as api-keys.ts)
  const keySecret = `mnm_${randomHex(16)}`;
  const keyHash = await sha256(keySecret);
  const keyPrefix = keySecret.slice(0, 8); // 'mnm_xxxx'
  const keyId = `mk-${randomHex(8)}`;

  // Store in mnemom_api_keys with org_id set
  const { error: insertError } = await supabaseInsert(env, 'mnemom_api_keys', {
    key_id: keyId,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    user_id: user.sub,
    account_id: org.billing_account_id,
    org_id: orgId,
    name,
    scopes: ['gateway', 'api'],
    is_active: true,
  });

  if (insertError) {
    return errorResponse(`Failed to create API key: ${insertError}`, 500);
  }

  // Log billing event
  await logBillingEvent(env, org.billing_account_id, 'org_api_key_created', {
    key_id: keyId,
    key_prefix: keyPrefix,
    org_id: orgId,
    created_by: user.sub,
  });

  return jsonResponse({
    key_id: keyId,
    key: keySecret,
    key_prefix: keyPrefix,
    name,
    org_id: orgId,
    scopes: ['gateway', 'api'],
    created_at: new Date().toISOString(),
  }, 201);
}

// ============================================
// 15. GET /v1/orgs/:org_id/api-keys — List Org API Keys
// ============================================

export async function handleListOrgApiKeys(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  // Any member can list keys
  const roleCheck = await requireOrgRole(env, user.sub, orgId, [
    'owner', 'admin', 'member', 'viewer', 'auditor',
  ]);
  if (roleCheck instanceof Response) return roleCheck;

  const { data, error } = await supabaseQuery(env, 'mnemom_api_keys', {
    filters: { org_id: orgId, is_active: 'true' },
    select: 'key_id,key_prefix,name,user_id,scopes,created_at,last_used_at',
    order: 'created_at.desc',
  });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  return jsonResponse({ keys: data ?? [] });
}

// ============================================
// 16. DELETE /v1/orgs/:org_id/api-keys/:key_id — Revoke Org API Key
// ============================================

export async function handleRevokeOrgApiKey(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string,
  keyId: string
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  // Owner, admin, or the key creator can revoke
  const roleCheck = await requireOrgRole(env, user.sub, orgId, [
    'owner', 'admin', 'member', 'viewer', 'auditor',
  ]);
  if (roleCheck instanceof Response) return roleCheck;

  const { org, member: callerMember } = roleCheck;

  // Verify the key exists and belongs to this org
  const { data: keys } = await supabaseQuery(env, 'mnemom_api_keys', {
    filters: { key_id: keyId, org_id: orgId, is_active: 'true' },
    select: 'key_id,user_id',
  });

  if (!keys || keys.length === 0) {
    return errorResponse('API key not found', 404);
  }

  const key = keys[0] as Record<string, unknown>;
  const keyCreator = key.user_id as string;

  // Only owner, admin, or the key creator can revoke
  const canRevoke =
    callerMember.role === 'owner' ||
    callerMember.role === 'admin' ||
    keyCreator === user.sub;

  if (!canRevoke) {
    return errorResponse('Only owners, admins, or the key creator can revoke API keys', 403);
  }

  // Soft-delete
  const { error } = await supabaseUpdate(
    env,
    'mnemom_api_keys',
    { key_id: keyId },
    { is_active: false, revoked_at: new Date().toISOString() }
  );

  if (error) {
    return errorResponse(`Failed to revoke key: ${error}`, 500);
  }

  // Log billing event
  await logBillingEvent(env, org.billing_account_id, 'org_api_key_revoked', {
    key_id: keyId,
    org_id: orgId,
    revoked_by: user.sub,
  });

  return jsonResponse({ revoked: true, key_id: keyId });
}

// ============================================
// 17. GET /v1/orgs/:org_id/drift — Get Org Drift Alerts
// ============================================

export async function handleGetOrgDrift(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const roleCheck = await requireOrgRole(env, user.sub, orgId, [
    'owner', 'admin', 'member', 'viewer', 'auditor',
  ]);
  if (roleCheck instanceof Response) return roleCheck;

  const featureGate = await requireOrgFeature(env, orgId, 'fleet_dashboard');
  if (featureGate) return featureGate;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 200);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10) || 0;

  const { data, error } = await supabaseRpc(env, 'get_org_drift_alerts', {
    p_org_id: orgId,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  return jsonResponse(data ?? { alerts: [], summary: { total_active: 0, agents_drifting: 0, high_severity: 0, trend: 'stable' } });
}

// ============================================
// 18. POST /v1/orgs/:org_id/drift/:alert_id/acknowledge
// ============================================

export async function handleAcknowledgeDriftAlert(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string,
  alertId: string
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  // Only owner, admin, member can acknowledge — not viewer/auditor
  const roleCheck = await requireOrgRole(env, user.sub, orgId, [
    'owner', 'admin', 'member',
  ]);
  if (roleCheck instanceof Response) return roleCheck;

  const featureGate = await requireOrgFeature(env, orgId, 'fleet_dashboard');
  if (featureGate) return featureGate;

  const { data, error } = await supabaseRpc(env, 'acknowledge_drift_alert', {
    p_alert_id: alertId,
    p_org_id: orgId,
    p_user_id: user.sub,
  });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  // Emit drift.resolved webhook event (non-blocking, fail-open)
  try {
    const { emitWebhookEvent } = await import('../webhooks/emitter');
    await emitWebhookEvent(env, roleCheck.org.billing_account_id, 'drift.resolved', {
      alert_id: alertId,
      org_id: orgId,
      acknowledged_by: user.sub,
    });
  } catch {
    // Fail-open
  }

  return jsonResponse(data ?? { acknowledged: false });
}

// ============================================
// 19. GET /v1/orgs/:org_id/export/fleet — Fleet Export (CSV/PDF)
// ============================================

export async function handleFleetExport(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter,
  orgId: string
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const roleCheck = await requireOrgRole(env, user.sub, orgId, [
    'owner', 'admin', 'member', 'viewer', 'auditor',
  ]);
  if (roleCheck instanceof Response) return roleCheck;

  const featureGate = await requireOrgFeature(env, orgId, 'fleet_dashboard');
  if (featureGate) return featureGate;

  const url = new URL(request.url);
  const format = url.searchParams.get('format') ?? 'csv';

  // Fetch fleet data
  const { data, error } = await supabaseRpc(env, 'get_org_agent_fleet', {
    p_org_id: orgId,
  });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  const agents = (data ?? []) as Array<Record<string, unknown>>;

  if (format === 'pdf') {
    const { generateFleetPdf } = await import('./pdf-export');
    const org = (roleCheck as { org: { name: string } }).org;
    const pdfBytes = await generateFleetPdf(agents, org.name);
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="fleet-report-${new Date().toISOString().split('T')[0]}.pdf"`,
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // Default: CSV
  let csv = 'Agent Name,Owner Email,Integrity Score,Latest Verdict,Last Seen,Active Drift Alerts,Worst Severity,Checks This Period,Created\n';
  for (const a of agents) {
    const score = typeof a.integrity_score === 'number' ? Math.round((a.integrity_score as number) * 100) + '%' : 'N/A';
    csv += `"${a.agent_name ?? ''}","${a.owner_email ?? ''}",${score},${a.latest_verdict ?? 'none'},${a.last_seen ?? 'never'},${a.active_drift_alerts ?? 0},${a.worst_drift_severity ?? 'none'},${a.check_count ?? 0},${a.created_at ?? ''}\n`;
  }

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="fleet-${new Date().toISOString().split('T')[0]}.csv"`,
      'Access-Control-Allow-Origin': '*',
    },
  });
}
