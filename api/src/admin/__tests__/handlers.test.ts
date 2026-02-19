import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleAdminRevenueDashboard,
  handleAdminCustomerList,
  handleAdminCustomerDetail,
  handleAdminAddNote,
  handleAdminSuspendAccount,
  handleAdminUnsuspendAccount,
  handleAdminIssueCreditNote,
  handleAdminGenerateInvoice,
  handleAdminImpersonate,
  handleAdminConversionFunnel,
  handleAdminExportRevenue,
  handleAdminExportCustomers,
  handleAdminExportUsageAggregate,
  handleAdminExportTax,
  handleAdminListCoupons,
  handleAdminCreateCoupon,
  handleAdminDeactivateCoupon,
  handleAdminApplyCoupon,
  type AdminGuard,
} from '../handlers';
import type { BillingEnv } from '../../billing/types';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock Stripe provider
vi.mock('../../billing/stripe-provider', () => ({
  createStripeProvider: vi.fn(() => ({
    createCreditNote: vi.fn().mockResolvedValue({ id: 'cn_test', status: 'issued' }),
    createManualInvoice: vi.fn().mockResolvedValue({ id: 'inv_test', status: 'open', hostedInvoiceUrl: 'https://stripe.com/inv' }),
    listCoupons: vi.fn().mockResolvedValue([
      { id: 'coupon_test', name: 'Test Coupon', percentOff: 20, amountOff: null, currency: null, duration: 'once', durationInMonths: null, valid: true, promotionCodes: [], created: 1700000000 },
    ]),
    createCoupon: vi.fn().mockResolvedValue({ id: 'coupon_new', name: 'New Coupon', percentOff: 10, amountOff: null, currency: null, duration: 'forever', durationInMonths: null, valid: true, promotionCodes: [], created: 1700000000 }),
    deactivateCoupon: vi.fn().mockResolvedValue(undefined),
    applyCustomerCoupon: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock email
vi.mock('../../billing/email', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  accountSuspendedEmail: vi.fn().mockReturnValue({ subject: 'Suspended', html: '<p>Suspended</p>', text: 'Suspended' }),
}));

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
  };
}

const mockAdmin = { sub: 'admin-user-id', email: 'admin@mnemom.ai', app_metadata: { is_admin: true }, exp: 9999999999, iat: 1700000000 };

const mockRequireAdmin: AdminGuard = vi.fn().mockResolvedValue(mockAdmin);
const mockRequireAdminFail: AdminGuard = vi.fn().mockResolvedValue(
  new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers: { 'Content-Type': 'application/json' } }),
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

// Helper: mock a successful Supabase RPC response
function mockRpcResponse(data: unknown): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

// Helper: mock a successful Supabase query response
function mockQueryResponse(data: unknown): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

// Helper: mock a successful Supabase insert/update response
function mockMutationResponse(data: unknown = [{}]): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Re-set default admin mock (may have been changed in individual tests)
  (mockRequireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(mockAdmin);
});

// ============================================
// Auth guard tests
// ============================================

describe('Admin auth guard', () => {
  it('should return 403 for non-admins on revenue dashboard', async () => {
    const env = makeEnv();
    const request = makeRequest('GET', '/v1/admin/revenue');
    const response = await handleAdminRevenueDashboard(env, request, mockRequireAdminFail);
    expect(response.status).toBe(403);
  });

  it('should return 403 for non-admins on customer list', async () => {
    const env = makeEnv();
    const request = makeRequest('GET', '/v1/admin/customers');
    const url = makeUrl('/v1/admin/customers');
    const response = await handleAdminCustomerList(env, request, mockRequireAdminFail, url);
    expect(response.status).toBe(403);
  });

  it('should return 403 for non-admins on suspend', async () => {
    const env = makeEnv();
    const request = makeRequest('POST', '/v1/admin/users/user-1/suspend', { reason: 'test' });
    const response = await handleAdminSuspendAccount(env, request, mockRequireAdminFail, 'user-1');
    expect(response.status).toBe(403);
  });
});

// ============================================
// 6.1 Revenue Dashboard
// ============================================

describe('handleAdminRevenueDashboard', () => {
  it('should return revenue KPIs from RPC', async () => {
    const env = makeEnv();
    const kpis = {
      mrr_cents: 50000,
      usage_revenue_cents: 1200,
      total_revenue_cents: 51200,
      active_accounts: 10,
      total_accounts: 25,
    };
    mockRpcResponse(kpis);

    const request = makeRequest('GET', '/v1/admin/revenue');
    const response = await handleAdminRevenueDashboard(env, request, mockRequireAdmin);

    expect(response.status).toBe(200);
    const body = ((await response.json()) as any) as any;
    expect(body.mrr_cents).toBe(50000);
    expect(body.active_accounts).toBe(10);
  });

  it('should return 500 on RPC error', async () => {
    const env = makeEnv();
    mockFetch.mockResolvedValueOnce({ ok: false, text: () => Promise.resolve('DB error') });

    const request = makeRequest('GET', '/v1/admin/revenue');
    const response = await handleAdminRevenueDashboard(env, request, mockRequireAdmin);
    expect(response.status).toBe(500);
  });
});

// ============================================
// 6.2 Customer List / Detail / Notes
// ============================================

describe('handleAdminCustomerList', () => {
  it('should pass query params to RPC', async () => {
    const env = makeEnv();
    const result = { customers: [], total: 0, limit: 50, offset: 0 };
    mockRpcResponse(result);

    const request = makeRequest('GET', '/v1/admin/customers');
    const url = makeUrl('/v1/admin/customers', { status: 'active', plan: 'plan-team', search: 'test@' });
    const response = await handleAdminCustomerList(env, request, mockRequireAdmin, url);

    expect(response.status).toBe(200);
    // Verify RPC was called with correct params
    const rpcCall = mockFetch.mock.calls[0];
    const rpcBody = JSON.parse(rpcCall[1].body);
    expect(rpcBody.p_status).toBe('active');
    expect(rpcBody.p_plan).toBe('plan-team');
    expect(rpcBody.p_search).toBe('test@');
  });
});

describe('handleAdminCustomerDetail', () => {
  it('should return customer detail from RPC', async () => {
    const env = makeEnv();
    const detail = { account: { account_id: 'ba-test' }, plan: { plan_id: 'plan-team' }, events: [], agents: [], notes: [] };
    mockRpcResponse(detail);

    const request = makeRequest('GET', '/v1/admin/customers/user-1');
    const response = await handleAdminCustomerDetail(env, request, mockRequireAdmin, 'user-1');

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.account.account_id).toBe('ba-test');
  });

  it('should return 404 when account not found', async () => {
    const env = makeEnv();
    mockRpcResponse({ error: 'account_not_found' });

    const request = makeRequest('GET', '/v1/admin/customers/user-unknown');
    const response = await handleAdminCustomerDetail(env, request, mockRequireAdmin, 'user-unknown');
    expect(response.status).toBe(404);
  });
});

describe('handleAdminAddNote', () => {
  it('should add a note and log audit', async () => {
    const env = makeEnv();
    // Query billing_accounts
    mockQueryResponse([{ account_id: 'ba-test' }]);
    // Insert note
    mockMutationResponse([{ id: 'acn-test', note: 'test note' }]);
    // Audit log insert
    mockMutationResponse();

    const request = makeRequest('POST', '/v1/admin/customers/user-1/notes', { note: 'test note' });
    const response = await handleAdminAddNote(env, request, mockRequireAdmin, 'user-1');

    expect(response.status).toBe(201);
  });

  it('should return 400 when note is missing', async () => {
    const env = makeEnv();
    const request = makeRequest('POST', '/v1/admin/customers/user-1/notes', {});
    const response = await handleAdminAddNote(env, request, mockRequireAdmin, 'user-1');
    expect(response.status).toBe(400);
  });

  it('should return 404 when account not found', async () => {
    const env = makeEnv();
    mockQueryResponse([]);

    const request = makeRequest('POST', '/v1/admin/customers/user-1/notes', { note: 'test' });
    const response = await handleAdminAddNote(env, request, mockRequireAdmin, 'user-1');
    expect(response.status).toBe(404);
  });
});

// ============================================
// 6.3 Suspend / Unsuspend
// ============================================

describe('handleAdminSuspendAccount', () => {
  it('should suspend account, log audit, send email, and purge KV', async () => {
    const env = makeEnv();
    // Query billing_accounts
    mockQueryResponse([{ account_id: 'ba-test', billing_email: 'user@test.com', is_suspended: false }]);
    // Update billing_accounts
    mockMutationResponse();
    // Insert billing event
    mockMutationResponse();
    // Audit log insert
    mockMutationResponse();
    // Agent query for KV purge
    mockQueryResponse([{ id: 'smolt-abc' }]);

    const request = makeRequest('POST', '/v1/admin/users/user-1/suspend', { reason: 'TOS violation' });
    const response = await handleAdminSuspendAccount(env, request, mockRequireAdmin, 'user-1');

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.suspended).toBe(true);

    // Verify email was sent
    const { sendEmail } = await import('../../billing/email');
    expect(sendEmail).toHaveBeenCalledWith('user@test.com', expect.any(Object), env);

    // Verify KV cache was purged
    expect(env.BILLING_CACHE!.delete).toHaveBeenCalledWith('quota:agent:smolt-abc');
  });

  it('should return 409 when already suspended', async () => {
    const env = makeEnv();
    mockQueryResponse([{ account_id: 'ba-test', billing_email: 'user@test.com', is_suspended: true }]);

    const request = makeRequest('POST', '/v1/admin/users/user-1/suspend', { reason: 'test' });
    const response = await handleAdminSuspendAccount(env, request, mockRequireAdmin, 'user-1');
    expect(response.status).toBe(409);
  });
});

describe('handleAdminUnsuspendAccount', () => {
  it('should unsuspend account and purge KV', async () => {
    const env = makeEnv();
    // Query billing_accounts
    mockQueryResponse([{ account_id: 'ba-test', is_suspended: true }]);
    // Update billing_accounts
    mockMutationResponse();
    // Insert billing event
    mockMutationResponse();
    // Audit log insert
    mockMutationResponse();
    // Agent query for KV purge
    mockQueryResponse([{ id: 'smolt-abc' }]);

    const request = makeRequest('POST', '/v1/admin/users/user-1/unsuspend');
    const response = await handleAdminUnsuspendAccount(env, request, mockRequireAdmin, 'user-1');

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.suspended).toBe(false);
  });

  it('should return 409 when not suspended', async () => {
    const env = makeEnv();
    mockQueryResponse([{ account_id: 'ba-test', is_suspended: false }]);

    const request = makeRequest('POST', '/v1/admin/users/user-1/unsuspend');
    const response = await handleAdminUnsuspendAccount(env, request, mockRequireAdmin, 'user-1');
    expect(response.status).toBe(409);
  });
});

// ============================================
// 6.3 Credit Note / Invoice
// ============================================

describe('handleAdminIssueCreditNote', () => {
  it('should create credit note via Stripe provider', async () => {
    const env = makeEnv();
    // Query billing_accounts
    mockQueryResponse([{ account_id: 'ba-test', stripe_customer_id: 'cus_test' }]);
    // Insert billing event
    mockMutationResponse();
    // Audit log insert
    mockMutationResponse();

    const request = makeRequest('POST', '/v1/admin/users/user-1/billing/credit-note', { amount_cents: 500, reason: 'Goodwill' });
    const response = await handleAdminIssueCreditNote(env, request, mockRequireAdmin, 'user-1');

    expect(response.status).toBe(201);
    const body = (await response.json()) as any;
    expect(body.id).toBe('cn_test');
  });

  it('should return 400 when amount is missing', async () => {
    const env = makeEnv();
    const request = makeRequest('POST', '/v1/admin/users/user-1/billing/credit-note', {});
    const response = await handleAdminIssueCreditNote(env, request, mockRequireAdmin, 'user-1');
    expect(response.status).toBe(400);
  });

  it('should return 400 when no Stripe customer linked', async () => {
    const env = makeEnv();
    mockQueryResponse([{ account_id: 'ba-test', stripe_customer_id: null }]);

    const request = makeRequest('POST', '/v1/admin/users/user-1/billing/credit-note', { amount_cents: 500 });
    const response = await handleAdminIssueCreditNote(env, request, mockRequireAdmin, 'user-1');
    expect(response.status).toBe(400);
  });
});

describe('handleAdminGenerateInvoice', () => {
  it('should create manual invoice via Stripe provider', async () => {
    const env = makeEnv();
    mockQueryResponse([{ account_id: 'ba-test', stripe_customer_id: 'cus_test' }]);
    mockMutationResponse();
    mockMutationResponse();

    const request = makeRequest('POST', '/v1/admin/users/user-1/billing/invoice', { amount_cents: 1000, description: 'Custom charge' });
    const response = await handleAdminGenerateInvoice(env, request, mockRequireAdmin, 'user-1');

    expect(response.status).toBe(201);
    const body = (await response.json()) as any;
    expect(body.id).toBe('inv_test');
  });

  it('should return 400 when description is missing', async () => {
    const env = makeEnv();
    const request = makeRequest('POST', '/v1/admin/users/user-1/billing/invoice', { amount_cents: 1000 });
    const response = await handleAdminGenerateInvoice(env, request, mockRequireAdmin, 'user-1');
    expect(response.status).toBe(400);
  });
});

// ============================================
// 6.3 Impersonate
// ============================================

describe('handleAdminImpersonate', () => {
  it('should return data snapshot and log audit', async () => {
    const env = makeEnv();
    const snapshot = { account: { account_id: 'ba-test' }, plan: {}, events: [], agents: [] };
    // RPC call
    mockRpcResponse(snapshot);
    // Billing event insert
    mockMutationResponse();
    // Audit log insert
    mockMutationResponse();

    const request = makeRequest('POST', '/v1/admin/users/user-1/impersonate');
    const response = await handleAdminImpersonate(env, request, mockRequireAdmin, 'user-1');

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.impersonated_user_id).toBe('user-1');
    expect(body.snapshot).toBeDefined();
  });

  it('should return 404 when account not found', async () => {
    const env = makeEnv();
    mockRpcResponse({ error: 'account_not_found' });

    const request = makeRequest('POST', '/v1/admin/users/user-unknown/impersonate');
    const response = await handleAdminImpersonate(env, request, mockRequireAdmin, 'user-unknown');
    expect(response.status).toBe(404);
  });
});

// ============================================
// C.4 Conversion Funnel
// ============================================

describe('handleAdminConversionFunnel', () => {
  it('should return funnel data from RPC', async () => {
    const env = makeEnv();
    const funnel = { period_days: 90, signups: 50, trials_started: 20, trials_converted: 8, upgrades: 3, churns: 2 };
    mockRpcResponse(funnel);

    const request = makeRequest('GET', '/v1/admin/analytics/funnel');
    const url = makeUrl('/v1/admin/analytics/funnel', { days: '60' });
    const response = await handleAdminConversionFunnel(env, request, mockRequireAdmin, url);

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.signups).toBe(50);

    // Verify days param was passed
    const rpcBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(rpcBody.p_days).toBe(60);
  });
});

// ============================================
// C.5 Exports
// ============================================

describe('handleAdminExportRevenue', () => {
  it('should return CSV with correct content-type', async () => {
    const env = makeEnv();
    mockQueryResponse([
      { event_id: 'be-1', account_id: 'ba-1', event_type: 'payment_succeeded', details: { amount_cents: 5000 }, timestamp: '2026-01-15' },
    ]);
    mockMutationResponse(); // Audit log

    const request = makeRequest('GET', '/v1/admin/exports/revenue');
    const url = makeUrl('/v1/admin/exports/revenue', { start: '2026-01-01', end: '2026-01-31' });
    const response = await handleAdminExportRevenue(env, request, mockRequireAdmin, url);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv');
    expect(response.headers.get('Content-Disposition')).toContain('revenue-');

    const text = await response.text();
    expect(text).toContain('event_id,account_id,event_type,amount_cents,timestamp');
    expect(text).toContain('be-1');
  });
});

describe('handleAdminExportCustomers', () => {
  it('should return CSV of all accounts', async () => {
    const env = makeEnv();
    mockQueryResponse([
      { account_id: 'ba-1', user_id: 'u-1', billing_email: 'user@test.com', plan_id: 'plan-team', subscription_status: 'active', is_suspended: false, check_count_this_period: 500, created_at: '2026-01-01' },
    ]);
    mockMutationResponse(); // Audit log

    const request = makeRequest('GET', '/v1/admin/exports/customers');
    const response = await handleAdminExportCustomers(env, request, mockRequireAdmin);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv');
    const text = await response.text();
    expect(text).toContain('account_id,user_id,billing_email');
    expect(text).toContain('ba-1');
  });
});

describe('handleAdminExportUsageAggregate', () => {
  it('should return usage CSV with date range', async () => {
    const env = makeEnv();
    mockQueryResponse([
      { account_id: 'ba-1', period_date: '2026-01-15', check_count: 100, overage_count: 0, cost_cents: 100 },
    ]);
    mockMutationResponse(); // Audit log

    const request = makeRequest('GET', '/v1/admin/exports/usage');
    const url = makeUrl('/v1/admin/exports/usage');
    const response = await handleAdminExportUsageAggregate(env, request, mockRequireAdmin, url);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv');
  });
});

describe('handleAdminExportTax', () => {
  it('should return tax CSV with currency column', async () => {
    const env = makeEnv();
    mockQueryResponse([
      { event_id: 'be-1', account_id: 'ba-1', event_type: 'payment_succeeded', details: { amount_cents: 5000, currency: 'usd' }, created_at: '2026-01-15' },
    ]);
    mockMutationResponse(); // Audit log

    const request = makeRequest('GET', '/v1/admin/exports/tax');
    const url = makeUrl('/v1/admin/exports/tax');
    const response = await handleAdminExportTax(env, request, mockRequireAdmin, url);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv');
    const text = await response.text();
    expect(text).toContain('currency');
  });
});

// ============================================
// C.6 Coupons
// ============================================

describe('handleAdminListCoupons', () => {
  it('should return coupons from Stripe', async () => {
    const env = makeEnv();
    const request = makeRequest('GET', '/v1/admin/coupons');
    const response = await handleAdminListCoupons(env, request, mockRequireAdmin);

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.coupons).toHaveLength(1);
    expect(body.coupons[0].id).toBe('coupon_test');
  });
});

describe('handleAdminCreateCoupon', () => {
  it('should create coupon with optional promo code', async () => {
    const env = makeEnv();
    mockMutationResponse(); // Audit log

    const request = makeRequest('POST', '/v1/admin/coupons', {
      name: 'New Coupon',
      percent_off: 10,
      duration: 'forever',
      promotion_code: 'SAVE10',
    });
    const response = await handleAdminCreateCoupon(env, request, mockRequireAdmin);

    expect(response.status).toBe(201);
    const body = (await response.json()) as any;
    expect(body.id).toBe('coupon_new');
  });

  it('should return 400 when name is missing', async () => {
    const env = makeEnv();
    const request = makeRequest('POST', '/v1/admin/coupons', { duration: 'once', percent_off: 10 });
    const response = await handleAdminCreateCoupon(env, request, mockRequireAdmin);
    expect(response.status).toBe(400);
  });

  it('should return 400 when neither percent_off nor amount_off provided', async () => {
    const env = makeEnv();
    const request = makeRequest('POST', '/v1/admin/coupons', { name: 'test', duration: 'once' });
    const response = await handleAdminCreateCoupon(env, request, mockRequireAdmin);
    expect(response.status).toBe(400);
  });
});

describe('handleAdminDeactivateCoupon', () => {
  it('should deactivate coupon and log audit', async () => {
    const env = makeEnv();
    mockMutationResponse(); // Audit log

    const request = makeRequest('DELETE', '/v1/admin/coupons/coupon_test');
    const response = await handleAdminDeactivateCoupon(env, request, mockRequireAdmin, 'coupon_test');

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.success).toBe(true);
    expect(body.coupon_id).toBe('coupon_test');
  });
});

describe('handleAdminApplyCoupon', () => {
  it('should apply coupon to customer and log audit', async () => {
    const env = makeEnv();
    // Query billing_accounts
    mockQueryResponse([{ account_id: 'ba-test', stripe_customer_id: 'cus_test' }]);
    // Insert billing event
    mockMutationResponse();
    // Audit log insert
    mockMutationResponse();

    const request = makeRequest('POST', '/v1/admin/users/user-1/billing/coupon', { coupon_id: 'coupon_test' });
    const response = await handleAdminApplyCoupon(env, request, mockRequireAdmin, 'user-1');

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.success).toBe(true);
    expect(body.coupon_id).toBe('coupon_test');
  });

  it('should return 400 when coupon_id is missing', async () => {
    const env = makeEnv();
    const request = makeRequest('POST', '/v1/admin/users/user-1/billing/coupon', {});
    const response = await handleAdminApplyCoupon(env, request, mockRequireAdmin, 'user-1');
    expect(response.status).toBe(400);
  });

  it('should return 404 when billing account not found', async () => {
    const env = makeEnv();
    mockQueryResponse([]);

    const request = makeRequest('POST', '/v1/admin/users/user-1/billing/coupon', { coupon_id: 'coupon_test' });
    const response = await handleAdminApplyCoupon(env, request, mockRequireAdmin, 'user-1');
    expect(response.status).toBe(404);
  });
});
