/**
 * Email system using Resend API.
 * Templates as TypeScript functions returning { subject, html, text }.
 * All sends are logged to email_log table for audit trail.
 */

import type { BillingEnv } from './types';

// ============================================
// Core send + logging
// ============================================

interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(
  to: string,
  template: EmailTemplate,
  env: BillingEnv
): Promise<void> {
  let resendId: string | undefined;
  let error: string | undefined;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Mnemom <billing@mnemom.ai>',
        to: [to],
        subject: template.subject,
        html: template.html,
        text: template.text,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      error = `Resend API error: ${response.status} - ${body}`;
      console.error(`[email] ${error}`);
    } else {
      const data = (await response.json()) as { id?: string };
      resendId = data.id;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error(`[email] Send failed: ${error}`);
  }

  // Log to email_log (best-effort, don't throw)
  await logEmail(to, template.subject, resendId, error, env);
}

async function logEmail(
  recipient: string,
  subject: string,
  resendId: string | undefined,
  error: string | undefined,
  env: BillingEnv
): Promise<void> {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'em-';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/email_log`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        id,
        email_type: subject, // Using subject as type for simplicity
        recipient,
        subject,
        resend_id: resendId ?? null,
        status: error ? 'failed' : 'sent',
        error: error ?? null,
      }),
    });
  } catch (err) {
    console.warn('[email] Failed to log email:', err);
  }
}

// ============================================
// Email templates
// ============================================

interface EmailData {
  email: string;
}

export function welcomeDeveloperEmail(data: EmailData): EmailTemplate {
  return {
    subject: 'Welcome to Mnemom Developer',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 16px;">
        <h1 style="color: #1a1a2e; font-size: 24px;">Welcome to Mnemom Developer</h1>
        <p style="color: #444; line-height: 1.6;">Your Developer plan is now active. Integrity checks are billed at $0.01 each, with no monthly minimum.</p>
        <p style="color: #444; line-height: 1.6;">Your first invoice will be generated at the end of your billing period based on actual usage.</p>
        <h2 style="color: #1a1a2e; font-size: 18px; margin-top: 24px;">What's included:</h2>
        <ul style="color: #444; line-height: 1.8;">
          <li>Managed integrity gateway</li>
          <li>Private trace storage (30-day retention)</li>
          <li>OpenTelemetry export</li>
          <li>Dashboard access</li>
        </ul>
        <p style="color: #444; line-height: 1.6;">Manage your subscription anytime from your <a href="https://mnemom.ai/settings/billing" style="color: #4f46e5;">billing settings</a>.</p>
        <p style="color: #888; font-size: 13px; margin-top: 32px;">Mnemom &mdash; Transparent AI Infrastructure</p>
      </div>
    `,
    text: `Welcome to Mnemom Developer

Your Developer plan is now active. Integrity checks are billed at $0.01 each, with no monthly minimum.

Your first invoice will be generated at the end of your billing period based on actual usage.

What's included:
- Managed integrity gateway
- Private trace storage (30-day retention)
- OpenTelemetry export
- Dashboard access

Manage your subscription anytime from your billing settings: https://mnemom.ai/settings/billing`,
  };
}

export function welcomeTeamTrialEmail(data: EmailData): EmailTemplate {
  return {
    subject: 'Your 14-day Mnemom Team trial starts now',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 16px;">
        <h1 style="color: #1a1a2e; font-size: 24px;">Your Team trial is active</h1>
        <p style="color: #444; line-height: 1.6;">You have 14 days to explore the full Mnemom Team plan, including 15,000 integrity checks per month, 90-day trace retention, and EU compliance exports.</p>
        <p style="color: #444; line-height: 1.6;">No charge until your trial ends. Add a payment method anytime to continue uninterrupted.</p>
        <h2 style="color: #1a1a2e; font-size: 18px; margin-top: 24px;">Team plan highlights:</h2>
        <ul style="color: #444; line-height: 1.8;">
          <li>15,000 included integrity checks/month</li>
          <li>$0.008/check for overages</li>
          <li>90-day trace retention</li>
          <li>EU compliance exports</li>
          <li>Pairwise coherence analysis</li>
        </ul>
        <p style="color: #444; line-height: 1.6;">Manage your subscription from <a href="https://mnemom.ai/settings/billing" style="color: #4f46e5;">billing settings</a>.</p>
        <p style="color: #888; font-size: 13px; margin-top: 32px;">Mnemom &mdash; Transparent AI Infrastructure</p>
      </div>
    `,
    text: `Your Team trial is active

You have 14 days to explore the full Mnemom Team plan, including 15,000 integrity checks per month, 90-day trace retention, and EU compliance exports.

No charge until your trial ends. Add a payment method anytime to continue uninterrupted.

Team plan highlights:
- 15,000 included integrity checks/month
- $0.008/check for overages
- 90-day trace retention
- EU compliance exports
- Pairwise coherence analysis

Manage your subscription from billing settings: https://mnemom.ai/settings/billing`,
  };
}

export function invoicePaidEmail(data: EmailData & { amountCents: number; invoiceUrl: string | null }): EmailTemplate {
  const amount = (data.amountCents / 100).toFixed(2);
  return {
    subject: `Mnemom receipt — $${amount}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 16px;">
        <h1 style="color: #1a1a2e; font-size: 24px;">Payment received</h1>
        <p style="color: #444; line-height: 1.6;">We've received your payment of <strong>$${amount}</strong>.</p>
        ${data.invoiceUrl ? `<p style="color: #444; line-height: 1.6;"><a href="${data.invoiceUrl}" style="color: #4f46e5;">View your invoice</a></p>` : ''}
        <p style="color: #888; font-size: 13px; margin-top: 32px;">Mnemom &mdash; Transparent AI Infrastructure</p>
      </div>
    `,
    text: `Payment received

We've received your payment of $${amount}.${data.invoiceUrl ? `\n\nView your invoice: ${data.invoiceUrl}` : ''}`,
  };
}

export function paymentFailedEmail(data: EmailData, attemptNumber: number): EmailTemplate {
  const urgency = attemptNumber >= 3 ? 'final' : attemptNumber === 2 ? 'second' : 'first';
  const warning = attemptNumber >= 3
    ? 'This is our final attempt. Your subscription will be canceled if payment is not resolved.'
    : 'We\'ll retry automatically, but please update your payment method to avoid interruption.';

  return {
    subject: `Action needed: Mnemom payment failed (${urgency} notice)`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 16px;">
        <h1 style="color: #dc2626; font-size: 24px;">Payment failed</h1>
        <p style="color: #444; line-height: 1.6;">We were unable to process your payment (attempt ${attemptNumber}).</p>
        <p style="color: #444; line-height: 1.6;">${warning}</p>
        <p style="color: #444; line-height: 1.6;"><a href="https://mnemom.ai/settings/billing" style="color: #4f46e5; font-weight: 600;">Update payment method</a></p>
        <p style="color: #888; font-size: 13px; margin-top: 32px;">Mnemom &mdash; Transparent AI Infrastructure</p>
      </div>
    `,
    text: `Payment failed

We were unable to process your payment (attempt ${attemptNumber}).

${warning}

Update payment method: https://mnemom.ai/settings/billing`,
  };
}

export function trialEndingEmail(data: EmailData & { trialEndDate?: string }): EmailTemplate {
  const dateStr = data.trialEndDate
    ? new Date(data.trialEndDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'in 3 days';

  return {
    subject: 'Your Mnemom Team trial ends soon',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 16px;">
        <h1 style="color: #1a1a2e; font-size: 24px;">Your trial ends ${dateStr}</h1>
        <p style="color: #444; line-height: 1.6;">Add a payment method to keep your Team plan active. Your agents, traces, and configuration will remain exactly as they are.</p>
        <p style="color: #444; line-height: 1.6;">Without a payment method, you'll be moved to the Free plan when the trial ends.</p>
        <p style="color: #444; line-height: 1.6;"><a href="https://mnemom.ai/settings/billing" style="color: #4f46e5; font-weight: 600;">Add payment method</a></p>
        <p style="color: #888; font-size: 13px; margin-top: 32px;">Mnemom &mdash; Transparent AI Infrastructure</p>
      </div>
    `,
    text: `Your trial ends ${dateStr}

Add a payment method to keep your Team plan active. Your agents, traces, and configuration will remain exactly as they are.

Without a payment method, you'll be moved to the Free plan when the trial ends.

Add payment method: https://mnemom.ai/settings/billing`,
  };
}

export function trialExpiredEmail(data: EmailData): EmailTemplate {
  return {
    subject: 'Your Mnemom trial has ended — your data is safe',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 16px;">
        <h1 style="color: #1a1a2e; font-size: 24px;">Your trial has ended</h1>
        <p style="color: #444; line-height: 1.6;">Your account has been moved to the Free plan. <strong>Your agents, traces, alignment cards, and all configuration are fully preserved.</strong></p>
        <p style="color: #444; line-height: 1.6;">Add a payment method anytime to restore your Team plan — you'll pick up right where you left off, with zero data loss.</p>
        <p style="color: #444; line-height: 1.6;"><a href="https://mnemom.ai/settings/billing" style="color: #4f46e5; font-weight: 600;">Resubscribe now</a></p>
        <p style="color: #888; font-size: 13px; margin-top: 32px;">Mnemom &mdash; Transparent AI Infrastructure</p>
      </div>
    `,
    text: `Your trial has ended

Your account has been moved to the Free plan. Your agents, traces, alignment cards, and all configuration are fully preserved.

Add a payment method anytime to restore your Team plan — you'll pick up right where you left off, with zero data loss.

Resubscribe now: https://mnemom.ai/settings/billing`,
  };
}

export function subscriptionCanceledEmail(data: EmailData): EmailTemplate {
  return {
    subject: 'Your Mnemom subscription has ended',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 16px;">
        <h1 style="color: #1a1a2e; font-size: 24px;">Subscription ended</h1>
        <p style="color: #444; line-height: 1.6;">Your Mnemom subscription has been canceled. Your account is now on the Free plan.</p>
        <p style="color: #444; line-height: 1.6;"><strong>Your data is safe.</strong> All agents, traces, and configuration are preserved. You can resubscribe anytime to restore full access.</p>
        <p style="color: #444; line-height: 1.6;"><a href="https://mnemom.ai/settings/billing" style="color: #4f46e5; font-weight: 600;">Resubscribe</a></p>
        <p style="color: #888; font-size: 13px; margin-top: 32px;">Mnemom &mdash; Transparent AI Infrastructure</p>
      </div>
    `,
    text: `Subscription ended

Your Mnemom subscription has been canceled. Your account is now on the Free plan.

Your data is safe. All agents, traces, and configuration are preserved. You can resubscribe anytime to restore full access.

Resubscribe: https://mnemom.ai/settings/billing`,
  };
}
