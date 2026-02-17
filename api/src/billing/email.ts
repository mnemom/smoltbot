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
        headers: {
          'List-Unsubscribe': '<https://mnemom.ai/settings/notifications>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
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
// Shared layout
// ============================================

function emailLayout(body: string): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Mnemom</title>
</head>
<body style="margin:0;padding:0;background-color:#F9F8F3;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F9F8F3;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;">
          <tr>
            <td style="padding:32px 32px 0 32px;">
              <a href="https://mnemom.ai" style="text-decoration:none;">
                <img src="https://www.mnemom.ai/images/mnemom_hero.png" alt="Mnemom" width="40" height="37" style="display:block;border:0;outline:none;">
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 32px 32px;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;color:#0F172A;line-height:1.6;">
              ${body}
            </td>
          </tr>
        </table>
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <tr>
            <td style="padding:16px 32px;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#999;text-align:center;line-height:1.5;">
              Mnemom, Inc. &middot; Transparent AI Infrastructure<br>
              <a href="https://mnemom.ai/settings/notifications" style="color:#999;">Email preferences</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ============================================
// Email templates
// ============================================

interface EmailData {
  email: string;
}

export function emailVerificationEmail(data: { verifyUrl: string }): EmailTemplate {
  return {
    subject: 'Verify your Mnemom email address',
    html: emailLayout(`
      <h1 style="margin:0 0 16px 0;font-size:22px;color:#0F172A;">Verify your email</h1>
      <p style="margin:0 0 16px 0;">Confirm your email address to finish setting up your Mnemom account.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="${data.verifyUrl}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Verify email address</a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 8px 0;font-size:13px;color:#888;">If the button doesn't work, copy and paste this link into your browser:</p>
      <p style="margin:0 0 16px 0;font-size:13px;color:#888;word-break:break-all;">${data.verifyUrl}</p>
      <p style="margin:0;font-size:13px;color:#888;">This link expires in 24 hours. If you didn't create a Mnemom account, ignore this email.</p>
    `),
    text: `Verify your email

Confirm your email address to finish setting up your Mnemom account.

Verify here: ${data.verifyUrl}

This link expires in 24 hours. If you didn't create a Mnemom account, ignore this email.`,
  };
}

export function welcomeDeveloperEmail(data: EmailData): EmailTemplate {
  return {
    subject: 'Welcome to Mnemom Developer',
    html: emailLayout(`
      <h1 style="margin:0 0 16px 0;font-size:22px;color:#0F172A;">Welcome to Mnemom Developer</h1>
      <p style="margin:0 0 12px 0;">Your Developer plan is now active. Integrity checks are billed at $0.01 each, with no monthly minimum.</p>
      <p style="margin:0 0 20px 0;">Your first invoice will be generated at the end of your billing period based on actual usage.</p>
      <h2 style="margin:0 0 12px 0;font-size:17px;color:#0F172A;">What's included</h2>
      <ul style="margin:0 0 20px 0;padding-left:20px;line-height:1.8;">
        <li>Managed integrity gateway</li>
        <li>Private trace storage (30-day retention)</li>
        <li>OpenTelemetry export</li>
        <li>Dashboard access</li>
      </ul>
      <p style="margin:0;">Manage your subscription anytime from your <a href="https://mnemom.ai/settings/billing" style="color:#D97706;">billing settings</a>.</p>
    `),
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
    html: emailLayout(`
      <h1 style="margin:0 0 16px 0;font-size:22px;color:#0F172A;">Your Team trial is active</h1>
      <p style="margin:0 0 12px 0;">You have 14 days to explore the full Mnemom Team plan, including 15,000 integrity checks per month, 90-day trace retention, and EU compliance exports.</p>
      <p style="margin:0 0 20px 0;">No charge until your trial ends. Add a payment method anytime to continue uninterrupted.</p>
      <h2 style="margin:0 0 12px 0;font-size:17px;color:#0F172A;">Team plan highlights</h2>
      <ul style="margin:0 0 20px 0;padding-left:20px;line-height:1.8;">
        <li>15,000 included integrity checks/month</li>
        <li>$0.008/check for overages</li>
        <li>90-day trace retention</li>
        <li>EU compliance exports</li>
        <li>Pairwise coherence analysis</li>
      </ul>
      <p style="margin:0;">Manage your subscription from <a href="https://mnemom.ai/settings/billing" style="color:#D97706;">billing settings</a>.</p>
    `),
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
    html: emailLayout(`
      <h1 style="margin:0 0 16px 0;font-size:22px;color:#0F172A;">Payment received</h1>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background:#F9F8F3;border-radius:8px;">
        <tr>
          <td style="padding:20px 24px;">
            <p style="margin:0 0 4px 0;font-size:13px;color:#888;">Amount paid</p>
            <p style="margin:0;font-size:28px;font-weight:700;color:#0F172A;">$${amount}</p>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 16px 0;">Thanks for your payment. No action is needed on your end.</p>
      ${data.invoiceUrl ? `<p style="margin:0;"><a href="${data.invoiceUrl}" style="color:#D97706;font-weight:600;">View invoice details</a></p>` : ''}
    `),
    text: `Payment received

Amount paid: $${amount}

Thanks for your payment. No action is needed on your end.${data.invoiceUrl ? `\n\nView invoice details: ${data.invoiceUrl}` : ''}`,
  };
}

export function paymentFailedEmail(data: EmailData, attemptNumber: number): EmailTemplate {
  const urgency = attemptNumber >= 3 ? 'final' : attemptNumber === 2 ? 'second' : 'first';
  const warning = attemptNumber >= 3
    ? 'This is our final attempt. Your subscription will be canceled if payment is not resolved.'
    : 'We\'ll retry automatically, but please update your payment method to avoid interruption.';

  return {
    subject: `Action needed: Mnemom payment failed (${urgency} notice)`,
    html: emailLayout(`
      <h1 style="margin:0 0 16px 0;font-size:22px;color:#dc2626;">Payment failed</h1>
      <p style="margin:0 0 12px 0;">We were unable to process your payment (attempt ${attemptNumber}).</p>
      <p style="margin:0 0 20px 0;">${warning}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="https://mnemom.ai/settings/billing" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Update payment method</a>
          </td>
        </tr>
      </table>
    `),
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
    html: emailLayout(`
      <h1 style="margin:0 0 16px 0;font-size:22px;color:#0F172A;">Your trial ends ${dateStr}</h1>
      <p style="margin:0 0 12px 0;">Add a payment method to keep your Team plan active. Your agents, traces, and configuration will remain exactly as they are.</p>
      <p style="margin:0 0 20px 0;">Without a payment method, you'll be moved to the Free plan when the trial ends.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="https://mnemom.ai/settings/billing" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Add payment method</a>
          </td>
        </tr>
      </table>
    `),
    text: `Your trial ends ${dateStr}

Add a payment method to keep your Team plan active. Your agents, traces, and configuration will remain exactly as they are.

Without a payment method, you'll be moved to the Free plan when the trial ends.

Add payment method: https://mnemom.ai/settings/billing`,
  };
}

export function trialExpiredEmail(data: EmailData): EmailTemplate {
  return {
    subject: 'Your Mnemom trial has ended — your data is safe',
    html: emailLayout(`
      <h1 style="margin:0 0 16px 0;font-size:22px;color:#0F172A;">Your trial has ended</h1>
      <p style="margin:0 0 12px 0;">Your account has been moved to the Free plan. <strong>Your agents, traces, alignment cards, and all configuration are fully preserved.</strong></p>
      <p style="margin:0 0 20px 0;">Add a payment method anytime to restore your Team plan — you'll pick up right where you left off, with zero data loss.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="https://mnemom.ai/settings/billing" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Resubscribe now</a>
          </td>
        </tr>
      </table>
    `),
    text: `Your trial has ended

Your account has been moved to the Free plan. Your agents, traces, alignment cards, and all configuration are fully preserved.

Add a payment method anytime to restore your Team plan — you'll pick up right where you left off, with zero data loss.

Resubscribe now: https://mnemom.ai/settings/billing`,
  };
}

export function subscriptionCanceledEmail(data: EmailData): EmailTemplate {
  return {
    subject: 'Your Mnemom subscription has ended',
    html: emailLayout(`
      <h1 style="margin:0 0 16px 0;font-size:22px;color:#0F172A;">Subscription ended</h1>
      <p style="margin:0 0 12px 0;">Your Mnemom subscription has been canceled. Your account is now on the Free plan.</p>
      <p style="margin:0 0 20px 0;"><strong>Your data is safe.</strong> All agents, traces, and configuration are preserved. You can resubscribe anytime to restore full access.</p>
      <p style="margin:0;"><a href="https://mnemom.ai/settings/billing" style="color:#D97706;font-weight:600;">Resubscribe</a></p>
    `),
    text: `Subscription ended

Your Mnemom subscription has been canceled. Your account is now on the Free plan.

Your data is safe. All agents, traces, and configuration are preserved. You can resubscribe anytime to restore full access.

Resubscribe: https://mnemom.ai/settings/billing`,
  };
}

export function planUpgradeEmail(data: EmailData & { newPlan: string; proratedCharge?: string; features: string[] }): EmailTemplate {
  const featureList = data.features.map(f => `<li>${f}</li>`).join('');
  const featureListText = data.features.map(f => `- ${f}`).join('\n');
  return {
    subject: `You've upgraded to Mnemom ${data.newPlan}`,
    html: emailLayout(`
      <h1 style="margin:0 0 16px 0;font-size:22px;color:#0F172A;">Welcome to ${data.newPlan}</h1>
      <p style="margin:0 0 20px 0;">Your upgrade is now active.${data.proratedCharge ? ` A prorated charge of <strong>${data.proratedCharge}</strong> has been applied to your account.` : ''}</p>
      <h2 style="margin:0 0 12px 0;font-size:17px;color:#0F172A;">New features unlocked</h2>
      <ul style="margin:0 0 20px 0;padding-left:20px;line-height:1.8;">${featureList}</ul>
      <p style="margin:0;">Manage your subscription from <a href="https://mnemom.ai/settings/billing" style="color:#D97706;">billing settings</a>.</p>
    `),
    text: `Welcome to ${data.newPlan}

Your upgrade is now active.${data.proratedCharge ? ` A prorated charge of ${data.proratedCharge} has been applied.` : ''}

New features unlocked:
${featureListText}

Manage your subscription: https://mnemom.ai/settings/billing`,
  };
}

export function planDowngradeScheduledEmail(data: EmailData & { currentPlan: string; newPlan: string; effectiveDate: string; losingFeatures: string[] }): EmailTemplate {
  const dateStr = new Date(data.effectiveDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const featureList = data.losingFeatures.map(f => `<li>${f}</li>`).join('');
  const featureListText = data.losingFeatures.map(f => `- ${f}`).join('\n');
  return {
    subject: 'Mnemom plan change scheduled',
    html: emailLayout(`
      <h1 style="margin:0 0 16px 0;font-size:22px;color:#0F172A;">Downgrade scheduled</h1>
      <p style="margin:0 0 12px 0;">Your plan will change from <strong>${data.currentPlan}</strong> to <strong>${data.newPlan}</strong> on <strong>${dateStr}</strong>.</p>
      <p style="margin:0 0 20px 0;">You'll continue to have full ${data.currentPlan} access until then.</p>
      <h2 style="margin:0 0 12px 0;font-size:17px;color:#0F172A;">Features you'll lose</h2>
      <ul style="margin:0 0 20px 0;padding-left:20px;line-height:1.8;">${featureList}</ul>
      <p style="margin:0;">Changed your mind? <a href="https://mnemom.ai/settings/billing" style="color:#D97706;">Cancel the downgrade</a> anytime before ${dateStr}.</p>
    `),
    text: `Downgrade scheduled

Your plan will change from ${data.currentPlan} to ${data.newPlan} on ${dateStr}.

You'll continue to have full ${data.currentPlan} access until then.

Features you'll lose:
${featureListText}

Cancel the downgrade anytime: https://mnemom.ai/settings/billing`,
  };
}

export function usageWarningEmail(data: EmailData & { usagePercent: number; checksUsed: number; checksIncluded: number; planName: string }): EmailTemplate {
  return {
    subject: `Mnemom usage alert — ${data.usagePercent}% of included checks used`,
    html: emailLayout(`
      <h1 style="margin:0 0 16px 0;font-size:22px;color:#d97706;">Usage alert</h1>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;background:#F9F8F3;border-radius:8px;">
        <tr>
          <td style="padding:20px 24px;">
            <p style="margin:0 0 4px 0;font-size:13px;color:#888;">Integrity checks used</p>
            <p style="margin:0;font-size:22px;font-weight:700;color:#0F172A;">${data.checksUsed.toLocaleString()} <span style="font-size:15px;font-weight:400;color:#888;">/ ${data.checksIncluded.toLocaleString()}</span></p>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 20px 0;">Once you exceed your included checks, overage billing will begin automatically.</p>
      <p style="margin:0;"><a href="https://mnemom.ai/settings/billing" style="color:#D97706;font-weight:600;">View usage details</a> &nbsp;&middot;&nbsp; <a href="https://mnemom.ai/pricing" style="color:#D97706;font-weight:600;">Upgrade plan</a></p>
    `),
    text: `Usage alert

You've used ${data.checksUsed.toLocaleString()} of your ${data.checksIncluded.toLocaleString()} included integrity checks this period (${data.usagePercent}%).

Once you exceed your included checks, overage billing will begin automatically.

View usage details: https://mnemom.ai/settings/billing
Upgrade plan: https://mnemom.ai/pricing`,
  };
}

export function usageLimitReachedEmail(data: EmailData & { checksUsed: number; checksIncluded: number; perCheckPrice: number }): EmailTemplate {
  const overagePrice = `$${data.perCheckPrice.toFixed(3)}`;
  return {
    subject: 'Mnemom — included checks exhausted, overage billing active',
    html: emailLayout(`
      <h1 style="margin:0 0 16px 0;font-size:22px;color:#dc2626;">Included checks exhausted</h1>
      <p style="margin:0 0 12px 0;">You've used all <strong>${data.checksIncluded.toLocaleString()}</strong> included integrity checks this period.</p>
      <p style="margin:0 0 20px 0;">Additional checks will be billed at <strong>${overagePrice}/check</strong>. Your service is uninterrupted.</p>
      <p style="margin:0;"><a href="https://mnemom.ai/pricing" style="color:#D97706;font-weight:600;">Upgrade for more included checks</a></p>
    `),
    text: `Included checks exhausted

You've used all ${data.checksIncluded.toLocaleString()} included integrity checks this period.

Additional checks will be billed at ${overagePrice}/check. Your service is uninterrupted.

Upgrade for more included checks: https://mnemom.ai/pricing`,
  };
}

export function budgetAlertEmail(data: EmailData & { currentCostCents: number; budgetCents: number }): EmailTemplate {
  const current = `$${(data.currentCostCents / 100).toFixed(2)}`;
  const budget = `$${(data.budgetCents / 100).toFixed(2)}`;
  return {
    subject: `Mnemom budget alert — spending at ${current}`,
    html: emailLayout(`
      <h1 style="margin:0 0 16px 0;font-size:22px;color:#dc2626;">Budget threshold reached</h1>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;background:#F9F8F3;border-radius:8px;">
        <tr>
          <td style="padding:20px 24px;">
            <p style="margin:0 0 4px 0;font-size:13px;color:#888;">Current spend / Budget</p>
            <p style="margin:0;font-size:22px;font-weight:700;color:#0F172A;">${current} <span style="font-size:15px;font-weight:400;color:#888;">/ ${budget}</span></p>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 20px 0;">This is an alert only — your service is uninterrupted. You can adjust your budget threshold or upgrade your plan to include more checks.</p>
      <p style="margin:0;"><a href="https://mnemom.ai/settings/billing" style="color:#D97706;font-weight:600;">Review spending</a></p>
    `),
    text: `Budget threshold reached

Your current period spending has reached ${current}, which exceeds your budget alert threshold of ${budget}.

This is an alert only — your service is uninterrupted. You can adjust your budget threshold or upgrade your plan.

Review spending: https://mnemom.ai/settings/billing`,
  };
}

export function trialProgressEmail(data: EmailData & { checksUsed: number; agentsLinked: number; daysUsed: number }): EmailTemplate {
  return {
    subject: 'Your Mnemom trial — day 3 check-in',
    html: emailLayout(`
      <h1 style="margin:0 0 16px 0;font-size:22px;color:#0F172A;">How's your trial going?</h1>
      <p style="margin:0 0 16px 0;">You're ${data.daysUsed} days into your Mnemom Team trial. Here's your progress:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;background:#F9F8F3;border-radius:8px;">
        <tr>
          <td style="padding:20px 24px;">
            <p style="margin:0 0 8px 0;"><strong>${data.checksUsed.toLocaleString()}</strong> integrity checks performed</p>
            <p style="margin:0;"><strong>${data.agentsLinked}</strong> agent${data.agentsLinked === 1 ? '' : 's'} linked</p>
          </td>
        </tr>
      </table>
      ${data.checksUsed === 0 ? '<p style="margin:0 0 20px 0;">Need help getting started? Point your agent at the gateway and integrity checks happen automatically.</p>' : '<p style="margin:0 0 20px 0;">Great progress! Your agents are building integrity history that you can review anytime.</p>'}
      <p style="margin:0;"><a href="https://mnemom.ai/settings/billing" style="color:#D97706;font-weight:600;">View your dashboard</a></p>
    `),
    text: `How's your trial going?

You're ${data.daysUsed} days into your Mnemom Team trial. Here's your progress:

- ${data.checksUsed.toLocaleString()} integrity checks performed
- ${data.agentsLinked} agent${data.agentsLinked === 1 ? '' : 's'} linked

${data.checksUsed === 0 ? 'Need help getting started? Point your agent at the gateway and integrity checks happen automatically.' : 'Great progress! Your agents are building integrity history that you can review anytime.'}

View your dashboard: https://mnemom.ai/settings/billing`,
  };
}

export function orgInviteEmail(data: { inviterName: string; orgName: string; acceptUrl: string }): EmailTemplate {
  return {
    subject: `${data.inviterName} invited you to join ${data.orgName} on Mnemom`,
    html: emailLayout(`
      <h1 style="margin:0 0 16px 0;font-size:22px;color:#0F172A;">You've been invited to ${data.orgName}</h1>
      <p style="margin:0 0 12px 0;"><strong>${data.inviterName}</strong> has invited you to join <strong>${data.orgName}</strong> on Mnemom.</p>
      <p style="margin:0 0 20px 0;">Click the button below to accept the invitation and join the organization.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="${data.acceptUrl}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Accept Invitation</a>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;color:#888;">This invitation will expire in 7 days. If you did not expect this invitation, you can safely ignore this email.</p>
    `),
    text: `You've been invited to ${data.orgName}

${data.inviterName} has invited you to join ${data.orgName} on Mnemom.

Accept the invitation by visiting the link below:
${data.acceptUrl}

This invitation will expire in 7 days. If you did not expect this invitation, you can safely ignore this email.`,
  };
}

export function accountSuspendedEmail(data: { reason: string }): EmailTemplate {
  return {
    subject: 'Your Mnemom account has been suspended',
    html: emailLayout(`
      <div style="background:#dc2626;padding:16px 24px;border-radius:8px 8px 0 0;margin:-24px -32px 24px -32px;">
        <h1 style="margin:0;font-size:22px;color:#ffffff;">Account Suspended</h1>
      </div>
      <p style="margin:0 0 12px 0;">Your Mnemom account has been suspended by an administrator.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;background:#FEF2F2;border-radius:8px;border:1px solid #FECACA;">
        <tr>
          <td style="padding:16px 20px;">
            <p style="margin:0 0 4px 0;font-size:13px;color:#991B1B;font-weight:600;">Reason</p>
            <p style="margin:0;color:#991B1B;">${data.reason}</p>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 12px 0;">While your account is suspended, all gateway API requests will be blocked. Your data remains intact and will be accessible once the suspension is lifted.</p>
      <p style="margin:0 0 20px 0;">If you believe this is an error, please contact our support team.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="mailto:support@mnemom.ai" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Contact Support</a>
          </td>
        </tr>
      </table>
    `),
    text: `Account Suspended

Your Mnemom account has been suspended by an administrator.

Reason: ${data.reason}

While your account is suspended, all gateway API requests will be blocked. Your data remains intact and will be accessible once the suspension is lifted.

If you believe this is an error, please contact support: support@mnemom.ai`,
  };
}

export function orgRoleChangeEmail(data: { orgName: string; oldRole: string; newRole: string }): EmailTemplate {
  return {
    subject: `Your role in ${data.orgName} has been updated`,
    html: emailLayout(`
      <h1 style="margin:0 0 16px 0;font-size:22px;color:#0F172A;">Role updated in ${data.orgName}</h1>
      <p style="margin:0 0 12px 0;">Your role in <strong>${data.orgName}</strong> has been changed from <strong>${data.oldRole}</strong> to <strong>${data.newRole}</strong>.</p>
      <p style="margin:0;">This change is effective immediately. If you have any questions, please contact your organization administrator.</p>
    `),
    text: `Role updated in ${data.orgName}

Your role in ${data.orgName} has been changed from ${data.oldRole} to ${data.newRole}.

This change is effective immediately. If you have any questions, please contact your organization administrator.`,
  };
}

// ============================================
// Phase 7: License Email Templates
// ============================================

export function licenseCreatedEmail(data: { companyName: string; licenseId: string; expiresAt: string; features: string[] }): EmailTemplate {
  const featureList = data.features.map((f) => `<li style="margin:0 0 4px 0;">${f}</li>`).join('');
  return {
    subject: 'Your Mnemom Enterprise license is ready',
    html: emailLayout(`
      <h1 style="margin:0 0 16px 0;font-size:22px;color:#0F172A;">Your Enterprise license is ready</h1>
      <p style="margin:0 0 12px 0;">A new Mnemom Enterprise license has been created for <strong>${data.companyName}</strong>.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;background:#F9F8F3;border-radius:8px;border:1px solid #E5E7EB;">
        <tr>
          <td style="padding:16px 20px;">
            <p style="margin:0 0 4px 0;font-size:13px;color:#6B7280;font-weight:600;">License ID</p>
            <p style="margin:0 0 12px 0;font-family:monospace;color:#0F172A;">${data.licenseId}</p>
            <p style="margin:0 0 4px 0;font-size:13px;color:#6B7280;font-weight:600;">Expires</p>
            <p style="margin:0;color:#0F172A;">${data.expiresAt}</p>
          </td>
        </tr>
      </table>
      ${data.features.length > 0 ? `<p style="margin:0 0 8px 0;font-weight:600;">Enabled features:</p><ul style="margin:0 0 16px 0;padding-left:20px;">${featureList}</ul>` : ''}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="https://docs.mnemom.ai/enterprise/setup" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Setup Guide</a>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;color:#888;">The license JWT was included in the API response. It will not be sent via email for security.</p>
    `),
    text: `Your Enterprise license is ready

A new Mnemom Enterprise license has been created for ${data.companyName}.

License ID: ${data.licenseId}
Expires: ${data.expiresAt}
${data.features.length > 0 ? `\nEnabled features:\n${data.features.map((f) => `- ${f}`).join('\n')}` : ''}

Setup guide: https://docs.mnemom.ai/enterprise/setup

The license JWT was included in the API response. It will not be sent via email for security.`,
  };
}

export function licenseExpiringEmail(data: { companyName: string; licenseId: string; expiresAt: string; daysRemaining: number }): EmailTemplate {
  return {
    subject: `Your Mnemom license expires in ${data.daysRemaining} days`,
    html: emailLayout(`
      <div style="background:#D97706;padding:16px 24px;border-radius:8px 8px 0 0;margin:-24px -32px 24px -32px;">
        <h1 style="margin:0;font-size:22px;color:#ffffff;">License Expiring Soon</h1>
      </div>
      <p style="margin:0 0 12px 0;">Your Mnemom Enterprise license for <strong>${data.companyName}</strong> expires in <strong>${data.daysRemaining} days</strong>.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;background:#F9F8F3;border-radius:8px;border:1px solid #E5E7EB;">
        <tr>
          <td style="padding:16px 20px;">
            <p style="margin:0 0 4px 0;font-size:13px;color:#6B7280;font-weight:600;">License ID</p>
            <p style="margin:0 0 12px 0;font-family:monospace;color:#0F172A;">${data.licenseId}</p>
            <p style="margin:0 0 4px 0;font-size:13px;color:#6B7280;font-weight:600;">Expiry Date</p>
            <p style="margin:0;color:#0F172A;">${data.expiresAt}</p>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 20px 0;">Please contact your account manager to renew your license before it expires.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="mailto:enterprise@mnemom.ai" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Contact for Renewal</a>
          </td>
        </tr>
      </table>
    `),
    text: `License Expiring Soon

Your Mnemom Enterprise license for ${data.companyName} expires in ${data.daysRemaining} days.

License ID: ${data.licenseId}
Expiry Date: ${data.expiresAt}

Please contact your account manager to renew your license before it expires.

Contact: enterprise@mnemom.ai`,
  };
}

export function licenseExpiredEmail(data: { companyName: string; licenseId: string }): EmailTemplate {
  return {
    subject: 'Your Mnemom Enterprise license has expired',
    html: emailLayout(`
      <div style="background:#dc2626;padding:16px 24px;border-radius:8px 8px 0 0;margin:-24px -32px 24px -32px;">
        <h1 style="margin:0;font-size:22px;color:#ffffff;">License Expired</h1>
      </div>
      <p style="margin:0 0 12px 0;">Your Mnemom Enterprise license for <strong>${data.companyName}</strong> has expired.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;background:#FEF2F2;border-radius:8px;border:1px solid #FECACA;">
        <tr>
          <td style="padding:16px 20px;">
            <p style="margin:0 0 4px 0;font-size:13px;color:#991B1B;font-weight:600;">License ID</p>
            <p style="margin:0;font-family:monospace;color:#991B1B;">${data.licenseId}</p>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 12px 0;">Your self-hosted gateway will continue to operate in a 7-day grace period. After this period, integrity checking will be disabled until the license is renewed.</p>
      <p style="margin:0 0 20px 0;">Please contact us to renew your license immediately.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="mailto:enterprise@mnemom.ai" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Renew License</a>
          </td>
        </tr>
      </table>
    `),
    text: `License Expired

Your Mnemom Enterprise license for ${data.companyName} has expired.

License ID: ${data.licenseId}

Your self-hosted gateway will continue to operate in a 7-day grace period. After this period, integrity checking will be disabled until the license is renewed.

Please contact us to renew your license immediately: enterprise@mnemom.ai`,
  };
}

export function licenseRevokedEmail(data: { companyName: string; licenseId: string; reason: string }): EmailTemplate {
  return {
    subject: 'Your Mnemom Enterprise license has been revoked',
    html: emailLayout(`
      <div style="background:#dc2626;padding:16px 24px;border-radius:8px 8px 0 0;margin:-24px -32px 24px -32px;">
        <h1 style="margin:0;font-size:22px;color:#ffffff;">License Revoked</h1>
      </div>
      <p style="margin:0 0 12px 0;">Your Mnemom Enterprise license for <strong>${data.companyName}</strong> has been revoked.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;background:#FEF2F2;border-radius:8px;border:1px solid #FECACA;">
        <tr>
          <td style="padding:16px 20px;">
            <p style="margin:0 0 4px 0;font-size:13px;color:#991B1B;font-weight:600;">Reason</p>
            <p style="margin:0;color:#991B1B;">${data.reason}</p>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 12px 0;">Self-hosted gateways using this license will no longer be able to validate. Your data remains intact.</p>
      <p style="margin:0 0 20px 0;">If you believe this is an error, please contact our support team.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="mailto:support@mnemom.ai" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Contact Support</a>
          </td>
        </tr>
      </table>
    `),
    text: `License Revoked

Your Mnemom Enterprise license for ${data.companyName} has been revoked.

Reason: ${data.reason}

Self-hosted gateways using this license will no longer be able to validate. Your data remains intact.

If you believe this is an error, please contact support: support@mnemom.ai`,
  };
}
