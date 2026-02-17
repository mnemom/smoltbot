/**
 * Usage alert cron job — checks all active/trialing accounts and sends
 * usage warnings, budget alerts, and trial progress emails.
 * Runs every 6 hours via scheduled trigger.
 */

import type { BillingEnv } from './types';
import {
  sendEmail,
  sendSequenceEmail,
  usageWarningEmail,
  usageLimitReachedEmail,
  budgetAlertEmail,
  reEngagementInactiveEmail,
} from './email';

interface BillingAccount {
  account_id: string;
  user_id: string;
  plan_id: string;
  billing_email: string | null;
  subscription_status: string;
  check_count_this_period: number;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  budget_alert_threshold_cents: number | null;
  budget_alert_sent_at: string | null;
  usage_warning_sent_at: string | null;
  created_at: string;
}

interface Plan {
  plan_id: string;
  included_checks: number;
  per_check_price: number;
}

async function supabaseQuery(env: BillingEnv, path: string): Promise<unknown[]> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
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
  accountId: string,
  data: Record<string, unknown>
): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?account_id=eq.${accountId}`, {
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

async function supabaseInsert(
  env: BillingEnv,
  table: string,
  data: Record<string, unknown>
): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_KEY,
      Authorization: `Bearer ${env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(data),
  });
}

function generateId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}-${id}`;
}

export async function checkUsageAlerts(env: BillingEnv): Promise<void> {
  console.log('[usage-alerts] Starting usage alert check...');

  // Fetch all active/trialing accounts with billing email
  const accounts = (await supabaseQuery(
    env,
    'billing_accounts?subscription_status=in.(active,trialing)&billing_email=not.is.null&select=*'
  )) as BillingAccount[];

  console.log(`[usage-alerts] Found ${accounts.length} accounts to check`);

  // Fetch all plans for lookup
  const plansRaw = (await supabaseQuery(env, 'plans?select=plan_id,included_checks,per_check_price')) as Plan[];
  const plans = new Map(plansRaw.map(p => [p.plan_id, p]));

  for (const account of accounts) {
    if (!account.billing_email) continue;

    try {
      const plan = plans.get(account.plan_id);
      if (!plan) continue;

      // 1. Usage warning at 80%
      if (plan.included_checks > 0 && account.subscription_status === 'active') {
        const usagePercent = (account.check_count_this_period / plan.included_checks) * 100;

        if (usagePercent >= 80 && !account.usage_warning_sent_at) {
          await sendEmail(account.billing_email, usageWarningEmail({
            email: account.billing_email,
            usagePercent: Math.round(usagePercent),
            checksUsed: account.check_count_this_period,
            checksIncluded: plan.included_checks,
            planName: account.plan_id,
          }), env);

          await supabaseUpdate(env, 'billing_accounts', account.account_id, {
            usage_warning_sent_at: new Date().toISOString(),
          });

          await supabaseInsert(env, 'billing_events', {
            event_id: generateId('be'),
            account_id: account.account_id,
            event_type: 'usage_warning_sent',
            details: { usage_percent: Math.round(usagePercent), checks_used: account.check_count_this_period },
            performed_by: 'system_cron',
            timestamp: new Date().toISOString(),
          });

          console.log(`[usage-alerts] Sent usage warning to ${account.account_id} (${Math.round(usagePercent)}%)`);
        }
      }

      // 2. Budget alert
      if (
        account.budget_alert_threshold_cents &&
        !account.budget_alert_sent_at &&
        plan.per_check_price > 0
      ) {
        const overage = Math.max(0, account.check_count_this_period - plan.included_checks);
        const currentCostCents = Math.round(overage * plan.per_check_price * 100);

        if (currentCostCents >= account.budget_alert_threshold_cents) {
          await sendEmail(account.billing_email, budgetAlertEmail({
            email: account.billing_email,
            currentCostCents,
            budgetCents: account.budget_alert_threshold_cents,
          }), env);

          await supabaseUpdate(env, 'billing_accounts', account.account_id, {
            budget_alert_sent_at: new Date().toISOString(),
          });

          await supabaseInsert(env, 'billing_events', {
            event_id: generateId('be'),
            account_id: account.account_id,
            event_type: 'budget_alert_triggered',
            details: { current_cost_cents: currentCostCents, threshold_cents: account.budget_alert_threshold_cents },
            performed_by: 'system_cron',
            timestamp: new Date().toISOString(),
          });

          console.log(`[usage-alerts] Sent budget alert to ${account.account_id}`);
        }
      }

      // 3. 30-day inactive re-engagement (one-shot, not a sequence)
      if (
        account.check_count_this_period === 0 &&
        account.created_at &&
        Math.floor((Date.now() - new Date(account.created_at).getTime()) / (24 * 60 * 60 * 1000)) >= 30
      ) {
        const existingEvents = await supabaseQuery(
          env,
          `billing_events?account_id=eq.${account.account_id}&event_type=eq.inactive_reengagement_sent&select=event_id&limit=1`
        );

        if (existingEvents.length === 0) {
          await sendSequenceEmail(account.billing_email, reEngagementInactiveEmail(), env);

          await supabaseInsert(env, 'billing_events', {
            event_id: generateId('be'),
            account_id: account.account_id,
            event_type: 'inactive_reengagement_sent',
            details: { checks_used: 0 },
            performed_by: 'system_cron',
            timestamp: new Date().toISOString(),
          });

          console.log(`[usage-alerts] Sent inactive re-engagement to ${account.account_id}`);
        }
      }
    } catch (err) {
      console.error(`[usage-alerts] Error processing account ${account.account_id}:`, err);
    }
  }

  console.log('[usage-alerts] Usage alert check complete');
}
