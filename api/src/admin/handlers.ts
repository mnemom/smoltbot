/**
 * Phase 6: Admin Revenue & Operations Handlers
 *
 * 18 handlers for revenue dashboard, customer health, operational controls
 * (suspend, credit notes, coupons), analytics, and data exports.
 *
 * Follows same pattern as billing/handlers.ts and org/handlers.ts:
 * local supabase helpers, AdminGuard, jsonResponse/errorResponse.
 */

import type { BillingEnv, BillingProvider, CouponInfo } from '../billing/types';
import { createStripeProvider } from '../billing/stripe-provider';
import { sendEmail, accountSuspendedEmail } from '../billing/email';

// ============================================
// Types
// ============================================

interface JWTPayload {
  sub: string;
  email?: string;
  role?: string;
  app_metadata?: { is_admin?: boolean };
  exp: number;
  iat: number;
}

/** Function signature matching requireAdmin in index.ts */
export type AdminGuard = (request: Request, env: BillingEnv) => Promise<JWTPayload | Response>;

// ============================================
// Response helpers
// ============================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

// ============================================
// Supabase helpers (identical to billing/handlers)
// ============================================

async function supabaseRpc(
  env: BillingEnv,
  functionName: string,
  params: Record<string, unknown> = {},
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

async function supabaseUpdate(
  env: BillingEnv,
  table: string,
  filterString: string,
  data: Record<string, unknown>,
): Promise<{ data: unknown; error: string | null }> {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${filterString}`, {
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
      return { data: null, error: await response.text() };
    }
    return { data: await response.json(), error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ============================================
// ID generator
// ============================================

function generateId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}-${id}`;
}

// ============================================
// KV cache purge helper
// ============================================

async function purgeQuotaCache(env: BillingEnv, userId: string): Promise<void> {
  if (!env.BILLING_CACHE) return;
  try {
    const agentsRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/agents?user_id=eq.${userId}&select=id`,
      { headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` } },
    );
    if (agentsRes.ok) {
      const agents = (await agentsRes.json()) as Array<{ id: string }>;
      for (const a of agents) {
        await (env.BILLING_CACHE as KVNamespace).delete(`quota:agent:${a.id}`).catch(() => {});
      }
    }
  } catch {
    // Best-effort
  }
}

// ============================================
// Audit log helper
// ============================================

async function logAudit(
  env: BillingEnv,
  adminUserId: string,
  action: string,
  targetUserId: string | null,
  targetAccountId: string | null,
  details: Record<string, unknown>,
  ipAddress: string | null,
): Promise<void> {
  await supabaseInsert(env, 'admin_audit_log', {
    id: generateId('aal'),
    admin_user_id: adminUserId,
    action,
    target_user_id: targetUserId,
    target_account_id: targetAccountId,
    details,
    ip_address: ipAddress,
  }).catch(() => {});
}

function getClientIp(request: Request): string | null {
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? null;
}

// ============================================
// 6.1 Revenue Dashboard
// ============================================

export async function handleAdminRevenueDashboard(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;

  const { data, error } = await supabaseRpc(env, 'admin_revenue_dashboard');
  if (error) return errorResponse(`Database error: ${error}`, 500);

  return jsonResponse(data);
}

// ============================================
// 6.2 Customer Health
// ============================================

export async function handleAdminCustomerList(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
  url: URL,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const status = url.searchParams.get('status') || undefined;
  const plan = url.searchParams.get('plan') || undefined;
  const search = url.searchParams.get('search') || undefined;

  const params: Record<string, unknown> = { p_limit: limit, p_offset: offset };
  if (status) params.p_status = status;
  if (plan) params.p_plan = plan;
  if (search) params.p_search = search;

  const { data, error } = await supabaseRpc(env, 'admin_customer_health_list', params);
  if (error) return errorResponse(`Database error: ${error}`, 500);

  return jsonResponse(data);
}

export async function handleAdminCustomerDetail(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
  userId: string,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;

  const { data, error } = await supabaseRpc(env, 'admin_customer_detail', { p_user_id: userId });
  if (error) return errorResponse(`Database error: ${error}`, 500);

  const result = data as Record<string, unknown> | null;
  if (result?.error === 'account_not_found') {
    return errorResponse('Account not found', 404);
  }

  return jsonResponse(data);
}

export async function handleAdminAddNote(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
  userId: string,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;
  const admin = adminOrError as JWTPayload;

  let body: { note?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.note || typeof body.note !== 'string' || body.note.trim().length === 0) {
    return errorResponse('note is required', 400);
  }

  // Resolve account_id from user_id
  const { data: accData } = await supabaseQuery(
    env,
    'billing_accounts',
    `user_id=eq.${userId}&select=account_id&limit=1`,
  );
  const accounts = (accData as Array<{ account_id: string }>) || [];
  if (accounts.length === 0) return errorResponse('Billing account not found', 404);

  const { data: noteData, error } = await supabaseInsert(env, 'admin_customer_notes', {
    id: generateId('acn'),
    account_id: accounts[0].account_id,
    admin_user_id: admin.sub,
    note: body.note.trim(),
  });

  if (error) return errorResponse(`Database error: ${error}`, 500);

  await logAudit(env, admin.sub, 'add_customer_note', userId, accounts[0].account_id, { note: body.note.trim() }, getClientIp(request));

  return jsonResponse(noteData, 201);
}

// ============================================
// 6.3 Operations: Suspend / Unsuspend
// ============================================

export async function handleAdminSuspendAccount(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
  userId: string,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;
  const admin = adminOrError as JWTPayload;

  let body: { reason?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const reason = body.reason || 'No reason provided';

  // Resolve account
  const { data: accData } = await supabaseQuery(
    env,
    'billing_accounts',
    `user_id=eq.${userId}&select=account_id,billing_email,is_suspended`,
  );
  const accounts = (accData as Array<{ account_id: string; billing_email: string | null; is_suspended: boolean }>) || [];
  if (accounts.length === 0) return errorResponse('Billing account not found', 404);

  const account = accounts[0];
  if (account.is_suspended) return errorResponse('Account is already suspended', 409);

  // Suspend
  const { error: updateError } = await supabaseUpdate(
    env,
    'billing_accounts',
    `account_id=eq.${account.account_id}`,
    {
      is_suspended: true,
      suspended_at: new Date().toISOString(),
      suspended_by: admin.sub,
      suspended_reason: reason,
    },
  );
  if (updateError) return errorResponse(`Database error: ${updateError}`, 500);

  // Billing event
  await supabaseInsert(env, 'billing_events', {
    event_id: generateId('be'),
    account_id: account.account_id,
    event_type: 'account_suspended',
    details: { reason, admin_user_id: admin.sub },
    performed_by: admin.sub,
  });

  // Audit log
  await logAudit(env, admin.sub, 'suspend_account', userId, account.account_id, { reason }, getClientIp(request));

  // Send suspension email
  if (account.billing_email) {
    await sendEmail(account.billing_email, accountSuspendedEmail({ reason }), env).catch(() => {});
  }

  // Purge KV cache
  await purgeQuotaCache(env, userId);

  return jsonResponse({ success: true, suspended: true });
}

export async function handleAdminUnsuspendAccount(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
  userId: string,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;
  const admin = adminOrError as JWTPayload;

  // Resolve account
  const { data: accData } = await supabaseQuery(
    env,
    'billing_accounts',
    `user_id=eq.${userId}&select=account_id,is_suspended`,
  );
  const accounts = (accData as Array<{ account_id: string; is_suspended: boolean }>) || [];
  if (accounts.length === 0) return errorResponse('Billing account not found', 404);

  const account = accounts[0];
  if (!account.is_suspended) return errorResponse('Account is not suspended', 409);

  // Unsuspend
  const { error: updateError } = await supabaseUpdate(
    env,
    'billing_accounts',
    `account_id=eq.${account.account_id}`,
    {
      is_suspended: false,
      suspended_at: null,
      suspended_by: null,
      suspended_reason: null,
    },
  );
  if (updateError) return errorResponse(`Database error: ${updateError}`, 500);

  // Billing event
  await supabaseInsert(env, 'billing_events', {
    event_id: generateId('be'),
    account_id: account.account_id,
    event_type: 'account_unsuspended',
    details: { admin_user_id: admin.sub },
    performed_by: admin.sub,
  });

  // Audit log
  await logAudit(env, admin.sub, 'unsuspend_account', userId, account.account_id, {}, getClientIp(request));

  // Purge KV cache
  await purgeQuotaCache(env, userId);

  return jsonResponse({ success: true, suspended: false });
}

// ============================================
// 6.3 Operations: Credit Note / Invoice
// ============================================

export async function handleAdminIssueCreditNote(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
  userId: string,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;
  const admin = adminOrError as JWTPayload;

  let body: { amount_cents?: number; reason?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.amount_cents || body.amount_cents <= 0) {
    return errorResponse('amount_cents is required and must be positive', 400);
  }

  // Resolve Stripe customer
  const { data: accData } = await supabaseQuery(
    env,
    'billing_accounts',
    `user_id=eq.${userId}&select=account_id,stripe_customer_id`,
  );
  const accounts = (accData as Array<{ account_id: string; stripe_customer_id: string | null }>) || [];
  if (accounts.length === 0) return errorResponse('Billing account not found', 404);
  if (!accounts[0].stripe_customer_id) return errorResponse('No Stripe customer linked', 400);

  const provider = createStripeProvider(env.STRIPE_SECRET_KEY);
  try {
    const result = await provider.createCreditNote({
      customerId: accounts[0].stripe_customer_id,
      amountCents: body.amount_cents,
      reason: body.reason,
    });

    // Billing event
    await supabaseInsert(env, 'billing_events', {
      event_id: generateId('be'),
      account_id: accounts[0].account_id,
      event_type: 'credit_note_issued',
      details: { credit_note_id: result.id, amount_cents: body.amount_cents, reason: body.reason ?? '' },
      performed_by: admin.sub,
    });

    await logAudit(env, admin.sub, 'issue_credit_note', userId, accounts[0].account_id, { amount_cents: body.amount_cents }, getClientIp(request));

    return jsonResponse(result, 201);
  } catch (err) {
    return errorResponse(`Stripe error: ${err instanceof Error ? err.message : 'Unknown'}`, 502);
  }
}

export async function handleAdminGenerateInvoice(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
  userId: string,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;
  const admin = adminOrError as JWTPayload;

  let body: { amount_cents?: number; description?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.amount_cents || body.amount_cents <= 0) {
    return errorResponse('amount_cents is required and must be positive', 400);
  }
  if (!body.description) {
    return errorResponse('description is required', 400);
  }

  // Resolve Stripe customer
  const { data: accData } = await supabaseQuery(
    env,
    'billing_accounts',
    `user_id=eq.${userId}&select=account_id,stripe_customer_id`,
  );
  const accounts = (accData as Array<{ account_id: string; stripe_customer_id: string | null }>) || [];
  if (accounts.length === 0) return errorResponse('Billing account not found', 404);
  if (!accounts[0].stripe_customer_id) return errorResponse('No Stripe customer linked', 400);

  const provider = createStripeProvider(env.STRIPE_SECRET_KEY);
  try {
    const result = await provider.createManualInvoice({
      customerId: accounts[0].stripe_customer_id,
      amountCents: body.amount_cents,
      description: body.description,
    });

    // Billing event
    await supabaseInsert(env, 'billing_events', {
      event_id: generateId('be'),
      account_id: accounts[0].account_id,
      event_type: 'manual_invoice_generated',
      details: { invoice_id: result.id, amount_cents: body.amount_cents, description: body.description },
      performed_by: admin.sub,
    });

    await logAudit(env, admin.sub, 'generate_invoice', userId, accounts[0].account_id, { amount_cents: body.amount_cents }, getClientIp(request));

    return jsonResponse(result, 201);
  } catch (err) {
    return errorResponse(`Stripe error: ${err instanceof Error ? err.message : 'Unknown'}`, 502);
  }
}

// ============================================
// 6.3 Operations: Impersonate
// ============================================

export async function handleAdminImpersonate(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
  userId: string,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;
  const admin = adminOrError as JWTPayload;

  // Return data snapshot — NOT a session token
  const { data: detail, error } = await supabaseRpc(env, 'admin_customer_detail', { p_user_id: userId });
  if (error) return errorResponse(`Database error: ${error}`, 500);

  const result = detail as Record<string, unknown> | null;
  if (result?.error === 'account_not_found') {
    return errorResponse('Account not found', 404);
  }

  // Billing event
  const accData = result?.account as Record<string, unknown> | undefined;
  const accountId = (accData?.account_id as string) ?? null;

  await supabaseInsert(env, 'billing_events', {
    event_id: generateId('be'),
    account_id: accountId,
    event_type: 'admin_impersonation',
    details: { admin_user_id: admin.sub },
    performed_by: admin.sub,
  });

  await logAudit(env, admin.sub, 'impersonate_user', userId, accountId, {}, getClientIp(request));

  return jsonResponse({ impersonated_user_id: userId, snapshot: detail });
}

// ============================================
// C.4 Analytics: Conversion Funnel
// ============================================

export async function handleAdminConversionFunnel(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
  url: URL,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;

  const days = parseInt(url.searchParams.get('days') || '90', 10);

  const { data, error } = await supabaseRpc(env, 'admin_conversion_funnel', { p_days: days });
  if (error) return errorResponse(`Database error: ${error}`, 500);

  return jsonResponse(data);
}

// ============================================
// C.5 Exports (CSV)
// ============================================

function csvResponse(csvContent: string, filename: string): Response {
  return new Response(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
      ...corsHeaders,
    },
  });
}

export async function handleAdminExportRevenue(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
  url: URL,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;
  const admin = adminOrError as JWTPayload;

  const startDate = url.searchParams.get('start') || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const endDate = url.searchParams.get('end') || new Date().toISOString().split('T')[0];

  const { data, error } = await supabaseQuery(
    env,
    'billing_events',
    `event_type=in.(payment_succeeded,invoice_finalized)&timestamp=gte.${startDate}&timestamp=lte.${endDate}T23:59:59Z&select=event_id,account_id,event_type,details,timestamp&order=timestamp.desc`,
  );
  if (error) return errorResponse(`Database error: ${error}`, 500);

  const rows = (data as Array<Record<string, unknown>>) || [];
  let csv = 'event_id,account_id,event_type,amount_cents,timestamp\n';
  for (const row of rows) {
    const details = (row.details as Record<string, unknown>) || {};
    const amount = details.amount_cents ?? details.amount ?? '';
    csv += `${row.event_id},${row.account_id},${row.event_type},${amount},${row.timestamp}\n`;
  }

  await logAudit(env, admin.sub, 'export_revenue', null, null, { start: startDate, end: endDate }, getClientIp(request));

  return csvResponse(csv, `revenue-${startDate}-to-${endDate}.csv`);
}

export async function handleAdminExportCustomers(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;
  const admin = adminOrError as JWTPayload;

  const { data, error } = await supabaseQuery(
    env,
    'billing_accounts',
    'select=account_id,user_id,billing_email,plan_id,subscription_status,is_suspended,check_count_this_period,created_at&order=created_at.desc',
  );
  if (error) return errorResponse(`Database error: ${error}`, 500);

  const rows = (data as Array<Record<string, unknown>>) || [];
  let csv = 'account_id,user_id,billing_email,plan_id,subscription_status,is_suspended,check_count_this_period,created_at\n';
  for (const row of rows) {
    csv += `${row.account_id},${row.user_id},${row.billing_email ?? ''},${row.plan_id},${row.subscription_status},${row.is_suspended},${row.check_count_this_period},${row.created_at}\n`;
  }

  await logAudit(env, admin.sub, 'export_customers', null, null, {}, getClientIp(request));

  return csvResponse(csv, `customers-${new Date().toISOString().split('T')[0]}.csv`);
}

export async function handleAdminExportUsageAggregate(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
  url: URL,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;
  const admin = adminOrError as JWTPayload;

  const startDate = url.searchParams.get('start') || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const endDate = url.searchParams.get('end') || new Date().toISOString().split('T')[0];

  const { data, error } = await supabaseQuery(
    env,
    'usage_daily_rollup',
    `period_date=gte.${startDate}&period_date=lte.${endDate}&select=account_id,period_date,check_count,overage_count,cost_cents&order=period_date.desc`,
  );
  if (error) return errorResponse(`Database error: ${error}`, 500);

  const rows = (data as Array<Record<string, unknown>>) || [];
  let csv = 'account_id,period_date,check_count,overage_count,cost_cents\n';
  for (const row of rows) {
    csv += `${row.account_id},${row.period_date},${row.check_count},${row.overage_count},${row.cost_cents}\n`;
  }

  await logAudit(env, admin.sub, 'export_usage', null, null, { start: startDate, end: endDate }, getClientIp(request));

  return csvResponse(csv, `usage-${startDate}-to-${endDate}.csv`);
}

export async function handleAdminExportTax(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
  url: URL,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;
  const admin = adminOrError as JWTPayload;

  const startDate = url.searchParams.get('start') || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const endDate = url.searchParams.get('end') || new Date().toISOString().split('T')[0];

  const { data, error } = await supabaseQuery(
    env,
    'billing_events',
    `event_type=in.(payment_succeeded,invoice_finalized)&timestamp=gte.${startDate}&timestamp=lte.${endDate}T23:59:59Z&select=event_id,account_id,event_type,details,timestamp&order=timestamp.desc`,
  );
  if (error) return errorResponse(`Database error: ${error}`, 500);

  const rows = (data as Array<Record<string, unknown>>) || [];
  let csv = 'event_id,account_id,event_type,amount_cents,currency,timestamp\n';
  for (const row of rows) {
    const details = (row.details as Record<string, unknown>) || {};
    const amount = details.amount_cents ?? details.amount ?? '';
    const currency = details.currency ?? 'usd';
    csv += `${row.event_id},${row.account_id},${row.event_type},${amount},${currency},${row.timestamp}\n`;
  }

  await logAudit(env, admin.sub, 'export_tax', null, null, { start: startDate, end: endDate }, getClientIp(request));

  return csvResponse(csv, `tax-${startDate}-to-${endDate}.csv`);
}

// ============================================
// C.6 Coupons
// ============================================

export async function handleAdminListCoupons(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;

  const provider = createStripeProvider(env.STRIPE_SECRET_KEY);
  try {
    const coupons = await provider.listCoupons();
    return jsonResponse({ coupons });
  } catch (err) {
    return errorResponse(`Stripe error: ${err instanceof Error ? err.message : 'Unknown'}`, 502);
  }
}

export async function handleAdminCreateCoupon(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;
  const admin = adminOrError as JWTPayload;

  let body: {
    name?: string;
    percent_off?: number;
    amount_off?: number;
    currency?: string;
    duration?: 'once' | 'repeating' | 'forever';
    duration_in_months?: number;
    promotion_code?: string;
  };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.name) return errorResponse('name is required', 400);
  if (!body.duration) return errorResponse('duration is required', 400);
  if (body.percent_off === undefined && body.amount_off === undefined) {
    return errorResponse('Either percent_off or amount_off is required', 400);
  }

  const provider = createStripeProvider(env.STRIPE_SECRET_KEY);
  try {
    const coupon = await provider.createCoupon({
      name: body.name,
      percentOff: body.percent_off,
      amountOff: body.amount_off,
      currency: body.currency,
      duration: body.duration,
      durationInMonths: body.duration_in_months,
      promotionCode: body.promotion_code,
    });

    await logAudit(env, admin.sub, 'create_coupon', null, null, { coupon_id: coupon.id, name: body.name }, getClientIp(request));

    return jsonResponse(coupon, 201);
  } catch (err) {
    return errorResponse(`Stripe error: ${err instanceof Error ? err.message : 'Unknown'}`, 502);
  }
}

export async function handleAdminDeactivateCoupon(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
  couponId: string,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;
  const admin = adminOrError as JWTPayload;

  const provider = createStripeProvider(env.STRIPE_SECRET_KEY);
  try {
    await provider.deactivateCoupon(couponId);

    await logAudit(env, admin.sub, 'deactivate_coupon', null, null, { coupon_id: couponId }, getClientIp(request));

    return jsonResponse({ success: true, coupon_id: couponId });
  } catch (err) {
    return errorResponse(`Stripe error: ${err instanceof Error ? err.message : 'Unknown'}`, 502);
  }
}

export async function handleAdminApplyCoupon(
  env: BillingEnv,
  request: Request,
  requireAdmin: AdminGuard,
  userId: string,
): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;
  const admin = adminOrError as JWTPayload;

  let body: { coupon_id?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.coupon_id) return errorResponse('coupon_id is required', 400);

  // Resolve Stripe customer
  const { data: accData } = await supabaseQuery(
    env,
    'billing_accounts',
    `user_id=eq.${userId}&select=account_id,stripe_customer_id`,
  );
  const accounts = (accData as Array<{ account_id: string; stripe_customer_id: string | null }>) || [];
  if (accounts.length === 0) return errorResponse('Billing account not found', 404);
  if (!accounts[0].stripe_customer_id) return errorResponse('No Stripe customer linked', 400);

  const provider = createStripeProvider(env.STRIPE_SECRET_KEY);
  try {
    await provider.applyCustomerCoupon({
      customerId: accounts[0].stripe_customer_id,
      couponId: body.coupon_id,
    });

    // Billing event
    await supabaseInsert(env, 'billing_events', {
      event_id: generateId('be'),
      account_id: accounts[0].account_id,
      event_type: 'coupon_applied',
      details: { coupon_id: body.coupon_id, admin_user_id: admin.sub },
      performed_by: admin.sub,
    });

    await logAudit(env, admin.sub, 'apply_coupon', userId, accounts[0].account_id, { coupon_id: body.coupon_id }, getClientIp(request));

    return jsonResponse({ success: true, coupon_id: body.coupon_id });
  } catch (err) {
    return errorResponse(`Stripe error: ${err instanceof Error ? err.message : 'Unknown'}`, 502);
  }
}
