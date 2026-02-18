/**
 * Phase 7: Hybrid Analysis API Handlers
 *
 * POST /v1/analyze — single analysis request
 * POST /v1/analyze/batch — batch analysis (1-50 items, synchronous)
 *
 * Authenticates via X-Mnemom-Api-Key header. Calls analysis LLM,
 * builds checkpoint, meters usage. Follows same module pattern as
 * admin/handlers.ts and licensing/handlers.ts.
 */

import type { BillingEnv } from '../billing/types';
import {
  checkIntegrity,
  buildConsciencePrompt,
  buildSignal,
  DEFAULT_CONSCIENCE_VALUES,
  WindowManager,
  type IntegrityCheckpoint,
  type ConscienceValue,
  type AlignmentCard,
} from '@mnemom/agent-integrity-protocol';
import type { AnalyzeRequest, AnalyzeResponse } from './types';

// ============================================
// Response helpers
// ============================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Mnemom-Api-Key, X-AIP-Version',
};

function jsonResponse(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...extraHeaders },
  });
}

function errorResponse(message: string, status: number, extraHeaders?: Record<string, string>): Response {
  return jsonResponse({ error: message }, status, extraHeaders);
}

// ============================================
// Supabase helpers
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
// SHA-256 helper
// ============================================

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ============================================
// Synthetic clear checkpoint (fail-open)
// ============================================

const SYNTHETIC_CLEAR: Partial<IntegrityCheckpoint> = {
  verdict: 'clear',
  concerns: [],
  reasoning_summary: 'Analysis unavailable; fail-open synthetic clear.',
};

// ============================================
// Rate limiter
// ============================================

interface RateLimitResult {
  allowed: boolean;
  remaining?: number;
}

async function checkRateLimit(
  env: BillingEnv,
  accountId: string,
  billingModel: string,
): Promise<RateLimitResult> {
  const cache = env.BILLING_CACHE;
  if (!cache) return { allowed: true };

  // Limits by billing model
  const limits: Record<string, number> = {
    subscription_plus_metered: 100,
    flat: 20,
    free: 5,
  };
  const limit = limits[billingModel] || 20;

  const epochSecond = Math.floor(Date.now() / 1000);
  const key = `rl:analyze:${accountId}:${epochSecond}`;

  try {
    const current = parseInt((await cache.get(key)) || '0', 10);
    if (current >= limit) {
      return { allowed: false, remaining: 0 };
    }
    await cache.put(key, String(current + 1), { expirationTtl: 5 });
    return { allowed: true, remaining: limit - current - 1 };
  } catch {
    // Fail-open on KV error
    return { allowed: true };
  }
}

// ============================================
// Quota evaluation
// ============================================

interface QuotaResult {
  allowed: boolean;
  reason?: string;
}

function evaluateQuota(quota: Record<string, unknown>): QuotaResult {
  if (quota.is_suspended) {
    return { allowed: false, reason: 'Account suspended' };
  }

  const status = quota.subscription_status as string;
  if (status === 'canceled' || status === 'unpaid') {
    return { allowed: false, reason: 'Subscription inactive' };
  }

  const included = (quota.included_checks as number) || 0;
  const used = (quota.check_count_this_period as number) || 0;
  const billingModel = quota.billing_model as string;

  // Free tier: hard limit
  if (billingModel === 'free' && used >= included) {
    return { allowed: false, reason: 'Free tier check limit reached' };
  }

  return { allowed: true };
}

// ============================================
// Validate analyze request body
// ============================================

function validateAnalyzeRequest(body: unknown): { valid: true; data: AnalyzeRequest } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body is required' };
  }

  const req = body as Record<string, unknown>;

  if (!req.thinking_block || typeof req.thinking_block !== 'string' || req.thinking_block.trim() === '') {
    return { valid: false, error: 'thinking_block is required and must be a non-empty string' };
  }

  const meta = req.thinking_metadata as Record<string, unknown> | undefined;
  if (!meta || typeof meta !== 'object') {
    return { valid: false, error: 'thinking_metadata is required' };
  }
  if (!meta.provider || typeof meta.provider !== 'string') {
    return { valid: false, error: 'thinking_metadata.provider is required' };
  }
  if (!meta.model || typeof meta.model !== 'string') {
    return { valid: false, error: 'thinking_metadata.model is required' };
  }

  if (!req.agent_id || typeof req.agent_id !== 'string') {
    return { valid: false, error: 'agent_id is required' };
  }
  if (!req.session_id || typeof req.session_id !== 'string') {
    return { valid: false, error: 'session_id is required' };
  }

  const card = req.card as Record<string, unknown> | undefined;
  if (!card || typeof card !== 'object') {
    return { valid: false, error: 'card is required' };
  }
  if (!card.card_id || typeof card.card_id !== 'string') {
    return { valid: false, error: 'card.card_id is required' };
  }
  if (!Array.isArray(card.values) || card.values.length === 0) {
    return { valid: false, error: 'card.values is required and must be a non-empty array' };
  }

  return { valid: true, data: body as AnalyzeRequest };
}

// ============================================
// Call analysis LLM
// ============================================

async function callAnalysisLLM(
  system: string,
  user: string,
  env: BillingEnv,
): Promise<{ text: string; error?: undefined } | { text?: undefined; error: string; timeout?: boolean }> {
  const anthropicKey = (env as unknown as Record<string, string>).ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return { error: 'Analysis LLM not configured' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { error: `Analysis LLM returned ${response.status}` };
    }

    const body = (await response.json()) as Record<string, unknown>;
    const content = body.content as Array<Record<string, unknown>> | undefined;

    if (!content || content.length === 0) {
      return { error: 'Analysis LLM returned empty content' };
    }

    const textBlock = content.find((b) => b.type === 'text');
    if (!textBlock || typeof textBlock.text !== 'string') {
      return { error: 'Analysis LLM returned no text content' };
    }

    return { text: textBlock.text };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { error: 'Analysis timeout', timeout: true };
    }
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================
// Process single analysis
// ============================================

async function processAnalysis(
  body: AnalyzeRequest,
  accountId: string,
  env: BillingEnv,
): Promise<{ response: AnalyzeResponse } | { error: string; status: number; extraHeaders?: Record<string, string> }> {
  // Build conscience prompt
  const card = body.card as unknown as AlignmentCard;
  const values: ConscienceValue[] = (body.conscience_values as ConscienceValue[]) || [...DEFAULT_CONSCIENCE_VALUES];

  // Reconstruct window context from summaries (minimal stubs)
  const windowCheckpoints: IntegrityCheckpoint[] = (body.window_context || []).map((ctx, i) => ({
    checkpoint_id: ctx.checkpoint_id,
    agent_id: body.agent_id,
    card_id: body.card.card_id,
    session_id: body.session_id,
    timestamp: new Date().toISOString(),
    thinking_block_hash: '',
    provider: body.thinking_metadata.provider,
    model: body.thinking_metadata.model,
    verdict: ctx.verdict as 'clear' | 'review_needed' | 'boundary_violation',
    concerns: [],
    reasoning_summary: ctx.reasoning_summary,
    conscience_context: { values_checked: [], conflicts: [], supports: [], considerations: [], consultation_depth: 'standard' as const },
    window_position: { index: i, window_size: (body.window_context || []).length },
    analysis_metadata: { analysis_model: 'claude-haiku-4-5-20251001', analysis_duration_ms: 0, thinking_tokens_original: 0, thinking_tokens_analyzed: 0, truncated: false, extraction_confidence: 1.0 },
    linked_trace_id: null,
  }));

  const taskContext = body.task_context ? body.task_context.slice(0, 200) : undefined;

  const prompt = buildConsciencePrompt({
    card,
    conscienceValues: values,
    windowContext: windowCheckpoints,
    thinkingBlock: body.thinking_block,
    taskContext,
  });

  // Call analysis LLM
  const analysisStartTime = Date.now();
  const llmResult = await callAnalysisLLM(prompt.system, prompt.user, env);
  const analysisDurationMs = Date.now() - analysisStartTime;

  if (llmResult.error) {
    if (llmResult.timeout) {
      const thinkingHash = await sha256(body.thinking_block);
      return {
        response: {
          checkpoint: {
            ...SYNTHETIC_CLEAR,
            checkpoint_id: `ic-${generateId('syn')}`,
            agent_id: body.agent_id,
            card_id: body.card.card_id,
            session_id: body.session_id,
            timestamp: new Date().toISOString(),
            thinking_block_hash: thinkingHash,
            provider: body.thinking_metadata.provider,
            model: body.thinking_metadata.model,
            window_position: { index: windowCheckpoints.length, window_size: windowCheckpoints.length + 1 },
            analysis_metadata: { analysis_model: 'claude-haiku-4-5-20251001', analysis_duration_ms: analysisDurationMs, thinking_tokens_original: prompt.originalTokens, thinking_tokens_analyzed: prompt.analyzedTokens, truncated: prompt.truncated, extraction_confidence: 1.0 },
            linked_trace_id: null,
          } as IntegrityCheckpoint,
          proceed: true,
          recommended_action: 'continue',
          metering: { event_id: '', account_id: accountId, billed: false },
        },
      };
    }
    return { error: 'Analysis unavailable', status: 503 };
  }

  // Strip markdown code fences
  const rawText = llmResult.text as string;
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  const analysisResponseText = jsonMatch ? jsonMatch[0] : rawText;

  // Hash thinking block
  const thinkingHash = await sha256(body.thinking_block);

  // Build checkpoint
  let checkpoint: IntegrityCheckpoint;
  try {
    checkpoint = checkIntegrity({
      analysisResponse: analysisResponseText,
      thinking: {
        hash: thinkingHash,
        provider: body.thinking_metadata.provider,
        model: body.thinking_metadata.model,
        tokensOriginal: prompt.originalTokens,
        tokensAnalyzed: prompt.analyzedTokens,
        truncated: prompt.truncated,
        confidence: 1.0,
      },
      agentId: body.agent_id,
      cardId: body.card.card_id,
      sessionId: body.session_id,
      windowPosition: {
        index: windowCheckpoints.length,
        window_size: windowCheckpoints.length + 1,
      },
      analysisModel: 'claude-haiku-4-5-20251001',
      analysisDurationMs,
    });
  } catch {
    // Unparseable LLM response — synthetic clear
    return {
      response: {
        checkpoint: {
          ...SYNTHETIC_CLEAR,
          checkpoint_id: `ic-${generateId('syn')}`,
          agent_id: body.agent_id,
          card_id: body.card.card_id,
          session_id: body.session_id,
          timestamp: new Date().toISOString(),
          thinking_block_hash: thinkingHash,
          provider: body.thinking_metadata.provider,
          model: body.thinking_metadata.model,
          window_position: { index: windowCheckpoints.length, window_size: windowCheckpoints.length + 1 },
          analysis_metadata: { analysis_model: 'claude-haiku-4-5-20251001', analysis_duration_ms: analysisDurationMs, thinking_tokens_original: prompt.originalTokens, thinking_tokens_analyzed: prompt.analyzedTokens, truncated: prompt.truncated, extraction_confidence: 1.0 },
          linked_trace_id: null,
        } as IntegrityCheckpoint,
        proceed: true,
        recommended_action: 'continue',
        metering: { event_id: '', account_id: accountId, billed: false },
      },
    };
  }

  // Build signal
  const windowManager = new WindowManager(
    { max_size: 10, mode: 'sliding', session_boundary: 'reset', max_age_seconds: 3600 },
    body.session_id,
  );
  for (const wc of windowCheckpoints) {
    windowManager.push(wc);
  }
  windowManager.push(checkpoint);
  const summary = windowManager.getSummary();
  const signal = buildSignal(checkpoint, summary);

  // Store checkpoint if requested (non-blocking)
  if (body.store_checkpoint) {
    try {
      await supabaseInsert(env, 'integrity_checkpoints', {
        checkpoint_id: checkpoint.checkpoint_id,
        agent_id: checkpoint.agent_id,
        card_id: checkpoint.card_id,
        session_id: checkpoint.session_id,
        thinking_block_hash: checkpoint.thinking_block_hash,
        provider: checkpoint.provider,
        model: checkpoint.model,
        verdict: checkpoint.verdict,
        concerns: checkpoint.concerns,
        reasoning_summary: checkpoint.reasoning_summary,
        conscience_context: checkpoint.conscience_context,
        window_position: checkpoint.window_position,
        analysis_metadata: checkpoint.analysis_metadata,
        source: 'hybrid_api',
      });
    } catch {
      console.warn('[analyze] Failed to store checkpoint');
    }

    // Emit webhook events (non-blocking, fail-open)
    try {
      const { emitWebhookEvent } = await import('../webhooks/emitter');

      // Always emit integrity.checkpoint
      await emitWebhookEvent(env, accountId, 'integrity.checkpoint', {
        checkpoint_id: checkpoint.checkpoint_id,
        agent_id: checkpoint.agent_id,
        session_id: checkpoint.session_id,
        verdict: checkpoint.verdict,
        concerns: checkpoint.concerns,
        reasoning_summary: checkpoint.reasoning_summary,
      });

      // Emit integrity.violation if boundary_violation
      if (checkpoint.verdict === 'boundary_violation') {
        await emitWebhookEvent(env, accountId, 'integrity.violation', {
          checkpoint_id: checkpoint.checkpoint_id,
          agent_id: checkpoint.agent_id,
          session_id: checkpoint.session_id,
          verdict: checkpoint.verdict,
          concerns: checkpoint.concerns,
          reasoning_summary: checkpoint.reasoning_summary,
        });
      }

      // Emit conscience.escalation if conscience conflicts detected
      const conscienceCtx = checkpoint.conscience_context as unknown as Record<string, unknown> | undefined;
      if (conscienceCtx?.conflicts && Array.isArray(conscienceCtx.conflicts) && conscienceCtx.conflicts.length > 0) {
        await emitWebhookEvent(env, accountId, 'conscience.escalation', {
          checkpoint_id: checkpoint.checkpoint_id,
          agent_id: checkpoint.agent_id,
          session_id: checkpoint.session_id,
          conflicts: conscienceCtx.conflicts,
          verdict: checkpoint.verdict,
        });
      }
    } catch {
      // Fail-open: never block the primary operation
    }
  }

  // Meter (non-blocking, fail-open)
  const meteringEventId = generateId('me');
  try {
    await supabaseInsert(env, 'metering_events', {
      event_id: meteringEventId,
      account_id: accountId,
      agent_id: body.agent_id,
      event_type: 'integrity_check',
      metadata: { checkpoint_id: checkpoint.checkpoint_id, source: 'hybrid_api' },
    });
  } catch {
    console.warn('[analyze] Failed to record metering event');
  }

  return {
    response: {
      checkpoint,
      proceed: signal.proceed,
      recommended_action: signal.recommended_action,
      window_summary: {
        size: summary.size,
        verdicts: summary.verdicts,
      },
      metering: {
        event_id: meteringEventId,
        account_id: accountId,
        billed: true,
      },
    },
  };
}

// ============================================
// POST /v1/analyze
// ============================================

export async function handleAnalyze(
  env: BillingEnv,
  request: Request,
): Promise<Response> {
  // Authenticate via API key
  const apiKey = request.headers.get('X-Mnemom-Api-Key');
  if (!apiKey) {
    return errorResponse('X-Mnemom-Api-Key header is required', 401);
  }

  const keyHash = await sha256(apiKey);
  const { data: quotaData, error: quotaError } = await supabaseRpc(env, 'resolve_analyze_quota', {
    p_key_hash: keyHash,
  });
  if (quotaError) return errorResponse('Service temporarily unavailable', 503);

  const quota = quotaData as Record<string, unknown>;
  if (!quota || !quota.valid) {
    const reason = quota?.reason as string;
    if (reason === 'insufficient_scope') return errorResponse('API key lacks analyze scope', 403);
    if (reason === 'account_suspended') return errorResponse('Account suspended', 402);
    return errorResponse('Invalid API key', 401);
  }

  const accountId = quota.account_id as string;
  const billingModel = (quota.billing_model as string) || 'free';

  // Rate limit
  const rateResult = await checkRateLimit(env, accountId, billingModel);
  if (!rateResult.allowed) {
    return errorResponse('Rate limit exceeded', 429, { 'Retry-After': '1' });
  }

  // Quota check
  const quotaResult = evaluateQuota(quota);
  if (!quotaResult.allowed) {
    return errorResponse(quotaResult.reason || 'Quota exceeded', 402);
  }

  // Parse and validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const validation = validateAnalyzeRequest(body);
  if (!validation.valid) {
    return errorResponse(validation.error, 400);
  }

  // Process analysis
  const result = await processAnalysis(validation.data, accountId, env);

  if ('error' in result) {
    return errorResponse(result.error, result.status, result.extraHeaders);
  }

  return jsonResponse(result.response);
}

// ============================================
// POST /v1/analyze/batch
// ============================================

export async function handleAnalyzeBatch(
  env: BillingEnv,
  request: Request,
): Promise<Response> {
  // Authenticate via API key
  const apiKey = request.headers.get('X-Mnemom-Api-Key');
  if (!apiKey) {
    return errorResponse('X-Mnemom-Api-Key header is required', 401);
  }

  const keyHash = await sha256(apiKey);
  const { data: quotaData, error: quotaError } = await supabaseRpc(env, 'resolve_analyze_quota', {
    p_key_hash: keyHash,
  });
  if (quotaError) return errorResponse('Service temporarily unavailable', 503);

  const quota = quotaData as Record<string, unknown>;
  if (!quota || !quota.valid) {
    const reason = quota?.reason as string;
    if (reason === 'insufficient_scope') return errorResponse('API key lacks analyze scope', 403);
    if (reason === 'account_suspended') return errorResponse('Account suspended', 402);
    return errorResponse('Invalid API key', 401);
  }

  const accountId = quota.account_id as string;

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const items = body.items as AnalyzeRequest[] | undefined;
  if (!Array.isArray(items) || items.length === 0) {
    return errorResponse('items array is required and must not be empty', 400);
  }
  if (items.length > 50) {
    return errorResponse('Maximum 50 items per batch', 400);
  }

  // Quota check at batch level
  const quotaResult = evaluateQuota(quota);
  if (!quotaResult.allowed) {
    return errorResponse(quotaResult.reason || 'Quota exceeded', 402);
  }

  // Process sequentially (avoid Anthropic rate limits)
  const results: Array<AnalyzeResponse | { error: string; index: number }> = [];
  let totalEvents = 0;

  for (let i = 0; i < items.length; i++) {
    const validation = validateAnalyzeRequest(items[i]);
    if (!validation.valid) {
      results.push({ error: validation.error, index: i });
      continue;
    }

    const result = await processAnalysis(validation.data, accountId, env);
    if ('error' in result) {
      results.push({ error: result.error, index: i });
    } else {
      results.push(result.response);
      totalEvents++;
    }
  }

  return jsonResponse({
    results,
    metering: {
      total_events: totalEvents,
      account_id: accountId,
    },
  });
}
