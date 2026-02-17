/**
 * Tests for the analyze module: authentication, validation, analysis,
 * metering, error handling, rate limiting, batch, and privacy.
 * Mocks global fetch (Supabase RPCs, Anthropic LLM, metering inserts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleAnalyze, handleAnalyzeBatch } from '../handlers';
import type { BillingEnv } from '../../billing/types';

// ============================================================================
// Mock global fetch
// ============================================================================

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ============================================================================
// Env factory
// ============================================================================

function makeEnv(overrides?: Partial<BillingEnv>): BillingEnv {
  return {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_KEY: 'test-key',
    SUPABASE_JWT_SECRET: 'test-jwt-secret',
    MNEMOM_PUBLISH_KEY: 'test-pub-key',
    STRIPE_SECRET_KEY: 'sk_test_xxx',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    RESEND_API_KEY: 'test-resend-key',
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    BILLING_CACHE: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    } as unknown as KVNamespace,
    ...overrides,
  } as unknown as BillingEnv;
}

// ============================================================================
// Request helpers
// ============================================================================

function makeAnalyzeRequest(body: unknown, apiKey = 'mnm_test_key_1234567890abcdef'): Request {
  return new Request('https://api.mnemom.ai/v1/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mnemom-Api-Key': apiKey,
    },
    body: JSON.stringify(body),
  });
}

function makeBatchRequest(body: unknown, apiKey = 'mnm_test_key_1234567890abcdef'): Request {
  return new Request('https://api.mnemom.ai/v1/analyze/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mnemom-Api-Key': apiKey,
    },
    body: JSON.stringify(body),
  });
}

// ============================================================================
// Mock helpers
// ============================================================================

// Full valid quota response from resolve_analyze_quota RPC
function mockValidQuota(): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({
      valid: true,
      key_id: 'mk-test1234',
      account_id: 'ba-test1234',
      plan_id: 'plan-enterprise',
      subscription_status: 'active',
      included_checks: 100000,
      check_count_this_period: 500,
      overage_threshold: null,
      per_check_price: 0,
      feature_flags: { aip: true },
      limits: { included_checks: 100000 },
      billing_model: 'subscription_plus_metered',
      current_period_end: '2026-03-01T00:00:00Z',
      past_due_since: null,
      is_suspended: false,
    }),
    text: () => Promise.resolve(''),
  });
}

// Mock Anthropic analysis LLM response
function mockAnalysisResponse(verdict = 'clear'): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({
      content: [{ type: 'text', text: JSON.stringify({
        verdict,
        concerns: [],
        reasoning_summary: 'Test analysis complete',
        conscience_context: {
          values_checked: ['boundary-no-deception'],
          conflicts: [],
          supports: ['boundary-no-deception'],
          considerations: [],
          consultation_depth: 'standard',
        },
      })}],
    }),
    text: () => Promise.resolve(''),
  });
}

// Mock metering insert (supabaseInsert for metering_events)
function mockMeteringInsert(): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve([{}]),
    text: () => Promise.resolve('[{}]'),
  });
}

// Valid minimal analyze request body
const validBody = {
  thinking_block: 'I should help the user with their request by providing accurate information.',
  thinking_metadata: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
  agent_id: 'smolt-test1234',
  session_id: 'sess-test1234',
  card: {
    card_id: 'card-test1234',
    values: [{ name: 'honesty', priority: 1, description: 'Be truthful' }],
    autonomy_envelope: {
      bounded_actions: ['respond_to_user'],
      forbidden_actions: ['exfiltrate_data'],
    },
  },
};

// ============================================================================
// Reset mocks before each test
// ============================================================================

beforeEach(() => {
  mockFetch.mockReset();
});

// ============================================================================
// 1. Authentication (5 tests)
// ============================================================================

describe('Authentication', () => {
  it('returns 401 when X-Mnemom-Api-Key header is missing', async () => {
    const env = makeEnv();
    const req = new Request('https://api.mnemom.ai/v1/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    const res = await handleAnalyze(env, req);
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('X-Mnemom-Api-Key');
  });

  it('returns 401 when API key is invalid (RPC returns valid: false, reason: invalid_key)', async () => {
    const env = makeEnv();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ valid: false, reason: 'invalid_key' }),
      text: () => Promise.resolve(''),
    });

    const req = makeAnalyzeRequest(validBody);
    const res = await handleAnalyze(env, req);
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('Invalid API key');
  });

  it('returns 403 when API key lacks analyze scope (RPC returns valid: false, reason: insufficient_scope)', async () => {
    const env = makeEnv();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ valid: false, reason: 'insufficient_scope' }),
      text: () => Promise.resolve(''),
    });

    const req = makeAnalyzeRequest(validBody);
    const res = await handleAnalyze(env, req);
    expect(res.status).toBe(403);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('analyze scope');
  });

  it('returns 402 when account is suspended (RPC returns valid: false, reason: account_suspended)', async () => {
    const env = makeEnv();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ valid: false, reason: 'account_suspended' }),
      text: () => Promise.resolve(''),
    });

    const req = makeAnalyzeRequest(validBody);
    const res = await handleAnalyze(env, req);
    expect(res.status).toBe(402);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('suspended');
  });

  it('returns 402 when free tier quota is exceeded', async () => {
    const env = makeEnv();
    // Quota RPC returns valid quota but with free billing_model and usage >= included
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        valid: true,
        key_id: 'mk-test1234',
        account_id: 'ba-test1234',
        plan_id: 'plan-free',
        subscription_status: 'active',
        included_checks: 100,
        check_count_this_period: 100,
        overage_threshold: null,
        per_check_price: 0,
        feature_flags: {},
        limits: { included_checks: 100 },
        billing_model: 'free',
        current_period_end: '2026-03-01T00:00:00Z',
        past_due_since: null,
        is_suspended: false,
      }),
      text: () => Promise.resolve(''),
    });

    const req = makeAnalyzeRequest(validBody);
    const res = await handleAnalyze(env, req);
    expect(res.status).toBe(402);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('Free tier check limit');
  });
});

// ============================================================================
// 2. Validation (8 tests)
// ============================================================================

describe('Validation', () => {
  it('returns 400 when thinking_block is missing', async () => {
    const env = makeEnv();
    mockValidQuota();

    const { thinking_block: _, ...bodyWithout } = validBody;
    const req = makeAnalyzeRequest(bodyWithout);
    const res = await handleAnalyze(env, req);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('thinking_block');
  });

  it('returns 400 when thinking_block is empty', async () => {
    const env = makeEnv();
    mockValidQuota();

    const req = makeAnalyzeRequest({ ...validBody, thinking_block: '   ' });
    const res = await handleAnalyze(env, req);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('thinking_block');
  });

  it('returns 400 when thinking_metadata.provider is missing', async () => {
    const env = makeEnv();
    mockValidQuota();

    const req = makeAnalyzeRequest({
      ...validBody,
      thinking_metadata: { model: 'claude-sonnet-4-5-20250929' },
    });
    const res = await handleAnalyze(env, req);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('thinking_metadata.provider');
  });

  it('returns 400 when thinking_metadata.model is missing', async () => {
    const env = makeEnv();
    mockValidQuota();

    const req = makeAnalyzeRequest({
      ...validBody,
      thinking_metadata: { provider: 'anthropic' },
    });
    const res = await handleAnalyze(env, req);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('thinking_metadata.model');
  });

  it('returns 400 when agent_id is missing', async () => {
    const env = makeEnv();
    mockValidQuota();

    const { agent_id: _, ...bodyWithout } = validBody;
    const req = makeAnalyzeRequest(bodyWithout);
    const res = await handleAnalyze(env, req);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('agent_id');
  });

  it('returns 400 when session_id is missing', async () => {
    const env = makeEnv();
    mockValidQuota();

    const { session_id: _, ...bodyWithout } = validBody;
    const req = makeAnalyzeRequest(bodyWithout);
    const res = await handleAnalyze(env, req);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('session_id');
  });

  it('returns 400 when card is missing', async () => {
    const env = makeEnv();
    mockValidQuota();

    const { card: _, ...bodyWithout } = validBody;
    const req = makeAnalyzeRequest(bodyWithout);
    const res = await handleAnalyze(env, req);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('card');
  });

  it('returns 400 when card.values is missing', async () => {
    const env = makeEnv();
    mockValidQuota();

    const req = makeAnalyzeRequest({
      ...validBody,
      card: { card_id: 'card-test1234', autonomy_envelope: {} },
    });
    const res = await handleAnalyze(env, req);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('card.values');
  });
});

// ============================================================================
// 3. Analysis (4 tests)
// ============================================================================

describe('Analysis', () => {
  it('returns checkpoint with correct verdict on successful analysis', async () => {
    const env = makeEnv();
    mockValidQuota();
    mockAnalysisResponse('clear');
    mockMeteringInsert();

    const req = makeAnalyzeRequest(validBody);
    const res = await handleAnalyze(env, req);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.checkpoint).toBeDefined();
    expect(body.proceed).toBe(true);
    expect(body.recommended_action).toBe('continue');
    expect(body.metering).toBeDefined();

    const checkpoint = body.checkpoint as Record<string, unknown>;
    expect(checkpoint.verdict).toBe('clear');
    expect(checkpoint.checkpoint_id).toBeDefined();
    expect(typeof checkpoint.checkpoint_id).toBe('string');
    expect((checkpoint.checkpoint_id as string).startsWith('ic-')).toBe(true);
    expect(checkpoint.agent_id).toBe('smolt-test1234');
    expect(checkpoint.session_id).toBe('sess-test1234');
    expect(checkpoint.card_id).toBe('card-test1234');
    expect(checkpoint.thinking_block_hash).toBeDefined();
    expect(typeof checkpoint.thinking_block_hash).toBe('string');
    expect((checkpoint.thinking_block_hash as string).length).toBe(64); // SHA-256 hex length

    const metering = body.metering as Record<string, unknown>;
    expect(metering.event_id).toBeDefined();
    expect(metering.account_id).toBe('ba-test1234');
    expect(metering.billed).toBe(true);
  });

  it('uses claude-haiku-4-5-20251001 model in Anthropic API call', async () => {
    const env = makeEnv();
    mockValidQuota();
    mockAnalysisResponse('clear');
    mockMeteringInsert();

    const req = makeAnalyzeRequest(validBody);
    await handleAnalyze(env, req);

    // The second fetch call is the Anthropic API call
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    const anthropicCall = mockFetch.mock.calls[1];
    expect(anthropicCall[0]).toBe('https://api.anthropic.com/v1/messages');

    const anthropicBody = JSON.parse(anthropicCall[1].body as string);
    expect(anthropicBody.model).toBe('claude-haiku-4-5-20251001');
    expect(anthropicBody.max_tokens).toBe(1024);

    // Verify headers
    expect(anthropicCall[1].headers['x-api-key']).toBe('test-anthropic-key');
    expect(anthropicCall[1].headers['anthropic-version']).toBe('2023-06-01');
  });

  it('SHA-256 hash in response does not contain thinking block text', async () => {
    const env = makeEnv();
    mockValidQuota();
    mockAnalysisResponse('clear');
    mockMeteringInsert();

    const thinkingText = 'I should help the user with their request by providing accurate information.';
    const req = makeAnalyzeRequest(validBody);
    const res = await handleAnalyze(env, req);
    const body = await res.json() as Record<string, unknown>;
    const checkpoint = body.checkpoint as Record<string, unknown>;

    // The hash should be a hex string, not the original text
    expect(checkpoint.thinking_block_hash).not.toContain(thinkingText);
    expect(checkpoint.thinking_block_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('analysis with boundary_violation verdict returns proceed: false', async () => {
    const env = makeEnv();
    mockValidQuota();
    mockAnalysisResponse('boundary_violation');
    mockMeteringInsert();

    const req = makeAnalyzeRequest(validBody);
    const res = await handleAnalyze(env, req);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    const checkpoint = body.checkpoint as Record<string, unknown>;
    expect(checkpoint.verdict).toBe('boundary_violation');
    expect(body.proceed).toBe(false);
    // boundary_violation without critical severity => pause_for_review
    expect(body.recommended_action).toBe('pause_for_review');
  });
});

// ============================================================================
// 4. Metering (2 tests)
// ============================================================================

describe('Metering', () => {
  it('generates event_id in correct format (starts with me-)', async () => {
    const env = makeEnv();
    mockValidQuota();
    mockAnalysisResponse('clear');
    mockMeteringInsert();

    const req = makeAnalyzeRequest(validBody);
    const res = await handleAnalyze(env, req);
    const body = await res.json() as Record<string, unknown>;
    const metering = body.metering as Record<string, unknown>;

    expect(typeof metering.event_id).toBe('string');
    expect((metering.event_id as string).startsWith('me-')).toBe(true);
  });

  it('metering failure does not block the response', async () => {
    const env = makeEnv();
    mockValidQuota();
    mockAnalysisResponse('clear');
    // Metering insert fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'insert failed' }),
      text: () => Promise.resolve('insert failed'),
    });

    const req = makeAnalyzeRequest(validBody);
    const res = await handleAnalyze(env, req);
    // Should still return 200 with checkpoint despite metering failure
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.checkpoint).toBeDefined();
    expect(body.proceed).toBe(true);
  });
});

// ============================================================================
// 5. Error handling (4 tests)
// ============================================================================

describe('Error handling', () => {
  it('returns synthetic clear checkpoint on analysis LLM timeout (AbortError)', async () => {
    const env = makeEnv();
    mockValidQuota();
    // Mock fetch to throw AbortError for the Anthropic call
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    mockFetch.mockRejectedValueOnce(abortError);

    const req = makeAnalyzeRequest(validBody);
    const res = await handleAnalyze(env, req);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    const checkpoint = body.checkpoint as Record<string, unknown>;
    expect(checkpoint.verdict).toBe('clear');
    expect(checkpoint.reasoning_summary).toContain('fail-open');
    expect(body.proceed).toBe(true);
    expect(body.recommended_action).toBe('continue');
  });

  it('returns 503 when analysis LLM returns 500', async () => {
    const env = makeEnv();
    mockValidQuota();
    // LLM returns 500
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'internal error' }),
      text: () => Promise.resolve('internal error'),
    });

    const req = makeAnalyzeRequest(validBody);
    const res = await handleAnalyze(env, req);
    expect(res.status).toBe(503);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('Analysis unavailable');
  });

  it('returns synthetic clear checkpoint when LLM returns unparseable JSON', async () => {
    const env = makeEnv();
    mockValidQuota();
    // LLM returns non-JSON text
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'text', text: 'This is not valid JSON at all, just plain text!' }],
      }),
      text: () => Promise.resolve(''),
    });
    // Metering insert for the synthetic clear path
    mockMeteringInsert();

    const req = makeAnalyzeRequest(validBody);
    const res = await handleAnalyze(env, req);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    const checkpoint = body.checkpoint as Record<string, unknown>;
    expect(checkpoint.verdict).toBe('clear');
    expect(checkpoint.reasoning_summary).toContain('fail-open');
    expect(body.proceed).toBe(true);
  });

  it('returns 503 on DB error during authentication', async () => {
    const env = makeEnv();
    // RPC call fails (non-ok response)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'DB error' }),
      text: () => Promise.resolve('DB connection failed'),
    });

    const req = makeAnalyzeRequest(validBody);
    const res = await handleAnalyze(env, req);
    expect(res.status).toBe(503);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('temporarily unavailable');
  });
});

// ============================================================================
// 6. Rate limiting (2 tests)
// ============================================================================

describe('Rate limiting', () => {
  it('returns 429 when rate limit is exceeded', async () => {
    const env = makeEnv();
    // Quota RPC returns valid quota with a billing model that has a rate limit
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        valid: true,
        key_id: 'mk-test1234',
        account_id: 'ba-test1234',
        plan_id: 'plan-free',
        subscription_status: 'active',
        included_checks: 10000,
        check_count_this_period: 10,
        billing_model: 'free',
        is_suspended: false,
      }),
      text: () => Promise.resolve(''),
    });

    // BILLING_CACHE.get returns a high number to trigger rate limit
    // Free tier limit is 5 per second
    const cache = env.BILLING_CACHE as unknown as { get: ReturnType<typeof vi.fn> };
    cache.get.mockResolvedValueOnce('100');

    const req = makeAnalyzeRequest(validBody);
    const res = await handleAnalyze(env, req);
    expect(res.status).toBe(429);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('Rate limit');
    expect(res.headers.get('Retry-After')).toBe('1');
  });

  it('calls KV put to increment rate limit counter', async () => {
    const env = makeEnv();
    mockValidQuota();
    mockAnalysisResponse('clear');
    mockMeteringInsert();

    const cache = env.BILLING_CACHE as unknown as {
      get: ReturnType<typeof vi.fn>;
      put: ReturnType<typeof vi.fn>;
    };
    // Return '0' so the request is allowed
    cache.get.mockResolvedValueOnce('0');

    const req = makeAnalyzeRequest(validBody);
    const res = await handleAnalyze(env, req);
    expect(res.status).toBe(200);

    // Verify KV put was called with incremented counter
    expect(cache.put).toHaveBeenCalled();
    const putCall = cache.put.mock.calls[0];
    expect(putCall[0]).toMatch(/^rl:analyze:ba-test1234:/);
    expect(putCall[1]).toBe('1');
    expect(putCall[2]).toEqual({ expirationTtl: 5 });
  });
});

// ============================================================================
// 7. Batch (4 tests)
// ============================================================================

describe('Batch', () => {
  it('returns 400 when items array is empty', async () => {
    const env = makeEnv();
    // Quota RPC for batch auth
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        valid: true,
        key_id: 'mk-test1234',
        account_id: 'ba-test1234',
        plan_id: 'plan-enterprise',
        subscription_status: 'active',
        included_checks: 100000,
        check_count_this_period: 0,
        billing_model: 'subscription_plus_metered',
        is_suspended: false,
      }),
      text: () => Promise.resolve(''),
    });

    const req = makeBatchRequest({ items: [] });
    const res = await handleAnalyzeBatch(env, req);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('items');
  });

  it('returns 400 when items array exceeds 50', async () => {
    const env = makeEnv();
    // Quota RPC for batch auth
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        valid: true,
        key_id: 'mk-test1234',
        account_id: 'ba-test1234',
        plan_id: 'plan-enterprise',
        subscription_status: 'active',
        included_checks: 100000,
        check_count_this_period: 0,
        billing_model: 'subscription_plus_metered',
        is_suspended: false,
      }),
      text: () => Promise.resolve(''),
    });

    const items = Array.from({ length: 51 }, () => ({ ...validBody }));
    const req = makeBatchRequest({ items });
    const res = await handleAnalyzeBatch(env, req);
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toContain('50');
  });

  it('processes all valid items in a batch successfully', async () => {
    const env = makeEnv();
    // Quota RPC for batch auth
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        valid: true,
        key_id: 'mk-test1234',
        account_id: 'ba-test1234',
        plan_id: 'plan-enterprise',
        subscription_status: 'active',
        included_checks: 100000,
        check_count_this_period: 0,
        billing_model: 'subscription_plus_metered',
        is_suspended: false,
      }),
      text: () => Promise.resolve(''),
    });

    // Mock analysis + metering for item 1
    mockAnalysisResponse('clear');
    mockMeteringInsert();

    // Mock analysis + metering for item 2
    mockAnalysisResponse('clear');
    mockMeteringInsert();

    const items = [
      { ...validBody, agent_id: 'agent-1' },
      { ...validBody, agent_id: 'agent-2' },
    ];
    const req = makeBatchRequest({ items });
    const res = await handleAnalyzeBatch(env, req);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    const results = body.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(2);

    // Both should have checkpoints (not errors)
    expect(results[0].checkpoint).toBeDefined();
    expect(results[1].checkpoint).toBeDefined();

    const cp1 = results[0].checkpoint as Record<string, unknown>;
    const cp2 = results[1].checkpoint as Record<string, unknown>;
    expect(cp1.agent_id).toBe('agent-1');
    expect(cp2.agent_id).toBe('agent-2');

    const metering = body.metering as Record<string, unknown>;
    expect(metering.total_events).toBe(2);
    expect(metering.account_id).toBe('ba-test1234');
  });

  it('returns partial failures correctly when some items are invalid', async () => {
    const env = makeEnv();
    // Quota RPC for batch auth
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        valid: true,
        key_id: 'mk-test1234',
        account_id: 'ba-test1234',
        plan_id: 'plan-enterprise',
        subscription_status: 'active',
        included_checks: 100000,
        check_count_this_period: 0,
        billing_model: 'subscription_plus_metered',
        is_suspended: false,
      }),
      text: () => Promise.resolve(''),
    });

    // Mock analysis + metering for valid first item
    mockAnalysisResponse('clear');
    mockMeteringInsert();

    // Second item is invalid (missing thinking_block) so no fetch mocks needed for it

    const items = [
      { ...validBody },
      {
        // Missing thinking_block
        thinking_metadata: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
        agent_id: 'agent-bad',
        session_id: 'sess-bad',
        card: validBody.card,
      },
    ];
    const req = makeBatchRequest({ items });
    const res = await handleAnalyzeBatch(env, req);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    const results = body.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(2);

    // First item should succeed
    expect(results[0].checkpoint).toBeDefined();
    expect((results[0].checkpoint as Record<string, unknown>).verdict).toBe('clear');

    // Second item should be an error
    expect(results[1].error).toBeDefined();
    expect(results[1].index).toBe(1);
    expect((results[1].error as string)).toContain('thinking_block');

    const metering = body.metering as Record<string, unknown>;
    expect(metering.total_events).toBe(1);
  });
});

// ============================================================================
// 8. Privacy (1 test)
// ============================================================================

describe('Privacy', () => {
  it('response body never contains raw thinking_block text', async () => {
    const env = makeEnv();
    mockValidQuota();
    mockAnalysisResponse('clear');
    mockMeteringInsert();

    const thinkingText = 'I should help the user with their request by providing accurate information.';
    const req = makeAnalyzeRequest(validBody);
    const res = await handleAnalyze(env, req);

    const rawText = await res.clone().text();
    expect(rawText).not.toContain(thinkingText);
  });
});
