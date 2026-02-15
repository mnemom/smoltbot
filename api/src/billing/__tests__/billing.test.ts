/**
 * Tests for billing system: handlers, webhooks, feature-gate, usage-alerts, api-keys, email.
 * Mocks global fetch (Supabase), Stripe provider, and Resend.
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
const mockGetAuthNull = vi.fn().mockResolvedValue(null);

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(`https://api.mnemom.ai${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

// ============================================================================
// Email template tests (pure functions, no mocking needed)
// ============================================================================

describe('email templates', () => {
  // Import individual template functions
  let welcomeDeveloperEmail: typeof import('../email').welcomeDeveloperEmail;
  let welcomeTeamTrialEmail: typeof import('../email').welcomeTeamTrialEmail;
  let invoicePaidEmail: typeof import('../email').invoicePaidEmail;
  let paymentFailedEmail: typeof import('../email').paymentFailedEmail;
  let trialEndingEmail: typeof import('../email').trialEndingEmail;
  let trialExpiredEmail: typeof import('../email').trialExpiredEmail;
  let subscriptionCanceledEmail: typeof import('../email').subscriptionCanceledEmail;
  let planUpgradeEmail: typeof import('../email').planUpgradeEmail;
  let planDowngradeScheduledEmail: typeof import('../email').planDowngradeScheduledEmail;
  let usageWarningEmail: typeof import('../email').usageWarningEmail;
  let usageLimitReachedEmail: typeof import('../email').usageLimitReachedEmail;
  let budgetAlertEmail: typeof import('../email').budgetAlertEmail;
  let trialProgressEmail: typeof import('../email').trialProgressEmail;

  beforeEach(async () => {
    const mod = await import('../email');
    welcomeDeveloperEmail = mod.welcomeDeveloperEmail;
    welcomeTeamTrialEmail = mod.welcomeTeamTrialEmail;
    invoicePaidEmail = mod.invoicePaidEmail;
    paymentFailedEmail = mod.paymentFailedEmail;
    trialEndingEmail = mod.trialEndingEmail;
    trialExpiredEmail = mod.trialExpiredEmail;
    subscriptionCanceledEmail = mod.subscriptionCanceledEmail;
    planUpgradeEmail = mod.planUpgradeEmail;
    planDowngradeScheduledEmail = mod.planDowngradeScheduledEmail;
    usageWarningEmail = mod.usageWarningEmail;
    usageLimitReachedEmail = mod.usageLimitReachedEmail;
    budgetAlertEmail = mod.budgetAlertEmail;
    trialProgressEmail = mod.trialProgressEmail;
  });

  it('welcomeDeveloperEmail includes plan info', () => {
    const result = welcomeDeveloperEmail({ email: 'dev@test.com' });
    expect(result.subject).toContain('Developer');
    expect(result.html).toContain('$0.01');
    expect(result.text).toContain('Managed integrity gateway');
  });

  it('welcomeTeamTrialEmail mentions 14-day trial', () => {
    const result = welcomeTeamTrialEmail({ email: 'team@test.com' });
    expect(result.subject).toContain('14-day');
    expect(result.html).toContain('15,000');
    expect(result.text).toContain('90-day trace retention');
  });

  it('invoicePaidEmail formats amount correctly', () => {
    const result = invoicePaidEmail({ email: 'u@t.com', amountCents: 2999, invoiceUrl: 'https://stripe.com/inv/123' });
    expect(result.subject).toContain('$29.99');
    expect(result.html).toContain('$29.99');
    expect(result.html).toContain('https://stripe.com/inv/123');
  });

  it('invoicePaidEmail handles null invoice URL', () => {
    const result = invoicePaidEmail({ email: 'u@t.com', amountCents: 500, invoiceUrl: null });
    expect(result.subject).toContain('$5.00');
    expect(result.html).not.toContain('View your invoice');
  });

  it('paymentFailedEmail escalates urgency', () => {
    const first = paymentFailedEmail({ email: 'u@t.com' }, 1);
    expect(first.subject).toContain('first');
    expect(first.html).not.toContain('final attempt');

    const final = paymentFailedEmail({ email: 'u@t.com' }, 3);
    expect(final.subject).toContain('final');
    expect(final.html).toContain('final attempt');
  });

  it('trialEndingEmail shows date when provided', () => {
    const result = trialEndingEmail({ email: 'u@t.com', trialEndDate: '2026-03-15T12:00:00Z' });
    expect(result.html).toContain('March');
  });

  it('trialEndingEmail defaults to "in 3 days"', () => {
    const result = trialEndingEmail({ email: 'u@t.com' });
    expect(result.html).toContain('in 3 days');
  });

  it('trialExpiredEmail preserves data language', () => {
    const result = trialExpiredEmail({ email: 'u@t.com' });
    expect(result.text).toContain('fully preserved');
  });

  it('subscriptionCanceledEmail mentions Free plan', () => {
    const result = subscriptionCanceledEmail({ email: 'u@t.com' });
    expect(result.text).toContain('Free plan');
    expect(result.text).toContain('data is safe');
  });

  it('planUpgradeEmail lists features', () => {
    const result = planUpgradeEmail({
      email: 'u@t.com',
      newPlan: 'Team',
      features: ['15,000 checks', '90-day retention'],
    });
    expect(result.subject).toContain('Team');
    expect(result.html).toContain('15,000 checks');
    expect(result.html).toContain('90-day retention');
  });

  it('planDowngradeScheduledEmail formats date', () => {
    const result = planDowngradeScheduledEmail({
      email: 'u@t.com',
      currentPlan: 'Team',
      newPlan: 'Developer',
      effectiveDate: '2026-04-01T00:00:00Z',
      losingFeatures: ['EU compliance exports'],
    });
    expect(result.subject).toContain('plan change');
    expect(result.html).toContain('Team');
    expect(result.html).toContain('Developer');
    expect(result.html).toContain('EU compliance exports');
  });

  it('usageWarningEmail includes percentage', () => {
    const result = usageWarningEmail({
      email: 'u@t.com',
      usagePercent: 85,
      checksUsed: 12750,
      checksIncluded: 15000,
      planName: 'plan-team',
    });
    expect(result.subject).toContain('85%');
    expect(result.html).toContain('12,750');
    expect(result.html).toContain('15,000');
  });

  it('usageLimitReachedEmail shows per-check price', () => {
    const result = usageLimitReachedEmail({
      email: 'u@t.com',
      checksUsed: 15001,
      checksIncluded: 15000,
      perCheckPrice: 0.008,
    });
    expect(result.html).toContain('$0.008');
  });

  it('budgetAlertEmail formats cents to dollars', () => {
    const result = budgetAlertEmail({
      email: 'u@t.com',
      currentCostCents: 5000,
      budgetCents: 4000,
    });
    expect(result.subject).toContain('$50.00');
    expect(result.html).toContain('$40.00');
  });

  it('trialProgressEmail adapts for zero usage', () => {
    const zero = trialProgressEmail({ email: 'u@t.com', checksUsed: 0, agentsLinked: 0, daysUsed: 3 });
    expect(zero.html).toContain('getting started');

    const active = trialProgressEmail({ email: 'u@t.com', checksUsed: 50, agentsLinked: 2, daysUsed: 3 });
    expect(active.html).toContain('Great progress');
    expect(active.text).toContain('2 agents');
  });
});

// ============================================================================
// sendEmail tests (mocked Resend + Supabase)
// ============================================================================

describe('sendEmail', () => {
  let sendEmail: typeof import('../email').sendEmail;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    const mod = await import('../email');
    sendEmail = mod.sendEmail;
  });

  it('calls Resend API and logs to email_log', async () => {
    const env = makeEnv();
    mockFetch
      .mockResolvedValueOnce(jsonOk({ id: 'resend-123' })) // Resend API
      .mockResolvedValueOnce(jsonOk({})); // email_log insert

    await sendEmail('u@t.com', { subject: 'Test', html: '<p>Hi</p>', text: 'Hi' }, env as any);

    // First call: Resend API
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const resendCall = mockFetch.mock.calls[0];
    expect(resendCall[0]).toBe('https://api.resend.com/emails');
    const resendBody = JSON.parse(resendCall[1].body);
    expect(resendBody.to).toEqual(['u@t.com']);
    expect(resendBody.subject).toBe('Test');

    // Second call: email_log insert
    const logCall = mockFetch.mock.calls[1];
    expect(logCall[0]).toContain('email_log');
    const logBody = JSON.parse(logCall[1].body);
    expect(logBody.recipient).toBe('u@t.com');
    expect(logBody.status).toBe('sent');
    expect(logBody.resend_id).toBe('resend-123');
  });

  it('logs failure when Resend returns error', async () => {
    const env = makeEnv();
    mockFetch
      .mockResolvedValueOnce(jsonError(500, 'Resend error')) // Resend fails
      .mockResolvedValueOnce(jsonOk({})); // email_log insert

    await sendEmail('u@t.com', { subject: 'Test', html: '', text: '' }, env as any);

    const logCall = mockFetch.mock.calls[1];
    const logBody = JSON.parse(logCall[1].body);
    expect(logBody.status).toBe('failed');
    expect(logBody.error).toContain('Resend API error');
  });
});

// ============================================================================
// Feature gate tests
// ============================================================================

describe('feature-gate', () => {
  let requireFeature: typeof import('../feature-gate').requireFeature;
  let handleGetFeatures: typeof import('../feature-gate').handleGetFeatures;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    const mod = await import('../feature-gate');
    requireFeature = mod.requireFeature;
    handleGetFeatures = mod.handleGetFeatures;
  });

  describe('requireFeature', () => {
    it('returns null (allowed) when feature is enabled', async () => {
      const env = makeEnv();
      mockFetch.mockResolvedValueOnce(jsonOk({
        account: { check_count_this_period: 10 },
        plan: { feature_flags: { otel_export: true } },
      }));

      const result = await requireFeature(env as any, 'user-123', 'otel_export');
      expect(result).toBeNull();
    });

    it('returns 403 when feature is not enabled', async () => {
      const env = makeEnv();
      mockFetch.mockResolvedValueOnce(jsonOk({
        account: {},
        plan: { feature_flags: { otel_export: false } },
      }));

      const result = await requireFeature(env as any, 'user-123', 'otel_export');
      expect(result).not.toBeNull();
      expect(result!.status).toBe(403);
      const body = await result!.json() as Record<string, unknown>;
      expect(body.error).toBe('feature_gated');
      expect(body.feature).toBe('otel_export');
    });

    it('fails open on database error', async () => {
      const env = makeEnv();
      mockFetch.mockResolvedValueOnce(jsonError(500));

      const result = await requireFeature(env as any, 'user-123', 'otel_export');
      expect(result).toBeNull();
    });
  });

  describe('handleGetFeatures', () => {
    it('returns 401 without auth', async () => {
      const env = makeEnv();
      const req = makeRequest('/v1/billing/features');
      const res = await handleGetFeatures(env as any, req, mockGetAuthNull);
      expect(res.status).toBe(401);
    });

    it('returns features for authenticated user', async () => {
      const env = makeEnv();
      const req = makeRequest('/v1/billing/features');

      mockFetch
        .mockResolvedValueOnce(jsonOk({ account_id: 'acc-1' })) // ensure_billing_account
        .mockResolvedValueOnce(jsonOk({ // admin_get_billing_summary
          account: { check_count_this_period: 42, subscription_status: 'active' },
          plan: {
            plan_id: 'plan-team',
            feature_flags: { otel_export: true, eu_compliance: true },
            limits: { max_agents: 50 },
            included_checks: 15000,
          },
        }));

      const res = await handleGetFeatures(env as any, req, mockGetAuth);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.plan_id).toBe('plan-team');
      expect((body.feature_flags as Record<string, boolean>).otel_export).toBe(true);
      expect(body.check_count_this_period).toBe(42);
      expect(body.included_checks).toBe(15000);
    });
  });
});

// ============================================================================
// Handler tests
// ============================================================================

describe('handlers', () => {
  let handleCheckout: typeof import('../handlers').handleCheckout;
  let handleGetSubscription: typeof import('../handlers').handleGetSubscription;
  let handleCancel: typeof import('../handlers').handleCancel;
  let handleReactivate: typeof import('../handlers').handleReactivate;
  let handleChangePlan: typeof import('../handlers').handleChangePlan;
  let handleListInvoices: typeof import('../handlers').handleListInvoices;
  let handleGetMyUsage: typeof import('../handlers').handleGetMyUsage;
  let handleGetMyAgentUsage: typeof import('../handlers').handleGetMyAgentUsage;
  let handleExportUsage: typeof import('../handlers').handleExportUsage;
  let handleGetBudgetAlert: typeof import('../handlers').handleGetBudgetAlert;
  let handleSetBudgetAlert: typeof import('../handlers').handleSetBudgetAlert;
  let handleStripeWebhook: typeof import('../handlers').handleStripeWebhook;
  let handleValidatePromo: typeof import('../handlers').handleValidatePromo;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    mockGetAuth.mockClear();

    // Mock stripe module so createStripeProvider doesn't need real keys
    vi.doMock('stripe', () => ({
      default: class MockStripe {
        static createFetchHttpClient() { return {}; }
        promotionCodes = {
          list: vi.fn().mockResolvedValue({ data: [] }),
        };
      },
    }));

    const mod = await import('../handlers');
    handleCheckout = mod.handleCheckout;
    handleGetSubscription = mod.handleGetSubscription;
    handleCancel = mod.handleCancel;
    handleReactivate = mod.handleReactivate;
    handleChangePlan = mod.handleChangePlan;
    handleListInvoices = mod.handleListInvoices;
    handleGetMyUsage = mod.handleGetMyUsage;
    handleGetMyAgentUsage = mod.handleGetMyAgentUsage;
    handleExportUsage = mod.handleExportUsage;
    handleGetBudgetAlert = mod.handleGetBudgetAlert;
    handleSetBudgetAlert = mod.handleSetBudgetAlert;
    handleStripeWebhook = mod.handleStripeWebhook;
    handleValidatePromo = mod.handleValidatePromo;
  });

  describe('auth guard', () => {
    it('all protected endpoints return 401 without auth', async () => {
      const env = makeEnv();
      const handlers = [
        () => handleCheckout(env as any, makeRequest('/v1/billing/checkout', { method: 'POST', body: '{}' }), mockGetAuthNull),
        () => handleGetSubscription(env as any, makeRequest('/v1/billing/subscription'), mockGetAuthNull),
        () => handleCancel(env as any, makeRequest('/v1/billing/cancel', { method: 'POST' }), mockGetAuthNull),
        () => handleReactivate(env as any, makeRequest('/v1/billing/reactivate', { method: 'POST' }), mockGetAuthNull),
        () => handleChangePlan(env as any, makeRequest('/v1/billing/change-plan', { method: 'POST', body: '{}' }), mockGetAuthNull),
        () => handleListInvoices(env as any, makeRequest('/v1/billing/invoices'), mockGetAuthNull),
        () => handleGetMyUsage(env as any, makeRequest('/v1/billing/usage'), mockGetAuthNull),
        () => handleGetMyAgentUsage(env as any, makeRequest('/v1/billing/usage/agents'), mockGetAuthNull),
        () => handleExportUsage(env as any, makeRequest('/v1/billing/export/usage?from=2026-01-01&to=2026-01-31'), mockGetAuthNull),
        () => handleGetBudgetAlert(env as any, makeRequest('/v1/billing/budget-alert'), mockGetAuthNull),
        () => handleSetBudgetAlert(env as any, makeRequest('/v1/billing/budget-alert', { method: 'PUT', body: '{}' }), mockGetAuthNull),
      ];

      for (const handler of handlers) {
        const res = await handler();
        expect(res.status).toBe(401);
      }
    });
  });

  describe('handleCheckout', () => {
    it('returns 400 without plan_id', async () => {
      const env = makeEnv();
      const req = makeRequest('/v1/billing/checkout', { method: 'POST', body: JSON.stringify({}) });
      const res = await handleCheckout(env as any, req, mockGetAuth);
      expect(res.status).toBe(400);
    });

    it('returns contact_sales for enterprise', async () => {
      const env = makeEnv();
      const req = makeRequest('/v1/billing/checkout', { method: 'POST', body: JSON.stringify({ plan_id: 'plan-enterprise' }) });
      const res = await handleCheckout(env as any, req, mockGetAuth);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.action).toBe('contact_sales');
    });

    it('returns 400 for free plan', async () => {
      const env = makeEnv();
      const req = makeRequest('/v1/billing/checkout', { method: 'POST', body: JSON.stringify({ plan_id: 'plan-free' }) });
      const res = await handleCheckout(env as any, req, mockGetAuth);
      expect(res.status).toBe(400);
    });
  });

  describe('handleGetSubscription', () => {
    it('returns null subscription when no subscription ID', async () => {
      const env = makeEnv();
      mockFetch.mockResolvedValueOnce(jsonOk([{
        plan_id: 'plan-free',
        subscription_status: 'none',
        stripe_subscription_id: null,
      }]));

      const req = makeRequest('/v1/billing/subscription');
      const res = await handleGetSubscription(env as any, req, mockGetAuth);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.subscription).toBeNull();
      expect(body.plan_id).toBe('plan-free');
    });

    it('returns 404 when no billing account', async () => {
      const env = makeEnv();
      mockFetch.mockResolvedValueOnce(jsonOk([]));

      const req = makeRequest('/v1/billing/subscription');
      const res = await handleGetSubscription(env as any, req, mockGetAuth);
      expect(res.status).toBe(404);
    });
  });

  describe('handleCancel', () => {
    it('returns 400 when no subscription to cancel', async () => {
      const env = makeEnv();
      mockFetch.mockResolvedValueOnce(jsonOk([{
        stripe_subscription_id: null,
      }]));

      const req = makeRequest('/v1/billing/cancel', { method: 'POST' });
      const res = await handleCancel(env as any, req, mockGetAuth);
      expect(res.status).toBe(400);
    });
  });

  describe('handleReactivate', () => {
    it('returns 400 when no subscription to reactivate', async () => {
      const env = makeEnv();
      mockFetch.mockResolvedValueOnce(jsonOk([{ stripe_subscription_id: null }]));

      const req = makeRequest('/v1/billing/reactivate', { method: 'POST' });
      const res = await handleReactivate(env as any, req, mockGetAuth);
      expect(res.status).toBe(400);
    });
  });

  describe('handleChangePlan', () => {
    it('returns 400 without plan_id', async () => {
      const env = makeEnv();
      const req = makeRequest('/v1/billing/change-plan', { method: 'POST', body: JSON.stringify({}) });
      const res = await handleChangePlan(env as any, req, mockGetAuth);
      expect(res.status).toBe(400);
    });

    it('returns contact_sales for enterprise', async () => {
      const env = makeEnv();
      const req = makeRequest('/v1/billing/change-plan', { method: 'POST', body: JSON.stringify({ plan_id: 'plan-enterprise' }) });
      const res = await handleChangePlan(env as any, req, mockGetAuth);
      const body = await res.json() as Record<string, unknown>;
      expect(body.action).toBe('contact_sales');
    });

    it('returns 400 when no active subscription', async () => {
      const env = makeEnv();
      mockFetch.mockResolvedValueOnce(jsonOk([{ stripe_subscription_id: null }]));

      const req = makeRequest('/v1/billing/change-plan', { method: 'POST', body: JSON.stringify({ plan_id: 'plan-team' }) });
      const res = await handleChangePlan(env as any, req, mockGetAuth);
      expect(res.status).toBe(400);
    });
  });

  describe('handleListInvoices', () => {
    it('returns empty array when no customer ID', async () => {
      const env = makeEnv();
      mockFetch.mockResolvedValueOnce(jsonOk([{ stripe_customer_id: null }]));

      const req = makeRequest('/v1/billing/invoices');
      const res = await handleListInvoices(env as any, req, mockGetAuth);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.invoices).toEqual([]);
    });
  });

  describe('handleGetMyUsage', () => {
    it('clamps days parameter to 1-90', async () => {
      const env = makeEnv();
      // Account query
      mockFetch.mockResolvedValueOnce(jsonOk([{
        account_id: 'acc-1',
        plan_id: 'plan-team',
        check_count_this_period: 500,
        current_period_start: '2026-01-01',
        current_period_end: '2026-02-01',
      }]));
      // Rollup query
      mockFetch.mockResolvedValueOnce(jsonOk([]));
      // Plan query
      mockFetch.mockResolvedValueOnce(jsonOk([{ included_checks: 15000, per_check_price: 0.008 }]));

      const req = makeRequest('/v1/billing/usage?days=999');
      const res = await handleGetMyUsage(env as any, req, mockGetAuth);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      const summary = body.summary as Record<string, unknown>;
      expect(summary.checks_used).toBe(500);
      expect(summary.overage).toBe(0);
    });
  });

  describe('handleExportUsage', () => {
    it('returns 400 without date params', async () => {
      const env = makeEnv();
      const req = makeRequest('/v1/billing/export/usage');
      const res = await handleExportUsage(env as any, req, mockGetAuth);
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid date format', async () => {
      const env = makeEnv();
      const req = makeRequest('/v1/billing/export/usage?from=bad&to=date');
      const res = await handleExportUsage(env as any, req, mockGetAuth);
      expect(res.status).toBe(400);
    });

    it('returns CSV for valid date range', async () => {
      const env = makeEnv();
      // Account query
      mockFetch.mockResolvedValueOnce(jsonOk([{ account_id: 'acc-1' }]));
      // Rollup query
      mockFetch.mockResolvedValueOnce(jsonOk([
        { rollup_date: '2026-01-15', check_count: 100, tokens_in: 5000, tokens_out: 3000 },
      ]));

      const req = makeRequest('/v1/billing/export/usage?from=2026-01-01&to=2026-01-31');
      const res = await handleExportUsage(env as any, req, mockGetAuth);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/csv');
      const text = await res.text();
      expect(text).toContain('Date,Check Count,Tokens In,Tokens Out');
      expect(text).toContain('2026-01-15');
    });
  });

  describe('handleGetBudgetAlert', () => {
    it('returns threshold from account', async () => {
      const env = makeEnv();
      mockFetch.mockResolvedValueOnce(jsonOk([{
        budget_alert_threshold_cents: 5000,
        budget_alert_sent_at: null,
      }]));

      const req = makeRequest('/v1/billing/budget-alert');
      const res = await handleGetBudgetAlert(env as any, req, mockGetAuth);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.threshold_cents).toBe(5000);
    });
  });

  describe('handleSetBudgetAlert', () => {
    it('rejects negative threshold', async () => {
      const env = makeEnv();
      const req = makeRequest('/v1/billing/budget-alert', {
        method: 'PUT',
        body: JSON.stringify({ threshold_cents: -100 }),
      });
      const res = await handleSetBudgetAlert(env as any, req, mockGetAuth);
      expect(res.status).toBe(400);
    });

    it('allows null threshold to clear', async () => {
      const env = makeEnv();
      mockFetch
        .mockResolvedValueOnce(jsonOk([{ account_id: 'acc-1' }])) // account lookup
        .mockResolvedValueOnce(jsonOk({})); // update

      const req = makeRequest('/v1/billing/budget-alert', {
        method: 'PUT',
        body: JSON.stringify({ threshold_cents: null }),
      });
      const res = await handleSetBudgetAlert(env as any, req, mockGetAuth);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.updated).toBe(true);
      expect(body.threshold_cents).toBeNull();
    });
  });

  describe('handleStripeWebhook', () => {
    it('returns 400 without stripe-signature header', async () => {
      const env = makeEnv();
      const req = new Request('https://api.mnemom.ai/v1/billing/webhooks/stripe', {
        method: 'POST',
        body: '{}',
      });
      const res = await handleStripeWebhook(env as any, req);
      expect(res.status).toBe(400);
    });
  });

  describe('handleValidatePromo', () => {
    it('returns 400 without code', async () => {
      const env = makeEnv();
      const req = makeRequest('/v1/billing/validate-promo', { method: 'POST', body: JSON.stringify({}) });
      const res = await handleValidatePromo(env as any, req);
      expect(res.status).toBe(400);
    });
  });
});

// ============================================================================
// API key handler tests
// ============================================================================

describe('api-keys', () => {
  let handleCreateApiKey: typeof import('../api-keys').handleCreateApiKey;
  let handleListApiKeys: typeof import('../api-keys').handleListApiKeys;
  let handleRevokeApiKey: typeof import('../api-keys').handleRevokeApiKey;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    mockGetAuth.mockClear();
    const mod = await import('../api-keys');
    handleCreateApiKey = mod.handleCreateApiKey;
    handleListApiKeys = mod.handleListApiKeys;
    handleRevokeApiKey = mod.handleRevokeApiKey;
  });

  describe('handleCreateApiKey', () => {
    it('returns 401 without auth', async () => {
      const env = makeEnv();
      const req = makeRequest('/v1/api-keys', { method: 'POST', body: JSON.stringify({ name: 'Test' }) });
      const res = await handleCreateApiKey(env as any, req, mockGetAuthNull);
      expect(res.status).toBe(401);
    });

    it('creates key with mnm_ prefix', async () => {
      const env = makeEnv();
      mockFetch
        .mockResolvedValueOnce(jsonOk({ account_id: 'acc-1' })) // ensure_billing_account
        .mockResolvedValueOnce(jsonOk({})) // insert key
        .mockResolvedValueOnce(jsonOk({})); // insert billing event

      const req = makeRequest('/v1/api-keys', { method: 'POST', body: JSON.stringify({ name: 'My Key' }) });
      const res = await handleCreateApiKey(env as any, req, mockGetAuth);
      expect(res.status).toBe(201);
      const body = await res.json() as Record<string, unknown>;
      expect(body.key).toMatch(/^mnm_/);
      expect(body.key_prefix).toMatch(/^mnm_/);
      expect(body.name).toBe('My Key');
      expect(body.scopes).toEqual(['gateway', 'api']);
    });

    it('uses default name when not provided', async () => {
      const env = makeEnv();
      mockFetch
        .mockResolvedValueOnce(jsonOk({ account_id: 'acc-1' }))
        .mockResolvedValueOnce(jsonOk({}))
        .mockResolvedValueOnce(jsonOk({}));

      const req = makeRequest('/v1/api-keys', { method: 'POST' });
      const res = await handleCreateApiKey(env as any, req, mockGetAuth);
      expect(res.status).toBe(201);
      const body = await res.json() as Record<string, unknown>;
      expect(body.name).toBe('Default');
    });

    it('truncates name at 100 chars', async () => {
      const env = makeEnv();
      mockFetch
        .mockResolvedValueOnce(jsonOk({ account_id: 'acc-1' }))
        .mockResolvedValueOnce(jsonOk({}))
        .mockResolvedValueOnce(jsonOk({}));

      const longName = 'a'.repeat(200);
      const req = makeRequest('/v1/api-keys', { method: 'POST', body: JSON.stringify({ name: longName }) });
      const res = await handleCreateApiKey(env as any, req, mockGetAuth);
      const body = await res.json() as Record<string, unknown>;
      expect((body.name as string).length).toBe(100);
    });
  });

  describe('handleListApiKeys', () => {
    it('returns 401 without auth', async () => {
      const env = makeEnv();
      const req = makeRequest('/v1/api-keys');
      const res = await handleListApiKeys(env as any, req, mockGetAuthNull);
      expect(res.status).toBe(401);
    });

    it('returns list of keys', async () => {
      const env = makeEnv();
      const keys = [
        { key_id: 'mk-1', key_prefix: 'mnm_abcd', name: 'Test', created_at: '2026-01-01', last_used_at: null },
      ];
      mockFetch.mockResolvedValueOnce(jsonOk(keys));

      const req = makeRequest('/v1/api-keys');
      const res = await handleListApiKeys(env as any, req, mockGetAuth);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      const resultKeys = body.keys as Array<Record<string, unknown>>;
      expect(resultKeys).toHaveLength(1);
      expect(resultKeys[0].key_id).toBe('mk-1');
    });
  });

  describe('handleRevokeApiKey', () => {
    it('returns 401 without auth', async () => {
      const env = makeEnv();
      const req = makeRequest('/v1/api-keys/mk-1', { method: 'DELETE' });
      const res = await handleRevokeApiKey(env as any, req, mockGetAuthNull, 'mk-1');
      expect(res.status).toBe(401);
    });

    it('returns 404 when key not found', async () => {
      const env = makeEnv();
      mockFetch.mockResolvedValueOnce(jsonOk([]));

      const req = makeRequest('/v1/api-keys/mk-999', { method: 'DELETE' });
      const res = await handleRevokeApiKey(env as any, req, mockGetAuth, 'mk-999');
      expect(res.status).toBe(404);
    });

    it('soft-deletes key and logs event', async () => {
      const env = makeEnv();
      mockFetch
        .mockResolvedValueOnce(jsonOk([{ key_id: 'mk-1', account_id: 'acc-1' }])) // lookup
        .mockResolvedValueOnce(jsonOk({})) // update (soft-delete)
        .mockResolvedValueOnce(jsonOk({})); // billing event insert

      const req = makeRequest('/v1/api-keys/mk-1', { method: 'DELETE' });
      const res = await handleRevokeApiKey(env as any, req, mockGetAuth, 'mk-1');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.revoked).toBe(true);
      expect(body.key_id).toBe('mk-1');

      // Verify the soft-delete PATCH call
      const updateCall = mockFetch.mock.calls[1];
      const updateBody = JSON.parse(updateCall[1].body);
      expect(updateBody.is_active).toBe(false);
      expect(updateBody.revoked_at).toBeDefined();
    });
  });
});

// ============================================================================
// Webhook handler tests
// ============================================================================

describe('webhook-handler', () => {
  let processWebhookEvent: typeof import('../webhook-handler').processWebhookEvent;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    const mod = await import('../webhook-handler');
    processWebhookEvent = mod.processWebhookEvent;
  });

  it('skips duplicate events (idempotency)', async () => {
    const env = makeEnv();
    // Insert returns conflict
    mockFetch.mockResolvedValueOnce(jsonError(409, '23505 duplicate key'));

    await processWebhookEvent(
      { id: 'evt_dup', type: 'invoice.paid', data: { object: {} } },
      env as any,
    );

    // Only one fetch call (the insert), no processing
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('logs unknown event types without error', async () => {
    const env = makeEnv();
    // Insert succeeds
    mockFetch.mockResolvedValueOnce(jsonOk({}));
    // Mark processed
    mockFetch.mockResolvedValueOnce(jsonOk([]));

    await processWebhookEvent(
      { id: 'evt_unknown', type: 'some.unknown.event', data: { object: {} } },
      env as any,
    );

    // Should mark as processed
    const updateCall = mockFetch.mock.calls[1];
    const updateBody = JSON.parse(updateCall[1].body);
    expect(updateBody.status).toBe('processed');
  });

  it('marks failed events in stripe_webhook_events', async () => {
    const env = makeEnv();
    // Insert succeeds
    mockFetch.mockResolvedValueOnce(jsonOk({}));
    // The handler will try to lookup account — make it fail
    mockFetch.mockRejectedValueOnce(new Error('DB exploded'));
    // Mark failed
    mockFetch.mockResolvedValueOnce(jsonOk([]));

    await expect(
      processWebhookEvent(
        { id: 'evt_fail', type: 'customer.subscription.created', data: { object: { customer: 'cus_123' } } },
        env as any,
      ),
    ).rejects.toThrow('DB exploded');
  });

  describe('handleSubscriptionDeleted', () => {
    it('downgrades to free plan and purges cache', async () => {
      const env = makeEnv();
      // Insert event
      mockFetch.mockResolvedValueOnce(jsonOk({}));
      // lookupAccountByCustomer RPC
      mockFetch.mockResolvedValueOnce(jsonOk([{
        account_id: 'acc-1',
        billing_email: 'u@t.com',
        subscription_status: 'active',
      }]));
      // Update billing_accounts (downgrade to free)
      mockFetch.mockResolvedValueOnce(jsonOk([]));
      // Purge cache: fetch agents
      mockFetch.mockResolvedValueOnce(jsonOk([{ id: 'agent-1' }]));
      // Purge cache: fetch keys
      mockFetch.mockResolvedValueOnce(jsonOk([]));
      // Log billing event
      mockFetch.mockResolvedValueOnce(jsonOk({}));
      // Send email (Resend)
      mockFetch.mockResolvedValueOnce(jsonOk({ id: 'resend-1' }));
      // Log email
      mockFetch.mockResolvedValueOnce(jsonOk({}));
      // Mark processed
      mockFetch.mockResolvedValueOnce(jsonOk([]));

      await processWebhookEvent(
        {
          id: 'evt_sub_del',
          type: 'customer.subscription.deleted',
          data: { object: { customer: 'cus_123' } },
        },
        env as any,
      );

      // Verify the downgrade update
      const updateCall = mockFetch.mock.calls[2];
      const updateBody = JSON.parse(updateCall[1].body);
      expect(updateBody.plan_id).toBe('plan-free');
      expect(updateBody.subscription_status).toBe('canceled');

      // Verify KV cache was purged
      expect(env.BILLING_CACHE.delete).toHaveBeenCalledWith('quota:agent:agent-1');
    });
  });

  describe('handleInvoicePaid', () => {
    it('resets period counter and sets active', async () => {
      const env = makeEnv();
      // Insert event
      mockFetch.mockResolvedValueOnce(jsonOk({}));
      // lookupAccountByCustomer
      mockFetch.mockResolvedValueOnce(jsonOk([{
        account_id: 'acc-1',
        billing_email: 'u@t.com',
      }]));
      // Update (reset counter)
      mockFetch.mockResolvedValueOnce(jsonOk([]));
      // Purge cache: agents
      mockFetch.mockResolvedValueOnce(jsonOk([]));
      // Purge cache: keys
      mockFetch.mockResolvedValueOnce(jsonOk([]));
      // Log event
      mockFetch.mockResolvedValueOnce(jsonOk({}));
      // Send email
      mockFetch.mockResolvedValueOnce(jsonOk({ id: 'r-1' }));
      // Log email
      mockFetch.mockResolvedValueOnce(jsonOk({}));
      // Mark processed
      mockFetch.mockResolvedValueOnce(jsonOk([]));

      await processWebhookEvent(
        {
          id: 'evt_inv_paid',
          type: 'invoice.paid',
          data: {
            object: {
              customer: 'cus_123',
              amount_paid: 2900,
              period_start: 1700000000,
              period_end: 1702592000,
              hosted_invoice_url: 'https://stripe.com/inv/1',
            },
          },
        },
        env as any,
      );

      // Verify counter reset
      const updateCall = mockFetch.mock.calls[2];
      const updateBody = JSON.parse(updateCall[1].body);
      expect(updateBody.check_count_this_period).toBe(0);
      expect(updateBody.subscription_status).toBe('active');
      expect(updateBody.past_due_since).toBeNull();
    });
  });
});

// ============================================================================
// Usage alerts tests
// ============================================================================

describe('usage-alerts', () => {
  let checkUsageAlerts: typeof import('../usage-alerts').checkUsageAlerts;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    const mod = await import('../usage-alerts');
    checkUsageAlerts = mod.checkUsageAlerts;
  });

  it('sends usage warning at 80% threshold', async () => {
    const env = makeEnv();
    // Fetch accounts
    mockFetch.mockResolvedValueOnce(jsonOk([{
      account_id: 'acc-1',
      user_id: 'user-1',
      plan_id: 'plan-team',
      billing_email: 'u@t.com',
      subscription_status: 'active',
      check_count_this_period: 12500,
      usage_warning_sent_at: null,
      budget_alert_threshold_cents: null,
      budget_alert_sent_at: null,
      created_at: '2025-01-01',
    }]));
    // Fetch plans
    mockFetch.mockResolvedValueOnce(jsonOk([
      { plan_id: 'plan-team', included_checks: 15000, per_check_price: 0.008 },
    ]));
    // Send email (Resend)
    mockFetch.mockResolvedValueOnce(jsonOk({ id: 'r-1' }));
    // Log email
    mockFetch.mockResolvedValueOnce(jsonOk({}));
    // Update warning sent
    mockFetch.mockResolvedValueOnce(jsonOk({}));
    // Insert billing event
    mockFetch.mockResolvedValueOnce(jsonOk({}));

    await checkUsageAlerts(env as any);

    // Verify email was sent
    const resendCall = mockFetch.mock.calls[2];
    expect(resendCall[0]).toBe('https://api.resend.com/emails');
    const emailBody = JSON.parse(resendCall[1].body);
    expect(emailBody.subject).toContain('83%');
  });

  it('does not re-send usage warning', async () => {
    const env = makeEnv();
    mockFetch.mockResolvedValueOnce(jsonOk([{
      account_id: 'acc-1',
      plan_id: 'plan-team',
      billing_email: 'u@t.com',
      subscription_status: 'active',
      check_count_this_period: 14000,
      usage_warning_sent_at: '2026-02-01T00:00:00Z', // Already sent
      budget_alert_threshold_cents: null,
      budget_alert_sent_at: null,
      created_at: '2025-01-01',
    }]));
    mockFetch.mockResolvedValueOnce(jsonOk([
      { plan_id: 'plan-team', included_checks: 15000, per_check_price: 0.008 },
    ]));

    await checkUsageAlerts(env as any);

    // Only 2 calls: accounts + plans. No email sent.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('sends budget alert when threshold exceeded', async () => {
    const env = makeEnv();
    mockFetch.mockResolvedValueOnce(jsonOk([{
      account_id: 'acc-1',
      plan_id: 'plan-team',
      billing_email: 'u@t.com',
      subscription_status: 'active',
      check_count_this_period: 20000,
      usage_warning_sent_at: '2026-01-15',
      budget_alert_threshold_cents: 3000, // $30
      budget_alert_sent_at: null,
      created_at: '2025-01-01',
    }]));
    mockFetch.mockResolvedValueOnce(jsonOk([
      { plan_id: 'plan-team', included_checks: 15000, per_check_price: 0.008 },
    ]));
    // Send email
    mockFetch.mockResolvedValueOnce(jsonOk({ id: 'r-1' }));
    // Log email
    mockFetch.mockResolvedValueOnce(jsonOk({}));
    // Update budget_alert_sent_at
    mockFetch.mockResolvedValueOnce(jsonOk({}));
    // Insert billing event
    mockFetch.mockResolvedValueOnce(jsonOk({}));

    await checkUsageAlerts(env as any);

    // Overage = 5000 checks * $0.008 = $40 = 4000 cents > 3000 threshold
    const resendCall = mockFetch.mock.calls[2];
    const emailBody = JSON.parse(resendCall[1].body);
    expect(emailBody.subject).toContain('$40.00');
  });

  it('skips accounts with no billing email', async () => {
    const env = makeEnv();
    mockFetch.mockResolvedValueOnce(jsonOk([{
      account_id: 'acc-1',
      plan_id: 'plan-team',
      billing_email: null,
      subscription_status: 'active',
      check_count_this_period: 14000,
      usage_warning_sent_at: null,
      created_at: '2025-01-01',
    }]));
    mockFetch.mockResolvedValueOnce(jsonOk([
      { plan_id: 'plan-team', included_checks: 15000, per_check_price: 0.008 },
    ]));

    await checkUsageAlerts(env as any);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
