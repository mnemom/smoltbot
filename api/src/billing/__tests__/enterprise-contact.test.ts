/**
 * Tests for the enterprise contact form handler (handleEnterpriseContact).
 * Validates input, inserts lead into Supabase, and sends notification + confirmation emails.
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

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(`https://api.mnemom.ai${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

// ============================================================================
// handleEnterpriseContact tests
// ============================================================================

describe('handleEnterpriseContact', () => {
  let handleEnterpriseContact: typeof import('../handlers').handleEnterpriseContact;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();

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
    handleEnterpriseContact = mod.handleEnterpriseContact;
  });

  // ----------------------------------------
  // Validation tests
  // ----------------------------------------

  it('returns 400 if name is missing', async () => {
    const env = makeEnv();
    const req = makeRequest('/v1/billing/enterprise-contact', {
      method: 'POST',
      body: JSON.stringify({ email: 'jane@acme.com', company: 'Acme Corp' }),
    });
    const res = await handleEnterpriseContact(env as any, req);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('name');
  });

  it('returns 400 if email is missing', async () => {
    const env = makeEnv();
    const req = makeRequest('/v1/billing/enterprise-contact', {
      method: 'POST',
      body: JSON.stringify({ name: 'Jane Doe', company: 'Acme Corp' }),
    });
    const res = await handleEnterpriseContact(env as any, req);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('email');
  });

  it('returns 400 if company is missing', async () => {
    const env = makeEnv();
    const req = makeRequest('/v1/billing/enterprise-contact', {
      method: 'POST',
      body: JSON.stringify({ name: 'Jane Doe', email: 'jane@acme.com' }),
    });
    const res = await handleEnterpriseContact(env as any, req);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('company');
  });

  it('returns 400 for invalid email (no @ sign)', async () => {
    const env = makeEnv();
    const req = makeRequest('/v1/billing/enterprise-contact', {
      method: 'POST',
      body: JSON.stringify({ name: 'Jane Doe', email: 'jane-at-acme.com', company: 'Acme Corp' }),
    });
    const res = await handleEnterpriseContact(env as any, req);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('email');
  });

  // ----------------------------------------
  // Success path
  // ----------------------------------------

  it('successfully creates lead and returns { id: "el-..." }', async () => {
    const env = makeEnv();
    // Supabase insert into enterprise_leads
    mockFetch.mockResolvedValueOnce(jsonOk({}));
    // Notification email to support (Resend API)
    mockFetch.mockResolvedValueOnce(jsonOk({ id: 'resend-notif' }));
    // Log notification email
    mockFetch.mockResolvedValueOnce(jsonOk({}));
    // Confirmation email to lead (Resend API)
    mockFetch.mockResolvedValueOnce(jsonOk({ id: 'resend-confirm' }));
    // Log confirmation email
    mockFetch.mockResolvedValueOnce(jsonOk({}));

    const req = makeRequest('/v1/billing/enterprise-contact', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Jane Doe',
        email: 'jane@acme.com',
        company: 'Acme Corp',
        role: 'CTO',
        company_size: '50-100',
        message: 'Interested in enterprise features',
      }),
    });

    const res = await handleEnterpriseContact(env as any, req);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toMatch(/^el-/);
  });

  // ----------------------------------------
  // Email behavior
  // ----------------------------------------

  it('sends notification email to support@mnemom.ai', async () => {
    const env = makeEnv();
    // Supabase insert
    mockFetch.mockResolvedValueOnce(jsonOk({}));
    // Notification email (Resend)
    mockFetch.mockResolvedValueOnce(jsonOk({ id: 'resend-notif' }));
    // Log notification email
    mockFetch.mockResolvedValueOnce(jsonOk({}));
    // Confirmation email (Resend)
    mockFetch.mockResolvedValueOnce(jsonOk({ id: 'resend-confirm' }));
    // Log confirmation email
    mockFetch.mockResolvedValueOnce(jsonOk({}));

    const req = makeRequest('/v1/billing/enterprise-contact', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Jane Doe',
        email: 'jane@acme.com',
        company: 'Acme Corp',
      }),
    });

    await handleEnterpriseContact(env as any, req);

    // The first fetch call is the Supabase insert.
    // The second call is the Resend API for the notification email to support.
    const resendNotifCall = mockFetch.mock.calls[1];
    expect(resendNotifCall[0]).toBe('https://api.resend.com/emails');
    const notifBody = JSON.parse(resendNotifCall[1].body);
    expect(notifBody.to).toEqual(['support@mnemom.ai']);
    expect(notifBody.subject).toContain('Enterprise Lead');
    expect(notifBody.subject).toContain('Acme Corp');
    expect(notifBody.subject).toContain('Jane Doe');
  });

  it('sends confirmation email to the lead', async () => {
    const env = makeEnv();
    // Supabase insert
    mockFetch.mockResolvedValueOnce(jsonOk({}));
    // Notification email (Resend)
    mockFetch.mockResolvedValueOnce(jsonOk({ id: 'resend-notif' }));
    // Log notification email
    mockFetch.mockResolvedValueOnce(jsonOk({}));
    // Confirmation email (Resend)
    mockFetch.mockResolvedValueOnce(jsonOk({ id: 'resend-confirm' }));
    // Log confirmation email
    mockFetch.mockResolvedValueOnce(jsonOk({}));

    const req = makeRequest('/v1/billing/enterprise-contact', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Jane Doe',
        email: 'jane@acme.com',
        company: 'Acme Corp',
      }),
    });

    await handleEnterpriseContact(env as any, req);

    // The fourth call is the Resend API for the confirmation email to the lead.
    const resendConfirmCall = mockFetch.mock.calls[3];
    expect(resendConfirmCall[0]).toBe('https://api.resend.com/emails');
    const confirmBody = JSON.parse(resendConfirmCall[1].body);
    expect(confirmBody.to).toEqual(['jane@acme.com']);
    expect(confirmBody.subject).toContain('Mnemom Enterprise');
  });

  it('still returns success if email notification fails (best-effort)', async () => {
    const env = makeEnv();
    // Supabase insert succeeds
    mockFetch.mockResolvedValueOnce(jsonOk({}));
    // Notification email fails (Resend)
    mockFetch.mockResolvedValueOnce(jsonError(500, 'Resend error'));
    // Log notification email (logged as failed)
    mockFetch.mockResolvedValueOnce(jsonOk({}));

    const req = makeRequest('/v1/billing/enterprise-contact', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Jane Doe',
        email: 'jane@acme.com',
        company: 'Acme Corp',
      }),
    });

    const res = await handleEnterpriseContact(env as any, req);
    // The handler catches email errors — the lead was still saved
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toMatch(/^el-/);
  });

  // ----------------------------------------
  // Error path
  // ----------------------------------------

  it('returns 500 if Supabase insert fails', async () => {
    const env = makeEnv();
    // Supabase insert fails
    mockFetch.mockResolvedValueOnce(jsonError(500, 'DB write failed'));

    const req = makeRequest('/v1/billing/enterprise-contact', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Jane Doe',
        email: 'jane@acme.com',
        company: 'Acme Corp',
      }),
    });

    const res = await handleEnterpriseContact(env as any, req);
    expect(res.status).toBe(500);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('Failed to submit');
  });
});
