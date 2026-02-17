/**
 * HTTP route handlers for billing endpoints.
 * Each handler follows the existing pattern from index.ts:
 * authenticate, validate, call provider/DB, return JSON response.
 */

import type { BillingEnv, BillingProvider } from './types';
import { createStripeProvider } from './stripe-provider';
import { processWebhookEvent } from './webhook-handler';

// ============================================
// Response helpers (match index.ts pattern)
// ============================================

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

// ============================================
// Supabase helpers (same pattern as index.ts)
// ============================================

async function supabaseRpc(
  env: BillingEnv,
  functionName: string,
  params: Record<string, unknown> = {}
): Promise<{ data: unknown; error: string | null }> {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });
    if (!response.ok) {
      return { data: null, error: await response.text() };
    }
    return { data: await response.json(), error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function supabaseQuery(
  env: BillingEnv,
  table: string,
  filters: Record<string, string>
): Promise<unknown[]> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, `eq.${value}`);
  }
  const response = await fetch(url.toString(), {
    headers: {
      apikey: env.SUPABASE_KEY,
      Authorization: `Bearer ${env.SUPABASE_KEY}`,
    },
  });
  if (!response.ok) return [];
  return response.json() as Promise<unknown[]>;
}

async function supabaseUpdate(
  env: BillingEnv,
  table: string,
  filters: Record<string, string>,
  data: Record<string, unknown>
): Promise<void> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, `eq.${value}`);
  }
  await fetch(url.toString(), {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_KEY,
      Authorization: `Bearer ${env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(data),
  });
}

// ============================================
// Auth helper (JWT verification delegated to caller)
// ============================================

interface JWTPayload {
  sub: string;
  email?: string;
  role?: string;
  app_metadata?: { is_admin?: boolean };
  exp: number;
  iat: number;
}

// Re-export handler type for index.ts
export type AuthGetter = (request: Request, env: BillingEnv) => Promise<JWTPayload | null>;

// ============================================
// Provider singleton
// ============================================

let provider: BillingProvider | null = null;

function getProvider(env: BillingEnv): BillingProvider {
  if (!provider) {
    provider = createStripeProvider(env.STRIPE_SECRET_KEY);
  }
  return provider;
}

// ============================================
// POST /v1/billing/webhooks/stripe
// ============================================

export async function handleStripeWebhook(
  env: BillingEnv,
  request: Request
): Promise<Response> {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return errorResponse('Missing stripe-signature header', 400);
  }

  const body = await request.text();
  const billing = getProvider(env);

  let event;
  try {
    event = await billing.verifyWebhookSignature(body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err);
    return errorResponse('Invalid signature', 400);
  }

  try {
    await processWebhookEvent(event, env);
  } catch (err) {
    console.error('[webhook] Processing error:', err);
    // Return 200 to Stripe even on processing errors (to avoid retries for known-bad events)
    // The error is logged in stripe_webhook_events.error_detail
  }

  return jsonResponse({ received: true });
}

// ============================================
// POST /v1/billing/checkout
// ============================================

export async function handleCheckout(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const body = await request.json() as { plan_id?: string; annual?: boolean; promo_code?: string };
  const planId = body.plan_id;
  if (!planId) {
    return errorResponse('plan_id is required', 400);
  }

  if (planId === 'plan-enterprise') {
    return jsonResponse({ action: 'contact_sales', url: 'mailto:support@mnemom.ai?subject=Enterprise%20Inquiry' });
  }

  if (planId === 'plan-free') {
    return errorResponse('Cannot checkout for free plan', 400);
  }

  // Ensure billing account exists
  const { data: billingResult, error: billingError } = await supabaseRpc(env, 'ensure_billing_account', {
    p_user_id: user.sub,
    p_email: user.email ?? '',
  });
  if (billingError) return errorResponse(`Database error: ${billingError}`, 500);

  const billing = billingResult as Record<string, unknown>;
  const accountId = billing.account_id as string;

  // Fetch plan to get Stripe price ID
  const plans = await supabaseQuery(env, 'plans', { plan_id: planId });
  if (plans.length === 0) {
    return errorResponse('Plan not found', 404);
  }

  const plan = plans[0] as Record<string, unknown>;
  const isAnnual = body.annual === true;
  const priceId = isAnnual
    ? (plan.stripe_annual_price_id as string)
    : (plan.stripe_price_id as string);

  if (!priceId) {
    return errorResponse('Plan is not configured for Stripe billing', 400);
  }

  // Look up existing billing account for Stripe customer ID
  const accounts = await supabaseQuery(env, 'billing_accounts', { account_id: accountId });
  const account = accounts[0] as Record<string, unknown> | undefined;
  let customerId = account?.stripe_customer_id as string | undefined;

  const providerInstance = getProvider(env);

  // Create Stripe customer if needed
  if (!customerId) {
    const customer = await providerInstance.createCustomer({
      email: user.email || '',
      metadata: { mnemom_account_id: accountId, mnemom_user_id: user.sub },
    });
    customerId = customer.id;

    // Save customer ID
    await supabaseUpdate(env, 'billing_accounts', { account_id: accountId }, {
      stripe_customer_id: customerId,
      updated_at: new Date().toISOString(),
    });
  }

  // Build checkout session params
  const isDeveloper = planId === 'plan-developer';
  const billingModel = plan.billing_model as string;
  const isMeteredPrice = billingModel === 'metered';

  // For Team plan, include metered overage component as additional line item
  const meteredPriceId = plan.stripe_metered_price_id as string | undefined;
  const meteredPriceIds = meteredPriceId ? [meteredPriceId] : undefined;

  // Validate promo code if provided
  let promotionCodeId: string | undefined;
  if (body.promo_code) {
    try {
      const stripe = (await import('stripe')).default;
      const stripeClient = new stripe(env.STRIPE_SECRET_KEY, {
        apiVersion: '2026-01-28.clover' as any,
        httpClient: stripe.createFetchHttpClient(),
      });
      const promoCodes = await stripeClient.promotionCodes.list({
        code: body.promo_code,
        active: true,
        limit: 1,
      });
      if (promoCodes.data.length === 0) {
        return errorResponse('Invalid promo code', 400);
      }
      promotionCodeId = promoCodes.data[0].id;
    } catch (err) {
      console.warn('[billing] Promo code validation failed:', err);
      return errorResponse('Invalid promo code', 400);
    }
  }

  try {
    const session = await providerInstance.createCheckoutSession({
      customerId,
      priceId,
      isMeteredPrice,
      meteredPriceIds,
      successUrl: 'https://mnemom.ai/settings/billing?checkout=success',
      cancelUrl: 'https://mnemom.ai/settings/billing?checkout=canceled',
      clientReferenceId: accountId,
      metadata: {
        mnemom_plan_id: planId,
        mnemom_account_id: accountId,
      },
      trialPeriodDays: isDeveloper ? undefined : 14,
      paymentMethodCollection: isDeveloper ? 'always' : 'if_required',
      promotionCodeId,
    });

    return jsonResponse({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error('[billing] Checkout session creation failed:', err);
    return errorResponse(
      `Checkout failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      500,
    );
  }
}

// ============================================
// POST /v1/billing/portal
// ============================================

export async function handlePortal(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const accounts = await supabaseQuery(env, 'billing_accounts', { user_id: user.sub });
  if (accounts.length === 0) {
    return errorResponse('No billing account found', 404);
  }

  const account = accounts[0] as Record<string, unknown>;
  const customerId = account.stripe_customer_id as string;

  if (!customerId) {
    return errorResponse('No Stripe customer associated with this account', 400);
  }

  const session = await getProvider(env).createPortalSession({
    customerId,
    returnUrl: 'https://mnemom.ai/settings/billing',
  });

  return jsonResponse({ url: session.url });
}

// ============================================
// GET /v1/billing/subscription
// ============================================

export async function handleGetSubscription(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const accounts = await supabaseQuery(env, 'billing_accounts', { user_id: user.sub });
  if (accounts.length === 0) {
    return errorResponse('No billing account found', 404);
  }

  const account = accounts[0] as Record<string, unknown>;
  const subscriptionId = account.stripe_subscription_id as string;

  if (!subscriptionId) {
    return jsonResponse({
      subscription: null,
      plan_id: account.plan_id,
      status: account.subscription_status,
    });
  }

  try {
    const subscription = await getProvider(env).getSubscription(subscriptionId);
    return jsonResponse({
      subscription,
      plan_id: account.plan_id,
      status: account.subscription_status,
      check_count_this_period: account.check_count_this_period,
    });
  } catch (err) {
    console.error('[billing] Failed to fetch subscription:', err);
    return jsonResponse({
      subscription: null,
      plan_id: account.plan_id,
      status: account.subscription_status,
      error: 'Failed to fetch subscription details from Stripe',
    });
  }
}

// ============================================
// POST /v1/billing/cancel
// ============================================

export async function handleCancel(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const accounts = await supabaseQuery(env, 'billing_accounts', { user_id: user.sub });
  if (accounts.length === 0) {
    return errorResponse('No billing account found', 404);
  }

  const account = accounts[0] as Record<string, unknown>;
  const subscriptionId = account.stripe_subscription_id as string;

  if (!subscriptionId) {
    return errorResponse('No active subscription to cancel', 400);
  }

  const subscription = await getProvider(env).cancelSubscription(subscriptionId, {
    atPeriodEnd: true,
  });

  return jsonResponse({
    canceled: true,
    cancel_at_period_end: subscription.cancelAtPeriodEnd,
    current_period_end: new Date(subscription.currentPeriodEnd * 1000).toISOString(),
  });
}

// ============================================
// POST /v1/billing/reactivate
// ============================================

export async function handleReactivate(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const accounts = await supabaseQuery(env, 'billing_accounts', { user_id: user.sub });
  if (accounts.length === 0) {
    return errorResponse('No billing account found', 404);
  }

  const account = accounts[0] as Record<string, unknown>;
  const subscriptionId = account.stripe_subscription_id as string;

  if (!subscriptionId) {
    return errorResponse('No subscription to reactivate', 400);
  }

  const subscription = await getProvider(env).reactivateSubscription(subscriptionId);

  return jsonResponse({
    reactivated: true,
    cancel_at_period_end: subscription.cancelAtPeriodEnd,
    status: subscription.status,
  });
}

// ============================================
// POST /v1/billing/change-plan
// ============================================

export async function handleChangePlan(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const body = await request.json() as { plan_id?: string; annual?: boolean };
  const newPlanId = body.plan_id;
  if (!newPlanId) {
    return errorResponse('plan_id is required', 400);
  }

  if (newPlanId === 'plan-enterprise') {
    return jsonResponse({ action: 'contact_sales', url: 'mailto:support@mnemom.ai?subject=Enterprise%20Inquiry' });
  }

  const accounts = await supabaseQuery(env, 'billing_accounts', { user_id: user.sub });
  if (accounts.length === 0) {
    return errorResponse('No billing account found', 404);
  }

  const account = accounts[0] as Record<string, unknown>;
  const subscriptionId = account.stripe_subscription_id as string;

  if (!subscriptionId) {
    return errorResponse('No active subscription. Use /v1/billing/checkout to subscribe.', 400);
  }

  // Fetch new plan's Stripe price ID
  const plans = await supabaseQuery(env, 'plans', { plan_id: newPlanId });
  if (plans.length === 0) {
    return errorResponse('Plan not found', 404);
  }

  const plan = plans[0] as Record<string, unknown>;
  const isAnnual = body.annual === true;
  const newPriceId = isAnnual
    ? (plan.stripe_annual_price_id as string)
    : (plan.stripe_price_id as string);

  if (!newPriceId) {
    return errorResponse('Target plan is not configured for Stripe billing', 400);
  }

  // Get current subscription to find the item to update
  try {
    const currentSub = await getProvider(env).getSubscription(subscriptionId);
    if (currentSub.items.length === 0) {
      return errorResponse('Current subscription has no items', 500);
    }

    const subscription = await getProvider(env).updateSubscription(subscriptionId, {
      items: [{ id: currentSub.items[0].id, priceId: newPriceId }],
      prorationBehavior: 'create_prorations',
    });

    return jsonResponse({
      updated: true,
      plan_id: newPlanId,
      status: subscription.status,
    });
  } catch (err) {
    console.error('[billing] Plan change failed:', err);
    return errorResponse(
      `Plan change failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      500,
    );
  }
}

// ============================================
// GET /v1/billing/invoices
// ============================================

export async function handleListInvoices(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const accounts = await supabaseQuery(env, 'billing_accounts', { user_id: user.sub });
  if (accounts.length === 0) {
    return errorResponse('No billing account found', 404);
  }

  const account = accounts[0] as Record<string, unknown>;
  const customerId = account.stripe_customer_id as string;

  if (!customerId) {
    return jsonResponse({ invoices: [] });
  }

  const invoices = await getProvider(env).listInvoices(customerId, 20);
  return jsonResponse({ invoices });
}

// ============================================
// GET /v1/billing/usage
// ============================================

export async function handleGetMyUsage(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const url = new URL(request.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '30', 10), 1), 90);

  const accounts = await supabaseQuery(env, 'billing_accounts', { user_id: user.sub });
  if (accounts.length === 0) {
    return errorResponse('No billing account found', 404);
  }

  const account = accounts[0] as Record<string, unknown>;
  const accountId = account.account_id as string;

  // Query usage_daily_rollup for the period
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const rollupUrl = new URL(`${env.SUPABASE_URL}/rest/v1/usage_daily_rollup`);
  rollupUrl.searchParams.set('account_id', `eq.${accountId}`);
  rollupUrl.searchParams.set('rollup_date', `gte.${startDate}`);
  rollupUrl.searchParams.set('order', 'rollup_date.asc');

  const rollupResponse = await fetch(rollupUrl.toString(), {
    headers: {
      apikey: env.SUPABASE_KEY,
      Authorization: `Bearer ${env.SUPABASE_KEY}`,
    },
  });

  const daily = rollupResponse.ok
    ? (await rollupResponse.json()) as Array<Record<string, unknown>>
    : [];

  // Compute summary
  const checksUsed = account.check_count_this_period as number || 0;
  const plan = await supabaseQuery(env, 'plans', { plan_id: account.plan_id as string });
  const planData = plan.length > 0 ? plan[0] as Record<string, unknown> : null;
  const checksIncluded = (planData?.included_checks as number) || 0;
  const perCheckPrice = (planData?.per_check_price as number) || 0;
  const overage = Math.max(0, checksUsed - checksIncluded);
  const estimatedCost = overage * perCheckPrice;

  return jsonResponse({
    daily,
    summary: {
      checks_used: checksUsed,
      checks_included: checksIncluded,
      overage,
      estimated_overage_cost: estimatedCost,
      period_start: account.current_period_start,
      period_end: account.current_period_end,
    },
  });
}

// ============================================
// GET /v1/billing/usage/agents
// ============================================

export async function handleGetMyAgentUsage(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const url = new URL(request.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '30', 10), 1), 90);

  const { data, error } = await supabaseRpc(env, 'get_user_agent_usage', {
    p_user_id: user.sub,
    p_days: days,
  });

  if (error) return errorResponse(`Database error: ${error}`, 500);

  return jsonResponse(data);
}

// ============================================
// GET /v1/billing/export/usage
// ============================================

export async function handleExportUsage(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  if (!from || !to) {
    return errorResponse('from and to date parameters are required (YYYY-MM-DD)', 400);
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return errorResponse('Invalid date format. Use YYYY-MM-DD.', 400);
  }

  const accounts = await supabaseQuery(env, 'billing_accounts', { user_id: user.sub });
  if (accounts.length === 0) {
    return errorResponse('No billing account found', 404);
  }

  const account = accounts[0] as Record<string, unknown>;
  const accountId = account.account_id as string;

  // Query usage_daily_rollup
  const rollupUrl = new URL(`${env.SUPABASE_URL}/rest/v1/usage_daily_rollup`);
  rollupUrl.searchParams.set('account_id', `eq.${accountId}`);
  rollupUrl.searchParams.set('rollup_date', `gte.${from}`);
  rollupUrl.searchParams.set('rollup_date', `lte.${to}`);
  rollupUrl.searchParams.set('order', 'rollup_date.asc');

  const rollupResponse = await fetch(rollupUrl.toString(), {
    headers: {
      apikey: env.SUPABASE_KEY,
      Authorization: `Bearer ${env.SUPABASE_KEY}`,
    },
  });

  const daily = rollupResponse.ok
    ? (await rollupResponse.json()) as Array<Record<string, unknown>>
    : [];

  // Generate CSV
  const csvLines = ['Date,Check Count,Tokens In,Tokens Out'];
  for (const row of daily) {
    csvLines.push(
      `${row.rollup_date},${row.check_count ?? 0},${row.tokens_in ?? 0},${row.tokens_out ?? 0}`
    );
  }
  const csv = csvLines.join('\n');

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="mnemom-usage-${from}-to-${to}.csv"`,
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ============================================
// GET /v1/billing/budget-alert
// ============================================

export async function handleGetBudgetAlert(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const accounts = await supabaseQuery(env, 'billing_accounts', { user_id: user.sub });
  if (accounts.length === 0) {
    return errorResponse('No billing account found', 404);
  }

  const account = accounts[0] as Record<string, unknown>;

  return jsonResponse({
    threshold_cents: account.budget_alert_threshold_cents ?? null,
    last_alert_sent_at: account.budget_alert_sent_at ?? null,
  });
}

// ============================================
// PUT /v1/billing/budget-alert
// ============================================

export async function handleSetBudgetAlert(
  env: BillingEnv,
  request: Request,
  getAuth: AuthGetter
): Promise<Response> {
  const user = await getAuth(request, env);
  if (!user) return errorResponse('Authentication required', 401);

  const body = await request.json() as { threshold_cents?: number | null };

  // Allow null to clear the threshold
  if (body.threshold_cents !== null && body.threshold_cents !== undefined) {
    if (typeof body.threshold_cents !== 'number' || body.threshold_cents < 0) {
      return errorResponse('threshold_cents must be a non-negative number or null', 400);
    }
  }

  const accounts = await supabaseQuery(env, 'billing_accounts', { user_id: user.sub });
  if (accounts.length === 0) {
    return errorResponse('No billing account found', 404);
  }

  const account = accounts[0] as Record<string, unknown>;
  const accountId = account.account_id as string;

  await supabaseUpdate(env, 'billing_accounts', { account_id: accountId }, {
    budget_alert_threshold_cents: body.threshold_cents ?? null,
    budget_alert_sent_at: null, // Reset when threshold changes
    updated_at: new Date().toISOString(),
  });

  return jsonResponse({
    threshold_cents: body.threshold_cents ?? null,
    updated: true,
  });
}

// ============================================
// Cancel Stripe subscription (for delete-account flow)
// ============================================

export async function cancelStripeSubscriptionForAccount(
  env: BillingEnv,
  userId: string
): Promise<void> {
  const accounts = await supabaseQuery(env, 'billing_accounts', { user_id: userId });
  if (accounts.length === 0) return;

  const account = accounts[0] as Record<string, unknown>;
  const subscriptionId = account.stripe_subscription_id as string;
  if (!subscriptionId) return;

  try {
    await getProvider(env).cancelSubscription(subscriptionId, { atPeriodEnd: false });
    console.log(`[billing] Canceled subscription ${subscriptionId} for deleted account`);
  } catch (err) {
    console.warn(`[billing] Failed to cancel subscription on account deletion: ${err}`);
  }
}

// ============================================
// POST /v1/billing/validate-promo
// ============================================

export async function handleValidatePromo(
  env: BillingEnv,
  request: Request
): Promise<Response> {
  const body = await request.json() as { code?: string };
  if (!body.code) {
    return errorResponse('code is required', 400);
  }

  try {
    const stripe = (await import('stripe')).default;
    const stripeClient = new stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-01-28.clover' as any,
      httpClient: stripe.createFetchHttpClient(),
    });

    const promoCodes = await stripeClient.promotionCodes.list({
      code: body.code,
      active: true,
      limit: 1,
      expand: ['data.coupon'],
    });

    if (promoCodes.data.length === 0) {
      return jsonResponse({ valid: false });
    }

    const promo = promoCodes.data[0];
    // Stripe SDK v20+ removed coupon from PromotionCode types but it's still present at runtime
    const coupon = (promo as any).coupon as { percent_off?: number | null; amount_off?: number | null; name?: string | null };

    return jsonResponse({
      valid: true,
      discount_percent: coupon.percent_off ?? null,
      discount_amount_cents: coupon.amount_off ?? null,
      name: coupon.name ?? promo.code,
    });
  } catch (err) {
    console.error('[billing] Promo code validation error:', err);
    return errorResponse('Failed to validate promo code', 500);
  }
}

// ============================================
// Enterprise Contact Form
// ============================================

export async function handleEnterpriseContact(
  env: BillingEnv,
  request: Request
): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const name = (body.name as string || '').trim();
  const email = (body.email as string || '').trim();
  const company = (body.company as string || '').trim();
  const role = (body.role as string || '').trim();
  const companySize = (body.company_size as string || '').trim();
  const message = (body.message as string || '').trim();

  if (!name || !email || !company) {
    return errorResponse('name, email, and company are required', 400);
  }

  // Basic email validation
  if (!email.includes('@') || !email.includes('.')) {
    return errorResponse('Invalid email address', 400);
  }

  const leadId = `el-${crypto.randomUUID().slice(0, 8)}`;

  try {
    // Insert into enterprise_leads table
    const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/enterprise_leads`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        id: leadId,
        name,
        email,
        company,
        role: role || null,
        company_size: companySize || null,
        message: message || null,
        source: 'pricing_page',
      }),
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      console.error('[enterprise] Insert failed:', errText);
      return errorResponse('Failed to submit inquiry', 500);
    }

    // Send notification email to sales team (best-effort)
    try {
      const { sendEmail } = await import('./email');
      await sendEmail('support@mnemom.ai', {
        subject: `Enterprise Lead: ${company} — ${name}`,
        html: `<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px;">
<h2 style="color: #D97706;">New Enterprise Inquiry</h2>
<table style="border-collapse: collapse; width: 100%;">
<tr><td style="padding: 8px 12px; font-weight: bold; color: #666;">Name</td><td style="padding: 8px 12px;">${name}</td></tr>
<tr><td style="padding: 8px 12px; font-weight: bold; color: #666;">Email</td><td style="padding: 8px 12px;"><a href="mailto:${email}">${email}</a></td></tr>
<tr><td style="padding: 8px 12px; font-weight: bold; color: #666;">Company</td><td style="padding: 8px 12px;">${company}</td></tr>
${role ? `<tr><td style="padding: 8px 12px; font-weight: bold; color: #666;">Role</td><td style="padding: 8px 12px;">${role}</td></tr>` : ''}
${companySize ? `<tr><td style="padding: 8px 12px; font-weight: bold; color: #666;">Team Size</td><td style="padding: 8px 12px;">${companySize}</td></tr>` : ''}
</table>
${message ? `<h3 style="margin-top: 16px;">Use Case</h3><p style="color: #333; white-space: pre-wrap;">${message}</p>` : ''}
<hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
<p style="color: #999; font-size: 12px;">Lead ID: ${leadId} | Source: Pricing Page</p>
</div>`,
        text: `New Enterprise Inquiry\n\nName: ${name}\nEmail: ${email}\nCompany: ${company}\n${role ? `Role: ${role}\n` : ''}${companySize ? `Team Size: ${companySize}\n` : ''}${message ? `\nUse Case:\n${message}` : ''}\n\nLead ID: ${leadId}`,
      }, env);

      // Send confirmation to the lead
      await sendEmail(email, {
        subject: 'Thanks for your interest in Mnemom Enterprise',
        html: `<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px;">
<h2 style="color: #D97706;">Thanks for reaching out, ${name.split(' ')[0]}!</h2>
<p>We received your enterprise inquiry and a member of our team will be in touch within one business day.</p>
<p>In the meantime, you can explore our <a href="https://mnemom.ai/research">documentation</a> or reach us directly at <a href="mailto:support@mnemom.ai">support@mnemom.ai</a>.</p>
<p style="margin-top: 24px;">— The Mnemom Team</p>
</div>`,
        text: `Thanks for reaching out, ${name.split(' ')[0]}!\n\nWe received your enterprise inquiry and a member of our team will be in touch within one business day.\n\nIn the meantime, you can explore our documentation at https://mnemom.ai/research or reach us directly at support@mnemom.ai.\n\n— The Mnemom Team`,
      }, env);
    } catch (emailErr) {
      console.error('[enterprise] Email notification failed:', emailErr);
      // Don't fail the request — the lead was saved
    }

    // HubSpot: create/update contact + deal (best-effort)
    try {
      const { hubspotCreateOrUpdateContact, hubspotCreateDeal } = await import('./hubspot');
      const nameParts = name.split(' ');
      const contact = await hubspotCreateOrUpdateContact(env, {
        email,
        firstname: nameParts[0],
        lastname: nameParts.slice(1).join(' ') || undefined,
        company,
        jobtitle: role || undefined,
        lifecyclestage: 'lead',
        company_size: companySize || undefined,
        lead_source: 'pricing_page',
      });
      if (contact) {
        await hubspotCreateDeal(env, contact.id, {
          dealname: `Enterprise: ${company}`,
          dealstage: 'appointmentscheduled',
        });
      }
    } catch (hsErr) {
      console.error('[enterprise] HubSpot sync failed:', hsErr);
    }

    // Slack: enterprise lead alert (best-effort)
    try {
      const { enterpriseLeadAlert } = await import('./slack');
      await enterpriseLeadAlert(env, {
        name,
        email,
        company,
        companySize: companySize || undefined,
        role: role || undefined,
        leadId,
      });
    } catch (slackErr) {
      console.error('[enterprise] Slack alert failed:', slackErr);
    }

    // Enterprise nurture sequence (best-effort)
    try {
      const { enrollInSequence } = await import('./sequences');
      await enrollInSequence(env, email, 'enterprise_nurture', undefined, { name, company });
    } catch (seqErr) {
      console.error('[enterprise] Sequence enrollment failed:', seqErr);
    }

    return jsonResponse({ id: leadId });
  } catch (err) {
    console.error('[enterprise] Contact form error:', err);
    return errorResponse('Failed to submit inquiry', 500);
  }
}
