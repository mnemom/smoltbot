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
  CouponInfo,
} from './types';

let stripeInstance: Stripe | null = null;

function getStripe(secretKey: string): Stripe {
  if (!stripeInstance) {
    stripeInstance = new Stripe(secretKey, {
      apiVersion: '2026-01-28.clover',
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
        params.isMeteredPrice
          ? { price: params.priceId }
          : { price: params.priceId, quantity: 1 },
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

      if (params.promotionCodeId) {
        sessionParams.discounts = [{ promotion_code: params.promotionCodeId }];
      }

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
      // Stripe SDK v20+ removed createUsageRecord types; use raw API call
      await (stripe as any).subscriptionItems.createUsageRecord(
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

    async createCreditNote(params) {
      // Find the latest paid invoice for this customer
      const invoices = await stripe.invoices.list({
        customer: params.customerId,
        status: 'paid',
        limit: 1,
      });

      if (invoices.data.length === 0) {
        throw new Error('No paid invoice found for credit note');
      }

      const creditNote = await stripe.creditNotes.create({
        invoice: invoices.data[0].id,
        lines: [
          {
            type: 'custom_line_item',
            unit_amount: params.amountCents,
            quantity: 1,
            description: params.reason ?? 'Admin-issued credit note',
          },
        ],
        memo: params.reason ?? 'Admin-issued credit note',
      });

      return {
        id: creditNote.id,
        status: creditNote.status ?? 'issued',
      };
    },

    async createManualInvoice(params) {
      // Create an invoice item
      await stripe.invoiceItems.create({
        customer: params.customerId,
        amount: params.amountCents,
        currency: 'usd',
        description: params.description,
      });

      // Create and finalize the invoice
      const invoice = await stripe.invoices.create({
        customer: params.customerId,
        auto_advance: true,
        collection_method: 'send_invoice',
        days_until_due: 30,
      });

      const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
      await stripe.invoices.sendInvoice(finalized.id);

      return {
        id: finalized.id,
        status: finalized.status ?? 'open',
        hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
      };
    },

    async listCoupons(limit = 20) {
      const coupons = await stripe.coupons.list({ limit });

      const results: CouponInfo[] = [];
      for (const coupon of coupons.data) {
        // Fetch promotion codes for this coupon
        const promoCodes = await stripe.promotionCodes.list({
          coupon: coupon.id,
          limit: 10,
        });

        results.push(mapCoupon(coupon, promoCodes.data));
      }

      return results;
    },

    async createCoupon(params) {
      const couponParams: Stripe.CouponCreateParams = {
        name: params.name,
        duration: params.duration,
      };

      if (params.percentOff !== undefined) {
        couponParams.percent_off = params.percentOff;
      } else if (params.amountOff !== undefined) {
        couponParams.amount_off = params.amountOff;
        couponParams.currency = params.currency ?? 'usd';
      }

      if (params.duration === 'repeating' && params.durationInMonths) {
        couponParams.duration_in_months = params.durationInMonths;
      }

      const coupon = await stripe.coupons.create(couponParams);

      let promoCodes: Stripe.PromotionCode[] = [];
      if (params.promotionCode) {
        const promoCode = await stripe.promotionCodes.create({
          coupon: coupon.id,
          code: params.promotionCode,
        });
        promoCodes = [promoCode];
      }

      return mapCoupon(coupon, promoCodes);
    },

    async createPromotionCode(params) {
      const promoCode = await stripe.promotionCodes.create({
        coupon: params.couponId,
        code: params.code,
      });

      return {
        id: promoCode.id,
        code: promoCode.code,
      };
    },

    async deactivateCoupon(couponId: string) {
      await stripe.coupons.del(couponId);
    },

    async applyCustomerCoupon(params) {
      await stripe.customers.update(params.customerId, {
        coupon: params.couponId,
      });
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

  // Stripe API 2026-01-28 removed current_period_start/end from types
  // but they still exist at runtime. Access via any cast.
  const subAny = sub as any;

  return {
    id: sub.id,
    status: sub.status,
    customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    currentPeriodStart: subAny.current_period_start ?? sub.start_date,
    currentPeriodEnd: subAny.current_period_end ?? sub.start_date,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    trialEnd: sub.trial_end,
    items,
  };
}

function mapCoupon(coupon: Stripe.Coupon, promoCodes: Stripe.PromotionCode[]): CouponInfo {
  return {
    id: coupon.id,
    name: coupon.name,
    percentOff: coupon.percent_off ?? null,
    amountOff: coupon.amount_off ?? null,
    currency: coupon.currency ?? null,
    duration: coupon.duration,
    durationInMonths: coupon.duration_in_months ?? null,
    valid: coupon.valid,
    promotionCodes: promoCodes.map((pc) => ({
      id: pc.id,
      code: pc.code,
      active: pc.active,
    })),
    created: coupon.created,
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
