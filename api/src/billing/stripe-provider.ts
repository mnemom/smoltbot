/**
 * Stripe implementation of BillingProvider.
 * Uses `stripe` npm package with fetch-based HTTP client for edge compatibility.
 */

import Stripe from 'stripe';
import type {
  BillingProvider,
  CheckoutSessionParams,
  SubscriptionInfo,
  SubscriptionItemInfo,
  UpdateSubscriptionParams,
  InvoiceInfo,
  WebhookEvent,
} from './types';

let stripeInstance: Stripe | null = null;

function getStripe(secretKey: string): Stripe {
  if (!stripeInstance) {
    stripeInstance = new Stripe(secretKey, {
      apiVersion: '2025-01-27.acacia',
      httpClient: Stripe.createFetchHttpClient(),
    });
  }
  return stripeInstance;
}

export function createStripeProvider(secretKey: string): BillingProvider {
  const stripe = getStripe(secretKey);

  return {
    async createCustomer(params) {
      const customer = await stripe.customers.create({
        email: params.email,
        name: params.name,
        metadata: params.metadata,
      });
      return { id: customer.id };
    },

    async createCheckoutSession(params: CheckoutSessionParams) {
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
        { price: params.priceId, quantity: 1 },
      ];

      // Add metered price components (e.g., Team overage)
      if (params.meteredPriceIds) {
        for (const meteredPriceId of params.meteredPriceIds) {
          lineItems.push({ price: meteredPriceId });
        }
      }

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        customer: params.customerId,
        mode: 'subscription',
        line_items: lineItems,
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        client_reference_id: params.clientReferenceId,
        metadata: params.metadata,
        subscription_data: {
          metadata: params.metadata,
        },
      };

      if (params.trialPeriodDays) {
        sessionParams.subscription_data!.trial_period_days = params.trialPeriodDays;
      }

      if (params.paymentMethodCollection) {
        sessionParams.payment_method_collection = params.paymentMethodCollection;
      }

      const session = await stripe.checkout.sessions.create(sessionParams);
      return { url: session.url!, id: session.id };
    },

    async createPortalSession(params) {
      const session = await stripe.billingPortal.sessions.create({
        customer: params.customerId,
        return_url: params.returnUrl,
      });
      return { url: session.url };
    },

    async getSubscription(subscriptionId: string) {
      const sub = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['items.data'],
      });
      return mapSubscription(sub);
    },

    async updateSubscription(subscriptionId: string, params: UpdateSubscriptionParams) {
      const updateParams: Stripe.SubscriptionUpdateParams = {};

      if (params.items) {
        updateParams.items = params.items.map((item) => ({
          id: item.id,
          price: item.priceId,
        }));
      }

      if (params.prorationBehavior) {
        updateParams.proration_behavior = params.prorationBehavior;
      }

      const sub = await stripe.subscriptions.update(subscriptionId, updateParams);
      return mapSubscription(sub);
    },

    async cancelSubscription(subscriptionId: string, params) {
      const sub = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: params.atPeriodEnd,
      });
      return mapSubscription(sub);
    },

    async reactivateSubscription(subscriptionId: string) {
      const sub = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: false,
      });
      return mapSubscription(sub);
    },

    async reportUsage(
      subscriptionItemId: string,
      quantity: number,
      timestamp: number,
      idempotencyKey: string
    ) {
      await stripe.subscriptionItems.createUsageRecord(
        subscriptionItemId,
        {
          quantity,
          timestamp,
          action: 'set',
        },
        {
          idempotencyKey,
        }
      );
    },

    async listInvoices(customerId: string, limit = 10) {
      const invoices = await stripe.invoices.list({
        customer: customerId,
        limit,
      });
      return invoices.data.map(mapInvoice);
    },

    async verifyWebhookSignature(
      payload: string,
      signature: string,
      secret: string
    ): Promise<WebhookEvent> {
      const event = await stripe.webhooks.constructEventAsync(
        payload,
        signature,
        secret
      );
      return {
        id: event.id,
        type: event.type,
        data: {
          object: event.data.object as unknown as Record<string, unknown>,
        },
      };
    },
  };
}

// ============================================
// Mappers: Stripe types -> our types
// ============================================

function mapSubscription(sub: Stripe.Subscription): SubscriptionInfo {
  const items: SubscriptionItemInfo[] = sub.items.data.map((item) => ({
    id: item.id,
    priceId: typeof item.price === 'string' ? item.price : item.price.id,
    quantity: item.quantity ?? undefined,
  }));

  return {
    id: sub.id,
    status: sub.status,
    customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    currentPeriodStart: sub.current_period_start,
    currentPeriodEnd: sub.current_period_end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    trialEnd: sub.trial_end,
    items,
  };
}

function mapInvoice(inv: Stripe.Invoice): InvoiceInfo {
  return {
    id: inv.id,
    status: inv.status,
    amountDue: inv.amount_due,
    amountPaid: inv.amount_paid,
    currency: inv.currency,
    hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    invoicePdf: inv.invoice_pdf ?? null,
    created: inv.created,
    periodStart: inv.period_start,
    periodEnd: inv.period_end,
  };
}
