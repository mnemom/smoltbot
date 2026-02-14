import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  hashApiKey,
  generateSessionId,
  getOrCreateAgent,
  buildMetadataHeader,
  handleHealthCheck,
  handleAnthropicProxy,
  type Env,
} from '../index';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Helper to create test environment
function createTestEnv(overrides?: Partial<Env>): Env {
  return {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_KEY: 'test-supabase-key',
    CF_AI_GATEWAY_URL: 'https://gateway.ai.cloudflare.com/v1/test',
    CF_AIG_TOKEN: 'test-aig-token',
    GATEWAY_VERSION: '2.0.0',
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    AIP_ENABLED: 'false',
    ...overrides,
  };
}

// Helper to create mock execution context
function createMockContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hashApiKey', () => {
  it('should return a 16 character hex string', async () => {
    const result = await hashApiKey('test-api-key');

    expect(result).toHaveLength(16);
    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should produce consistent output for the same input', async () => {
    const result1 = await hashApiKey('same-key');
    const result2 = await hashApiKey('same-key');

    expect(result1).toBe(result2);
  });

  it('should produce different output for different inputs', async () => {
    const result1 = await hashApiKey('key-one');
    const result2 = await hashApiKey('key-two');

    expect(result1).not.toBe(result2);
  });

  it('should handle empty string input', async () => {
    const result = await hashApiKey('');

    expect(result).toHaveLength(16);
    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should handle special characters', async () => {
    const result = await hashApiKey('sk-ant-api03-!@#$%^&*()_+-=[]{}');

    expect(result).toHaveLength(16);
    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should only return first 16 characters of the full hash', async () => {
    // SHA-256 produces 64 hex chars, we want only first 16
    const result = await hashApiKey('test');

    expect(result).toHaveLength(16);
    // Verify it's not the full hash
    expect(result.length).toBeLessThan(64);
  });
});

describe('generateSessionId', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return format: agentHash-hourBucket', () => {
    vi.setSystemTime(new Date('2024-01-15T10:30:00Z'));
    const agentHash = 'abcd1234efgh5678';

    const result = generateSessionId(agentHash);

    expect(result).toMatch(/^abcd1234efgh5678-\d+$/);
  });

  it('should use hour-based bucketing', () => {
    const agentHash = 'testhash12345678';

    // Set time to specific hour
    vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));
    const result1 = generateSessionId(agentHash);

    // Same hour, different minute
    vi.setSystemTime(new Date('2024-01-15T10:45:00Z'));
    const result2 = generateSessionId(agentHash);

    expect(result1).toBe(result2);
  });

  it('should produce different session IDs for different hours', () => {
    const agentHash = 'testhash12345678';

    vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));
    const result1 = generateSessionId(agentHash);

    vi.setSystemTime(new Date('2024-01-15T11:00:00Z'));
    const result2 = generateSessionId(agentHash);

    expect(result1).not.toBe(result2);
  });

  it('should produce different session IDs for different agents in same hour', () => {
    vi.setSystemTime(new Date('2024-01-15T10:30:00Z'));

    const result1 = generateSessionId('agent111122223333');
    const result2 = generateSessionId('agent444455556666');

    expect(result1).not.toBe(result2);
    // But they should have the same hour bucket
    const bucket1 = result1.split('-')[1];
    const bucket2 = result2.split('-')[1];
    expect(bucket1).toBe(bucket2);
  });

  it('should calculate correct hour bucket value', () => {
    // Unix epoch + exactly 1 hour = 3600000ms, bucket = 1
    vi.setSystemTime(3600000);
    const result = generateSessionId('test');
    expect(result).toBe('test-1');

    // 2 hours = bucket 2
    vi.setSystemTime(7200000);
    const result2 = generateSessionId('test');
    expect(result2).toBe('test-2');
  });
});

describe('getOrCreateAgent', () => {
  const env = createTestEnv();
  const testAgentHash = 'abc123def456gh78';

  it('should return existing agent when found', async () => {
    const existingAgent = {
      id: 'agent-uuid-123',
      agent_hash: testAgentHash,
      name: 'Test Agent',
      created_at: '2024-01-01T00:00:00Z',
      last_seen: '2024-01-15T10:00:00Z',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([existingAgent]),
    });

    const result = await getOrCreateAgent(testAgentHash, env);

    expect(result.agent).toEqual(existingAgent);
    expect(result.isNew).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should create new agent when not found', async () => {
    const newAgent = {
      id: 'new-agent-uuid',
      agent_hash: testAgentHash,
      name: null,
      created_at: '2024-01-15T10:00:00Z',
      last_seen: '2024-01-15T10:00:00Z',
    };

    // First call - lookup returns empty
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    // Second call - create agent
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([newAgent]),
    });

    // Third call - create alignment card
    mockFetch.mockResolvedValueOnce({
      ok: true,
    });

    const result = await getOrCreateAgent(testAgentHash, env);

    expect(result.agent).toEqual(newAgent);
    expect(result.isNew).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should throw error on lookup failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    await expect(getOrCreateAgent(testAgentHash, env)).rejects.toThrow(
      'Supabase lookup failed: 500'
    );
  });

  it('should throw error on create failure', async () => {
    // Lookup returns empty
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    // Create fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Bad request'),
    });

    await expect(getOrCreateAgent(testAgentHash, env)).rejects.toThrow(
      'Failed to create agent: 400 - Bad request'
    );
  });

  it('should use correct Supabase headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ id: '123', agent_hash: testAgentHash }]),
    });

    await getOrCreateAgent(testAgentHash, env);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(env.SUPABASE_URL),
      expect.objectContaining({
        headers: expect.objectContaining({
          'apikey': env.SUPABASE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        }),
      })
    );
  });

  it('should query with correct agent_hash filter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ id: '123' }]),
    });
    mockFetch.mockResolvedValueOnce({ ok: true });

    await getOrCreateAgent(testAgentHash, env);

    expect(mockFetch).toHaveBeenCalledWith(
      `${env.SUPABASE_URL}/rest/v1/agents?agent_hash=eq.${testAgentHash}&select=*`,
      expect.any(Object)
    );
  });
});

describe('buildMetadataHeader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return valid JSON string', () => {
    const result = buildMetadataHeader('agent-123', 'hash123', 'session-456', '2.0.0');

    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('should include all required fields', () => {
    const result = buildMetadataHeader('agent-123', 'hash123', 'session-456', '2.0.0');
    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty('agent_id', 'agent-123');
    expect(parsed).toHaveProperty('agent_hash', 'hash123');
    expect(parsed).toHaveProperty('session_id', 'session-456');
    expect(parsed).toHaveProperty('gateway_version', '2.0.0');
    expect(parsed).toHaveProperty('timestamp');
  });

  it('should include ISO timestamp', () => {
    const result = buildMetadataHeader('agent-123', 'hash123', 'session-456', '2.0.0');
    const parsed = JSON.parse(result);

    expect(parsed.timestamp).toBe('2024-01-15T10:30:00.000Z');
  });

  it('should handle special characters in inputs', () => {
    const result = buildMetadataHeader(
      'agent-with-special-chars!@#',
      'hash/with/slashes',
      'session"with"quotes',
      'version-1.2.3-beta'
    );

    expect(() => JSON.parse(result)).not.toThrow();
    const parsed = JSON.parse(result);
    expect(parsed.agent_id).toBe('agent-with-special-chars!@#');
  });
});

describe('handleHealthCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return 200 status', () => {
    const env = createTestEnv();
    const response = handleHealthCheck(env);

    expect(response.status).toBe(200);
  });

  it('should return JSON content type', () => {
    const env = createTestEnv();
    const response = handleHealthCheck(env);

    expect(response.headers.get('Content-Type')).toBe('application/json');
  });

  it('should include status ok in body', async () => {
    const env = createTestEnv();
    const response = handleHealthCheck(env);
    const body = await response.json();

    expect(body.status).toBe('ok');
  });

  it('should include gateway version', async () => {
    const env = createTestEnv({ GATEWAY_VERSION: '3.0.0' });
    const response = handleHealthCheck(env);
    const body = await response.json();

    expect(body.version).toBe('3.0.0');
  });

  it('should include timestamp', async () => {
    const env = createTestEnv();
    const response = handleHealthCheck(env);
    const body = await response.json();

    expect(body.timestamp).toBe('2024-01-15T10:30:00.000Z');
  });
});

describe('handleAnthropicProxy', () => {
  const env = createTestEnv();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:30:00.000Z'));
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return 401 if x-api-key header is missing', async () => {
    const request = new Request('https://gateway.smoltbot.com/anthropic/v1/messages', {
      method: 'POST',
    });
    const ctx = createMockContext();

    const response = await handleAnthropicProxy(request, env, ctx);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Missing x-api-key header');
    expect(body.type).toBe('authentication_error');
  });

  it('should forward request to CF AI Gateway', async () => {
    const existingAgent = {
      id: 'agent-uuid-123',
      agent_hash: 'abcdef0123456789',
      name: null,
      created_at: '2024-01-01T00:00:00Z',
      last_seen: '2024-01-15T10:00:00Z',
    };

    // Agent lookup
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([existingAgent]),
    });

    // Forward request — must be a real Response so .text() works
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'msg_123' }), {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/json' },
      })
    );

    // Use GET request without body to avoid Node.js duplex stream issues
    const request = new Request('https://gateway.smoltbot.com/anthropic/v1/models', {
      method: 'GET',
      headers: {
        'x-api-key': 'sk-ant-test-key',
      },
    });
    const ctx = createMockContext();

    await handleAnthropicProxy(request, env, ctx);

    // Verify forward request was made
    // Calls: 1) agent lookup, 2) forward to CF gateway
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    const forwardCall = mockFetch.mock.calls[1];
    expect(forwardCall[0].url).toContain(env.CF_AI_GATEWAY_URL);
  });

  it('should strip /anthropic prefix from path when forwarding', async () => {
    const existingAgent = {
      id: 'agent-uuid-123',
      agent_hash: 'abcdef0123456789',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([existingAgent]),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      body: null,
    });

    const request = new Request('https://gateway.smoltbot.com/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'test-key' },
    });
    const ctx = createMockContext();

    await handleAnthropicProxy(request, env, ctx);

    const forwardCall = mockFetch.mock.calls[1];
    expect(forwardCall[0].url).toBe(`${env.CF_AI_GATEWAY_URL}/anthropic/v1/messages`);
  });

  it('should add cf-aig-metadata header to forwarded request', async () => {
    const existingAgent = {
      id: 'agent-uuid-123',
      agent_hash: 'abcdef0123456789',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([existingAgent]),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      body: null,
    });

    const request = new Request('https://gateway.smoltbot.com/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'test-key' },
    });
    const ctx = createMockContext();

    await handleAnthropicProxy(request, env, ctx);

    const forwardCall = mockFetch.mock.calls[1];
    const forwardRequest = forwardCall[0] as Request;
    const metadataHeader = forwardRequest.headers.get('cf-aig-metadata');

    expect(metadataHeader).toBeTruthy();
    const metadata = JSON.parse(metadataHeader!);
    expect(metadata).toHaveProperty('agent_id', 'agent-uuid-123');
    expect(metadata).toHaveProperty('session_id');
    expect(metadata).toHaveProperty('timestamp');
  });

  it('should add x-smoltbot-agent and x-smoltbot-session headers to response', async () => {
    const existingAgent = {
      id: 'agent-uuid-123',
      agent_hash: 'abcdef0123456789',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([existingAgent]),
    });

    // Must be a real Response so .text() works when the AIP pipeline buffers it
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 200, statusText: 'OK' })
    );

    const request = new Request('https://gateway.smoltbot.com/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'test-key' },
    });
    const ctx = createMockContext();

    const response = await handleAnthropicProxy(request, env, ctx);

    expect(response.headers.get('x-smoltbot-agent')).toBe('agent-uuid-123');
    expect(response.headers.get('x-smoltbot-session')).toBeTruthy();
  });

  it('should call waitUntil to update last_seen in background', async () => {
    const existingAgent = {
      id: 'agent-uuid-123',
      agent_hash: 'abcdef0123456789',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([existingAgent]),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      body: null,
    });

    const request = new Request('https://gateway.smoltbot.com/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'test-key' },
    });
    const ctx = createMockContext();

    await handleAnthropicProxy(request, env, ctx);

    expect(ctx.waitUntil).toHaveBeenCalled();
  });

  it('should return 500 on internal error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    const request = new Request('https://gateway.smoltbot.com/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'test-key' },
    });
    const ctx = createMockContext();

    const response = await handleAnthropicProxy(request, env, ctx);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.type).toBe('gateway_error');
    expect(body.message).toBe('Network failure');
  });

  it('should preserve query parameters when forwarding', async () => {
    const existingAgent = {
      id: 'agent-uuid-123',
      agent_hash: 'abcdef0123456789',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([existingAgent]),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      body: null,
    });

    const request = new Request('https://gateway.smoltbot.com/anthropic/v1/messages?stream=true', {
      method: 'POST',
      headers: { 'x-api-key': 'test-key' },
    });
    const ctx = createMockContext();

    await handleAnthropicProxy(request, env, ctx);

    const forwardCall = mockFetch.mock.calls[1];
    expect(forwardCall[0].url).toContain('?stream=true');
  });
});

describe('Request handler integration', () => {
  // Import the default export for integration tests
  let handler: { fetch: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> };

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    handler = (await import('../index')).default;
  });

  it('should handle OPTIONS requests for CORS preflight', async () => {
    const request = new Request('https://gateway.smoltbot.com/anthropic/v1/messages', {
      method: 'OPTIONS',
    });
    const env = createTestEnv();
    const ctx = createMockContext();

    const response = await handler.fetch(request, env, ctx);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('x-api-key');
  });

  it('should route /health to health check handler', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:30:00.000Z'));

    const request = new Request('https://gateway.smoltbot.com/health', {
      method: 'GET',
    });
    const env = createTestEnv();
    const ctx = createMockContext();

    const response = await handler.fetch(request, env, ctx);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');

    vi.useRealTimers();
  });

  it('should route /health/ (with trailing slash) to health check handler', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:30:00.000Z'));

    const request = new Request('https://gateway.smoltbot.com/health/', {
      method: 'GET',
    });
    const env = createTestEnv();
    const ctx = createMockContext();

    const response = await handler.fetch(request, env, ctx);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');

    vi.useRealTimers();
  });

  it('should return 404 for unknown paths', async () => {
    const request = new Request('https://gateway.smoltbot.com/unknown/path', {
      method: 'GET',
    });
    const env = createTestEnv();
    const ctx = createMockContext();

    const response = await handler.fetch(request, env, ctx);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.type).toBe('not_found');
  });

  it('should return 404 for root path', async () => {
    const request = new Request('https://gateway.smoltbot.com/', {
      method: 'GET',
    });
    const env = createTestEnv();
    const ctx = createMockContext();

    const response = await handler.fetch(request, env, ctx);

    expect(response.status).toBe(404);
  });

  it('should route /anthropic/* to proxy handler', async () => {
    const existingAgent = {
      id: 'agent-uuid-123',
      agent_hash: 'abcdef0123456789',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([existingAgent]),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      body: null,
    });

    const request = new Request('https://gateway.smoltbot.com/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'test-key' },
    });
    const env = createTestEnv();
    const ctx = createMockContext();

    const response = await handler.fetch(request, env, ctx);

    // Should either be 200 (success) or 401 (missing key) - not 404
    expect(response.status).not.toBe(404);
  });

  it('should route /anthropic (without trailing path) to proxy handler', async () => {
    const request = new Request('https://gateway.smoltbot.com/anthropic', {
      method: 'POST',
      headers: { 'x-api-key': 'test-key' },
    });
    const env = createTestEnv();
    const ctx = createMockContext();

    // Mock agent lookup for proxy handler
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ id: 'agent-123' }]),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      body: null,
    });

    const response = await handler.fetch(request, env, ctx);

    // Should not be 404
    expect(response.status).not.toBe(404);
  });
});
