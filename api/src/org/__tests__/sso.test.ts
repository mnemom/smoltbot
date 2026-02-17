/**
 * Tests for SSO handlers: handleCheckDomain, handleGetSsoConfig, handleConfigureSso,
 * handleRemoveSso, handleTestSso.
 * Follows the exact pattern from org/__tests__/org.test.ts.
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
// handleCheckDomain
// ============================================================================

describe('handleCheckDomain', () => {
  let handleCheckDomain: typeof import('../../org/sso-handlers').handleCheckDomain;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    mockGetAuth.mockResolvedValue(mockUser);

    vi.doMock('stripe', () => ({
      default: class MockStripe {
        static createFetchHttpClient() { return {}; }
      },
    }));

    const mod = await import('../../org/sso-handlers');
    handleCheckDomain = mod.handleCheckDomain;
  });

  it('returns sso_enabled true when domain matches', async () => {
    const env = makeEnv();

    // Mock: supabaseRpc('check_sso_domain') returns SSO match
    mockFetch.mockResolvedValueOnce(jsonOk({
      sso_enabled: true,
      org_id: 'org-1',
      org_name: 'Acme Corp',
      org_slug: 'acme',
      idp_name: 'Okta',
      enforced: false,
      supabase_sso_provider_id: 'provider-uuid-123',
    }));

    const req = makeRequest('/v1/auth/sso/check-domain?email=user@acme.com');
    const res = await handleCheckDomain(env as any, req, mockGetAuth);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.sso_enabled).toBe(true);
    expect(body.org_id).toBe('org-1');
    expect(body.provider_id).toBe('provider-uuid-123');
    // supabase_sso_provider_id must be stripped
    expect(body.supabase_sso_provider_id).toBeUndefined();
  });

  it('returns sso_enabled false when no domain matches', async () => {
    const env = makeEnv();

    // Mock: RPC returns sso_enabled false
    mockFetch.mockResolvedValueOnce(jsonOk({ sso_enabled: false }));

    const req = makeRequest('/v1/auth/sso/check-domain?email=user@unknown.com');
    const res = await handleCheckDomain(env as any, req, mockGetAuth);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.sso_enabled).toBe(false);
  });

  it('returns 400 for missing email param', async () => {
    const env = makeEnv();

    const req = makeRequest('/v1/auth/sso/check-domain');
    const res = await handleCheckDomain(env as any, req, mockGetAuth);
    expect(res.status).toBe(400);

    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('email');
  });

  it('returns 400 for invalid email', async () => {
    const env = makeEnv();

    const req = makeRequest('/v1/auth/sso/check-domain?email=notanemail');
    const res = await handleCheckDomain(env as any, req, mockGetAuth);
    expect(res.status).toBe(400);

    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('email');
  });
});

// ============================================================================
// handleGetSsoConfig
// ============================================================================

describe('handleGetSsoConfig', () => {
  let handleGetSsoConfig: typeof import('../../org/sso-handlers').handleGetSsoConfig;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    mockGetAuth.mockResolvedValue(mockUser);

    vi.doMock('stripe', () => ({
      default: class MockStripe {
        static createFetchHttpClient() { return {}; }
      },
    }));

    const mod = await import('../../org/sso-handlers');
    handleGetSsoConfig = mod.handleGetSsoConfig;
  });

  it('returns config for owner', async () => {
    const env = makeEnv();

    // Mock 1: requireOrgRole -> get_org_for_user RPC returns owner
    mockFetch.mockResolvedValueOnce(jsonOk({
      org_id: 'org-1',
      name: 'Acme',
      slug: 'acme',
      billing_account_id: 'ba-1',
      owner_user_id: 'user-123',
      role: 'owner',
    }));

    // Mock 2: supabaseQuery org_sso_configs returns config
    mockFetch.mockResolvedValueOnce(jsonOk([{
      org_id: 'org-1',
      enabled: true,
      enforced: false,
      supabase_sso_provider_id: 'provider-uuid',
      metadata_url: 'https://idp.example.com/metadata',
      idp_name: 'Okta',
      default_role: 'member',
      allowed_domains: ['acme.com'],
    }]));

    const req = makeRequest('/v1/orgs/org-1/sso');
    const res = await handleGetSsoConfig(env as any, req, mockGetAuth, 'org-1');
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.org_id).toBe('org-1');
    expect(body.enabled).toBe(true);
    expect(body.idp_name).toBe('Okta');
    expect(body.metadata_url).toBe('https://idp.example.com/metadata');
    // supabase_sso_provider_id must be stripped
    expect(body.supabase_sso_provider_id).toBeUndefined();
  });

  it('returns configured: false when no SSO config exists', async () => {
    const env = makeEnv();

    // Mock 1: requireOrgRole success
    mockFetch.mockResolvedValueOnce(jsonOk({
      org_id: 'org-1',
      name: 'Acme',
      slug: 'acme',
      billing_account_id: 'ba-1',
      owner_user_id: 'user-123',
      role: 'admin',
    }));

    // Mock 2: org_sso_configs returns empty array
    mockFetch.mockResolvedValueOnce(jsonOk([]));

    const req = makeRequest('/v1/orgs/org-1/sso');
    const res = await handleGetSsoConfig(env as any, req, mockGetAuth, 'org-1');
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.configured).toBe(false);
  });

  it('returns 401 for unauthenticated requests', async () => {
    const env = makeEnv();

    // Override getAuth to return null
    mockGetAuth.mockResolvedValueOnce(null);

    const req = makeRequest('/v1/orgs/org-1/sso');
    const res = await handleGetSsoConfig(env as any, req, mockGetAuth, 'org-1');
    expect(res.status).toBe(401);

    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('Authentication');
  });

  it('returns 403 for member role', async () => {
    const env = makeEnv();

    // Mock: requireOrgRole returns 403 because 'member' is not in ['owner', 'admin']
    mockFetch.mockResolvedValueOnce(jsonOk({
      org_id: 'org-1',
      name: 'Acme',
      slug: 'acme',
      billing_account_id: 'ba-1',
      owner_user_id: 'user-owner',
      role: 'member',
    }));

    const req = makeRequest('/v1/orgs/org-1/sso');
    const res = await handleGetSsoConfig(env as any, req, mockGetAuth, 'org-1');
    expect(res.status).toBe(403);

    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('Access denied');
  });
});

// ============================================================================
// handleConfigureSso
// ============================================================================

describe('handleConfigureSso', () => {
  let handleConfigureSso: typeof import('../../org/sso-handlers').handleConfigureSso;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    mockGetAuth.mockResolvedValue(mockUser);

    vi.doMock('stripe', () => ({
      default: class MockStripe {
        static createFetchHttpClient() { return {}; }
      },
    }));

    const mod = await import('../../org/sso-handlers');
    handleConfigureSso = mod.handleConfigureSso;
  });

  it('creates SSO provider and stores config', async () => {
    const env = makeEnv();

    mockFetch
      // 1. requireOrgRole: get_org_for_user RPC
      .mockResolvedValueOnce(jsonOk({
        org_id: 'org-1',
        name: 'Acme Corp',
        slug: 'acme',
        billing_account_id: 'ba-1',
        owner_user_id: 'user-123',
        role: 'owner',
        billing_email: 'billing@acme.com',
      }))
      // 2. requireOrgFeature: supabaseQuery orgs for billing_account_id
      .mockResolvedValueOnce(jsonOk([{ billing_account_id: 'ba-1' }]))
      // 3. requireOrgFeature: admin_get_billing_summary RPC
      .mockResolvedValueOnce(jsonOk({ plan: { feature_flags: { sso_saml: true } } }))
      // 4. Check existing config: empty
      .mockResolvedValueOnce(jsonOk([]))
      // 5. Supabase SSO API: create provider
      .mockResolvedValueOnce(jsonOk({ id: 'provider-uuid-new' }))
      // 6. Insert org_sso_configs
      .mockResolvedValueOnce(new Response('', { status: 201 }))
      // 7. Insert sso_audit_log
      .mockResolvedValueOnce(new Response('', { status: 201 }))
      // 8. Insert billing_events
      .mockResolvedValueOnce(new Response('', { status: 201 }))
      // 9. Send email via Resend API
      .mockResolvedValueOnce(jsonOk({ id: 'email-1' }))
      // 10. Log email to email_log table
      .mockResolvedValueOnce(new Response('', { status: 201 }));

    const body = JSON.stringify({
      metadata_url: 'https://idp.example.com/saml/metadata',
      idp_name: 'Okta',
      default_role: 'member',
      allowed_domains: ['acme.com', 'acme.io'],
      enforced: false,
    });

    const req = makeRequest('/v1/orgs/org-1/sso', { method: 'PUT', body });
    const res = await handleConfigureSso(env as any, req, mockGetAuth, 'org-1');
    expect(res.status).toBe(200);

    const resBody = await res.json() as Record<string, unknown>;
    expect(resBody.org_id).toBe('org-1');
    expect(resBody.enabled).toBe(true);
    expect(resBody.enforced).toBe(false);
    expect(resBody.metadata_url).toBe('https://idp.example.com/saml/metadata');
    expect(resBody.idp_name).toBe('Okta');
    expect(resBody.default_role).toBe('member');
    expect(resBody.allowed_domains).toEqual(['acme.com', 'acme.io']);
    // supabase_sso_provider_id must NOT appear in the response
    expect(resBody.supabase_sso_provider_id).toBeUndefined();
  });

  it('returns 403 without sso_saml feature flag', async () => {
    const env = makeEnv();

    mockFetch
      // 1. requireOrgRole: success
      .mockResolvedValueOnce(jsonOk({
        org_id: 'org-1',
        name: 'Acme',
        slug: 'acme',
        billing_account_id: 'ba-1',
        owner_user_id: 'user-123',
        role: 'owner',
      }))
      // 2. requireOrgFeature: supabaseQuery orgs
      .mockResolvedValueOnce(jsonOk([{ billing_account_id: 'ba-1' }]))
      // 3. requireOrgFeature: admin_get_billing_summary with no sso_saml flag
      .mockResolvedValueOnce(jsonOk({ plan: { feature_flags: {} } }));

    const body = JSON.stringify({
      metadata_url: 'https://idp.example.com/saml/metadata',
      idp_name: 'Okta',
      default_role: 'member',
      allowed_domains: ['acme.com'],
    });

    const req = makeRequest('/v1/orgs/org-1/sso', { method: 'PUT', body });
    const res = await handleConfigureSso(env as any, req, mockGetAuth, 'org-1');
    expect(res.status).toBe(403);

    const resBody = await res.json() as Record<string, unknown>;
    expect(resBody.error).toBe('feature_gated');
    expect(resBody.feature).toBe('sso_saml');
  });

  it('returns 400 for missing metadata_url', async () => {
    const env = makeEnv();

    mockFetch
      // 1. requireOrgRole: success
      .mockResolvedValueOnce(jsonOk({
        org_id: 'org-1',
        name: 'Acme',
        slug: 'acme',
        billing_account_id: 'ba-1',
        owner_user_id: 'user-123',
        role: 'owner',
      }))
      // 2. requireOrgFeature: supabaseQuery orgs
      .mockResolvedValueOnce(jsonOk([{ billing_account_id: 'ba-1' }]))
      // 3. requireOrgFeature: admin_get_billing_summary
      .mockResolvedValueOnce(jsonOk({ plan: { feature_flags: { sso_saml: true } } }));

    const body = JSON.stringify({
      idp_name: 'Okta',
      default_role: 'member',
      allowed_domains: ['acme.com'],
    });

    const req = makeRequest('/v1/orgs/org-1/sso', { method: 'PUT', body });
    const res = await handleConfigureSso(env as any, req, mockGetAuth, 'org-1');
    expect(res.status).toBe(400);

    const resBody = await res.json() as Record<string, unknown>;
    expect(resBody.error).toContain('metadata_url');
  });

  it('returns 400 for empty allowed_domains', async () => {
    const env = makeEnv();

    mockFetch
      // 1. requireOrgRole: success
      .mockResolvedValueOnce(jsonOk({
        org_id: 'org-1',
        name: 'Acme',
        slug: 'acme',
        billing_account_id: 'ba-1',
        owner_user_id: 'user-123',
        role: 'owner',
      }))
      // 2. requireOrgFeature: supabaseQuery orgs
      .mockResolvedValueOnce(jsonOk([{ billing_account_id: 'ba-1' }]))
      // 3. requireOrgFeature: admin_get_billing_summary
      .mockResolvedValueOnce(jsonOk({ plan: { feature_flags: { sso_saml: true } } }));

    const body = JSON.stringify({
      metadata_url: 'https://idp.example.com/saml/metadata',
      idp_name: 'Okta',
      default_role: 'member',
      allowed_domains: [],
    });

    const req = makeRequest('/v1/orgs/org-1/sso', { method: 'PUT', body });
    const res = await handleConfigureSso(env as any, req, mockGetAuth, 'org-1');
    expect(res.status).toBe(400);

    const resBody = await res.json() as Record<string, unknown>;
    expect(resBody.error).toContain('allowed_domains');
  });

  it('returns 400 for owner as default_role', async () => {
    const env = makeEnv();

    mockFetch
      // 1. requireOrgRole: success
      .mockResolvedValueOnce(jsonOk({
        org_id: 'org-1',
        name: 'Acme',
        slug: 'acme',
        billing_account_id: 'ba-1',
        owner_user_id: 'user-123',
        role: 'owner',
      }))
      // 2. requireOrgFeature: supabaseQuery orgs
      .mockResolvedValueOnce(jsonOk([{ billing_account_id: 'ba-1' }]))
      // 3. requireOrgFeature: admin_get_billing_summary
      .mockResolvedValueOnce(jsonOk({ plan: { feature_flags: { sso_saml: true } } }));

    const body = JSON.stringify({
      metadata_url: 'https://idp.example.com/saml/metadata',
      idp_name: 'Okta',
      default_role: 'owner',
      allowed_domains: ['acme.com'],
    });

    const req = makeRequest('/v1/orgs/org-1/sso', { method: 'PUT', body });
    const res = await handleConfigureSso(env as any, req, mockGetAuth, 'org-1');
    expect(res.status).toBe(400);

    const resBody = await res.json() as Record<string, unknown>;
    expect(resBody.error).toContain('owner');
  });
});

// ============================================================================
// handleRemoveSso
// ============================================================================

describe('handleRemoveSso', () => {
  let handleRemoveSso: typeof import('../../org/sso-handlers').handleRemoveSso;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    mockGetAuth.mockResolvedValue(mockUser);

    vi.doMock('stripe', () => ({
      default: class MockStripe {
        static createFetchHttpClient() { return {}; }
      },
    }));

    const mod = await import('../../org/sso-handlers');
    handleRemoveSso = mod.handleRemoveSso;
  });

  it('deletes provider and config row', async () => {
    const env = makeEnv();

    mockFetch
      // 1. requireOrgRole: get_org_for_user RPC
      .mockResolvedValueOnce(jsonOk({
        org_id: 'org-1',
        name: 'Acme Corp',
        slug: 'acme',
        billing_account_id: 'ba-1',
        owner_user_id: 'user-123',
        role: 'owner',
      }))
      // 2. requireOrgFeature: supabaseQuery orgs
      .mockResolvedValueOnce(jsonOk([{ billing_account_id: 'ba-1' }]))
      // 3. requireOrgFeature: admin_get_billing_summary
      .mockResolvedValueOnce(jsonOk({ plan: { feature_flags: { sso_saml: true } } }))
      // 4. supabaseQuery org_sso_configs: existing config
      .mockResolvedValueOnce(jsonOk([{
        org_id: 'org-1',
        enabled: true,
        enforced: false,
        supabase_sso_provider_id: 'provider-uuid-existing',
        metadata_url: 'https://idp.example.com/metadata',
        idp_name: 'Okta',
      }]))
      // 5. supabaseSsoApi DELETE providers/:id
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      // 6. supabaseDelete org_sso_configs
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      // 7. Insert sso_audit_log
      .mockResolvedValueOnce(new Response('', { status: 201 }))
      // 8. Insert billing_events
      .mockResolvedValueOnce(new Response('', { status: 201 }));

    const req = makeRequest('/v1/orgs/org-1/sso', { method: 'DELETE' });
    const res = await handleRemoveSso(env as any, req, mockGetAuth, 'org-1');
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.removed).toBe(true);
    expect(body.note).toContain('password reset');
  });

  it('returns 404 when no config exists', async () => {
    const env = makeEnv();

    mockFetch
      // 1. requireOrgRole: success
      .mockResolvedValueOnce(jsonOk({
        org_id: 'org-1',
        name: 'Acme',
        slug: 'acme',
        billing_account_id: 'ba-1',
        owner_user_id: 'user-123',
        role: 'owner',
      }))
      // 2. requireOrgFeature: supabaseQuery orgs
      .mockResolvedValueOnce(jsonOk([{ billing_account_id: 'ba-1' }]))
      // 3. requireOrgFeature: admin_get_billing_summary
      .mockResolvedValueOnce(jsonOk({ plan: { feature_flags: { sso_saml: true } } }))
      // 4. supabaseQuery org_sso_configs: empty
      .mockResolvedValueOnce(jsonOk([]));

    const req = makeRequest('/v1/orgs/org-1/sso', { method: 'DELETE' });
    const res = await handleRemoveSso(env as any, req, mockGetAuth, 'org-1');
    expect(res.status).toBe(404);

    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('No SSO configuration');
  });

  it('returns 403 for non-owner', async () => {
    const env = makeEnv();

    // Mock: requireOrgRole returns 403 because 'admin' is not in ['owner']
    mockFetch.mockResolvedValueOnce(jsonOk({
      org_id: 'org-1',
      name: 'Acme',
      slug: 'acme',
      billing_account_id: 'ba-1',
      owner_user_id: 'user-owner',
      role: 'admin',
    }));

    const req = makeRequest('/v1/orgs/org-1/sso', { method: 'DELETE' });
    const res = await handleRemoveSso(env as any, req, mockGetAuth, 'org-1');
    expect(res.status).toBe(403);

    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('Access denied');
  });
});

// ============================================================================
// handleTestSso
// ============================================================================

describe('handleTestSso', () => {
  let handleTestSso: typeof import('../../org/sso-handlers').handleTestSso;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    mockGetAuth.mockResolvedValue(mockUser);

    vi.doMock('stripe', () => ({
      default: class MockStripe {
        static createFetchHttpClient() { return {}; }
      },
    }));

    const mod = await import('../../org/sso-handlers');
    handleTestSso = mod.handleTestSso;
  });

  it('returns valid true for reachable SAML metadata', async () => {
    const env = makeEnv();

    const samlMetadata = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="https://idp.example.com">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;

    mockFetch
      // 1. requireOrgRole: get_org_for_user RPC
      .mockResolvedValueOnce(jsonOk({
        org_id: 'org-1',
        name: 'Acme Corp',
        slug: 'acme',
        billing_account_id: 'ba-1',
        owner_user_id: 'user-123',
        role: 'owner',
      }))
      // 2. requireOrgFeature: supabaseQuery orgs
      .mockResolvedValueOnce(jsonOk([{ billing_account_id: 'ba-1' }]))
      // 3. requireOrgFeature: admin_get_billing_summary
      .mockResolvedValueOnce(jsonOk({ plan: { feature_flags: { sso_saml: true } } }))
      // 4. Fetch SAML metadata URL (regular fetch, not supabase)
      .mockResolvedValueOnce(new Response(samlMetadata, {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
      }))
      // 5. Insert sso_audit_log (valid: true)
      .mockResolvedValueOnce(new Response('', { status: 201 }))
      // 6. Insert billing_events
      .mockResolvedValueOnce(new Response('', { status: 201 }));

    const body = JSON.stringify({
      metadata_url: 'https://idp.example.com/saml/metadata',
    });

    const req = makeRequest('/v1/orgs/org-1/sso/test', { method: 'POST', body });
    const res = await handleTestSso(env as any, req, mockGetAuth, 'org-1');
    expect(res.status).toBe(200);

    const resBody = await res.json() as Record<string, unknown>;
    expect(resBody.valid).toBe(true);
    expect(resBody.metadata_url).toBe('https://idp.example.com/saml/metadata');
  });

  it('returns valid false for unreachable URL', async () => {
    const env = makeEnv();

    mockFetch
      // 1. requireOrgRole: success
      .mockResolvedValueOnce(jsonOk({
        org_id: 'org-1',
        name: 'Acme',
        slug: 'acme',
        billing_account_id: 'ba-1',
        owner_user_id: 'user-123',
        role: 'admin',
      }))
      // 2. requireOrgFeature: supabaseQuery orgs
      .mockResolvedValueOnce(jsonOk([{ billing_account_id: 'ba-1' }]))
      // 3. requireOrgFeature: admin_get_billing_summary
      .mockResolvedValueOnce(jsonOk({ plan: { feature_flags: { sso_saml: true } } }))
      // 4. Fetch metadata URL: returns 404
      .mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
      // 5. Insert sso_audit_log (valid: false)
      .mockResolvedValueOnce(new Response('', { status: 201 }))
      // 6. Insert billing_events
      .mockResolvedValueOnce(new Response('', { status: 201 }));

    const body = JSON.stringify({
      metadata_url: 'https://idp.example.com/saml/metadata',
    });

    const req = makeRequest('/v1/orgs/org-1/sso/test', { method: 'POST', body });
    const res = await handleTestSso(env as any, req, mockGetAuth, 'org-1');
    expect(res.status).toBe(200);

    const resBody = await res.json() as Record<string, unknown>;
    expect(resBody.valid).toBe(false);
    expect(resBody.error).toContain('unreachable');
  });

  it('returns valid false for non-SAML response', async () => {
    const env = makeEnv();

    mockFetch
      // 1. requireOrgRole: success
      .mockResolvedValueOnce(jsonOk({
        org_id: 'org-1',
        name: 'Acme',
        slug: 'acme',
        billing_account_id: 'ba-1',
        owner_user_id: 'user-123',
        role: 'owner',
      }))
      // 2. requireOrgFeature: supabaseQuery orgs
      .mockResolvedValueOnce(jsonOk([{ billing_account_id: 'ba-1' }]))
      // 3. requireOrgFeature: admin_get_billing_summary
      .mockResolvedValueOnce(jsonOk({ plan: { feature_flags: { sso_saml: true } } }))
      // 4. Fetch metadata URL: returns OK but with non-SAML content
      .mockResolvedValueOnce(new Response('<html><body>Not SAML</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }))
      // 5. Insert sso_audit_log (valid: false)
      .mockResolvedValueOnce(new Response('', { status: 201 }))
      // 6. Insert billing_events
      .mockResolvedValueOnce(new Response('', { status: 201 }));

    const body = JSON.stringify({
      metadata_url: 'https://idp.example.com/saml/metadata',
    });

    const req = makeRequest('/v1/orgs/org-1/sso/test', { method: 'POST', body });
    const res = await handleTestSso(env as any, req, mockGetAuth, 'org-1');
    expect(res.status).toBe(200);

    const resBody = await res.json() as Record<string, unknown>;
    expect(resBody.valid).toBe(false);
    expect(resBody.error).toContain('SAML metadata');
  });
});
