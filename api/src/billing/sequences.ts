/**
 * Email sequence engine — enroll, process, cancel drip sequences.
 * Runs via 6-hour cron (same pattern as usage-alerts.ts).
 * Sends via Resend from "Alex from Mnemom <alex@mnemom.ai>".
 */

import type { BillingEnv } from './types';
import {
  sendSequenceEmail,
  devOnboardingDay1Email,
  devOnboardingDay3Email,
  devOnboardingDay7Email,
  devOnboardingDay14Email,
  teamOnboardingDay1Email,
  teamOnboardingDay3Email,
  teamOnboardingDay7Email,
  teamOnboardingDay12Email,
  enterpriseNurtureDay0Email,
  enterpriseNurtureDay3Email,
  enterpriseNurtureDay7Email,
  enterpriseNurtureDay14Email,
  reEngagementChurnSurveyEmail,
} from './email';

// ============================================
// Sequence definitions
// ============================================

type SequenceType =
  | 'developer_onboarding'
  | 'team_onboarding'
  | 'enterprise_nurture'
  | 're_engagement_churned';

interface SequenceStep {
  step: number;
  dayOffset: number;
}

const SEQUENCE_DEFINITIONS: Record<SequenceType, SequenceStep[]> = {
  developer_onboarding: [
    { step: 1, dayOffset: 1 },
    { step: 2, dayOffset: 3 },
    { step: 3, dayOffset: 7 },
    { step: 4, dayOffset: 14 },
  ],
  team_onboarding: [
    { step: 1, dayOffset: 1 },
    { step: 2, dayOffset: 3 },
    { step: 3, dayOffset: 7 },
    { step: 4, dayOffset: 12 },
  ],
  enterprise_nurture: [
    { step: 1, dayOffset: 0 },
    { step: 2, dayOffset: 3 },
    { step: 3, dayOffset: 7 },
    { step: 4, dayOffset: 14 },
  ],
  re_engagement_churned: [
    { step: 1, dayOffset: 7 },
  ],
};

// ============================================
// Supabase helpers (module-local, same pattern as usage-alerts.ts)
// ============================================

interface SequenceRow {
  id: string;
  account_id: string | null;
  email: string;
  sequence_type: SequenceType;
  enrolled_at: string;
  last_step_sent: number;
  last_sent_at: string | null;
  completed_at: string | null;
  unsubscribed: boolean;
  metadata: Record<string, unknown>;
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

async function supabaseInsert(
  env: BillingEnv,
  table: string,
  data: Record<string, unknown>,
  prefer = 'return=minimal',
): Promise<boolean> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_KEY,
      Authorization: `Bearer ${env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: JSON.stringify(data),
  });
  return response.ok;
}

async function supabasePatch(
  env: BillingEnv,
  table: string,
  filter: string,
  data: Record<string, unknown>,
): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${filter}`, {
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

function generateId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}-${id}`;
}

// ============================================
// enrollInSequence
// ============================================

export async function enrollInSequence(
  env: BillingEnv,
  email: string,
  sequenceType: SequenceType,
  accountId?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  // INSERT with ignore-duplicates (UNIQUE on email+sequence_type)
  const inserted = await supabaseInsert(
    env,
    'email_sequences',
    {
      account_id: accountId || null,
      email,
      sequence_type: sequenceType,
      metadata: metadata || {},
    },
    'resolution=ignore-duplicates,return=minimal',
  );

  if (!inserted) {
    console.warn(`[sequences] Failed to enroll ${email} in ${sequenceType} (may be duplicate)`);
    return;
  }

  console.log(`[sequences] Enrolled ${email} in ${sequenceType}`);

  // Log billing event
  await supabaseInsert(env, 'billing_events', {
    event_id: generateId('be'),
    account_id: accountId || null,
    event_type: 'sequence_enrolled',
    details: { email, sequence_type: sequenceType },
    performed_by: 'system',
    timestamp: new Date().toISOString(),
  });

  // HubSpot: update contact with sequence info (best-effort)
  try {
    const { hubspotCreateOrUpdateContact } = await import('./hubspot');
    await hubspotCreateOrUpdateContact(env, {
      email,
      mnemom_email_sequence: sequenceType,
      mnemom_sequence_step: '0/' + (SEQUENCE_DEFINITIONS[sequenceType]?.length ?? 0),
    });
  } catch (err) {
    console.warn(`[sequences] HubSpot sync failed for enrollment:`, err);
  }

  // If enterprise_nurture, send day-0 email immediately
  if (sequenceType === 'enterprise_nurture' && metadata) {
    try {
      const name = (metadata.name as string) || '';
      const company = (metadata.company as string) || '';
      if (name && company) {
        await sendSequenceEmail(email, enterpriseNurtureDay0Email({ name, company }), env);
        await supabasePatch(
          env,
          'email_sequences',
          `email=eq.${encodeURIComponent(email)}&sequence_type=eq.${sequenceType}`,
          { last_step_sent: 1, last_sent_at: new Date().toISOString() },
        );
        await supabaseInsert(env, 'billing_events', {
          event_id: generateId('be'),
          account_id: accountId || null,
          event_type: 'sequence_step_sent',
          details: { email, sequence_type: sequenceType, step: 1 },
          performed_by: 'system',
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error(`[sequences] Failed to send enterprise nurture day-0:`, err);
    }
  }
}

// ============================================
// cancelSequence
// ============================================

export async function cancelSequence(
  env: BillingEnv,
  email: string,
  sequenceType: SequenceType,
): Promise<void> {
  await supabasePatch(
    env,
    'email_sequences',
    `email=eq.${encodeURIComponent(email)}&sequence_type=eq.${sequenceType}&completed_at=is.null`,
    { completed_at: new Date().toISOString() },
  );
  console.log(`[sequences] Canceled ${sequenceType} for ${email}`);
}

// ============================================
// processSequences (cron entry point)
// ============================================

export async function processSequences(env: BillingEnv): Promise<void> {
  console.log('[sequences] Starting sequence processing...');

  const rows = (await supabaseQuery(
    env,
    'email_sequences?completed_at=is.null&unsubscribed=eq.false&select=*',
  )) as SequenceRow[];

  console.log(`[sequences] Found ${rows.length} active sequences`);

  for (const row of rows) {
    try {
      const definition = SEQUENCE_DEFINITIONS[row.sequence_type];
      if (!definition) continue;

      const daysSinceEnroll = Math.floor(
        (Date.now() - new Date(row.enrolled_at).getTime()) / (24 * 60 * 60 * 1000),
      );

      // Find next eligible step
      const nextStep = definition.find(
        (s) => s.step > row.last_step_sent && s.dayOffset <= daysSinceEnroll,
      );

      if (!nextStep) continue;

      // Build template for this step
      const template = await buildTemplate(env, row, nextStep.step);
      if (!template) continue;

      // Send one step per row per cron run
      await sendSequenceEmail(row.email, template, env);

      // Update sequence row
      const isLastStep = nextStep.step === definition[definition.length - 1].step;
      await supabasePatch(
        env,
        'email_sequences',
        `id=eq.${row.id}`,
        {
          last_step_sent: nextStep.step,
          last_sent_at: new Date().toISOString(),
          ...(isLastStep ? { completed_at: new Date().toISOString() } : {}),
        },
      );

      // Log event
      await supabaseInsert(env, 'billing_events', {
        event_id: generateId('be'),
        account_id: row.account_id,
        event_type: 'sequence_step_sent',
        details: {
          email: row.email,
          sequence_type: row.sequence_type,
          step: nextStep.step,
          completed: isLastStep,
        },
        performed_by: 'system_cron',
        timestamp: new Date().toISOString(),
      });

      // HubSpot: update step (best-effort)
      try {
        const { hubspotCreateOrUpdateContact } = await import('./hubspot');
        await hubspotCreateOrUpdateContact(env, {
          email: row.email,
          mnemom_sequence_step: `${nextStep.step}/${definition.length}`,
          ...(isLastStep ? { mnemom_email_sequence: '' } : {}),
        });
      } catch {
        // best-effort
      }

      console.log(
        `[sequences] Sent ${row.sequence_type} step ${nextStep.step} to ${row.email}`,
      );
    } catch (err) {
      console.error(
        `[sequences] Error processing sequence ${row.id} (${row.email}):`,
        err,
      );
    }
  }

  console.log('[sequences] Sequence processing complete');
}

// ============================================
// Template builder
// ============================================

interface AccountData {
  check_count_this_period: number;
  user_id: string;
}

async function getAccountData(
  env: BillingEnv,
  accountId: string | null,
): Promise<{ checksUsed: number; agentsLinked: number } | null> {
  if (!accountId) return null;

  const accounts = (await supabaseQuery(
    env,
    `billing_accounts?account_id=eq.${accountId}&select=check_count_this_period,user_id`,
  )) as AccountData[];

  if (accounts.length === 0) return null;

  const account = accounts[0];
  const agents = await supabaseQuery(
    env,
    `agents?user_id=eq.${account.user_id}&select=id`,
  );

  return {
    checksUsed: account.check_count_this_period || 0,
    agentsLinked: agents.length,
  };
}

async function buildTemplate(
  env: BillingEnv,
  row: SequenceRow,
  step: number,
): Promise<{ subject: string; html: string; text: string } | null> {
  const meta = row.metadata || {};

  switch (row.sequence_type) {
    case 'developer_onboarding': {
      switch (step) {
        case 1: return devOnboardingDay1Email();
        case 2: return devOnboardingDay3Email();
        case 3: return devOnboardingDay7Email();
        case 4: {
          const data = await getAccountData(env, row.account_id);
          return devOnboardingDay14Email({
            checksUsed: data?.checksUsed ?? 0,
            agentsLinked: data?.agentsLinked ?? 0,
          });
        }
      }
      break;
    }
    case 'team_onboarding': {
      switch (step) {
        case 1: return teamOnboardingDay1Email();
        case 2: {
          const data = await getAccountData(env, row.account_id);
          return teamOnboardingDay3Email({
            checksUsed: data?.checksUsed ?? 0,
            agentsLinked: data?.agentsLinked ?? 0,
          });
        }
        case 3: return teamOnboardingDay7Email();
        case 4: {
          const data = await getAccountData(env, row.account_id);
          return teamOnboardingDay12Email({
            checksUsed: data?.checksUsed ?? 0,
            agentsLinked: data?.agentsLinked ?? 0,
          });
        }
      }
      break;
    }
    case 'enterprise_nurture': {
      // Step 1 (day 0) is sent immediately on enrollment, so cron handles steps 2-4
      switch (step) {
        case 2: return enterpriseNurtureDay3Email();
        case 3: return enterpriseNurtureDay7Email();
        case 4: {
          const name = (meta.name as string) || '';
          return enterpriseNurtureDay14Email({ name });
        }
      }
      break;
    }
    case 're_engagement_churned': {
      if (step === 1) return reEngagementChurnSurveyEmail();
      break;
    }
  }

  return null;
}
