/**
 * Tests for billing checkout and route handler logic.
 * Validates handler parameter validation, provider interactions, and response format.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  welcomeDeveloperEmail,
  welcomeTeamTrialEmail,
  paymentFailedEmail,
  trialEndingEmail,
  trialExpiredEmail,
  subscriptionCanceledEmail,
  invoicePaidEmail,
} from '../../billing/email';

describe('Email templates', () => {
  describe('welcomeDeveloperEmail', () => {
    it('should include correct subject and content', () => {
      const result = welcomeDeveloperEmail({ email: 'dev@example.com' });
      expect(result.subject).toBe('Welcome to Mnemom Developer');
      expect(result.html).toContain('$0.01');
      expect(result.text).toContain('Developer plan is now active');
      expect(result.html).toContain('billing settings');
    });
  });

  describe('welcomeTeamTrialEmail', () => {
    it('should mention 14-day trial', () => {
      const result = welcomeTeamTrialEmail({ email: 'team@example.com' });
      expect(result.subject).toContain('14-day');
      expect(result.html).toContain('15,000');
      expect(result.text).toContain('No charge until your trial ends');
    });
  });

  describe('invoicePaidEmail', () => {
    it('should format amount correctly', () => {
      const result = invoicePaidEmail({
        email: 'user@example.com',
        amountCents: 9900,
        invoiceUrl: 'https://invoice.stripe.com/i/test',
      });
      expect(result.subject).toContain('$99.00');
      expect(result.html).toContain('$99.00');
      expect(result.html).toContain('https://invoice.stripe.com/i/test');
    });

    it('should handle null invoice URL', () => {
      const result = invoicePaidEmail({
        email: 'user@example.com',
        amountCents: 100,
        invoiceUrl: null,
      });
      expect(result.subject).toContain('$1.00');
      expect(result.html).not.toContain('View your invoice');
    });
  });

  describe('paymentFailedEmail', () => {
    it('should escalate urgency with attempt number', () => {
      const first = paymentFailedEmail({ email: 'user@example.com' }, 1);
      expect(first.subject).toContain('first');
      expect(first.text).toContain('retry automatically');

      const third = paymentFailedEmail({ email: 'user@example.com' }, 3);
      expect(third.subject).toContain('final');
      expect(third.text).toContain('canceled');
    });
  });

  describe('trialEndingEmail', () => {
    it('should include trial end date when provided', () => {
      const result = trialEndingEmail({
        email: 'user@example.com',
        trialEndDate: '2026-03-15T00:00:00Z',
      });
      expect(result.subject).toContain('trial ends soon');
      expect(result.html).toContain('2026');
    });

    it('should handle missing trial end date', () => {
      const result = trialEndingEmail({ email: 'user@example.com' });
      expect(result.html).toContain('in 3 days');
    });
  });

  describe('trialExpiredEmail', () => {
    it('should emphasize data safety', () => {
      const result = trialExpiredEmail({ email: 'user@example.com' });
      expect(result.subject).toContain('data is safe');
      expect(result.html).toContain('fully preserved');
      expect(result.text).toContain('zero data loss');
    });
  });

  describe('subscriptionCanceledEmail', () => {
    it('should confirm data preservation', () => {
      const result = subscriptionCanceledEmail({ email: 'user@example.com' });
      expect(result.subject).toContain('ended');
      expect(result.html).toContain('data is safe');
      expect(result.text).toContain('resubscribe anytime');
    });
  });
});

describe('BillingProvider interface contracts', () => {
  it('createStripeProvider should return object with all required methods', async () => {
    // Import dynamically to avoid Stripe SDK initialization issues in test
    const { createStripeProvider } = await import('../../billing/stripe-provider');
    const provider = createStripeProvider('sk_test_fake_key_for_interface_check');

    expect(typeof provider.createCustomer).toBe('function');
    expect(typeof provider.createCheckoutSession).toBe('function');
    expect(typeof provider.createPortalSession).toBe('function');
    expect(typeof provider.getSubscription).toBe('function');
    expect(typeof provider.updateSubscription).toBe('function');
    expect(typeof provider.cancelSubscription).toBe('function');
    expect(typeof provider.reactivateSubscription).toBe('function');
    expect(typeof provider.reportUsage).toBe('function');
    expect(typeof provider.listInvoices).toBe('function');
    expect(typeof provider.verifyWebhookSignature).toBe('function');
  });
});
