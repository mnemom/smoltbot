/**
 * Billing provider abstraction and shared types.
 * Defines the interface that route handlers use — not raw Stripe objects.
 */

// ============================================
// Provider Interface
// ============================================

export interface BillingProvider {
  createCustomer(params: {
    email: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<{ id: string }>;

  createCheckoutSession(params: CheckoutSessionParams): Promise<{ url: string; id: string }>;

  createPortalSession(params: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;

  getSubscription(subscriptionId: string): Promise<SubscriptionInfo>;

  updateSubscription(
    subscriptionId: string,
    params: UpdateSubscriptionParams
  ): Promise<SubscriptionInfo>;

  cancelSubscription(
    subscriptionId: string,
    params: { atPeriodEnd: boolean }
  ): Promise<SubscriptionInfo>;

  reactivateSubscription(subscriptionId: string): Promise<SubscriptionInfo>;

  reportUsage(
    subscriptionItemId: string,
    quantity: number,
    timestamp: number,
    idempotencyKey: string
  ): Promise<void>;

  listInvoices(customerId: string, limit?: number): Promise<InvoiceInfo[]>;

  verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string
  ): Promise<WebhookEvent>;

  createCreditNote(params: {
    customerId: string;
    amountCents: number;
    reason?: string;
  }): Promise<{ id: string; status: string }>;

  createManualInvoice(params: {
    customerId: string;
    amountCents: number;
    description: string;
  }): Promise<{ id: string; status: string; hostedInvoiceUrl: string | null }>;

  listCoupons(limit?: number): Promise<CouponInfo[]>;

  createCoupon(params: {
    name: string;
    percentOff?: number;
    amountOff?: number;
    currency?: string;
    duration: 'once' | 'repeating' | 'forever';
    durationInMonths?: number;
    promotionCode?: string;
  }): Promise<CouponInfo>;

  createPromotionCode(params: {
    couponId: string;
    code: string;
  }): Promise<{ id: string; code: string }>;

  deactivateCoupon(couponId: string): Promise<void>;

  applyCustomerCoupon(params: {
    customerId: string;
    couponId: string;
  }): Promise<void>;
}

// ============================================
// Checkout
// ============================================

export interface CheckoutSessionParams {
  customerId: string;
  priceId: string;
  /** True if the primary price is metered (no quantity at checkout) */
  isMeteredPrice?: boolean;
  /** Additional metered price IDs (e.g., Team overage component) */
  meteredPriceIds?: string[];
  successUrl: string;
  cancelUrl: string;
  clientReferenceId: string;
  metadata?: Record<string, string>;
  trialPeriodDays?: number;
  paymentMethodCollection?: 'always' | 'if_required';
  promotionCodeId?: string;
}

// ============================================
// Subscription
// ============================================

export interface SubscriptionInfo {
  id: string;
  status: string;
  customerId: string;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  trialEnd: number | null;
  items: SubscriptionItemInfo[];
}

export interface SubscriptionItemInfo {
  id: string;
  priceId: string;
  quantity?: number;
}

export interface UpdateSubscriptionParams {
  items?: Array<{
    id: string;
    priceId: string;
  }>;
  prorationBehavior?: 'create_prorations' | 'none' | 'always_invoice';
}

// ============================================
// Invoice
// ============================================

export interface InvoiceInfo {
  id: string;
  status: string | null;
  amountDue: number;
  amountPaid: number;
  currency: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  created: number;
  periodStart: number;
  periodEnd: number;
}

// ============================================
// Webhook
// ============================================

export interface WebhookEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
}

// ============================================
// Coupon
// ============================================

export interface CouponInfo {
  id: string;
  name: string | null;
  percentOff: number | null;
  amountOff: number | null;
  currency: string | null;
  duration: string;
  durationInMonths: number | null;
  valid: boolean;
  promotionCodes: Array<{ id: string; code: string; active: boolean }>;
  created: number;
}

// ============================================
// Env extension for billing secrets
// ============================================

export interface BillingEnv {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  SUPABASE_JWT_SECRET: string;
  MNEMOM_PUBLISH_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  RESEND_API_KEY: string;
  HUBSPOT_API_KEY?: string;
  SLACK_WEBHOOK_URL?: string;
  BILLING_CACHE?: KVNamespace;
}
