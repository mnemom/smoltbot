/**
 * Tests for self-hosted deployment management: register, list, get, update,
 * delete, heartbeat, and admin endpoints.
 * Mocks global fetch (Supabase) and license JWT verification.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleRegisterDeployment,
  handleListOrgDeployments,
  handleGetDeployment,
  handleUpdateDeployment,
  handleDeleteDeployment,
  handleDeploymentHeartbeat,
  handleAdminListDeployments,
  handleAdminGetDeployment,
  type AdminGuard,
  type AuthGuard,
} from '../handlers';
import type { BillingEnv } from '../../billing/types';

// ============================================================================
// Mock global fetch
// ============================================================================

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock verifyLicenseJWT from licensing/jwt
vi.mock('../../licensing/jwt', () => ({
  verifyLicenseJWT: vi.fn(),
}));

import { verifyLicenseJWT } from '../../licensing/jwt';
const mockVerifyLicenseJWT = verifyLicenseJWT as ReturnType<typeof vi.fn>;

// ============================================================================
// Test helpers
// ============================================================================

function makeEnv(overrides?: Partial<BillingEnv>): BillingEnv {
  return {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_KEY: 'test-key',
    SUPABASE_JWT_SECRET: 'test-jwt-secret',
    MNEMOM_PUBLISH_KEY: 'test-pub-key',
    STRIPE_SECRET_KEY: 'sk_test_xxx',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    RESEND_API_KEY: 'test-resend-key',
    BILLING_CACHE: {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    } as unknown as KVNamespace,
    ...overrides,
  } as unknown as BillingEnv;
}

const mockUser = {
  sub: 'user-abc123',
  email: 'user@company.com',
  exp: 9999999999,
  iat: 1700000000,
};

const mockAdmin = {
  sub: 'admin-user-id',
  email: 'admin@mnemom.ai',
  app_metadata: { is_admin: true },
  exp: 9999999999,
  iat: 1700000000,
};

const mockGetAuthUser: AuthGuard = vi.fn().mockResolvedValue(mockUser);

const mockGetAuthUserFail: AuthGuard = vi.fn().mockImplementation(() =>
  Promise.resolve(
    new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
);

const mockRequireAdmin: AdminGuard = vi.fn().mockResolvedValue(mockAdmin);

const mockRequireAdminFail: AdminGuard = vi.fn().mockImplementation(() =>
  Promise.resolve(
    new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
);

function makeRequest(method: string, path: string, body?: unknown, headers?: Record<string, string>): Request {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body) init.body = JSON.stringify(body);
  return new Request(`https://api.mnemom.ai${path}`, init);
}

function makeUrl(path: string, params?: Record<string, string>): URL {
  const url = new URL(`https://api.mnemom.ai${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  return url;
}

function mockRpcResponse(data: unknown): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function mockQueryResponse(data: unknown): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function mockMutationResponse(data: unknown = [{}]): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function mockFetchError(statusText: string): void {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    text: () => Promise.resolve(statusText),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockGetAuthUser as any).mockResolvedValue(mockUser);
  (mockRequireAdmin as any).mockResolvedValue(mockAdmin);
});

// ============================================================================
// 1. handleRegisterDeployment
// ============================================================================

describe('handleRegisterDeployment', () => {
  it('registers a deployment successfully and returns 201', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/v1/orgs/org-1/deployments', {
      instance_name: 'production-us-east',
      instance_id: 'inst-abc123',
      license_id: 'lic-xyz789',
      region: 'us-east-1',
      version: '2.1.0',
      instance_metadata: { cpu_cores: 8, memory_gb: 32 },
    });

    // 1. Org role check RPC
    mockRpcResponse('owner');

    // 2. License verification RPC
    mockRpcResponse({ valid: true });

    // 3. Insert deployment
    mockMutationResponse([{
      deployment_id: 'dep-new12345',
      org_id: 'org-1',
      instance_name: 'production-us-east',
      instance_id: 'inst-abc123',
      status: 'active',
    }]);

    const res = await handleRegisterDeployment(env, req, mockGetAuthUser, 'org-1');
    expect(res.status).toBe(201);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.instance_name).toBe('production-us-east');
    expect(body.instance_id).toBe('inst-abc123');
    expect(body.status).toBe('active');
    expect(body.deployment_id).toBeTruthy();
  });

  it('returns 400 when instance_name is missing', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/v1/orgs/org-1/deployments', {
      instance_id: 'inst-abc123',
      license_id: 'lic-xyz789',
    });

    // Org role check
    mockRpcResponse('owner');

    const res = await handleRegisterDeployment(env, req, mockGetAuthUser, 'org-1');
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('instance_name');
  });

  it('returns 400 when instance_id is missing', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/v1/orgs/org-1/deployments', {
      instance_name: 'production',
      license_id: 'lic-xyz789',
    });

    // Org role check
    mockRpcResponse('owner');

    const res = await handleRegisterDeployment(env, req, mockGetAuthUser, 'org-1');
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('instance_id');
  });

  it('returns 400 when license_id is missing', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/v1/orgs/org-1/deployments', {
      instance_name: 'production',
      instance_id: 'inst-abc123',
    });

    // Org role check
    mockRpcResponse('owner');

    const res = await handleRegisterDeployment(env, req, mockGetAuthUser, 'org-1');
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('license_id');
  });

  it('returns 403 when user is not an admin or owner of the org', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/v1/orgs/org-1/deployments', {
      instance_name: 'production',
      instance_id: 'inst-abc123',
      license_id: 'lic-xyz789',
    });

    // Org role check returns 'member' (not admin/owner)
    mockRpcResponse('member');

    const res = await handleRegisterDeployment(env, req, mockGetAuthUser, 'org-1');
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('Admin or owner role required');
  });

  it('returns 403 when user is not a member of the org', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/v1/orgs/org-1/deployments', {
      instance_name: 'production',
      instance_id: 'inst-abc123',
      license_id: 'lic-xyz789',
    });

    // Org role check returns null (not a member)
    mockRpcResponse(null);

    const res = await handleRegisterDeployment(env, req, mockGetAuthUser, 'org-1');
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('Not a member');
  });

  it('returns 404 when license does not belong to the org', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/v1/orgs/org-1/deployments', {
      instance_name: 'production',
      instance_id: 'inst-abc123',
      license_id: 'lic-wrong',
    });

    // Org role check
    mockRpcResponse('admin');

    // License verification fails
    mockRpcResponse({ valid: false });

    const res = await handleRegisterDeployment(env, req, mockGetAuthUser, 'org-1');
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('License not found');
  });

  it('returns 401 when auth fails', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/v1/orgs/org-1/deployments', {
      instance_name: 'production',
      instance_id: 'inst-abc123',
      license_id: 'lic-xyz789',
    });

    const res = await handleRegisterDeployment(env, req, mockGetAuthUserFail, 'org-1');
    expect(res.status).toBe(401);
  });
});

// ============================================================================
// 2. handleListOrgDeployments
// ============================================================================

describe('handleListOrgDeployments', () => {
  it('returns paginated list of deployments for org members', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', '/v1/orgs/org-1/deployments?limit=10&offset=0&status=active');

    // Org role check
    mockRpcResponse('member');

    // List deployments RPC
    const mockDeployments = [
      { deployment_id: 'dep-1', instance_name: 'prod-1', status: 'active' },
      { deployment_id: 'dep-2', instance_name: 'prod-2', status: 'active' },
    ];
    mockRpcResponse(mockDeployments);

    const res = await handleListOrgDeployments(env, req, mockGetAuthUser, 'org-1');
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    expect(body[0].deployment_id).toBe('dep-1');
    expect(body[1].deployment_id).toBe('dep-2');

    // Verify the RPC was called with correct params
    const rpcCall = mockFetch.mock.calls[1];
    expect(rpcCall[0]).toContain('/rpc/list_org_deployments');
    const rpcBody = JSON.parse(rpcCall[1].body);
    expect(rpcBody.p_org_id).toBe('org-1');
    expect(rpcBody.p_limit).toBe(10);
    expect(rpcBody.p_offset).toBe(0);
    expect(rpcBody.p_status).toBe('active');
  });

  it('uses default params when none are provided', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', '/v1/orgs/org-1/deployments');

    // Org role check
    mockRpcResponse('member');

    // List deployments RPC
    mockRpcResponse([]);

    const res = await handleListOrgDeployments(env, req, mockGetAuthUser, 'org-1');
    expect(res.status).toBe(200);

    const rpcCall = mockFetch.mock.calls[1];
    const rpcBody = JSON.parse(rpcCall[1].body);
    expect(rpcBody.p_limit).toBe(50);
    expect(rpcBody.p_offset).toBe(0);
    expect(rpcBody.p_status).toBeNull();
  });

  it('returns 403 when user is not a member', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', '/v1/orgs/org-1/deployments');

    // Org role check returns null
    mockRpcResponse(null);

    const res = await handleListOrgDeployments(env, req, mockGetAuthUser, 'org-1');
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// 3. handleGetDeployment
// ============================================================================

describe('handleGetDeployment', () => {
  it('returns deployment detail for org members', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', '/v1/orgs/org-1/deployments/dep-abc');

    // Org role check
    mockRpcResponse('member');

    // Get deployment RPC
    const deployment = {
      deployment_id: 'dep-abc',
      org_id: 'org-1',
      instance_name: 'production-us',
      instance_id: 'inst-001',
      status: 'active',
      version: '2.1.0',
      last_heartbeat_at: '2026-02-17T10:00:00Z',
    };
    mockRpcResponse(deployment);

    const res = await handleGetDeployment(env, req, mockGetAuthUser, 'org-1', 'dep-abc');
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.deployment_id).toBe('dep-abc');
    expect(body.instance_name).toBe('production-us');
    expect(body.status).toBe('active');
  });

  it('returns 404 when deployment is not found', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', '/v1/orgs/org-1/deployments/dep-missing');

    // Org role check
    mockRpcResponse('member');

    // Get deployment RPC returns not found
    mockRpcResponse({ error: 'deployment_not_found' });

    const res = await handleGetDeployment(env, req, mockGetAuthUser, 'org-1', 'dep-missing');
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('Deployment not found');
  });

  it('returns 404 when RPC returns null', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', '/v1/orgs/org-1/deployments/dep-missing');

    // Org role check
    mockRpcResponse('member');

    // Get deployment RPC returns null
    mockRpcResponse(null);

    const res = await handleGetDeployment(env, req, mockGetAuthUser, 'org-1', 'dep-missing');
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// 4. handleUpdateDeployment
// ============================================================================

describe('handleUpdateDeployment', () => {
  it('updates deployment fields and returns success', async () => {
    const env = makeEnv();
    const req = makeRequest('PUT', '/v1/orgs/org-1/deployments/dep-upd1', {
      instance_name: 'production-renamed',
      status: 'inactive',
      region: 'eu-west-1',
    });

    // Org role check
    mockRpcResponse('admin');

    // Query existing deployment
    mockQueryResponse([{
      deployment_id: 'dep-upd1',
      org_id: 'org-1',
      instance_name: 'production-old',
      status: 'active',
    }]);

    // Update deployment
    mockMutationResponse([{ deployment_id: 'dep-upd1' }]);

    const res = await handleUpdateDeployment(env, req, mockGetAuthUser, 'org-1', 'dep-upd1');
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.deployment_id).toBe('dep-upd1');
    expect(body.updated).toBe(true);

    // Verify the PATCH was called with correct fields
    const updateCall = mockFetch.mock.calls[2];
    const updateBody = JSON.parse(updateCall[1].body);
    expect(updateBody.instance_name).toBe('production-renamed');
    expect(updateBody.status).toBe('inactive');
    expect(updateBody.region).toBe('eu-west-1');
    expect(updateBody.updated_at).toBeTruthy();
  });

  it('returns 404 when deployment does not exist', async () => {
    const env = makeEnv();
    const req = makeRequest('PUT', '/v1/orgs/org-1/deployments/dep-missing', {
      instance_name: 'renamed',
    });

    // Org role check
    mockRpcResponse('owner');

    // Query returns empty
    mockQueryResponse([]);

    const res = await handleUpdateDeployment(env, req, mockGetAuthUser, 'org-1', 'dep-missing');
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('Deployment not found');
  });

  it('returns 400 for invalid status value', async () => {
    const env = makeEnv();
    const req = makeRequest('PUT', '/v1/orgs/org-1/deployments/dep-upd2', {
      status: 'invalid-status',
    });

    // Org role check
    mockRpcResponse('admin');

    // Query existing deployment
    mockQueryResponse([{ deployment_id: 'dep-upd2', org_id: 'org-1' }]);

    const res = await handleUpdateDeployment(env, req, mockGetAuthUser, 'org-1', 'dep-upd2');
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('status must be one of');
  });

  it('returns 400 for empty instance_name', async () => {
    const env = makeEnv();
    const req = makeRequest('PUT', '/v1/orgs/org-1/deployments/dep-upd3', {
      instance_name: '  ',
    });

    // Org role check
    mockRpcResponse('admin');

    // Query existing deployment
    mockQueryResponse([{ deployment_id: 'dep-upd3', org_id: 'org-1' }]);

    const res = await handleUpdateDeployment(env, req, mockGetAuthUser, 'org-1', 'dep-upd3');
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('instance_name');
  });

  it('returns 403 when user is a regular member (not admin/owner)', async () => {
    const env = makeEnv();
    const req = makeRequest('PUT', '/v1/orgs/org-1/deployments/dep-upd4', {
      instance_name: 'renamed',
    });

    // Org role check returns 'member'
    mockRpcResponse('member');

    const res = await handleUpdateDeployment(env, req, mockGetAuthUser, 'org-1', 'dep-upd4');
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('Admin or owner role required');
  });
});

// ============================================================================
// 5. handleDeleteDeployment
// ============================================================================

describe('handleDeleteDeployment', () => {
  it('deletes deployment and returns success', async () => {
    const env = makeEnv();
    const req = makeRequest('DELETE', '/v1/orgs/org-1/deployments/dep-del1');

    // Org role check
    mockRpcResponse('owner');

    // Query existing deployment
    mockQueryResponse([{ deployment_id: 'dep-del1' }]);

    // Delete deployment
    mockMutationResponse([{ deployment_id: 'dep-del1' }]);

    const res = await handleDeleteDeployment(env, req, mockGetAuthUser, 'org-1', 'dep-del1');
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.deployment_id).toBe('dep-del1');
    expect(body.deleted).toBe(true);

    // Verify the DELETE was called on the correct resource
    const deleteCall = mockFetch.mock.calls[2];
    expect(deleteCall[0]).toContain('self_hosted_deployments');
    expect(deleteCall[0]).toContain('deployment_id=eq.dep-del1');
    expect(deleteCall[1].method).toBe('DELETE');
  });

  it('returns 404 when deployment does not exist', async () => {
    const env = makeEnv();
    const req = makeRequest('DELETE', '/v1/orgs/org-1/deployments/dep-missing');

    // Org role check
    mockRpcResponse('admin');

    // Query returns empty
    mockQueryResponse([]);

    const res = await handleDeleteDeployment(env, req, mockGetAuthUser, 'org-1', 'dep-missing');
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('Deployment not found');
  });

  it('returns 403 when user is a regular member', async () => {
    const env = makeEnv();
    const req = makeRequest('DELETE', '/v1/orgs/org-1/deployments/dep-del2');

    // Org role check returns 'member'
    mockRpcResponse('member');

    const res = await handleDeleteDeployment(env, req, mockGetAuthUser, 'org-1', 'dep-del2');
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('Admin or owner role required');
  });
});

// ============================================================================
// 6. handleDeploymentHeartbeat
// ============================================================================

describe('handleDeploymentHeartbeat', () => {
  it('processes heartbeat with valid license JWT and returns status', async () => {
    const env = makeEnv();
    const req = makeRequest(
      'POST',
      '/v1/deployments/heartbeat',
      {
        deployment_id: 'dep-hb1',
        instance_id: 'inst-001',
        version: '2.1.0',
        heartbeat_data: { cpu_usage: 45, memory_usage: 72 },
      },
      { Authorization: 'Bearer valid-license-jwt-token' },
    );

    // Mock JWT verification
    mockVerifyLicenseJWT.mockResolvedValueOnce({
      valid: true,
      payload: {
        license_id: 'lic-xyz789',
        account_id: 'acc-123',
        plan_id: 'plan-enterprise',
        feature_flags: {},
        limits: {},
        max_activations: 5,
        is_offline: false,
        iat: 1700000000,
        exp: 9999999999,
        kid: 'lsk-test',
      },
    });

    // Heartbeat RPC response
    mockRpcResponse({
      status: 'active',
      next_heartbeat_seconds: 300,
    });

    const res = await handleDeploymentHeartbeat(env, req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.deployment_id).toBe('dep-hb1');
    expect(body.status).toBe('active');
    expect(body.next_heartbeat_seconds).toBe(300);
    expect(body.server_time).toBeTruthy();

    // Verify the RPC was called with correct params
    const rpcCall = mockFetch.mock.calls[0];
    expect(rpcCall[0]).toContain('/rpc/deployment_heartbeat');
    const rpcBody = JSON.parse(rpcCall[1].body);
    expect(rpcBody.p_deployment_id).toBe('dep-hb1');
    expect(rpcBody.p_instance_id).toBe('inst-001');
    expect(rpcBody.p_license_id).toBe('lic-xyz789');
    expect(rpcBody.p_version).toBe('2.1.0');
    expect(rpcBody.p_heartbeat_data).toEqual({ cpu_usage: 45, memory_usage: 72 });
  });

  it('returns 401 when no Authorization header is present', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/v1/deployments/heartbeat', {
      deployment_id: 'dep-hb2',
      instance_id: 'inst-002',
    });

    const res = await handleDeploymentHeartbeat(env, req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('Authorization header');
  });

  it('returns 401 when license JWT is invalid', async () => {
    const env = makeEnv();
    const req = makeRequest(
      'POST',
      '/v1/deployments/heartbeat',
      {
        deployment_id: 'dep-hb3',
        instance_id: 'inst-003',
      },
      { Authorization: 'Bearer invalid-token' },
    );

    mockVerifyLicenseJWT.mockResolvedValueOnce({
      valid: false,
      error: 'Invalid signature',
    });

    const res = await handleDeploymentHeartbeat(env, req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('Invalid license token');
  });

  it('returns 401 when license JWT is expired', async () => {
    const env = makeEnv();
    const req = makeRequest(
      'POST',
      '/v1/deployments/heartbeat',
      {
        deployment_id: 'dep-hb4',
        instance_id: 'inst-004',
      },
      { Authorization: 'Bearer expired-token' },
    );

    mockVerifyLicenseJWT.mockResolvedValueOnce({
      valid: false,
      error: 'Token expired',
    });

    const res = await handleDeploymentHeartbeat(env, req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('License token expired');
  });

  it('returns 400 when deployment_id is missing', async () => {
    const env = makeEnv();
    const req = makeRequest(
      'POST',
      '/v1/deployments/heartbeat',
      { instance_id: 'inst-005' },
      { Authorization: 'Bearer valid-token' },
    );

    mockVerifyLicenseJWT.mockResolvedValueOnce({
      valid: true,
      payload: {
        license_id: 'lic-xyz789',
        account_id: 'acc-123',
        plan_id: 'plan-enterprise',
        feature_flags: {},
        limits: {},
        max_activations: 5,
        is_offline: false,
        iat: 1700000000,
        exp: 9999999999,
        kid: 'lsk-test',
      },
    });

    const res = await handleDeploymentHeartbeat(env, req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('deployment_id');
  });

  it('returns 400 when instance_id is missing', async () => {
    const env = makeEnv();
    const req = makeRequest(
      'POST',
      '/v1/deployments/heartbeat',
      { deployment_id: 'dep-hb5' },
      { Authorization: 'Bearer valid-token' },
    );

    mockVerifyLicenseJWT.mockResolvedValueOnce({
      valid: true,
      payload: {
        license_id: 'lic-xyz789',
        account_id: 'acc-123',
        plan_id: 'plan-enterprise',
        feature_flags: {},
        limits: {},
        max_activations: 5,
        is_offline: false,
        iat: 1700000000,
        exp: 9999999999,
        kid: 'lsk-test',
      },
    });

    const res = await handleDeploymentHeartbeat(env, req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('instance_id');
  });

  it('returns 404 when deployment is not found by RPC', async () => {
    const env = makeEnv();
    const req = makeRequest(
      'POST',
      '/v1/deployments/heartbeat',
      {
        deployment_id: 'dep-missing',
        instance_id: 'inst-wrong',
      },
      { Authorization: 'Bearer valid-token' },
    );

    mockVerifyLicenseJWT.mockResolvedValueOnce({
      valid: true,
      payload: {
        license_id: 'lic-xyz789',
        account_id: 'acc-123',
        plan_id: 'plan-enterprise',
        feature_flags: {},
        limits: {},
        max_activations: 5,
        is_offline: false,
        iat: 1700000000,
        exp: 9999999999,
        kid: 'lsk-test',
      },
    });

    // Heartbeat RPC returns not found
    mockRpcResponse({ error: 'deployment_not_found' });

    const res = await handleDeploymentHeartbeat(env, req);
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('Deployment not found');
  });

  it('returns 503 when Supabase RPC fails', async () => {
    const env = makeEnv();
    const req = makeRequest(
      'POST',
      '/v1/deployments/heartbeat',
      {
        deployment_id: 'dep-hb6',
        instance_id: 'inst-006',
      },
      { Authorization: 'Bearer valid-token' },
    );

    mockVerifyLicenseJWT.mockResolvedValueOnce({
      valid: true,
      payload: {
        license_id: 'lic-xyz789',
        account_id: 'acc-123',
        plan_id: 'plan-enterprise',
        feature_flags: {},
        limits: {},
        max_activations: 5,
        is_offline: false,
        iat: 1700000000,
        exp: 9999999999,
        kid: 'lsk-test',
      },
    });

    // Supabase returns error
    mockFetchError('Internal server error');

    const res = await handleDeploymentHeartbeat(env, req);
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('Service temporarily unavailable');
  });
});

// ============================================================================
// 7. handleAdminListDeployments
// ============================================================================

describe('handleAdminListDeployments', () => {
  it('returns paginated list of all deployments for admins', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', '/v1/admin/deployments');
    const url = makeUrl('/v1/admin/deployments', { limit: '25', offset: '10', status: 'active', org_id: 'org-1' });

    const mockDeployments = [
      { deployment_id: 'dep-1', org_id: 'org-1', status: 'active' },
      { deployment_id: 'dep-2', org_id: 'org-1', status: 'active' },
    ];
    mockRpcResponse(mockDeployments);

    const res = await handleAdminListDeployments(env, req, mockRequireAdmin, url);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);

    // Verify the RPC was called with correct params
    const rpcCall = mockFetch.mock.calls[0];
    expect(rpcCall[0]).toContain('/rpc/admin_list_deployments');
    const rpcBody = JSON.parse(rpcCall[1].body);
    expect(rpcBody.p_limit).toBe(25);
    expect(rpcBody.p_offset).toBe(10);
    expect(rpcBody.p_status).toBe('active');
    expect(rpcBody.p_org_id).toBe('org-1');
  });

  it('uses default params when none are provided', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', '/v1/admin/deployments');
    const url = makeUrl('/v1/admin/deployments');

    mockRpcResponse([]);

    const res = await handleAdminListDeployments(env, req, mockRequireAdmin, url);
    expect(res.status).toBe(200);

    const rpcCall = mockFetch.mock.calls[0];
    const rpcBody = JSON.parse(rpcCall[1].body);
    expect(rpcBody.p_limit).toBe(50);
    expect(rpcBody.p_offset).toBe(0);
    expect(rpcBody.p_status).toBeNull();
    expect(rpcBody.p_org_id).toBeNull();
  });

  it('returns 403 for non-admins', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', '/v1/admin/deployments');
    const url = makeUrl('/v1/admin/deployments');

    const res = await handleAdminListDeployments(env, req, mockRequireAdminFail, url);
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('Admin access required');
  });

  it('returns 500 when Supabase RPC fails', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', '/v1/admin/deployments');
    const url = makeUrl('/v1/admin/deployments');

    mockFetchError('Connection refused');

    const res = await handleAdminListDeployments(env, req, mockRequireAdmin, url);
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('Database error');
  });
});

// ============================================================================
// 8. handleAdminGetDeployment
// ============================================================================

describe('handleAdminGetDeployment', () => {
  it('returns deployment detail for admins', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', '/v1/admin/deployments/dep-detail');

    const deployment = {
      deployment_id: 'dep-detail',
      org_id: 'org-1',
      license_id: 'lic-xyz789',
      instance_name: 'production-us-east',
      instance_id: 'inst-001',
      region: 'us-east-1',
      status: 'active',
      version: '2.1.0',
      last_heartbeat_at: '2026-02-17T10:00:00Z',
      heartbeat_data: { cpu_usage: 45 },
      instance_metadata: { cpu_cores: 8 },
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-02-17T10:00:00Z',
    };
    mockRpcResponse(deployment);

    const res = await handleAdminGetDeployment(env, req, mockRequireAdmin, 'dep-detail');
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.deployment_id).toBe('dep-detail');
    expect(body.org_id).toBe('org-1');
    expect(body.instance_name).toBe('production-us-east');
    expect(body.status).toBe('active');
    expect(body.version).toBe('2.1.0');
  });

  it('returns 404 when deployment is not found', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', '/v1/admin/deployments/dep-missing');

    mockRpcResponse({ error: 'deployment_not_found' });

    const res = await handleAdminGetDeployment(env, req, mockRequireAdmin, 'dep-missing');
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('Deployment not found');
  });

  it('returns 403 for non-admins', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', '/v1/admin/deployments/dep-detail');

    const res = await handleAdminGetDeployment(env, req, mockRequireAdminFail, 'dep-detail');
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('Admin access required');
  });

  it('returns 500 when Supabase RPC fails', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', '/v1/admin/deployments/dep-detail');

    mockFetchError('timeout');

    const res = await handleAdminGetDeployment(env, req, mockRequireAdmin, 'dep-detail');
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('Database error');
  });
});
