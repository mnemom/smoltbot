/**
 * Slack incoming webhook alerts for GTM events.
 * Single POST to a webhook URL with Block Kit JSON.
 * All functions guard on env.SLACK_WEBHOOK_URL — return silently if not set.
 */

import type { BillingEnv } from './types';

// ============================================
// Core webhook sender
// ============================================

export async function sendSlackAlert(
  env: BillingEnv,
  blocks: unknown[],
  text: string,
): Promise<void> {
  if (!env.SLACK_WEBHOOK_URL) return;

  try {
    const response = await fetch(env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, blocks }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[slack] Webhook error ${response.status}: ${body}`);
    } else {
      console.log(`[slack] Alert sent: ${text}`);
    }
  } catch (err) {
    console.error(`[slack] Webhook failed:`, err);
  }
}

// ============================================
// Alert templates
// ============================================

export async function enterpriseLeadAlert(
  env: BillingEnv,
  data: {
    name: string;
    email: string;
    company: string;
    companySize?: string;
    role?: string;
    leadId: string;
  },
): Promise<void> {
  const fields = [
    { type: 'mrkdwn', text: `*Name:*\n${data.name}` },
    { type: 'mrkdwn', text: `*Company:*\n${data.company}` },
    { type: 'mrkdwn', text: `*Email:*\n${data.email}` },
    ...(data.role ? [{ type: 'mrkdwn', text: `*Role:*\n${data.role}` }] : []),
    ...(data.companySize ? [{ type: 'mrkdwn', text: `*Team Size:*\n${data.companySize}` }] : []),
    { type: 'mrkdwn', text: `*Lead ID:*\n\`${data.leadId}\`` },
  ];

  await sendSlackAlert(env, [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'New Enterprise Lead', emoji: true },
    },
    { type: 'section', fields },
  ], `New enterprise lead: ${data.name} at ${data.company}`);
}

export async function highValueSignupAlert(
  env: BillingEnv,
  data: {
    email: string;
    plan: string;
    accountId: string;
  },
): Promise<void> {
  await sendSlackAlert(env, [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Paid Plan Signup', emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Email:*\n${data.email}` },
        { type: 'mrkdwn', text: `*Plan:*\n${data.plan}` },
        { type: 'mrkdwn', text: `*Account:*\n\`${data.accountId}\`` },
      ],
    },
  ], `New paid signup: ${data.email} on ${data.plan}`);
}

export async function paymentFailedAlert(
  env: BillingEnv,
  data: {
    email: string;
    accountId: string;
    attemptCount: number;
  },
): Promise<void> {
  await sendSlackAlert(env, [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Payment Failed — Churn Risk', emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Email:*\n${data.email}` },
        { type: 'mrkdwn', text: `*Account:*\n\`${data.accountId}\`` },
        { type: 'mrkdwn', text: `*Attempt:*\n${data.attemptCount}` },
      ],
    },
  ], `Payment failed for ${data.email} (attempt ${data.attemptCount})`);
}

export async function highValuePaymentAlert(
  env: BillingEnv,
  data: {
    email: string;
    accountId: string;
    amountCents: number;
  },
): Promise<void> {
  const amount = `$${(data.amountCents / 100).toFixed(2)}`;
  await sendSlackAlert(env, [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Payment Received', emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Email:*\n${data.email}` },
        { type: 'mrkdwn', text: `*Amount:*\n${amount}` },
        { type: 'mrkdwn', text: `*Account:*\n\`${data.accountId}\`` },
      ],
    },
  ], `Payment received: ${amount} from ${data.email}`);
}
