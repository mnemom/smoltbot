/**
 * Stripe webhook event dispatcher and per-event handlers.
 * Uses insert-before-process idempotency pattern with stripe_webhook_events table.
 */

import type { BillingEnv, WebhookEvent } from './types';
import {
  sendEmail,
  welcomeDeveloperEmail,
  welcomeTeamTrialEmail,
  invoicePaidEmail,
  paymentFailedEmail,
  trialEndingEmail,
  trialExpiredEmail,
  subscriptionCanceledEmail,
} from './email';

// ============================================
// Supabase helpers (local to webhook handler)
// ============================================

async function supabaseRpc(
  env: BillingEnv,
  functionName: string,
  params: Record<string, unknown> = {}
): Promise<unknown> {
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
    const text = await response.text();
    throw new Error(`RPC ${functionName} failed: ${response.status} - ${text}`);
  }
  return response.json();
}

async function supabaseInsert(
  env: BillingEnv,
  table: string,
  data: Record<string, unknown>
): Promise<void> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_KEY,
      Authorization: `Bearer ${env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Insert into ${table} failed: ${response.status} - ${text}`);
  }
}

async function supabaseUpdate(
  env: BillingEnv,
  table: string,
  filters: Record<string, string>,
  data: Record<string, unknown>
): Promise<unknown[]> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, `eq.${value}`);
  }
  const response = await fetch(url.toString(), {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_KEY,
      Authorization: `Bearer ${env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Update ${table} failed: ${response.status} - ${text}`);
  }
  return response.json() as Promise<unknown[]>;
}

function generateId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}-${id}`;
}

// ============================================
// Main webhook processor
// ============================================

export async function processWebhookEvent(
  event: WebhookEvent,
  env: BillingEnv
): Promise<void> {
  // Idempotency: try to insert event record. If conflict, it's a duplicate.
  try {
    await supabaseInsert(env, 'stripe_webhook_events', {
      event_id: event.id,
      event_type: event.type,
      status: 'processing',
    });
  } catch (err) {
    // Conflict = duplicate event, already processed
    if (String(err).includes('duplicate') || String(err).includes('23505')) {
      console.log(`[webhook] Duplicate event ${event.id}, skipping`);
      return;
    }
    throw err;
  }

  try {
    await dispatchEvent(event, env);

    // Mark processed
    await supabaseUpdate(
      env,
      'stripe_webhook_events',
      { event_id: event.id },
      { status: 'processed', processed_at: new Date().toISOString() }
    );
  } catch (err) {
    console.error(`[webhook] Error processing ${event.type}:`, err);

    // Mark failed
    try {
      await supabaseUpdate(
        env,
        'stripe_webhook_events',
        { event_id: event.id },
        {
          status: 'failed',
          error_detail: err instanceof Error ? err.message : String(err),
          processed_at: new Date().toISOString(),
        }
      );
    } catch {
      // Swallow — don't mask the original error
    }

    throw err;
  }
}

// ============================================
// Event dispatcher
// ============================================

async function dispatchEvent(event: WebhookEvent, env: BillingEnv): Promise<void> {
  const obj = event.data.object;

  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(obj, env);
    case 'customer.subscription.created':
      return handleSubscriptionCreated(obj, env);
    case 'customer.subscription.updated':
      return handleSubscriptionUpdated(obj, env);
    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(obj, env);
    case 'customer.subscription.trial_will_end':
      return handleTrialWillEnd(obj, env);
    case 'invoice.paid':
      return handleInvoicePaid(obj, env);
    case 'invoice.payment_failed':
      return handleInvoicePaymentFailed(obj, env);
    case 'invoice.finalized':
      return handleInvoiceFinalized(obj, env);
    case 'customer.updated':
      return handleCustomerUpdated(obj, env);
    default:
      console.log(`[webhook] Unhandled event type: ${event.type}`);
  }
}

// ============================================
// Per-event handlers
// ============================================

async function handleCheckoutCompleted(
  obj: Record<string, unknown>,
  env: BillingEnv
): Promise<void> {
  const accountId = obj.client_reference_id as string;
  const customerId = obj.customer as string;
  const subscriptionId = obj.subscription as string;
  const metadata = (obj.metadata || {}) as Record<string, string>;
  const planId = metadata.mnemom_plan_id;

  if (!accountId || !subscriptionId) {
    console.warn('[webhook] checkout.session.completed missing account or subscription');
    return;
  }

  // Fetch subscription to get item ID and period dates
  const subResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/rpc/lookup_billing_account_by_stripe_customer`,
    { method: 'POST', headers: rpcHeaders(env), body: JSON.stringify({ p_customer_id: customerId }) }
  );

  // Update billing account with Stripe IDs
  const updateData: Record<string, unknown> = {
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    updated_at: new Date().toISOString(),
  };

  if (planId) {
    updateData.plan_id = planId;
  }

  await supabaseUpdate(env, 'billing_accounts', { account_id: accountId }, updateData);

  // Extract subscription item ID (first item)
  // We need to call Stripe API to get the subscription details
  // For now, the subscription.created webhook will also set the item ID
  await logBillingEvent(env, accountId, 'checkout_completed', {
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    plan_id: planId,
  });

  // Send welcome email
  const accounts = await lookupAccountById(env, accountId);
  if (accounts.length > 0) {
    const account = accounts[0] as Record<string, unknown>;
    const email = account.billing_email as string;
    if (email) {
      const isDeveloper = planId === 'plan-developer';
      const template = isDeveloper
        ? welcomeDeveloperEmail({ email })
        : welcomeTeamTrialEmail({ email });
      await sendEmail(email, template, env);
    }
  }
}

async function handleSubscriptionCreated(
  obj: Record<string, unknown>,
  env: BillingEnv
): Promise<void> {
  const subscriptionId = obj.id as string;
  const customerId = obj.customer as string;
  const status = obj.status as string;
  const currentPeriodStart = obj.current_period_start as number;
  const currentPeriodEnd = obj.current_period_end as number;
  const trialEnd = obj.trial_end as number | null;

  // Extract subscription item IDs
  const items = obj.items as { data?: Array<{ id: string; price?: { id: string; type?: string } }> } | undefined;
  let subscriptionItemId: string | undefined;

  if (items?.data) {
    // Find the metered item (for usage reporting)
    const meteredItem = items.data.find(
      (item) => item.price?.type === 'metered'
    );
    subscriptionItemId = meteredItem?.id || items.data[0]?.id;
  }

  const account = await lookupAccountByCustomer(env, customerId);
  if (!account) {
    console.warn(`[webhook] subscription.created: no account for customer ${customerId}`);
    return;
  }

  const accountId = (account as Record<string, unknown>).account_id as string;

  const updateData: Record<string, unknown> = {
    stripe_subscription_id: subscriptionId,
    subscription_status: mapStripeStatus(status),
    current_period_start: new Date(currentPeriodStart * 1000).toISOString(),
    current_period_end: new Date(currentPeriodEnd * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (subscriptionItemId) {
    updateData.stripe_subscription_item_id = subscriptionItemId;
  }

  if (trialEnd) {
    updateData.trial_ends_at = new Date(trialEnd * 1000).toISOString();
  }

  await supabaseUpdate(env, 'billing_accounts', { account_id: accountId }, updateData);

  await logBillingEvent(env, accountId, 'subscription_created', {
    stripe_subscription_id: subscriptionId,
    status,
    subscription_item_id: subscriptionItemId,
  });
}

async function handleSubscriptionUpdated(
  obj: Record<string, unknown>,
  env: BillingEnv
): Promise<void> {
  const subscriptionId = obj.id as string;
  const customerId = obj.customer as string;
  const status = obj.status as string;
  const currentPeriodStart = obj.current_period_start as number;
  const currentPeriodEnd = obj.current_period_end as number;
  const cancelAtPeriodEnd = obj.cancel_at_period_end as boolean;

  const account = await lookupAccountByCustomer(env, customerId);
  if (!account) {
    console.warn(`[webhook] subscription.updated: no account for customer ${customerId}`);
    return;
  }

  const accountId = (account as Record<string, unknown>).account_id as string;

  const updateData: Record<string, unknown> = {
    subscription_status: mapStripeStatus(status),
    current_period_start: new Date(currentPeriodStart * 1000).toISOString(),
    current_period_end: new Date(currentPeriodEnd * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Check for price change -> plan change
  const items = obj.items as { data?: Array<{ price?: { id: string } }> } | undefined;
  if (items?.data?.[0]?.price?.id) {
    const priceId = items.data[0].price.id;
    try {
      const plans = await supabaseRpc(env, 'lookup_plan_by_stripe_price', { p_price_id: priceId }) as unknown[];
      if (plans.length > 0) {
        const plan = plans[0] as Record<string, unknown>;
        updateData.plan_id = plan.plan_id;
      }
    } catch (err) {
      console.warn(`[webhook] Could not lookup plan for price ${priceId}:`, err);
    }
  }

  await supabaseUpdate(env, 'billing_accounts', { account_id: accountId }, updateData);

  await logBillingEvent(env, accountId, 'subscription_updated', {
    stripe_subscription_id: subscriptionId,
    status,
    cancel_at_period_end: cancelAtPeriodEnd,
  });
}

async function handleSubscriptionDeleted(
  obj: Record<string, unknown>,
  env: BillingEnv
): Promise<void> {
  const customerId = obj.customer as string;

  const account = await lookupAccountByCustomer(env, customerId);
  if (!account) {
    console.warn(`[webhook] subscription.deleted: no account for customer ${customerId}`);
    return;
  }

  const acct = account as Record<string, unknown>;
  const accountId = acct.account_id as string;

  // Downgrade to free, clear Stripe IDs, preserve all user data
  await supabaseUpdate(env, 'billing_accounts', { account_id: accountId }, {
    plan_id: 'plan-free',
    subscription_status: 'canceled',
    stripe_subscription_id: null,
    stripe_subscription_item_id: null,
    updated_at: new Date().toISOString(),
  });

  await logBillingEvent(env, accountId, 'subscription_canceled', {
    stripe_customer_id: customerId,
    downgraded_to: 'plan-free',
  });

  // Send trial expired / canceled email
  const email = acct.billing_email as string;
  if (email) {
    const wasTrial = acct.subscription_status === 'trialing';
    const template = wasTrial
      ? trialExpiredEmail({ email })
      : subscriptionCanceledEmail({ email });
    await sendEmail(email, template, env);
  }
}

async function handleTrialWillEnd(
  obj: Record<string, unknown>,
  env: BillingEnv
): Promise<void> {
  const customerId = obj.customer as string;
  const trialEnd = obj.trial_end as number | null;

  const account = await lookupAccountByCustomer(env, customerId);
  if (!account) return;

  const acct = account as Record<string, unknown>;
  const accountId = acct.account_id as string;

  await logBillingEvent(env, accountId, 'trial_will_end', {
    trial_end: trialEnd ? new Date(trialEnd * 1000).toISOString() : null,
  });

  const email = acct.billing_email as string;
  if (email) {
    await sendEmail(email, trialEndingEmail({ email, trialEndDate: trialEnd ? new Date(trialEnd * 1000).toISOString() : undefined }), env);
  }
}

async function handleInvoicePaid(
  obj: Record<string, unknown>,
  env: BillingEnv
): Promise<void> {
  const customerId = obj.customer as string;
  const hostedInvoiceUrl = obj.hosted_invoice_url as string | null;
  const amountPaid = obj.amount_paid as number;
  const periodStart = obj.period_start as number;
  const periodEnd = obj.period_end as number;

  const account = await lookupAccountByCustomer(env, customerId);
  if (!account) return;

  const acct = account as Record<string, unknown>;
  const accountId = acct.account_id as string;

  // Reset period counter and set active
  await supabaseUpdate(env, 'billing_accounts', { account_id: accountId }, {
    subscription_status: 'active',
    check_count_this_period: 0,
    current_period_start: new Date(periodStart * 1000).toISOString(),
    current_period_end: new Date(periodEnd * 1000).toISOString(),
    past_due_since: null,  // Phase 3: clear grace period
    updated_at: new Date().toISOString(),
  });

  await logBillingEvent(env, accountId, 'payment_succeeded', {
    amount_paid: amountPaid,
    hosted_invoice_url: hostedInvoiceUrl,
  });

  // Send receipt
  const email = acct.billing_email as string;
  if (email) {
    await sendEmail(email, invoicePaidEmail({
      email,
      amountCents: amountPaid,
      invoiceUrl: hostedInvoiceUrl,
    }), env);
  }
}

async function handleInvoicePaymentFailed(
  obj: Record<string, unknown>,
  env: BillingEnv
): Promise<void> {
  const customerId = obj.customer as string;
  const attemptCount = obj.attempt_count as number;

  const account = await lookupAccountByCustomer(env, customerId);
  if (!account) return;

  const acct = account as Record<string, unknown>;
  const accountId = acct.account_id as string;

  // Set past_due
  await supabaseUpdate(env, 'billing_accounts', { account_id: accountId }, {
    subscription_status: 'past_due',
    past_due_since: new Date().toISOString(),  // Phase 3: track grace period start
    updated_at: new Date().toISOString(),
  });

  await logBillingEvent(env, accountId, attemptCount > 1 ? 'dunning_escalated' : 'payment_failed', {
    attempt_count: attemptCount,
  });

  // Send dunning email
  const email = acct.billing_email as string;
  if (email) {
    await sendEmail(email, paymentFailedEmail({ email }, attemptCount), env);
  }
}

async function handleInvoiceFinalized(
  obj: Record<string, unknown>,
  env: BillingEnv
): Promise<void> {
  const customerId = obj.customer as string;
  const hostedInvoiceUrl = obj.hosted_invoice_url as string | null;
  const invoiceId = obj.id as string;

  const account = await lookupAccountByCustomer(env, customerId);
  if (!account) return;

  const accountId = (account as Record<string, unknown>).account_id as string;

  await logBillingEvent(env, accountId, 'invoice_finalized', {
    invoice_id: invoiceId,
    hosted_invoice_url: hostedInvoiceUrl,
  });
}

async function handleCustomerUpdated(
  obj: Record<string, unknown>,
  env: BillingEnv
): Promise<void> {
  const customerId = obj.id as string;
  const email = obj.email as string | null;

  if (!email) return;

  const account = await lookupAccountByCustomer(env, customerId);
  if (!account) return;

  const accountId = (account as Record<string, unknown>).account_id as string;

  await supabaseUpdate(env, 'billing_accounts', { account_id: accountId }, {
    billing_email: email,
    updated_at: new Date().toISOString(),
  });
}

// ============================================
// Helpers
// ============================================

function rpcHeaders(env: BillingEnv): Record<string, string> {
  return {
    apikey: env.SUPABASE_KEY,
    Authorization: `Bearer ${env.SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function lookupAccountByCustomer(
  env: BillingEnv,
  customerId: string
): Promise<unknown | null> {
  const result = await supabaseRpc(env, 'lookup_billing_account_by_stripe_customer', {
    p_customer_id: customerId,
  }) as unknown[];
  return result.length > 0 ? result[0] : null;
}

async function lookupAccountById(
  env: BillingEnv,
  accountId: string
): Promise<unknown[]> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/billing_accounts`);
  url.searchParams.set('account_id', `eq.${accountId}`);
  const response = await fetch(url.toString(), {
    headers: {
      apikey: env.SUPABASE_KEY,
      Authorization: `Bearer ${env.SUPABASE_KEY}`,
    },
  });
  if (!response.ok) return [];
  return response.json() as Promise<unknown[]>;
}

async function logBillingEvent(
  env: BillingEnv,
  accountId: string,
  eventType: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    await supabaseInsert(env, 'billing_events', {
      event_id: generateId('be'),
      account_id: accountId,
      event_type: eventType,
      details,
      performed_by: 'stripe_webhook',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.warn(`[webhook] Failed to log billing event: ${err}`);
  }
}

function mapStripeStatus(status: string): string {
  switch (status) {
    case 'trialing': return 'trialing';
    case 'active': return 'active';
    case 'past_due': return 'past_due';
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return 'none';
  }
}
