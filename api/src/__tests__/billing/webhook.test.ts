/**
 * Tests for Stripe webhook event processing.
 * Mocks Supabase calls and verifies correct DB state changes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processWebhookEvent } from '../../billing/webhook-handler';
import type { BillingEnv, WebhookEvent } from '../../billing/types';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockEnv: BillingEnv = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_KEY: 'test-key',
  SUPABASE_JWT_SECRET: 'test-jwt-secret',
  MNEMOM_PUBLISH_KEY: 'test-publish-key',
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_123',
  RESEND_API_KEY: 're_test_123',
};

function makeEvent(type: string, data: Record<string, unknown>): WebhookEvent {
  return {
    id: `evt_test_${Date.now()}`,
    type,
    data: { object: data },
  };
}

function mockResponse(data: unknown = [], status = 200) {
  return new Response(JSON.stringify(data), { status });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('processWebhookEvent', () => {
  describe('idempotency', () => {
    it('should skip duplicate events', async () => {
      // First call: insert succeeds
      mockFetch.mockResolvedValueOnce(mockResponse([], 201)); // insert webhook event
      // Then dispatch calls (we'll make it a simple unhandled type)
      mockFetch.mockResolvedValueOnce(mockResponse([], 200)); // update webhook event status

      const event = makeEvent('unknown.event', {});
      await processWebhookEvent(event, mockEnv);

      // Second call with same event ID: insert fails with conflict
      const event2 = { ...event };
      mockFetch.mockResolvedValueOnce(
        new Response('{"code":"23505","message":"duplicate key"}', { status: 409 })
      );

      // Should not throw, just skip
      await processWebhookEvent(event2, mockEnv);

      // The webhook event insert was called twice, but dispatch only once
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('checkout.session.completed', () => {
    it('should update billing account with Stripe IDs', async () => {
      const event = makeEvent('checkout.session.completed', {
        client_reference_id: 'ba-test123',
        customer: 'cus_test123',
        subscription: 'sub_test123',
        metadata: { mnemom_plan_id: 'plan-developer', mnemom_account_id: 'ba-test123' },
      });

      // Mock sequence:
      // 1. Insert webhook event (idempotency)
      mockFetch.mockResolvedValueOnce(mockResponse([], 201));
      // 2. RPC lookup_billing_account_by_stripe_customer
      mockFetch.mockResolvedValueOnce(mockResponse([{ account_id: 'ba-test123' }]));
      // 3. PATCH billing_accounts (update Stripe IDs)
      mockFetch.mockResolvedValueOnce(mockResponse([{ account_id: 'ba-test123' }]));
      // 4. Insert billing_event
      mockFetch.mockResolvedValueOnce(mockResponse([], 201));
      // 5. Lookup account by ID for email
      mockFetch.mockResolvedValueOnce(mockResponse([{ account_id: 'ba-test123', billing_email: 'test@example.com' }]));
      // 6. Send email via Resend
      mockFetch.mockResolvedValueOnce(mockResponse({ id: 'email_123' }));
      // 7. Log email
      mockFetch.mockResolvedValueOnce(mockResponse([], 201));
      // 8. Update webhook event status
      mockFetch.mockResolvedValueOnce(mockResponse([]));

      await processWebhookEvent(event, mockEnv);

      // Verify the PATCH call to billing_accounts included Stripe IDs
      const patchCall = mockFetch.mock.calls.find(
        (call) => String(call[0]).includes('billing_accounts') && (call[1] as RequestInit)?.method === 'PATCH'
      );
      expect(patchCall).toBeDefined();
      const patchBody = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(patchBody.stripe_customer_id).toBe('cus_test123');
      expect(patchBody.stripe_subscription_id).toBe('sub_test123');
    });
  });

  describe('customer.subscription.deleted', () => {
    it('should downgrade to free plan and preserve data', async () => {
      const event = makeEvent('customer.subscription.deleted', {
        id: 'sub_test123',
        customer: 'cus_test123',
      });

      // 1. Insert webhook event
      mockFetch.mockResolvedValueOnce(mockResponse([], 201));
      // 2. RPC lookup account by customer
      mockFetch.mockResolvedValueOnce(
        mockResponse([{
          account_id: 'ba-test123',
          billing_email: 'test@example.com',
          subscription_status: 'active',
        }])
      );
      // 3. PATCH billing_accounts (downgrade to free)
      mockFetch.mockResolvedValueOnce(mockResponse([{ account_id: 'ba-test123' }]));
      // 4. Insert billing_event
      mockFetch.mockResolvedValueOnce(mockResponse([], 201));
      // 5. Send cancellation email
      mockFetch.mockResolvedValueOnce(mockResponse({ id: 'email_456' }));
      // 6. Log email
      mockFetch.mockResolvedValueOnce(mockResponse([], 201));
      // 7. Update webhook event status
      mockFetch.mockResolvedValueOnce(mockResponse([]));

      await processWebhookEvent(event, mockEnv);

      // Verify downgrade to free
      const patchCall = mockFetch.mock.calls.find(
        (call) => String(call[0]).includes('billing_accounts') && (call[1] as RequestInit)?.method === 'PATCH'
      );
      expect(patchCall).toBeDefined();
      const patchBody = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(patchBody.plan_id).toBe('plan-free');
      expect(patchBody.subscription_status).toBe('canceled');
      expect(patchBody.stripe_subscription_id).toBeNull();
    });
  });

  describe('invoice.payment_failed', () => {
    it('should set past_due status and log dunning', async () => {
      const event = makeEvent('invoice.payment_failed', {
        customer: 'cus_test123',
        attempt_count: 2,
      });

      // 1. Insert webhook event
      mockFetch.mockResolvedValueOnce(mockResponse([], 201));
      // 2. Lookup account
      mockFetch.mockResolvedValueOnce(
        mockResponse([{ account_id: 'ba-test123', billing_email: 'test@example.com' }])
      );
      // 3. PATCH billing_accounts (set past_due)
      mockFetch.mockResolvedValueOnce(mockResponse([{ account_id: 'ba-test123' }]));
      // 4. Insert billing_event (dunning_escalated since attempt > 1)
      mockFetch.mockResolvedValueOnce(mockResponse([], 201));
      // 5. Send dunning email
      mockFetch.mockResolvedValueOnce(mockResponse({ id: 'email_789' }));
      // 6. Log email
      mockFetch.mockResolvedValueOnce(mockResponse([], 201));
      // 7. Update webhook event status
      mockFetch.mockResolvedValueOnce(mockResponse([]));

      await processWebhookEvent(event, mockEnv);

      // Verify past_due status
      const patchCall = mockFetch.mock.calls.find(
        (call) => String(call[0]).includes('billing_accounts') && (call[1] as RequestInit)?.method === 'PATCH'
      );
      expect(patchCall).toBeDefined();
      const patchBody = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(patchBody.subscription_status).toBe('past_due');
    });
  });

  describe('invoice.paid', () => {
    it('should reset period counter and set active', async () => {
      const event = makeEvent('invoice.paid', {
        customer: 'cus_test123',
        amount_paid: 9900,
        hosted_invoice_url: 'https://invoice.stripe.com/i/test',
        period_start: 1700000000,
        period_end: 1702592000,
      });

      // 1. Insert webhook event
      mockFetch.mockResolvedValueOnce(mockResponse([], 201));
      // 2. Lookup account
      mockFetch.mockResolvedValueOnce(
        mockResponse([{ account_id: 'ba-test123', billing_email: 'test@example.com' }])
      );
      // 3. PATCH billing_accounts
      mockFetch.mockResolvedValueOnce(mockResponse([]));
      // 4. Insert billing_event
      mockFetch.mockResolvedValueOnce(mockResponse([], 201));
      // 5. Send receipt email
      mockFetch.mockResolvedValueOnce(mockResponse({ id: 'email_receipt' }));
      // 6. Log email
      mockFetch.mockResolvedValueOnce(mockResponse([], 201));
      // 7. Update webhook event status
      mockFetch.mockResolvedValueOnce(mockResponse([]));

      await processWebhookEvent(event, mockEnv);

      const patchCall = mockFetch.mock.calls.find(
        (call) => String(call[0]).includes('billing_accounts') && (call[1] as RequestInit)?.method === 'PATCH'
      );
      expect(patchCall).toBeDefined();
      const patchBody = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(patchBody.subscription_status).toBe('active');
      expect(patchBody.check_count_this_period).toBe(0);
    });
  });
});
