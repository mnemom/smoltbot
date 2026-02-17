/**
 * License Expiry Check — runs on scheduled() cron
 * Phase 7: Enterprise self-hosted billing
 *
 * Checks for expiring/expired licenses and sends notification emails.
 * Deduplicates by checking billing_events for existing notifications.
 */

import type { BillingEnv } from '../billing/types';
import {
  sendEmail,
  licenseExpiringEmail,
  licenseExpiredEmail,
} from '../billing/email';

// ============================================
// Supabase helpers (local, matching module pattern)
// ============================================

async function supabaseQuery(
  env: BillingEnv,
  table: string,
  queryString: string,
): Promise<{ data: unknown; error: string | null }> {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${queryString}`, {
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      return { data: null, error: await response.text() };
    }
    return { data: await response.json(), error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function supabaseInsert(
  env: BillingEnv,
  table: string,
  data: Record<string, unknown>,
): Promise<{ data: unknown; error: string | null }> {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      return { data: null, error: await response.text() };
    }
    return { data: await response.json(), error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
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
// Main expiry check
// ============================================

export async function checkLicenseExpiry(env: BillingEnv): Promise<void> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD for dedup

  // Query active (non-revoked) licenses expiring within 30 days
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 86400000).toISOString();

  const { data: licenses, error } = await supabaseQuery(
    env,
    'license_keys',
    `revoked_at=is.null&expires_at=lte.${thirtyDaysFromNow}&select=license_id,account_id,expires_at`,
  );
  if (error || !licenses) {
    console.error('[license-expiry] Failed to query licenses:', error);
    return;
  }

  const licArr = licenses as Array<Record<string, unknown>>;

  for (const license of licArr) {
    const expiresAt = new Date(license.expires_at as string);
    const daysRemaining = Math.floor((expiresAt.getTime() - now.getTime()) / 86400000);
    const licenseId = license.license_id as string;
    const accountId = license.account_id as string;

    // Determine notification type
    let eventType: string;
    if (daysRemaining <= 0) {
      eventType = 'license_expired_notification';
    } else if (daysRemaining <= 1) {
      eventType = 'license_expiring_1d';
    } else if (daysRemaining <= 7) {
      eventType = 'license_expiring_7d';
    } else if (daysRemaining <= 30) {
      eventType = 'license_expiring_30d';
    } else {
      continue;
    }

    // Dedup: check if we already sent this notification today
    const { data: existing } = await supabaseQuery(
      env,
      'billing_events',
      `account_id=eq.${accountId}&event_type=eq.${eventType}&timestamp=gte.${today}T00:00:00Z&details->>license_id=eq.${licenseId}&select=event_id&limit=1`,
    );
    const existingArr = existing as Array<Record<string, unknown>>;
    if (existingArr && existingArr.length > 0) {
      continue; // Already sent today
    }

    // Get account email
    const { data: accounts } = await supabaseQuery(
      env,
      'billing_accounts',
      `account_id=eq.${accountId}&select=billing_email`,
    );
    const acctArr = accounts as Array<Record<string, unknown>>;
    if (!acctArr || acctArr.length === 0 || !acctArr[0].billing_email) continue;

    const email = acctArr[0].billing_email as string;

    // Send email
    try {
      if (daysRemaining <= 0) {
        await sendEmail(email, licenseExpiredEmail({ companyName: email, licenseId }), env);
      } else {
        await sendEmail(
          email,
          licenseExpiringEmail({
            companyName: email,
            licenseId,
            expiresAt: expiresAt.toISOString(),
            daysRemaining,
          }),
          env,
        );
      }
    } catch {
      console.warn(`[license-expiry] Failed to send email for license ${licenseId}`);
    }

    // Log billing event (for dedup)
    await supabaseInsert(env, 'billing_events', {
      event_id: generateId('be'),
      account_id: accountId,
      event_type: eventType,
      details: { license_id: licenseId, days_remaining: daysRemaining },
      performed_by: 'system',
      timestamp: now.toISOString(),
    }).catch(() => {});
  }
}
