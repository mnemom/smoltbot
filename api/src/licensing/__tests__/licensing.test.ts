/**
 * Tests for licensing system: JWT utilities, admin handlers, and public validation.
 * Mocks global fetch (Supabase) and email module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleAdminCreateLicense,
  handleAdminListLicenses,
  handleAdminLicenseDetail,
  handleAdminUpdateLicense,
  handleAdminRevokeLicense,
  handleAdminReissueLicense,
  handleLicenseValidate,
  type AdminGuard,
} from '../handlers';
import { signLicenseJWT, verifyLicenseJWT, decodeLicenseJWT } from '../jwt';
import type { LicenseJWTPayload } from '../types';
import type { BillingEnv } from '../../billing/types';

// ============================================================================
// Mock global fetch
// ============================================================================

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('../../billing/email', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  licenseCreatedEmail: vi.fn().mockReturnValue({ subject: 'License', html: '<p>License</p>', text: 'License' }),
  licenseRevokedEmail: vi.fn().mockReturnValue({ subject: 'Revoked', html: '<p>Revoked</p>', text: 'Revoked' }),
  licenseExpiringEmail: vi.fn().mockReturnValue({ subject: 'Expiring', html: '<p>Expiring</p>', text: 'Expiring' }),
  licenseExpiredEmail: vi.fn().mockReturnValue({ subject: 'Expired', html: '<p>Expired</p>', text: 'Expired' }),
}));

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
    LICENSE_SIGNING_SECRET: 'test-signing-secret-at-least-32-chars-long',
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

const mockAdmin = {
  sub: 'admin-user-id',
  email: 'admin@mnemom.ai',
  app_metadata: { is_admin: true },
  exp: 9999999999,
  iat: 1700000000,
};

const mockRequireAdmin: AdminGuard = vi.fn().mockResolvedValue(mockAdmin);

const mockRequireAdminFail: AdminGuard = vi.fn().mockImplementation(() =>
  Promise.resolve(
    new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
);

function makeRequest(method: string, path: string, body?: unknown): Request {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
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

const TEST_SIGNING_SECRET = 'test-signing-secret-at-least-32-chars-long';

function makeTestPayload(overrides?: Partial<LicenseJWTPayload>): LicenseJWTPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    license_id: 'lic-test1234',
    account_id: 'acc-test1234',
    plan_id: 'plan-enterprise',
    feature_flags: { aip: true, otel_export: true },
    limits: { included_checks: 100000 },
    max_activations: 3,
    is_offline: false,
    iat: now,
    exp: now + 86400 * 365,
    kid: 'lsk-test1234',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockRequireAdmin as any).mockResolvedValue(mockAdmin);
});

// ============================================================================
// 1. JWT Utilities
// ============================================================================

describe('JWT utilities', () => {
  it('sign/verify roundtrip produces valid token and recovers payload', async () => {
    const payload = makeTestPayload();
    const token = await signLicenseJWT(payload, TEST_SIGNING_SECRET);

    expect(token).toBeTruthy();
    expect(token.split('.').length).toBe(3);

    const result = await verifyLicenseJWT(token, TEST_SIGNING_SECRET);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.license_id).toBe(payload.license_id);
      expect(result.payload.account_id).toBe(payload.account_id);
      expect(result.payload.plan_id).toBe(payload.plan_id);
      expect(result.payload.feature_flags).toEqual(payload.feature_flags);
      expect(result.payload.limits).toEqual(payload.limits);
      expect(result.payload.max_activations).toBe(payload.max_activations);
      expect(result.payload.is_offline).toBe(payload.is_offline);
      expect(result.payload.kid).toBe(payload.kid);
    }
  });

  it('decode without verify returns payload without checking signature', () => {
    // Manually construct a JWT with a bad signature but valid base64url payload
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'lsk-fake' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const payload: LicenseJWTPayload = {
      license_id: 'lic-decoded',
      account_id: 'acc-decoded',
      plan_id: 'plan-team',
      feature_flags: { aip: true },
      limits: { included_checks: 5000 },
      max_activations: 1,
      is_offline: false,
      iat: 1700000000,
      exp: 1800000000,
      kid: 'lsk-fake',
    };
    const payloadB64 = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const fakeToken = `${header}.${payloadB64}.invalid-signature-data`;

    const result = decodeLicenseJWT(fakeToken);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.license_id).toBe('lic-decoded');
      expect(result.payload.account_id).toBe('acc-decoded');
    }
  });

  it('rejects expired tokens', async () => {
    const payload = makeTestPayload({
      exp: Math.floor(Date.now() / 1000) - 3600, // expired 1 hour ago
    });
    const token = await signLicenseJWT(payload, TEST_SIGNING_SECRET);

    const result = await verifyLicenseJWT(token, TEST_SIGNING_SECRET);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('Token expired');
    }
  });

  it('rejects tokens with invalid signature', async () => {
    const payload = makeTestPayload();
    const token = await signLicenseJWT(payload, TEST_SIGNING_SECRET);

    // Verify with a different secret
    const result = await verifyLicenseJWT(token, 'wrong-secret-that-is-also-long-enough');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('Invalid signature');
    }
  });

  it('rejects invalid JWT format', async () => {
    const result = await verifyLicenseJWT('not.a.valid.jwt.with.too.many.parts', TEST_SIGNING_SECRET);
    expect(result.valid).toBe(false);

    const result2 = await verifyLicenseJWT('only-one-part', TEST_SIGNING_SECRET);
    expect(result2.valid).toBe(false);
    if (!result2.valid) {
      expect(result2.error).toBe('Invalid JWT format');
    }

    const result3 = decodeLicenseJWT('bad-format');
    expect(result3.valid).toBe(false);
    if (!result3.valid) {
      expect(result3.error).toBe('Invalid JWT format');
    }
  });
});

// ============================================================================
// 2. Admin auth guard
// ============================================================================

describe('Admin auth guard', () => {
  it('returns 403 for non-admins on create license', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/v1/admin/licenses', {
      account_id: 'acc-123',
      expires_in_days: 365,
    });

    const res = await handleAdminCreateLicense(env, req, mockRequireAdminFail);
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('Admin access required');
  });

  it('returns 403 for non-admins on list licenses', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', '/v1/admin/licenses');
    const url = makeUrl('/v1/admin/licenses');

    const res = await handleAdminListLicenses(env, req, mockRequireAdminFail, url);
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('Admin access required');
  });

  it('returns 403 for non-admins on revoke license', async () => {
    const env = makeEnv();
    const req = makeRequest('DELETE', '/v1/admin/licenses/lic-123', { reason: 'violation' });

    const res = await handleAdminRevokeLicense(env, req, mockRequireAdminFail, 'lic-123');
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('Admin access required');
  });
});

// ============================================================================
// 3. handleAdminCreateLicense
// ============================================================================

describe('handleAdminCreateLicense', () => {
  it('creates a license successfully and returns 201 with license_id, license_jwt, expires_at', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/v1/admin/licenses', {
      account_id: 'acc-ent1',
      expires_in_days: 365,
      max_activations: 5,
    });

    // 1. Account query
    mockQueryResponse([{
      account_id: 'acc-ent1',
      billing_email: 'enterprise@company.com',
      plan_id: 'plan-enterprise',
      user_id: 'user-ent1',
    }]);

    // 2. Plan query
    mockQueryResponse([{
      plan_id: 'plan-enterprise',
      display_name: 'Enterprise',
      feature_flags: { aip: true, otel_export: true, eu_compliance: true },
      limits: { included_checks: 100000 },
    }]);

    // 3. Signing key insert
    mockMutationResponse([{ kid: 'lsk-test' }]);

    // 4. License insert
    mockMutationResponse([{ license_id: 'lic-new' }]);

    // 5. Billing event insert
    mockMutationResponse([{}]);

    // 6. Audit log insert
    mockMutationResponse([{}]);

    const res = await handleAdminCreateLicense(env, req, mockRequireAdmin);
    expect(res.status).toBe(201);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.license_id).toBeTruthy();
    expect(typeof body.license_id).toBe('string');
    expect(body.license_jwt).toBeTruthy();
    expect(typeof body.license_jwt).toBe('string');
    expect((body.license_jwt as string).split('.').length).toBe(3);
    expect(body.expires_at).toBeTruthy();

    // Verify the JWT is actually valid
    const jwtResult = await verifyLicenseJWT(body.license_jwt as string, TEST_SIGNING_SECRET);
    expect(jwtResult.valid).toBe(true);
    if (jwtResult.valid) {
      expect(jwtResult.payload.account_id).toBe('acc-ent1');
      expect(jwtResult.payload.plan_id).toBe('plan-enterprise');
      expect(jwtResult.payload.feature_flags.aip).toBe(true);
      expect(jwtResult.payload.max_activations).toBe(5);
    }
  });

  it('returns 400 when account_id is missing', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/v1/admin/licenses', {
      expires_in_days: 365,
    });

    const res = await handleAdminCreateLicense(env, req, mockRequireAdmin);
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('account_id');
  });

  it('returns 404 when account is not found', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/v1/admin/licenses', {
      account_id: 'acc-nonexistent',
      expires_in_days: 365,
    });

    // Account query returns empty array
    mockQueryResponse([]);

    const res = await handleAdminCreateLicense(env, req, mockRequireAdmin);
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('Account not found');
  });

  it('returns 400 when expires_in_days is invalid (out of range)', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/v1/admin/licenses', {
      account_id: 'acc-123',
      expires_in_days: 9999,
    });

    const res = await handleAdminCreateLicense(env, req, mockRequireAdmin);
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('expires_in_days');
  });

  it('returns 400 when neither expires_in_days nor expires_at is provided', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/v1/admin/licenses', {
      account_id: 'acc-123',
    });

    const res = await handleAdminCreateLicense(env, req, mockRequireAdmin);
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('expires_in_days or expires_at');
  });
});

// ============================================================================
// 4. handleAdminListLicenses
// ============================================================================

describe('handleAdminListLicenses', () => {
  it('passes query params to RPC and returns paginated results', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', '/v1/admin/licenses');
    const url = makeUrl('/v1/admin/licenses', { limit: '10', offset: '20', status: 'active' });

    const mockLicenses = [
      { license_id: 'lic-1', account_id: 'acc-1', expires_at: '2027-01-01T00:00:00Z', revoked_at: null },
      { license_id: 'lic-2', account_id: 'acc-2', expires_at: '2027-06-01T00:00:00Z', revoked_at: null },
    ];
    mockRpcResponse(mockLicenses);

    const res = await handleAdminListLicenses(env, req, mockRequireAdmin, url);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    expect(body[0].license_id).toBe('lic-1');
    expect(body[1].license_id).toBe('lic-2');

    // Verify the RPC was called with correct params
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toContain('/rpc/admin_list_licenses');
    const rpcBody = JSON.parse(fetchCall[1].body);
    expect(rpcBody.p_limit).toBe(10);
    expect(rpcBody.p_offset).toBe(20);
    expect(rpcBody.p_status).toBe('active');
  });

  it('uses default params when none are provided', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', '/v1/admin/licenses');
    const url = makeUrl('/v1/admin/licenses');

    mockRpcResponse([]);

    const res = await handleAdminListLicenses(env, req, mockRequireAdmin, url);
    expect(res.status).toBe(200);

    // Verify defaults: limit=50, offset=0, status=null
    const fetchCall = mockFetch.mock.calls[0];
    const rpcBody = JSON.parse(fetchCall[1].body);
    expect(rpcBody.p_limit).toBe(50);
    expect(rpcBody.p_offset).toBe(0);
    expect(rpcBody.p_status).toBeNull();
  });
});

// ============================================================================
// 5. handleAdminLicenseDetail
// ============================================================================

describe('handleAdminLicenseDetail', () => {
  it('returns license detail from RPC', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', '/v1/admin/licenses/lic-detail1');

    const licenseDetail = {
      license_id: 'lic-detail1',
      account_id: 'acc-123',
      plan_id: 'plan-enterprise',
      feature_flags: { aip: true },
      limits: { included_checks: 100000 },
      max_activations: 3,
      issued_at: '2026-01-01T00:00:00Z',
      expires_at: '2027-01-01T00:00:00Z',
      revoked_at: null,
      activation_count: 1,
    };
    mockRpcResponse(licenseDetail);

    const res = await handleAdminLicenseDetail(env, req, mockRequireAdmin, 'lic-detail1');
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.license_id).toBe('lic-detail1');
    expect(body.account_id).toBe('acc-123');
    expect(body.max_activations).toBe(3);
    expect(body.activation_count).toBe(1);
  });

  it('returns 404 when license is not found', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', '/v1/admin/licenses/lic-nonexistent');

    mockRpcResponse({ error: 'license_not_found' });

    const res = await handleAdminLicenseDetail(env, req, mockRequireAdmin, 'lic-nonexistent');
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('License not found');
  });
});

// ============================================================================
// 6. handleAdminUpdateLicense
// ============================================================================

describe('handleAdminUpdateLicense', () => {
  it('extends expiry, logs audit, and returns success', async () => {
    const env = makeEnv();
    const newExpiry = '2028-01-01T00:00:00Z';
    const req = makeRequest('PATCH', '/v1/admin/licenses/lic-upd1', {
      expires_at: newExpiry,
    });

    // 1. License query (fetch current)
    mockQueryResponse([{
      license_id: 'lic-upd1',
      account_id: 'acc-upd1',
      plan_id: 'plan-enterprise',
      expires_at: '2027-01-01T00:00:00Z',
      feature_flags: { aip: true },
      limits: { included_checks: 100000 },
      max_activations: 3,
    }]);

    // 2. License update
    mockMutationResponse([{ license_id: 'lic-upd1' }]);

    // 3. Billing event insert (for expiry change)
    mockMutationResponse([{}]);

    // 4. Audit log insert
    mockMutationResponse([{}]);

    const res = await handleAdminUpdateLicense(env, req, mockRequireAdmin, 'lic-upd1');
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.license_id).toBe('lic-upd1');
    expect(body.updated).toBe(true);

    // Verify the update PATCH was called with the new expiry
    const updateCall = mockFetch.mock.calls[1];
    const updateBody = JSON.parse(updateCall[1].body);
    expect(updateBody.expires_at).toBe(newExpiry);
    expect(updateBody.updated_at).toBeTruthy();

    // Verify billing event was logged for expiry change
    const billingEventCall = mockFetch.mock.calls[2];
    const billingEventBody = JSON.parse(billingEventCall[1].body);
    expect(billingEventBody.event_type).toBe('license_extended');
    expect(billingEventBody.details.new_expires_at).toBe(newExpiry);
  });

  it('returns 404 when license is not found', async () => {
    const env = makeEnv();
    const req = makeRequest('PATCH', '/v1/admin/licenses/lic-missing', {
      expires_at: '2028-01-01T00:00:00Z',
    });

    // License query returns empty
    mockQueryResponse([]);

    const res = await handleAdminUpdateLicense(env, req, mockRequireAdmin, 'lic-missing');
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('License not found');
  });
});

// ============================================================================
// 7. handleAdminRevokeLicense
// ============================================================================

describe('handleAdminRevokeLicense', () => {
  it('revokes license, logs audit, sends email', async () => {
    const env = makeEnv();
    const req = makeRequest('DELETE', '/v1/admin/licenses/lic-rev1', {
      reason: 'Terms violation',
    });

    // 1. License query
    mockQueryResponse([{
      license_id: 'lic-rev1',
      account_id: 'acc-rev1',
      plan_id: 'plan-enterprise',
      revoked_at: null,
    }]);

    // 2. License update (set revoked_at)
    mockMutationResponse([{ license_id: 'lic-rev1' }]);

    // 3. Billing event insert
    mockMutationResponse([{}]);

    // 4. Audit log insert
    mockMutationResponse([{}]);

    // 5. Account query for email
    mockQueryResponse([{ billing_email: 'revoked@company.com' }]);

    const res = await handleAdminRevokeLicense(env, req, mockRequireAdmin, 'lic-rev1');
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.license_id).toBe('lic-rev1');
    expect(body.revoked).toBe(true);

    // Verify the update set revoked_at and revoked_reason
    const updateCall = mockFetch.mock.calls[1];
    const updateBody = JSON.parse(updateCall[1].body);
    expect(updateBody.revoked_at).toBeTruthy();
    expect(updateBody.revoked_by).toBe('admin-user-id');
    expect(updateBody.revoked_reason).toBe('Terms violation');
  });

  it('returns 404 when license is not found', async () => {
    const env = makeEnv();
    const req = makeRequest('DELETE', '/v1/admin/licenses/lic-missing', {
      reason: 'Not found',
    });

    // License query returns empty
    mockQueryResponse([]);

    const res = await handleAdminRevokeLicense(env, req, mockRequireAdmin, 'lic-missing');
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('License not found');
  });

  it('returns 409 when license is already revoked', async () => {
    const env = makeEnv();
    const req = makeRequest('DELETE', '/v1/admin/licenses/lic-alreadyrev', {
      reason: 'Double revoke',
    });

    // License query returns already-revoked license
    mockQueryResponse([{
      license_id: 'lic-alreadyrev',
      account_id: 'acc-rev2',
      plan_id: 'plan-enterprise',
      revoked_at: '2026-01-15T00:00:00Z',
    }]);

    const res = await handleAdminRevokeLicense(env, req, mockRequireAdmin, 'lic-alreadyrev');
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('already revoked');
  });
});

// ============================================================================
// 8. handleAdminReissueLicense
// ============================================================================

describe('handleAdminReissueLicense', () => {
  it('generates a new JWT for existing license', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/v1/admin/licenses/lic-reissue/reissue');

    // 1. License query
    mockQueryResponse([{
      license_id: 'lic-reissue',
      account_id: 'acc-reissue',
      plan_id: 'plan-enterprise',
      feature_flags: { aip: true, eu_compliance: true },
      limits: { included_checks: 100000 },
      max_activations: 3,
      is_offline: false,
      expires_at: '2027-06-01T00:00:00Z',
      jwt_kid: 'lsk-orig',
    }]);

    // 2. Audit log insert
    mockMutationResponse([{}]);

    const res = await handleAdminReissueLicense(env, req, mockRequireAdmin, 'lic-reissue');
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.license_id).toBe('lic-reissue');
    expect(body.license_jwt).toBeTruthy();
    expect(typeof body.license_jwt).toBe('string');
    expect((body.license_jwt as string).split('.').length).toBe(3);
    expect(body.expires_at).toBe('2027-06-01T00:00:00Z');

    // Verify the new JWT is valid and contains the right data
    const jwtResult = await verifyLicenseJWT(body.license_jwt as string, TEST_SIGNING_SECRET);
    expect(jwtResult.valid).toBe(true);
    if (jwtResult.valid) {
      expect(jwtResult.payload.license_id).toBe('lic-reissue');
      expect(jwtResult.payload.account_id).toBe('acc-reissue');
      expect(jwtResult.payload.feature_flags.aip).toBe(true);
      expect(jwtResult.payload.feature_flags.eu_compliance).toBe(true);
      expect(jwtResult.payload.kid).toBe('lsk-orig');
    }
  });

  it('returns 404 when license is not found', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/v1/admin/licenses/lic-nope/reissue');

    // License query returns empty
    mockQueryResponse([]);

    const res = await handleAdminReissueLicense(env, req, mockRequireAdmin, 'lic-nope');
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('License not found');
  });
});

// ============================================================================
// 9. handleLicenseValidate
// ============================================================================

describe('handleLicenseValidate', () => {
  it('returns 200 with features for a valid JWT', async () => {
    const env = makeEnv();

    // Sign a real JWT
    const payload = makeTestPayload();
    const token = await signLicenseJWT(payload, TEST_SIGNING_SECRET);

    const req = makeRequest('POST', '/v1/licenses/validate', {
      license: token,
      instance_id: 'inst-001',
    });

    // Mock the validate_license RPC response
    const futureDate = new Date(Date.now() + 86400000 * 365).toISOString();
    mockRpcResponse({
      valid: true,
      license_id: payload.license_id,
      plan_id: payload.plan_id,
      feature_flags: payload.feature_flags,
      limits: payload.limits,
      expires_at: futureDate,
    });

    const res = await handleLicenseValidate(env, req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.valid).toBe(true);
    expect(body.license_id).toBe(payload.license_id);
    expect(body.plan_id).toBe(payload.plan_id);
    expect((body.feature_flags as Record<string, boolean>).aip).toBe(true);
    expect((body.feature_flags as Record<string, boolean>).otel_export).toBe(true);
    expect(body.next_check_seconds).toBe(86400);
    expect(body.expires_at).toBe(futureDate);
  });

  it('returns 401 for invalid signature', async () => {
    const env = makeEnv();

    // Sign with a different secret
    const payload = makeTestPayload();
    const token = await signLicenseJWT(payload, 'completely-different-secret-that-is-long');

    const req = makeRequest('POST', '/v1/licenses/validate', {
      license: token,
      instance_id: 'inst-002',
    });

    const res = await handleLicenseValidate(env, req);
    expect(res.status).toBe(401);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('Invalid license');
  });

  it('returns 410 for expired JWT', async () => {
    const env = makeEnv();

    // Sign a JWT that expired in the past
    const payload = makeTestPayload({
      exp: Math.floor(Date.now() / 1000) - 86400, // expired yesterday
    });
    const token = await signLicenseJWT(payload, TEST_SIGNING_SECRET);

    const req = makeRequest('POST', '/v1/licenses/validate', {
      license: token,
      instance_id: 'inst-003',
    });

    const res = await handleLicenseValidate(env, req);
    expect(res.status).toBe(410);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('License expired');
  });

  it('returns 403 for revoked license', async () => {
    const env = makeEnv();

    // Sign a valid JWT
    const payload = makeTestPayload();
    const token = await signLicenseJWT(payload, TEST_SIGNING_SECRET);

    const req = makeRequest('POST', '/v1/licenses/validate', {
      license: token,
      instance_id: 'inst-004',
    });

    // Mock the RPC returning revoked
    mockRpcResponse({
      valid: false,
      reason: 'license_revoked',
    });

    const res = await handleLicenseValidate(env, req);
    expect(res.status).toBe(403);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('License revoked');
  });

  it('returns 409 when max activations exceeded', async () => {
    const env = makeEnv();

    // Sign a valid JWT
    const payload = makeTestPayload({ max_activations: 2 });
    const token = await signLicenseJWT(payload, TEST_SIGNING_SECRET);

    const req = makeRequest('POST', '/v1/licenses/validate', {
      license: token,
      instance_id: 'inst-005',
    });

    // Mock the RPC returning max activations exceeded
    mockRpcResponse({
      valid: false,
      reason: 'max_activations_exceeded',
      activation_count: 3,
      max_activations: 2,
    });

    const res = await handleLicenseValidate(env, req);
    expect(res.status).toBe(409);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('Maximum activations exceeded');
    expect(body.activation_count).toBe(3);
    expect(body.max_activations).toBe(2);
  });

  it('returns 400 when license field is missing', async () => {
    const env = makeEnv();
    const req = makeRequest('POST', '/v1/licenses/validate', {
      instance_id: 'inst-006',
    });

    const res = await handleLicenseValidate(env, req);
    expect(res.status).toBe(400);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain('license is required');
  });
});
