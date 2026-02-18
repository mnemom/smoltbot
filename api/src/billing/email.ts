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

export function ssoEnabledEmail(data: { orgName: string; idpName: string; domains: string[] }): EmailTemplate {
  const domainList = data.domains.join(', ');
  return {
    subject: `SSO has been enabled for ${data.orgName}`,
    html: emailLayout(`
      <h1 style="margin:0 0 16px 0;font-size:22px;color:#0F172A;">SSO Enabled for ${data.orgName}</h1>
      <p style="margin:0 0 12px 0;">Single Sign-On via <strong>${data.idpName}</strong> has been enabled for <strong>${data.orgName}</strong>.</p>
      <p style="margin:0 0 12px 0;">Members with email addresses matching the following domains will authenticate via SSO:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;background:#F0FDF4;border-radius:8px;border:1px solid #BBF7D0;">
        <tr>
          <td style="padding:16px 20px;">
            <p style="margin:0;font-weight:600;color:#166534;">${domainList}</p>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;color:#888;">If you did not configure this change, please contact your organization administrator immediately.</p>
    `),
    text: `SSO Enabled for ${data.orgName}

Single Sign-On via ${data.idpName} has been enabled for ${data.orgName}.

Members with email addresses matching the following domains will authenticate via SSO: ${domainList}

If you did not configure this change, please contact your organization administrator immediately.`,
  };
}

// ============================================
// Sequence email sender (Alex from Mnemom)
// ============================================

export async function sendSequenceEmail(
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
        from: 'Alex from Mnemom <alex@mnemom.ai>',
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

  await logEmail(to, template.subject, resendId, error, env);
}

// ============================================
// Sequence email templates
// ============================================

// --- Developer onboarding (4 emails, Day 1/3/7/14) ---

export function devOnboardingDay1Email(): EmailTemplate {
  return {
    subject: 'Connect your first agent to Mnemom',
    html: emailLayout(`
      <p style="margin:0 0 16px 0;">The fastest way to start: point your agent at the Mnemom gateway and run a check.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;background:#F9F8F3;border-radius:8px;">
        <tr>
          <td style="padding:16px 20px;">
<pre style="margin:0;font-size:13px;line-height:1.5;font-family:'SF Mono',Menlo,monospace;white-space:pre-wrap;"><code># Python
import mnemom
client = mnemom.Client(api_key="mk_...")
result = client.check(agent_id="your-agent")</code></pre>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 16px 0;">When the first check runs, Mnemom analyzes coherence, boundary adherence, and instruction fidelity. Results appear in your dashboard within seconds.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="https://docs.mnemom.ai/quickstart" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">View the quickstart guide</a>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0 0;font-size:13px;color:#888;">Alex</p>
    `),
    text: `The fastest way to start: point your agent at the Mnemom gateway and run a check.

# Python
import mnemom
client = mnemom.Client(api_key="mk_...")
result = client.check(agent_id="your-agent")

When the first check runs, Mnemom analyzes coherence, boundary adherence, and instruction fidelity. Results appear in your dashboard within seconds.

View the quickstart guide: https://docs.mnemom.ai/quickstart

Alex`,
  };
}

export function devOnboardingDay3Email(): EmailTemplate {
  return {
    subject: 'What your first integrity report tells you',
    html: emailLayout(`
      <p style="margin:0 0 16px 0;">Every integrity check produces a report with three dimensions:</p>
      <ul style="margin:0 0 16px 0;padding-left:20px;line-height:1.8;">
        <li><strong>Coherence</strong> — Is the agent's output internally consistent and aligned with its stated purpose?</li>
        <li><strong>Boundary adherence</strong> — Does the agent stay within its defined operational limits?</li>
        <li><strong>Instruction fidelity</strong> — Does the agent follow its system prompt and configured behavior?</li>
      </ul>
      <p style="margin:0 0 16px 0;">Green signals mean the agent is operating as expected. Yellow flags indicate drift worth investigating. Red signals mean something needs attention now.</p>
      <p style="margin:0 0 16px 0;">Start with red signals, then work through yellows. Most issues resolve by adjusting the agent's system prompt or tightening boundary definitions.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="https://mnemom.ai/dashboard" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Open your dashboard</a>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0 0;font-size:13px;color:#888;">Alex</p>
    `),
    text: `Every integrity check produces a report with three dimensions:

- Coherence — Is the agent's output internally consistent and aligned with its stated purpose?
- Boundary adherence — Does the agent stay within its defined operational limits?
- Instruction fidelity — Does the agent follow its system prompt and configured behavior?

Green signals mean the agent is operating as expected. Yellow flags indicate drift worth investigating. Red signals mean something needs attention now.

Start with red signals, then work through yellows. Most issues resolve by adjusting the agent's system prompt or tightening boundary definitions.

Open your dashboard: https://mnemom.ai/dashboard

Alex`,
  };
}

export function devOnboardingDay7Email(): EmailTemplate {
  return {
    subject: 'Monitoring multiple agents with check groups',
    html: emailLayout(`
      <p style="margin:0 0 16px 0;">If you're running more than one agent, check groups let you monitor them as a fleet.</p>
      <p style="margin:0 0 16px 0;">Add a <code style="background:#F9F8F3;padding:2px 6px;border-radius:4px;font-size:13px;">check_group</code> to your integrity checks and Mnemom will track coherence across agents in the same group:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;background:#F9F8F3;border-radius:8px;">
        <tr>
          <td style="padding:16px 20px;">
<pre style="margin:0;font-size:13px;line-height:1.5;font-family:'SF Mono',Menlo,monospace;white-space:pre-wrap;"><code>result = client.check(
  agent_id="support-agent-eu",
  metadata={"check_group": "support-fleet"}
)</code></pre>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 16px 0;">Pairwise coherence analysis compares each agent's behavior against the others in its group. This catches semantic drift — when agents in the same role start giving inconsistent answers — before it reaches users.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="https://docs.mnemom.ai/guides/fleet-monitoring" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Read the fleet monitoring guide</a>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0 0;font-size:13px;color:#888;">Alex</p>
    `),
    text: `If you're running more than one agent, check groups let you monitor them as a fleet.

Add a check_group to your integrity checks and Mnemom will track coherence across agents in the same group:

result = client.check(
  agent_id="support-agent-eu",
  metadata={"check_group": "support-fleet"}
)

Pairwise coherence analysis compares each agent's behavior against the others in its group. This catches semantic drift — when agents in the same role start giving inconsistent answers — before it reaches users.

Read the fleet monitoring guide: https://docs.mnemom.ai/guides/fleet-monitoring

Alex`,
  };
}

export function devOnboardingDay14Email(data: { checksUsed: number; agentsLinked: number }): EmailTemplate {
  return {
    subject: 'Your first two weeks on Mnemom',
    html: emailLayout(`
      <p style="margin:0 0 16px 0;">Two weeks in. Here's where things stand:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;background:#F9F8F3;border-radius:8px;">
        <tr>
          <td style="padding:20px 24px;">
            <p style="margin:0 0 8px 0;"><strong>${data.checksUsed.toLocaleString()}</strong> integrity checks run</p>
            <p style="margin:0;"><strong>${data.agentsLinked}</strong> agent${data.agentsLinked === 1 ? '' : 's'} connected</p>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 16px 0;">Your Developer plan bills at $0.01 per check with no monthly minimum. If you're running checks at scale, the Team plan includes 15,000 checks per month, 90-day trace retention, compliance exports, and role-based access control.</p>
      <p style="margin:0 0 16px 0;">Whether you stay on Developer or move to Team depends on volume and whether you need audit trails. Both plans use the same gateway and analysis engine.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="https://mnemom.ai/pricing" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Compare plans</a>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0 0;font-size:13px;color:#888;">Alex</p>
    `),
    text: `Two weeks in. Here's where things stand:

- ${data.checksUsed.toLocaleString()} integrity checks run
- ${data.agentsLinked} agent${data.agentsLinked === 1 ? '' : 's'} connected

Your Developer plan bills at $0.01 per check with no monthly minimum. If you're running checks at scale, the Team plan includes 15,000 checks per month, 90-day trace retention, compliance exports, and role-based access control.

Whether you stay on Developer or move to Team depends on volume and whether you need audit trails. Both plans use the same gateway and analysis engine.

Compare plans: https://mnemom.ai/pricing

Alex`,
  };
}

// --- Team trial onboarding (4 emails, Day 1/3/7/12) ---

export function teamOnboardingDay1Email(): EmailTemplate {
  return {
    subject: 'Set up your team: roles and access control',
    html: emailLayout(`
      <p style="margin:0 0 16px 0;">Your Team plan includes role-based access control. Three roles are available:</p>
      <ul style="margin:0 0 16px 0;padding-left:20px;line-height:1.8;">
        <li><strong>Admin</strong> — Full access. Manages billing, team members, and all agents.</li>
        <li><strong>Member</strong> — Can create agents, run checks, and view reports.</li>
        <li><strong>Viewer</strong> — Read-only access to dashboards and reports.</li>
      </ul>
      <p style="margin:0 0 16px 0;">Role separation matters for audit trails. When compliance asks "who accessed what," you want clear answers. Every action in Mnemom is logged with the user who performed it.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="https://mnemom.ai/settings/team" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Invite your team</a>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0 0;font-size:13px;color:#888;">Alex</p>
    `),
    text: `Your Team plan includes role-based access control. Three roles are available:

- Admin — Full access. Manages billing, team members, and all agents.
- Member — Can create agents, run checks, and view reports.
- Viewer — Read-only access to dashboards and reports.

Role separation matters for audit trails. When compliance asks "who accessed what," you want clear answers. Every action in Mnemom is logged with the user who performed it.

Invite your team: https://mnemom.ai/settings/team

Alex`,
  };
}

export function teamOnboardingDay3Email(data: { checksUsed: number; agentsLinked: number }): EmailTemplate {
  return {
    subject: 'Export your first compliance trace',
    html: emailLayout(`
      <p style="margin:0 0 16px 0;">One of the most valuable Team features is compliance trace export. Every integrity check creates a trace that maps directly to EU AI Act requirements.</p>
      <p style="margin:0 0 16px 0;"><strong>Article 9 (Risk Management)</strong> requires documented monitoring of AI systems. Your integrity traces are that documentation. <strong>Article 13 (Transparency)</strong> requires evidence of system behavior — integrity reports serve as that evidence.</p>
      <p style="margin:0 0 16px 0;">Export formats: JSON (for programmatic use), CSV (for spreadsheets and auditors), and OpenTelemetry (for existing observability pipelines).</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;background:#F9F8F3;border-radius:8px;">
        <tr>
          <td style="padding:20px 24px;">
            <p style="margin:0 0 8px 0;"><strong>${data.checksUsed.toLocaleString()}</strong> checks run so far</p>
            <p style="margin:0;"><strong>${data.agentsLinked}</strong> agent${data.agentsLinked === 1 ? '' : 's'} linked</p>
          </td>
        </tr>
      </table>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="https://mnemom.ai/dashboard" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Export traces</a>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0 0;font-size:13px;color:#888;">Alex</p>
    `),
    text: `One of the most valuable Team features is compliance trace export. Every integrity check creates a trace that maps directly to EU AI Act requirements.

Article 9 (Risk Management) requires documented monitoring of AI systems. Your integrity traces are that documentation. Article 13 (Transparency) requires evidence of system behavior — integrity reports serve as that evidence.

Export formats: JSON (for programmatic use), CSV (for spreadsheets and auditors), and OpenTelemetry (for existing observability pipelines).

- ${data.checksUsed.toLocaleString()} checks run so far
- ${data.agentsLinked} agent${data.agentsLinked === 1 ? '' : 's'} linked

Export traces: https://mnemom.ai/dashboard

Alex`,
  };
}

export function teamOnboardingDay7Email(): EmailTemplate {
  return {
    subject: 'Coherence analysis: catch drift before it matters',
    html: emailLayout(`
      <p style="margin:0 0 16px 0;">Pairwise coherence is the Team feature most teams don't know they need until they see it.</p>
      <p style="margin:0 0 16px 0;">Here's what it does: for every pair of agents in a check group, Mnemom compares their semantic behavior over time. When two agents that should behave consistently start diverging — one giving different answers than the other on the same class of input — coherence analysis flags it.</p>
      <p style="margin:0 0 16px 0;">This catches a specific failure mode that standard monitoring misses: semantic drift. An agent can pass all its unit tests, respond within latency bounds, and still slowly shift its behavior in ways that create inconsistent user experiences across your fleet.</p>
      <p style="margin:0 0 16px 0;">The coherence dashboard shows a matrix of agent pairs with their current coherence scores. Green means aligned. Yellow means drifting. Worth a look if you have two or more agents in production.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="https://mnemom.ai/dashboard" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">View coherence dashboard</a>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0 0;font-size:13px;color:#888;">Alex</p>
    `),
    text: `Pairwise coherence is the Team feature most teams don't know they need until they see it.

Here's what it does: for every pair of agents in a check group, Mnemom compares their semantic behavior over time. When two agents that should behave consistently start diverging — one giving different answers than the other on the same class of input — coherence analysis flags it.

This catches a specific failure mode that standard monitoring misses: semantic drift. An agent can pass all its unit tests, respond within latency bounds, and still slowly shift its behavior in ways that create inconsistent user experiences across your fleet.

The coherence dashboard shows a matrix of agent pairs with their current coherence scores. Green means aligned. Yellow means drifting. Worth a look if you have two or more agents in production.

View coherence dashboard: https://mnemom.ai/dashboard

Alex`,
  };
}

export function teamOnboardingDay12Email(data: { checksUsed: number; agentsLinked: number }): EmailTemplate {
  return {
    subject: 'Your trial ends in 2 days',
    html: emailLayout(`
      <p style="margin:0 0 16px 0;">Your Mnemom Team trial ends in 2 days. Here's what you've used:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;background:#F9F8F3;border-radius:8px;">
        <tr>
          <td style="padding:20px 24px;">
            <p style="margin:0 0 8px 0;"><strong>${data.checksUsed.toLocaleString()}</strong> integrity checks</p>
            <p style="margin:0;"><strong>${data.agentsLinked}</strong> agent${data.agentsLinked === 1 ? '' : 's'} connected</p>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 12px 0;"><strong>What you keep on Free:</strong> Managed gateway, basic integrity checks, 7-day trace retention.</p>
      <p style="margin:0 0 16px 0;"><strong>What requires Team:</strong> 15,000 included checks/month, 90-day trace retention, compliance exports, pairwise coherence analysis, role-based access control.</p>
      <p style="margin:0 0 16px 0;">Add a payment method to continue on Team. Your agents, traces, and configuration stay exactly as they are.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="https://mnemom.ai/settings/billing" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Keep your Team plan</a>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0 0;font-size:13px;color:#888;">Alex</p>
    `),
    text: `Your Mnemom Team trial ends in 2 days. Here's what you've used:

- ${data.checksUsed.toLocaleString()} integrity checks
- ${data.agentsLinked} agent${data.agentsLinked === 1 ? '' : 's'} connected

What you keep on Free: Managed gateway, basic integrity checks, 7-day trace retention.

What requires Team: 15,000 included checks/month, 90-day trace retention, compliance exports, pairwise coherence analysis, role-based access control.

Add a payment method to continue on Team. Your agents, traces, and configuration stay exactly as they are.

Keep your Team plan: https://mnemom.ai/settings/billing

Alex`,
  };
}

// --- Enterprise nurture (4 emails, Day 0/3/7/14) ---

export function enterpriseNurtureDay0Email(data: { name: string; company: string }): EmailTemplate {
  const firstName = data.name.split(' ')[0];
  return {
    subject: `Mnemom for ${data.company}: AI integrity infrastructure`,
    html: emailLayout(`
      <p style="margin:0 0 16px 0;">Hi ${firstName},</p>
      <p style="margin:0 0 16px 0;">Thanks for reaching out about Mnemom. I wanted to give you a clear picture of what we do and how companies like ${data.company} use it.</p>
      <p style="margin:0 0 16px 0;">Mnemom is integrity checking infrastructure for AI agents. When your agents process requests, Mnemom analyzes whether they're behaving consistently, staying within defined boundaries, and following their instructions. The output is a continuous stream of integrity evidence that your engineering and compliance teams can act on.</p>
      <p style="margin:0 0 16px 0;">Enterprise teams use Mnemom for three things: generating compliance audit trails automatically (EU AI Act, SOC 2), governing agent fleets at scale (catching drift before it reaches users), and getting visibility into agent behavior that standard observability tools miss.</p>
      <p style="margin:0 0 16px 0;">What makes Mnemom different: it's built on an open protocol, deploys self-hosted or managed, and exports natively to OpenTelemetry. No vendor lock-in, no proprietary data formats.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="https://docs.mnemom.ai/architecture" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Read the architecture overview</a>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0 0;font-size:13px;color:#888;">Alex</p>
    `),
    text: `Hi ${firstName},

Thanks for reaching out about Mnemom. I wanted to give you a clear picture of what we do and how companies like ${data.company} use it.

Mnemom is integrity checking infrastructure for AI agents. When your agents process requests, Mnemom analyzes whether they're behaving consistently, staying within defined boundaries, and following their instructions. The output is a continuous stream of integrity evidence that your engineering and compliance teams can act on.

Enterprise teams use Mnemom for three things: generating compliance audit trails automatically (EU AI Act, SOC 2), governing agent fleets at scale (catching drift before it reaches users), and getting visibility into agent behavior that standard observability tools miss.

What makes Mnemom different: it's built on an open protocol, deploys self-hosted or managed, and exports natively to OpenTelemetry. No vendor lock-in, no proprietary data formats.

Read the architecture overview: https://docs.mnemom.ai/architecture

Alex`,
  };
}

export function enterpriseNurtureDay3Email(): EmailTemplate {
  return {
    subject: 'EU AI Act Article 9: what your AI team needs to document',
    html: emailLayout(`
      <p style="margin:0 0 16px 0;">If your team is deploying AI agents in or serving users in the EU, Article 9 of the AI Act requires a risk management system that includes continuous monitoring of AI system behavior.</p>
      <p style="margin:0 0 16px 0;">Specifically, Article 9(2)(b) requires "estimation and evaluation of the risks that may emerge when the high-risk AI system is used in accordance with its intended purpose." Article 13 adds transparency requirements: you need to demonstrate that your AI systems behave as documented.</p>
      <p style="margin:0 0 16px 0;">In practice, this means you need three things: continuous behavioral monitoring (not just uptime checks), audit-ready evidence of system behavior over time, and documented traces that map to specific regulatory requirements.</p>
      <p style="margin:0 0 16px 0;">Mnemom's integrity traces were designed for exactly this. Each check produces a structured record that maps to Article 9 risk management and Article 13 transparency requirements. The compliance export formats these traces as audit evidence.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="https://mnemom.ai/enterprise/compliance" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Read the compliance mapping</a>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0 0;font-size:13px;color:#888;">Alex</p>
    `),
    text: `If your team is deploying AI agents in or serving users in the EU, Article 9 of the AI Act requires a risk management system that includes continuous monitoring of AI system behavior.

Specifically, Article 9(2)(b) requires "estimation and evaluation of the risks that may emerge when the high-risk AI system is used in accordance with its intended purpose." Article 13 adds transparency requirements: you need to demonstrate that your AI systems behave as documented.

In practice, this means you need three things: continuous behavioral monitoring (not just uptime checks), audit-ready evidence of system behavior over time, and documented traces that map to specific regulatory requirements.

Mnemom's integrity traces were designed for exactly this. Each check produces a structured record that maps to Article 9 risk management and Article 13 transparency requirements. The compliance export formats these traces as audit evidence.

Read the compliance mapping: https://mnemom.ai/enterprise/compliance

Alex`,
  };
}

export function enterpriseNurtureDay7Email(): EmailTemplate {
  return {
    subject: 'How integrity checking works in production',
    html: emailLayout(`
      <p style="margin:0 0 16px 0;">Here's what happens when an integrity check runs in production.</p>
      <p style="margin:0 0 16px 0;">Your agent sends a request through the Mnemom gateway. The gateway captures the interaction context — inputs, outputs, system prompt, and metadata — and passes it to the analysis engine. The engine evaluates three dimensions: coherence (is the agent consistent?), boundary adherence (is it staying in scope?), and instruction fidelity (is it following its prompt?).</p>
      <p style="margin:0 0 16px 0;">The result is a structured integrity trace stored in your private trace database. For self-hosted deployments, this stays entirely on your infrastructure. For managed, it's in isolated storage with encryption at rest.</p>
      <p style="margin:0 0 16px 0;">What integrity checking catches that standard observability misses: an agent that returns 200s, meets latency SLAs, and passes functional tests can still drift semantically. It might slowly change how it interprets ambiguous inputs, or gradually loosen its boundary adherence over time. These are the failures that only surface when a user complains — or an auditor asks.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="https://mnemom.ai/research" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Explore the research</a>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0 0;font-size:13px;color:#888;">Alex</p>
    `),
    text: `Here's what happens when an integrity check runs in production.

Your agent sends a request through the Mnemom gateway. The gateway captures the interaction context — inputs, outputs, system prompt, and metadata — and passes it to the analysis engine. The engine evaluates three dimensions: coherence (is the agent consistent?), boundary adherence (is it staying in scope?), and instruction fidelity (is it following its prompt?).

The result is a structured integrity trace stored in your private trace database. For self-hosted deployments, this stays entirely on your infrastructure. For managed, it's in isolated storage with encryption at rest.

What integrity checking catches that standard observability misses: an agent that returns 200s, meets latency SLAs, and passes functional tests can still drift semantically. It might slowly change how it interprets ambiguous inputs, or gradually loosen its boundary adherence over time. These are the failures that only surface when a user complains — or an auditor asks.

Explore the research: https://mnemom.ai/research

Alex`,
  };
}

export function enterpriseNurtureDay14Email(data: { name: string }): EmailTemplate {
  const firstName = data.name.split(' ')[0];
  return {
    subject: '30 minutes to walk through your architecture',
    html: emailLayout(`
      <p style="margin:0 0 16px 0;">Hi ${firstName},</p>
      <p style="margin:0 0 16px 0;">I'd like to understand how your team is deploying AI agents and show you how Mnemom fits. No slides — just your architecture and our dashboard.</p>
      <p style="margin:0 0 16px 0;">Thirty minutes is usually enough to cover your deployment topology, map your compliance requirements to our trace format, and walk through a live integrity check on one of your agents.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="https://cal.com/alexgarden/enterprise" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Pick a time</a>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0 0;font-size:13px;color:#888;">Alex</p>
    `),
    text: `Hi ${firstName},

I'd like to understand how your team is deploying AI agents and show you how Mnemom fits. No slides — just your architecture and our dashboard.

Thirty minutes is usually enough to cover your deployment topology, map your compliance requirements to our trace format, and walk through a live integrity check on one of your agents.

Pick a time: https://cal.com/alexgarden/enterprise

Alex`,
  };
}

// --- Re-engagement (2 emails) ---

export function reEngagementChurnSurveyEmail(): EmailTemplate {
  return {
    subject: 'One question from Alex',
    html: emailLayout(`
      <p style="margin:0 0 16px 0;">I noticed your Mnemom subscription ended last week.</p>
      <p style="margin:0 0 16px 0;">I'm genuinely curious: was there something we could have built differently? Your feedback directly shapes what we prioritize next. Even a one-line reply is helpful.</p>
      <p style="margin:0 0 16px 0;">If you'd prefer a structured format, there's a short survey below (takes about 2 minutes).</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="https://mnemom.ai/feedback" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Share your feedback (2 minutes)</a>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0 0;font-size:13px;color:#888;">Alex</p>
    `),
    text: `I noticed your Mnemom subscription ended last week.

I'm genuinely curious: was there something we could have built differently? Your feedback directly shapes what we prioritize next. Even a one-line reply is helpful.

If you'd prefer a structured format, there's a short survey below (takes about 2 minutes).

Share your feedback: https://mnemom.ai/feedback

Alex`,
  };
}

export function reEngagementInactiveEmail(): EmailTemplate {
  return {
    subject: 'Still monitoring your agents?',
    html: emailLayout(`
      <p style="margin:0 0 16px 0;">It's been a month since your last integrity check. A few things have shipped since then:</p>
      <ul style="margin:0 0 16px 0;padding-left:20px;line-height:1.8;">
        <li>Pairwise coherence analysis across agent fleets</li>
        <li>OpenTelemetry-native trace export</li>
        <li>EU AI Act compliance mapping for integrity traces</li>
      </ul>
      <p style="margin:0 0 16px 0;">If you ran into something that blocked you, I'd like to help. Reply to this email or check the changelog for what's new.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="https://mnemom.ai/changelog" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">See what's new</a>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0 0;font-size:13px;color:#888;">Alex</p>
    `),
    text: `It's been a month since your last integrity check. A few things have shipped since then:

- Pairwise coherence analysis across agent fleets
- OpenTelemetry-native trace export
- EU AI Act compliance mapping for integrity traces

If you ran into something that blocked you, I'd like to help. Reply to this email or check the changelog for what's new.

See what's new: https://mnemom.ai/changelog

Alex`,
  };
}

export function ssoMemberAddedEmail(data: { orgName: string; role: string }): EmailTemplate {
  return {
    subject: `You've been added to ${data.orgName} via SSO`,
    html: emailLayout(`
      <h1 style="margin:0 0 16px 0;font-size:22px;color:#0F172A;">Welcome to ${data.orgName}</h1>
      <p style="margin:0 0 12px 0;">You've been automatically added to <strong>${data.orgName}</strong> via Single Sign-On as a <strong>${data.role}</strong>.</p>
      <p style="margin:0 0 20px 0;">You can now access the organization's agents, dashboards, and resources based on your role permissions.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="https://mnemom.ai/dashboard" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Go to Dashboard</a>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;color:#888;">If you did not expect to be added to this organization, please contact your IT administrator.</p>
    `),
    text: `Welcome to ${data.orgName}

You've been automatically added to ${data.orgName} via Single Sign-On as a ${data.role}.

You can now access the organization's agents, dashboards, and resources based on your role permissions.

Go to Dashboard: https://mnemom.ai/dashboard

If you did not expect to be added to this organization, please contact your IT administrator.`,
  };
}

export function webhookDisabledEmail(data: { endpointUrl: string; endpointId: string; failureCount: number }): EmailTemplate {
  return {
    subject: 'Webhook endpoint auto-disabled due to delivery failures',
    html: emailLayout(`
      <div style="background-color:#DC2626;padding:12px 16px;border-radius:6px 6px 0 0;margin:-24px -32px 20px -32px;">
        <p style="margin:0;color:#ffffff;font-weight:600;font-size:15px;">Webhook Endpoint Disabled</p>
      </div>
      <p style="margin:0 0 12px 0;">Your webhook endpoint has been automatically disabled after <strong>${data.failureCount} consecutive delivery failures</strong>.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;width:100%;">
        <tr>
          <td style="padding:12px 16px;background-color:#F1F5F9;border-radius:6px;font-family:monospace;font-size:13px;">
            <strong>Endpoint:</strong> ${data.endpointUrl}<br>
            <strong>ID:</strong> ${data.endpointId}
          </td>
        </tr>
      </table>
      <p style="margin:0 0 16px 0;">To resume receiving webhook notifications, fix the issue with your endpoint and re-enable it in your organization settings.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
        <tr>
          <td style="border-radius:6px;background-color:#D97706;">
            <a href="https://mnemom.ai/settings/org" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">Go to Settings</a>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;color:#888;">Common causes: endpoint returning 5xx errors, DNS resolution failures, connection timeouts (&gt;10s).</p>
    `),
    text: `Webhook Endpoint Disabled

Your webhook endpoint has been automatically disabled after ${data.failureCount} consecutive delivery failures.

Endpoint: ${data.endpointUrl}
ID: ${data.endpointId}

To resume receiving webhook notifications, fix the issue with your endpoint and re-enable it in your organization settings.

Go to Settings: https://mnemom.ai/settings/org

Common causes: endpoint returning 5xx errors, DNS resolution failures, connection timeouts (>10s).`,
  };
}
