/**
 * Tests for org module: RBAC pure functions and org lifecycle handlers.
 * Follows the exact pattern from billing/__tests__/enterprise-contact.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mock global fetch
// ============================================================================

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ============================================================================
// Test helpers
// ============================================================================

function jsonOk(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function jsonError(status: number, text = 'error') {
  return new Response(text, { status });
}

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_KEY: 'test-key',
    SUPABASE_JWT_SECRET: 'test-jwt-secret',
    MNEMOM_PUBLISH_KEY: 'test-publish-key',
    STRIPE_SECRET_KEY: 'sk_test_xxx',
    STRIPE_WEBHOOK_SECRET: 'whsec_xxx',
    RESEND_API_KEY: 're_test_xxx',
    BILLING_CACHE: {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

const mockUser = { sub: 'user-123', email: 'test@example.com', exp: 9999999999, iat: 1000000000 };
const mockGetAuth = vi.fn().mockResolvedValue(mockUser);

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(`https://api.mnemom.ai${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

// ============================================================================
// RBAC Permission Matrix (pure function tests)
// ============================================================================

describe('RBAC permissions', () => {
  let ROLE_PERMISSIONS: typeof import('../../org/rbac').ROLE_PERMISSIONS;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();

    vi.doMock('stripe', () => ({
      default: class MockStripe {
        static createFetchHttpClient() { return {}; }
      },
    }));

    const mod = await import('../../org/rbac');
    ROLE_PERMISSIONS = mod.ROLE_PERMISSIONS;
  });

  it('owner has full permissions on all dimensions', () => {
    const perms = ROLE_PERMISSIONS.owner;
    expect(perms.dashboard).toBe('full');
    expect(perms.agents).toBe('full');
    expect(perms.billing).toBe('full');
    expect(perms.settings).toBe('full');
    expect(perms.compliance).toBe('full');
  });

  it('admin has edit on settings and view on billing', () => {
    const perms = ROLE_PERMISSIONS.admin;
    expect(perms.dashboard).toBe('full');
    expect(perms.agents).toBe('full');
    expect(perms.billing).toBe('view');
    expect(perms.settings).toBe('edit');
    expect(perms.compliance).toBe('full');
  });

  it('member has own on agents and none on billing/settings', () => {
    const perms = ROLE_PERMISSIONS.member;
    expect(perms.dashboard).toBe('full');
    expect(perms.agents).toBe('own');
    expect(perms.billing).toBe('none');
    expect(perms.settings).toBe('none');
    expect(perms.compliance).toBe('view');
  });

  it('viewer has view-only permissions', () => {
    const perms = ROLE_PERMISSIONS.viewer;
    expect(perms.dashboard).toBe('view');
    expect(perms.agents).toBe('view');
    expect(perms.billing).toBe('none');
    expect(perms.settings).toBe('none');
    expect(perms.compliance).toBe('view');
  });

  it('auditor has full+export on compliance', () => {
    const perms = ROLE_PERMISSIONS.auditor;
    expect(perms.dashboard).toBe('view');
    expect(perms.agents).toBe('view');
    expect(perms.billing).toBe('view');
    expect(perms.settings).toBe('none');
    expect(perms.compliance).toBe('full+export');
  });
});

// ============================================================================
// canAssignRole (pure function tests)
// ============================================================================

describe('canAssignRole', () => {
  let canAssignRole: typeof import('../../org/rbac').canAssignRole;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();

    vi.doMock('stripe', () => ({
      default: class MockStripe {
        static createFetchHttpClient() { return {}; }
      },
    }));

    const mod = await import('../../org/rbac');
    canAssignRole = mod.canAssignRole;
  });

  it('owner can assign admin role', () => {
    const result = canAssignRole('owner', 'admin', true);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('owner can assign member role', () => {
    const result = canAssignRole('owner', 'member', true);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('owner cannot assign owner role', () => {
    const result = canAssignRole('owner', 'owner', true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Ownership transfer');
  });

  it('admin cannot assign any role', () => {
    const result = canAssignRole('admin', 'member', true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Only the organization owner');
  });

  it('viewer/auditor roles rejected when rbac disabled', () => {
    const viewerResult = canAssignRole('owner', 'viewer', false);
    expect(viewerResult.allowed).toBe(false);
    expect(viewerResult.reason).toContain('RBAC feature');

    const auditorResult = canAssignRole('owner', 'auditor', false);
    expect(auditorResult.allowed).toBe(false);
    expect(auditorResult.reason).toContain('RBAC feature');
  });

  it('viewer/auditor roles allowed when rbac enabled', () => {
    const viewerResult = canAssignRole('owner', 'viewer', true);
    expect(viewerResult.allowed).toBe(true);

    const auditorResult = canAssignRole('owner', 'auditor', true);
    expect(auditorResult.allowed).toBe(true);
  });
});

// ============================================================================
// requireOrgRole (async function, uses fetch internally)
// ============================================================================

describe('requireOrgRole', () => {
  let requireOrgRole: typeof import('../../org/rbac').requireOrgRole;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();

    vi.doMock('stripe', () => ({
      default: class MockStripe {
        static createFetchHttpClient() { return {}; }
      },
    }));

    const mod = await import('../../org/rbac');
    requireOrgRole = mod.requireOrgRole;
  });

  it('returns org and member for valid user with allowed role', async () => {
    const env = makeEnv();
    // Mock: supabaseRpc('get_org_for_user') returns org data with owner role
    mockFetch.mockResolvedValueOnce(jsonOk({
      org_id: 'org-001',
      name: 'Acme Corp',
      slug: 'acme-corp',
      billing_account_id: 'ba-001',
      owner_user_id: 'user-123',
      role: 'owner',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }));

    const result = await requireOrgRole(env as any, 'user-123', 'org-001', ['owner', 'admin']);
    expect(result).not.toBeInstanceOf(Response);
    const data = result as { org: { org_id: string; name: string }; member: { role: string } };
    expect(data.org.org_id).toBe('org-001');
    expect(data.org.name).toBe('Acme Corp');
    expect(data.member.role).toBe('owner');
  });

  it('returns 403 when user role is not in allowed list', async () => {
    const env = makeEnv();
    mockFetch.mockResolvedValueOnce(jsonOk({
      org_id: 'org-001',
      name: 'Acme Corp',
      slug: 'acme-corp',
      billing_account_id: 'ba-001',
      owner_user_id: 'user-owner',
      role: 'member',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }));

    const result = await requireOrgRole(env as any, 'user-456', 'org-001', ['owner']);
    expect(result).toBeInstanceOf(Response);
    const res = result as Response;
    expect(res.status).toBe(403);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('Access denied');
  });

  it('returns 403 when org_id does not match', async () => {
    const env = makeEnv();
    mockFetch.mockResolvedValueOnce(jsonOk({
      org_id: 'org-002',
      name: 'Other Org',
      slug: 'other-org',
      billing_account_id: 'ba-002',
      owner_user_id: 'user-123',
      role: 'owner',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }));

    const result = await requireOrgRole(env as any, 'user-123', 'org-001', ['owner']);
    expect(result).toBeInstanceOf(Response);
    const res = result as Response;
    expect(res.status).toBe(403);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('not a member');
  });

  it('returns 404 when RPC returns error', async () => {
    const env = makeEnv();
    mockFetch.mockResolvedValueOnce(jsonError(500, 'Database error'));

    const result = await requireOrgRole(env as any, 'user-123', 'org-001', ['owner']);
    expect(result).toBeInstanceOf(Response);
    const res = result as Response;
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// getOrgMembership (async function, uses fetch internally)
// ============================================================================

describe('getOrgMembership', () => {
  let getOrgMembership: typeof import('../../org/rbac').getOrgMembership;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();

    vi.doMock('stripe', () => ({
      default: class MockStripe {
        static createFetchHttpClient() { return {}; }
      },
    }));

    const mod = await import('../../org/rbac');
    getOrgMembership = mod.getOrgMembership;
  });

  it('returns org and member when user belongs to org', async () => {
    const env = makeEnv();
    mockFetch.mockResolvedValueOnce(jsonOk({
      org_id: 'org-001',
      name: 'Acme Corp',
      slug: 'acme-corp',
      billing_account_id: 'ba-001',
      owner_user_id: 'user-123',
      role: 'admin',
      invited_by: 'user-owner',
      invited_at: '2025-01-01T00:00:00Z',
      accepted_at: '2025-01-02T00:00:00Z',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }));

    const result = await getOrgMembership(env as any, 'user-123');
    expect(result).not.toBeNull();
    expect(result!.org.org_id).toBe('org-001');
    expect(result!.member.role).toBe('admin');
    expect(result!.member.invited_by).toBe('user-owner');
  });

  it('returns null when user is not in any org', async () => {
    const env = makeEnv();
    // RPC returns empty/null data
    mockFetch.mockResolvedValueOnce(jsonOk(null));

    const result = await getOrgMembership(env as any, 'user-999');
    expect(result).toBeNull();
  });

  it('returns null when RPC returns data without org_id', async () => {
    const env = makeEnv();
    mockFetch.mockResolvedValueOnce(jsonOk({}));

    const result = await getOrgMembership(env as any, 'user-999');
    expect(result).toBeNull();
  });

  it('returns null when RPC fails', async () => {
    const env = makeEnv();
    mockFetch.mockResolvedValueOnce(jsonError(500, 'DB error'));

    const result = await getOrgMembership(env as any, 'user-123');
    expect(result).toBeNull();
  });
});

// ============================================================================
// requireOrgFeature (async function, uses fetch internally)
// ============================================================================

describe('requireOrgFeature', () => {
  let requireOrgFeature: typeof import('../../org/rbac').requireOrgFeature;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();

    vi.doMock('stripe', () => ({
      default: class MockStripe {
        static createFetchHttpClient() { return {}; }
      },
    }));

    const mod = await import('../../org/rbac');
    requireOrgFeature = mod.requireOrgFeature;
  });

  it('returns null (allowed) when feature flag is enabled', async () => {
    const env = makeEnv();
    // First fetch: supabaseQuery for orgs table
    mockFetch.mockResolvedValueOnce(jsonOk([{ billing_account_id: 'ba-001' }]));
    // Second fetch: supabaseRpc('admin_get_billing_summary')
    mockFetch.mockResolvedValueOnce(jsonOk({
      plan: { feature_flags: { rbac: true, compliance_export: true } },
    }));

    const result = await requireOrgFeature(env as any, 'org-001', 'rbac');
    expect(result).toBeNull();
  });

  it('returns 403 when feature flag is not enabled', async () => {
    const env = makeEnv();
    mockFetch.mockResolvedValueOnce(jsonOk([{ billing_account_id: 'ba-001' }]));
    mockFetch.mockResolvedValueOnce(jsonOk({
      plan: { feature_flags: { rbac: false } },
    }));

    const result = await requireOrgFeature(env as any, 'org-001', 'rbac');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
    const body = await result!.json() as Record<string, unknown>;
    expect(body.error).toBe('feature_gated');
    expect(body.feature).toBe('rbac');
  });

  it('returns null (fail-open) when org lookup fails', async () => {
    const env = makeEnv();
    mockFetch.mockResolvedValueOnce(jsonError(500, 'DB error'));

    const result = await requireOrgFeature(env as any, 'org-001', 'rbac');
    expect(result).toBeNull();
  });

  it('returns null (fail-open) when billing summary lookup fails', async () => {
    const env = makeEnv();
    mockFetch.mockResolvedValueOnce(jsonOk([{ billing_account_id: 'ba-001' }]));
    mockFetch.mockResolvedValueOnce(jsonError(500, 'Billing error'));

    const result = await requireOrgFeature(env as any, 'org-001', 'rbac');
    expect(result).toBeNull();
  });

  it('returns null (fail-open) when org has no billing_account_id', async () => {
    const env = makeEnv();
    mockFetch.mockResolvedValueOnce(jsonOk([{ billing_account_id: null }]));

    const result = await requireOrgFeature(env as any, 'org-001', 'rbac');
    expect(result).toBeNull();
  });

  it('returns 403 when feature flag is missing from plan', async () => {
    const env = makeEnv();
    mockFetch.mockResolvedValueOnce(jsonOk([{ billing_account_id: 'ba-001' }]));
    mockFetch.mockResolvedValueOnce(jsonOk({
      plan: { feature_flags: {} },
    }));

    const result = await requireOrgFeature(env as any, 'org-001', 'rbac');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });
});

// ============================================================================
// canAssignRole edge cases
// ============================================================================

describe('canAssignRole edge cases', () => {
  let canAssignRole: typeof import('../../org/rbac').canAssignRole;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();

    vi.doMock('stripe', () => ({
      default: class MockStripe {
        static createFetchHttpClient() { return {}; }
      },
    }));

    const mod = await import('../../org/rbac');
    canAssignRole = mod.canAssignRole;
  });

  it('member cannot assign any role', () => {
    const result = canAssignRole('member', 'admin', true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Only the organization owner');
  });

  it('viewer cannot assign any role', () => {
    const result = canAssignRole('viewer', 'member', true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Only the organization owner');
  });

  it('auditor cannot assign any role', () => {
    const result = canAssignRole('auditor', 'admin', false);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Only the organization owner');
  });

  it('owner can assign admin without rbac', () => {
    const result = canAssignRole('owner', 'admin', false);
    expect(result.allowed).toBe(true);
  });

  it('owner can assign member without rbac', () => {
    const result = canAssignRole('owner', 'member', false);
    expect(result.allowed).toBe(true);
  });

  it('viewer role reason mentions upgrading plan', () => {
    const result = canAssignRole('owner', 'viewer', false);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Upgrade your plan');
  });

  it('auditor role reason mentions the specific role name', () => {
    const result = canAssignRole('owner', 'auditor', false);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("'auditor'");
  });
});
