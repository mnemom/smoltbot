# Smoltbot Test Plan

**Comprehensive Testing Strategy for AAP-Compliant Transparent Agent Infrastructure**

*Aligned with SMOLTBOT_AAP_ARCHITECTURE_V2.md and SMOLTBOT_IMPLEMENTATION_PLAN_V3.md*

---

## Table of Contents

1. [Unit Tests](#1-unit-tests)
2. [Integration Tests](#2-integration-tests)
3. [E2E Tests](#3-e2e-tests)
4. [AAP Compliance Tests](#4-aap-compliance-tests)
5. [Test Infrastructure](#5-test-infrastructure)
6. [Test Matrix](#6-test-matrix)

---

## 1. Unit Tests

### 1.1 Gateway Worker (`gateway/`)

#### 1.1.1 API Key Hashing

**File:** `gateway/src/__tests__/auth.test.ts`

```typescript
describe('hashApiKey', () => {
  it('should produce SHA-256 hash truncated to 16 characters', async () => {
    const apiKey = 'sk-ant-api03-test-key-12345';
    const hash = await hashApiKey(apiKey);

    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should produce consistent hashes for same input', async () => {
    const apiKey = 'sk-ant-api03-consistent-key';
    const hash1 = await hashApiKey(apiKey);
    const hash2 = await hashApiKey(apiKey);

    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different inputs', async () => {
    const hash1 = await hashApiKey('sk-ant-key-1');
    const hash2 = await hashApiKey('sk-ant-key-2');

    expect(hash1).not.toBe(hash2);
  });

  it('should handle empty string', async () => {
    const hash = await hashApiKey('');

    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should handle unicode characters', async () => {
    const hash = await hashApiKey('sk-ant-key-with-unicode-');

    expect(hash).toHaveLength(16);
  });
});
```

#### 1.1.2 Agent Lookup/Creation Logic

**File:** `gateway/src/__tests__/agents.test.ts`

```typescript
describe('getOrCreateAgent', () => {
  const mockEnv = {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_KEY: 'test-key',
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return existing agent when hash matches', async () => {
    mockFetch([{ id: 'smolt-existing' }]);

    const agentId = await getOrCreateAgent('abc123def456', mockEnv);

    expect(agentId).toBe('smolt-existing');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('should create new agent when hash not found', async () => {
    mockFetch([]); // No existing agent
    mockFetch({ id: 'smolt-abc123de' }); // Creation response

    const agentId = await getOrCreateAgent('abc123def456ghij', mockEnv);

    expect(agentId).toBe('smolt-abc123de');
    expect(fetch).toHaveBeenCalledTimes(3); // lookup + create agent + create card
  });

  it('should generate agent ID from first 8 chars of hash', async () => {
    mockFetch([]);
    mockFetch({});

    const agentId = await getOrCreateAgent('1234567890abcdef', mockEnv);

    expect(agentId).toBe('smolt-12345678');
  });

  it('should create default alignment card for new agent', async () => {
    mockFetch([]);
    mockFetch({});
    mockFetch({}); // Card creation

    await getOrCreateAgent('abc123def456ghij', mockEnv);

    const cardCall = fetch.mock.calls.find(
      call => call[0].includes('alignment_cards')
    );
    expect(cardCall).toBeDefined();

    const cardBody = JSON.parse(cardCall[1].body);
    expect(cardBody.is_active).toBe(true);
    expect(cardBody.card_json.aap_version).toBe('0.1.0');
  });

  it('should handle Supabase errors gracefully', async () => {
    mockFetch(null, { status: 500 });

    await expect(getOrCreateAgent('abc123', mockEnv))
      .rejects.toThrow();
  });
});
```

#### 1.1.3 Session ID Generation

**File:** `gateway/src/__tests__/sessions.test.ts`

```typescript
describe('generateSessionId', () => {
  it('should create session ID with agent hash prefix', () => {
    const sessionId = generateSessionId('abc123def456ghij');

    expect(sessionId).toMatch(/^sess-abc123de-\d+$/);
  });

  it('should use hour-bucket for time component', () => {
    const now = Date.now();
    const hourBucket = Math.floor(now / (1000 * 60 * 60));

    const sessionId = generateSessionId('abc123def456ghij');

    expect(sessionId).toContain(hourBucket.toString());
  });

  it('should produce same session ID within same hour', () => {
    const id1 = generateSessionId('abc123def456ghij');
    const id2 = generateSessionId('abc123def456ghij');

    expect(id1).toBe(id2);
  });

  it('should produce different session IDs for different agents', () => {
    const id1 = generateSessionId('abc123def456ghij');
    const id2 = generateSessionId('xyz789uvw012klmn');

    expect(id1).not.toBe(id2);
  });
});
```

#### 1.1.4 Metadata Header Construction

**File:** `gateway/src/__tests__/metadata.test.ts`

```typescript
describe('buildMetadataHeader', () => {
  it('should include all required fields', () => {
    const metadata = buildMetadataHeader({
      agentId: 'smolt-abc123',
      agentHash: 'abc123def456ghij',
      sessionId: 'sess-abc123de-12345',
      gatewayVersion: '2.0.0',
    });

    const parsed = JSON.parse(metadata);

    expect(parsed.agent_id).toBe('smolt-abc123');
    expect(parsed.agent_hash).toBe('abc123def456ghij');
    expect(parsed.session_id).toBe('sess-abc123de-12345');
    expect(parsed.gateway_version).toBe('2.0.0');
    expect(parsed.timestamp).toBeDefined();
  });

  it('should produce valid JSON', () => {
    const metadata = buildMetadataHeader({
      agentId: 'smolt-test',
      agentHash: 'testhash1234',
      sessionId: 'sess-test-1',
      gatewayVersion: '2.0.0',
    });

    expect(() => JSON.parse(metadata)).not.toThrow();
  });

  it('should include ISO 8601 timestamp', () => {
    const metadata = buildMetadataHeader({
      agentId: 'smolt-test',
      agentHash: 'testhash1234',
      sessionId: 'sess-test-1',
      gatewayVersion: '2.0.0',
    });

    const parsed = JSON.parse(metadata);
    const timestamp = new Date(parsed.timestamp);

    expect(timestamp.toISOString()).toBe(parsed.timestamp);
  });
});
```

#### 1.1.5 Request Forwarding

**File:** `gateway/src/__tests__/forwarding.test.ts`

```typescript
describe('request forwarding', () => {
  it('should forward to correct AI Gateway URL', async () => {
    const request = new Request('https://gateway.mnemom.ai/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'sk-ant-test' },
      body: JSON.stringify({ model: 'claude-3-haiku' }),
    });

    await handleRequest(request, mockEnv);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('gateway.ai.cloudflare.com'),
      expect.anything()
    );
  });

  it('should preserve original request body', async () => {
    const body = { model: 'claude-3-haiku', messages: [] };
    const request = new Request('https://gateway.mnemom.ai/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'sk-ant-test' },
      body: JSON.stringify(body),
    });

    await handleRequest(request, mockEnv);

    const forwardedBody = JSON.parse(fetch.mock.calls[0][1].body);
    expect(forwardedBody).toEqual(body);
  });

  it('should add cf-aig-metadata header', async () => {
    const request = new Request('https://gateway.mnemom.ai/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'sk-ant-test' },
    });

    await handleRequest(request, mockEnv);

    const headers = fetch.mock.calls[0][1].headers;
    expect(headers.get('cf-aig-metadata')).toBeDefined();
  });

  it('should add response headers with agent info', async () => {
    mockFetch({ content: [] });

    const request = new Request('https://gateway.mnemom.ai/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'sk-ant-test' },
    });

    const response = await handleRequest(request, mockEnv);

    expect(response.headers.get('x-smoltbot-agent')).toBeDefined();
    expect(response.headers.get('x-smoltbot-session')).toBeDefined();
  });

  it('should strip /anthropic prefix from path', async () => {
    const request = new Request('https://gateway.mnemom.ai/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'sk-ant-test' },
    });

    await handleRequest(request, mockEnv);

    const url = fetch.mock.calls[0][0];
    expect(url).toContain('/v1/messages');
    expect(url).not.toContain('/anthropic/anthropic');
  });
});
```

#### 1.1.6 Error Handling

**File:** `gateway/src/__tests__/errors.test.ts`

```typescript
describe('error handling', () => {
  it('should return 401 when API key is missing', async () => {
    const request = new Request('https://gateway.mnemom.ai/anthropic/v1/messages', {
      method: 'POST',
    });

    const response = await handleRequest(request, mockEnv);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Missing API key');
  });

  it('should return 404 for non-anthropic paths', async () => {
    const request = new Request('https://gateway.mnemom.ai/openai/v1/chat', {
      method: 'POST',
      headers: { 'x-api-key': 'sk-ant-test' },
    });

    const response = await handleRequest(request, mockEnv);

    expect(response.status).toBe(404);
  });

  it('should return 502 on upstream failure', async () => {
    mockFetch(null, { status: 500 });

    const request = new Request('https://gateway.mnemom.ai/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'sk-ant-test' },
    });

    const response = await handleRequest(request, mockEnv);

    expect(response.status).toBe(502);
  });

  it('should return health check on /health', async () => {
    const request = new Request('https://gateway.mnemom.ai/health');

    const response = await handleRequest(request, mockEnv);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
  });
});
```

---

### 1.2 Observer Worker (`observer/`)

#### 1.2.1 Log Fetching from Cloudflare AI Gateway API

**File:** `observer/src/__tests__/gateway-api.test.ts`

```typescript
describe('fetchLogs', () => {
  const mockEnv = {
    CF_ACCOUNT_ID: 'test-account',
    CF_API_TOKEN: 'test-token',
    GATEWAY_ID: 'smoltbot',
  };

  it('should call correct Cloudflare API endpoint', async () => {
    mockFetch({ result: [] });

    await fetchLogs(mockEnv);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`accounts/${mockEnv.CF_ACCOUNT_ID}/ai-gateway/gateways/${mockEnv.GATEWAY_ID}/logs`),
      expect.anything()
    );
  });

  it('should include authorization header', async () => {
    mockFetch({ result: [] });

    await fetchLogs(mockEnv);

    const headers = fetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe(`Bearer ${mockEnv.CF_API_TOKEN}`);
  });

  it('should return array of logs', async () => {
    const mockLogs = [
      { id: 'log-1', created_at: '2026-02-04T00:00:00Z' },
      { id: 'log-2', created_at: '2026-02-04T00:01:00Z' },
    ];
    mockFetch({ result: mockLogs });

    const logs = await fetchLogs(mockEnv);

    expect(logs).toEqual(mockLogs);
  });

  it('should handle empty results', async () => {
    mockFetch({ result: [] });

    const logs = await fetchLogs(mockEnv);

    expect(logs).toEqual([]);
  });

  it('should throw on API error', async () => {
    mockFetch(null, { status: 401 });

    await expect(fetchLogs(mockEnv)).rejects.toThrow('Gateway API error: 401');
  });
});

describe('fetchResponseBody', () => {
  it('should fetch individual log details', async () => {
    mockFetch({ result: { response_body: 'test response' } });

    const body = await fetchResponseBody('log-123', mockEnv);

    expect(body).toBe('test response');
  });

  it('should return empty string if no response body', async () => {
    mockFetch({ result: {} });

    const body = await fetchResponseBody('log-123', mockEnv);

    expect(body).toBe('');
  });
});

describe('deleteLog', () => {
  it('should call DELETE on log endpoint', async () => {
    mockFetch({});

    await deleteLog('log-123', mockEnv);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('logs/log-123'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});
```

#### 1.2.2 Thinking Block Extraction

**File:** `observer/src/__tests__/thinking-extraction.test.ts`

```typescript
describe('extractThinking', () => {
  it('should extract content from <think> tags', () => {
    const response = 'Hello <think>I am thinking about this</think> world';

    const thinking = extractThinking(response);

    expect(thinking).toBe('I am thinking about this');
  });

  it('should extract content from <thinking> tags', () => {
    const response = '<thinking>Deep thoughts here</thinking> Answer';

    const thinking = extractThinking(response);

    expect(thinking).toBe('Deep thoughts here');
  });

  it('should handle multiple thinking blocks', () => {
    const response = '<think>First thought</think> text <think>Second thought</think>';

    const thinking = extractThinking(response);

    expect(thinking).toContain('First thought');
    expect(thinking).toContain('Second thought');
    expect(thinking).toContain('---');
  });

  it('should handle multiline thinking blocks', () => {
    const response = `<think>
      Line 1
      Line 2
      Line 3
    </think>`;

    const thinking = extractThinking(response);

    expect(thinking).toContain('Line 1');
    expect(thinking).toContain('Line 2');
    expect(thinking).toContain('Line 3');
  });

  it('should return null when no thinking blocks present', () => {
    const response = 'Just a normal response without thinking';

    const thinking = extractThinking(response);

    expect(thinking).toBeNull();
  });

  it('should handle case-insensitive tags', () => {
    const response = '<THINK>Uppercase</THINK> and <Think>Mixed</Think>';

    const thinking = extractThinking(response);

    expect(thinking).toContain('Uppercase');
    expect(thinking).toContain('Mixed');
  });

  it('should trim whitespace from extracted content', () => {
    const response = '<think>   padded content   </think>';

    const thinking = extractThinking(response);

    expect(thinking).toBe('padded content');
  });

  it('should handle nested content gracefully', () => {
    const response = '<think>Outer <code>inner code</code> text</think>';

    const thinking = extractThinking(response);

    expect(thinking).toContain('Outer');
    expect(thinking).toContain('<code>inner code</code>');
  });
});
```

#### 1.2.3 Haiku Analysis Prompt/Response Parsing

**File:** `observer/src/__tests__/haiku-analysis.test.ts`

```typescript
describe('analyzeWithHaiku', () => {
  const mockEnv = {
    ANTHROPIC_API_KEY: 'sk-ant-test',
  };

  it('should return default analysis when thinking is null', async () => {
    const analysis = await analyzeWithHaiku(null, mockEnv);

    expect(analysis.alternatives).toHaveLength(1);
    expect(analysis.selected).toBe('direct');
    expect(analysis.reasoning).toBe('No explicit reasoning captured');
    expect(analysis.values_applied).toContain('transparency');
    expect(analysis.confidence).toBe('medium');
  });

  it('should call Anthropic API with correct prompt structure', async () => {
    mockFetch({ content: [{ text: JSON.stringify({
      alternatives: [{ id: 'opt1', description: 'Option 1' }],
      selected: 'opt1',
      reasoning: 'Because...',
      values_applied: ['transparency'],
      confidence: 'high',
    })}]});

    await analyzeWithHaiku('Test thinking content', mockEnv);

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.model).toBe('claude-3-haiku-20240307');
    expect(body.max_tokens).toBe(1024);
    expect(body.messages[0].content).toContain('Test thinking content');
  });

  it('should parse Haiku response correctly', async () => {
    const expectedAnalysis = {
      alternatives: [
        { id: 'read_file', description: 'Read the file' },
        { id: 'grep_file', description: 'Search first' },
      ],
      selected: 'read_file',
      reasoning: 'Need full context',
      values_applied: ['transparency', 'accuracy'],
      confidence: 'high',
    };

    mockFetch({ content: [{ text: JSON.stringify(expectedAnalysis) }] });

    const analysis = await analyzeWithHaiku('Some thinking', mockEnv);

    expect(analysis).toEqual(expectedAnalysis);
  });

  it('should truncate long thinking blocks', async () => {
    const longThinking = 'x'.repeat(5000);
    mockFetch({ content: [{ text: '{}' }] });

    await analyzeWithHaiku(longThinking, mockEnv);

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.messages[0].content.length).toBeLessThan(5000);
  });

  it('should handle Haiku API errors gracefully', async () => {
    mockFetch(null, { status: 500 });

    const analysis = await analyzeWithHaiku('Test', mockEnv);

    expect(analysis.selected).toBe('unknown');
    expect(analysis.reasoning).toBe('Analysis failed');
    expect(analysis.confidence).toBe('low');
  });

  it('should handle malformed JSON response', async () => {
    mockFetch({ content: [{ text: 'not valid json' }] });

    const analysis = await analyzeWithHaiku('Test', mockEnv);

    expect(analysis.confidence).toBe('low');
  });
});
```

#### 1.2.4 APTrace Construction

**File:** `observer/src/__tests__/trace-builder.test.ts`

```typescript
import { type APTrace, type AlignmentCard } from 'agent-alignment-protocol';

describe('buildTrace', () => {
  const mockLog = {
    id: 'log-123',
    created_at: '2026-02-04T12:00:00Z',
    model: 'claude-3-5-sonnet-20241022',
    success: true,
    tokens_in: 100,
    tokens_out: 500,
    duration: 1500,
  };

  const mockMetadata = {
    agent_id: 'smolt-abc123',
    session_id: 'sess-abc123-12345',
  };

  const mockAnalysis = {
    alternatives: [{ id: 'opt1', description: 'Option 1' }],
    selected: 'opt1',
    reasoning: 'Chose this because...',
    values_applied: ['transparency'],
    confidence: 'high',
  };

  const mockCard = {
    card_id: 'ac-abc123',
    agent_id: 'smolt-abc123',
    aap_version: '0.1.0',
  };

  it('should generate unique trace ID', () => {
    const trace1 = buildTrace(mockLog, mockMetadata, null, mockAnalysis, mockCard);
    const trace2 = buildTrace(mockLog, mockMetadata, null, mockAnalysis, mockCard);

    expect(trace1.id).toMatch(/^tr-[0-9a-f]{8}$/);
    expect(trace1.id).not.toBe(trace2.id);
  });

  it('should include agent and card references', () => {
    const trace = buildTrace(mockLog, mockMetadata, null, mockAnalysis, mockCard);

    expect(trace.agent_id).toBe('smolt-abc123');
    expect(trace.card_id).toBe('ac-abc123');
    expect(trace.session_id).toBe('sess-abc123-12345');
  });

  it('should use log timestamp', () => {
    const trace = buildTrace(mockLog, mockMetadata, null, mockAnalysis, mockCard);

    expect(trace.timestamp).toBe('2026-02-04T12:00:00Z');
  });

  it('should set action_type to communicate for API calls', () => {
    const trace = buildTrace(mockLog, mockMetadata, null, mockAnalysis, mockCard);

    expect(trace.action_type).toBe('communicate');
  });

  it('should include model name as action_name', () => {
    const trace = buildTrace(mockLog, mockMetadata, null, mockAnalysis, mockCard);

    expect(trace.action_name).toBe('claude-3-5-sonnet-20241022');
  });

  it('should build decision from analysis', () => {
    const trace = buildTrace(mockLog, mockMetadata, null, mockAnalysis, mockCard);

    expect(trace.decision.alternatives_considered).toHaveLength(1);
    expect(trace.decision.selected).toBe('opt1');
    expect(trace.decision.selection_reasoning).toBe('Chose this because...');
    expect(trace.decision.values_applied).toContain('transparency');
    expect(trace.decision.confidence).toBe('high');
  });

  it('should include escalation structure', () => {
    const trace = buildTrace(mockLog, mockMetadata, null, mockAnalysis, mockCard);

    expect(trace.escalation.evaluated).toBe(true);
    expect(trace.escalation.required).toBe(false);
  });

  it('should include outcome from log', () => {
    const trace = buildTrace(mockLog, mockMetadata, null, mockAnalysis, mockCard);

    expect(trace.outcome.success).toBe(true);
    expect(trace.outcome.duration_ms).toBe(1500);
    expect(trace.outcome.result_summary).toContain('500 tokens');
  });

  it('should include raw thinking in trace_json', () => {
    const thinking = 'My internal reasoning';
    const trace = buildTrace(mockLog, mockMetadata, thinking, mockAnalysis, mockCard);

    expect(trace.trace_json.raw_thinking).toBe(thinking);
    expect(trace.trace_json.gateway_log_id).toBe('log-123');
  });

  it('should handle missing card gracefully', () => {
    const trace = buildTrace(mockLog, mockMetadata, null, mockAnalysis, null);

    expect(trace.card_id).toBe('ac-default');
  });
});
```

#### 1.2.5 Verification Using `verifyTrace()` from AAP SDK

**File:** `observer/src/__tests__/verification.test.ts`

```typescript
import { verifyTrace, type APTrace, type AlignmentCard } from 'agent-alignment-protocol';

describe('trace verification with AAP SDK', () => {
  const createMockCard = (overrides = {}): AlignmentCard => ({
    aap_version: '0.1.0',
    card_id: 'ac-test',
    agent_id: 'smolt-test',
    issued_at: '2026-02-04T00:00:00Z',
    values: {
      declared: ['transparency', 'accuracy'],
    },
    autonomy_envelope: {
      bounded_actions: [],
      forbidden_actions: [],
      escalation_triggers: [],
    },
    ...overrides,
  });

  const createMockTrace = (overrides = {}): APTrace => ({
    id: 'tr-test',
    agent_id: 'smolt-test',
    card_id: 'ac-test',
    timestamp: '2026-02-04T12:00:00Z',
    action_type: 'communicate',
    action_name: 'claude-3-haiku',
    decision: {
      alternatives_considered: [],
      selected: 'respond',
      selection_reasoning: 'Direct response appropriate',
      values_applied: ['transparency'],
      confidence: 'high',
    },
    escalation: {
      evaluated: true,
      required: false,
    },
    outcome: {
      success: true,
      result_summary: 'Completed',
    },
    ...overrides,
  });

  it('should pass verification for compliant trace', () => {
    const card = createMockCard();
    const trace = createMockTrace();

    const result = verifyTrace(trace, card);

    expect(result.verified).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('should detect forbidden action violation', () => {
    const card = createMockCard({
      autonomy_envelope: {
        forbidden_actions: ['dangerous_tool'],
      },
    });
    const trace = createMockTrace({
      action_name: 'dangerous_tool',
    });

    const result = verifyTrace(trace, card);

    expect(result.verified).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('should include autonomy_compliant flag', () => {
    const card = createMockCard();
    const trace = createMockTrace();

    const result = verifyTrace(trace, card);

    expect(result.autonomy_compliant).toBeDefined();
  });

  it('should handle missing card with warnings', () => {
    const trace = createMockTrace();

    const result = verifyTrace(trace, null);

    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
```

#### 1.2.6 Drift Detection Using `detectDrift()` from AAP SDK

**File:** `observer/src/__tests__/drift-detection.test.ts`

```typescript
import { detectDrift, type APTrace, type AlignmentCard } from 'agent-alignment-protocol';

describe('drift detection with AAP SDK', () => {
  const mockCard: AlignmentCard = {
    aap_version: '0.1.0',
    card_id: 'ac-test',
    agent_id: 'smolt-test',
    issued_at: '2026-02-04T00:00:00Z',
    values: {
      declared: ['transparency', 'accuracy', 'safety'],
    },
    autonomy_envelope: {
      bounded_actions: [],
      forbidden_actions: [],
    },
  };

  it('should detect no drift when values are consistent', () => {
    const traces: APTrace[] = Array(10).fill(null).map((_, i) => ({
      id: `tr-${i}`,
      agent_id: 'smolt-test',
      card_id: 'ac-test',
      timestamp: new Date(Date.now() - i * 60000).toISOString(),
      action_type: 'communicate',
      action_name: 'claude-3-haiku',
      decision: {
        values_applied: ['transparency', 'accuracy'],
        confidence: 'high',
      },
      outcome: { success: true },
    }));

    const drift = detectDrift(traces, mockCard);

    expect(drift.detected).toBe(false);
  });

  it('should detect value drift when declared values stop appearing', () => {
    const traces: APTrace[] = Array(10).fill(null).map((_, i) => ({
      id: `tr-${i}`,
      agent_id: 'smolt-test',
      card_id: 'ac-test',
      timestamp: new Date(Date.now() - i * 60000).toISOString(),
      action_type: 'communicate',
      action_name: 'claude-3-haiku',
      decision: {
        values_applied: i < 5 ? ['transparency'] : ['transparency', 'accuracy', 'safety'],
        confidence: 'high',
      },
      outcome: { success: true },
    }));

    const drift = detectDrift(traces, mockCard);

    // Recent traces missing 'safety' value that was applied earlier
    expect(drift.alerts.some(a => a.type === 'value_drift')).toBe(true);
  });

  it('should detect behavior drift when action patterns change', () => {
    const oldTraces: APTrace[] = Array(5).fill(null).map((_, i) => ({
      id: `tr-old-${i}`,
      agent_id: 'smolt-test',
      card_id: 'ac-test',
      timestamp: new Date(Date.now() - (i + 5) * 3600000).toISOString(),
      action_type: 'communicate',
      action_name: 'claude-3-haiku',
      decision: { values_applied: ['transparency'], confidence: 'high' },
      outcome: { success: true },
    }));

    const newTraces: APTrace[] = Array(5).fill(null).map((_, i) => ({
      id: `tr-new-${i}`,
      agent_id: 'smolt-test',
      card_id: 'ac-test',
      timestamp: new Date(Date.now() - i * 60000).toISOString(),
      action_type: 'execute',
      action_name: 'dangerous_action',
      decision: { values_applied: [], confidence: 'low' },
      outcome: { success: true },
    }));

    const drift = detectDrift([...newTraces, ...oldTraces], mockCard);

    expect(drift.alerts.some(a => a.type === 'behavior_drift')).toBe(true);
  });

  it('should return severity levels for drift alerts', () => {
    const traces: APTrace[] = [/* traces that trigger drift */];

    const drift = detectDrift(traces, mockCard);

    if (drift.alerts.length > 0) {
      expect(['low', 'medium', 'high']).toContain(drift.alerts[0].severity);
    }
  });
});
```

#### 1.2.7 Supabase Submission

**File:** `observer/src/__tests__/storage.test.ts`

```typescript
describe('submitTrace', () => {
  const mockEnv = {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_KEY: 'test-key',
  };

  const mockTrace = {
    id: 'tr-test123',
    agent_id: 'smolt-abc',
    card_id: 'ac-abc',
    timestamp: '2026-02-04T12:00:00Z',
    action_type: 'communicate',
    action_name: 'claude-3-haiku',
    decision: {},
    escalation: {},
    outcome: {},
    trace_json: {},
  };

  it('should POST to Supabase traces endpoint', async () => {
    mockFetch({});

    await submitTrace(mockTrace, mockEnv);

    expect(fetch).toHaveBeenCalledWith(
      `${mockEnv.SUPABASE_URL}/rest/v1/traces`,
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('should include authorization headers', async () => {
    mockFetch({});

    await submitTrace(mockTrace, mockEnv);

    const headers = fetch.mock.calls[0][1].headers;
    expect(headers['apikey']).toBe(mockEnv.SUPABASE_KEY);
    expect(headers['Authorization']).toBe(`Bearer ${mockEnv.SUPABASE_KEY}`);
  });

  it('should send trace as JSON body', async () => {
    mockFetch({});

    await submitTrace(mockTrace, mockEnv);

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.id).toBe('tr-test123');
    expect(body.agent_id).toBe('smolt-abc');
  });

  it('should throw on submission failure', async () => {
    mockFetch(null, { status: 400 });

    await expect(submitTrace(mockTrace, mockEnv))
      .rejects.toThrow('Failed to submit trace: 400');
  });
});
```

#### 1.2.8 Log Deletion After Processing

**File:** `observer/src/__tests__/log-cleanup.test.ts`

```typescript
describe('log deletion after processing', () => {
  it('should delete log after successful processing', async () => {
    // Setup mocks for full processing flow
    mockFetch({ result: [{ id: 'log-1', metadata: { 'cf-aig-metadata': '{"agent_id":"smolt-test"}' } }] });
    mockFetch({ result: { response_body: '<think>test</think>' } });
    mockFetch({ content: [{ text: '{}' }] }); // Haiku
    mockFetch([{ card_json: {} }]); // Card fetch
    mockFetch({}); // Trace submit
    mockFetch({}); // Delete log

    await processAllLogs(mockEnv);

    const deleteCall = fetch.mock.calls.find(
      call => call[1]?.method === 'DELETE'
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall[0]).toContain('logs/log-1');
  });

  it('should delete log even when processing fails', async () => {
    mockFetch({ result: [{ id: 'log-error', metadata: {} }] });
    mockFetch({}); // Delete should still happen

    await processAllLogs(mockEnv);

    const deleteCall = fetch.mock.calls.find(
      call => call[1]?.method === 'DELETE'
    );
    expect(deleteCall).toBeDefined();
  });

  it('should skip logs without smoltbot metadata and delete them', async () => {
    mockFetch({ result: [{ id: 'log-no-metadata', metadata: {} }] });
    mockFetch({});

    await processAllLogs(mockEnv);

    expect(fetch).toHaveBeenCalledTimes(2); // Fetch + delete only
  });
});
```

---

### 1.3 CLI (`cli/`)

#### 1.3.1 Config File Creation/Loading

**File:** `cli/src/__tests__/config.test.ts`

```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';
import { configExists, loadConfig, saveConfig, generateAgentId } from '../lib/config';

describe('config management', () => {
  const testDir = path.join(os.tmpdir(), 'smoltbot-test-' + Date.now());
  const originalHome = process.env.HOME;

  beforeEach(() => {
    process.env.HOME = testDir;
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('configExists', () => {
    it('should return false when config does not exist', () => {
      expect(configExists()).toBe(false);
    });

    it('should return true when config exists', () => {
      const configDir = path.join(testDir, '.smoltbot');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.json'), '{}');

      expect(configExists()).toBe(true);
    });
  });

  describe('saveConfig', () => {
    it('should create .smoltbot directory if not exists', () => {
      saveConfig({ agentId: 'smolt-test' });

      expect(fs.existsSync(path.join(testDir, '.smoltbot'))).toBe(true);
    });

    it('should write config as JSON', () => {
      const config = { agentId: 'smolt-abc123', email: 'test@example.com' };
      saveConfig(config);

      const savedConfig = JSON.parse(
        fs.readFileSync(path.join(testDir, '.smoltbot', 'config.json'), 'utf-8')
      );
      expect(savedConfig).toEqual(config);
    });
  });

  describe('loadConfig', () => {
    it('should throw when config does not exist', () => {
      expect(() => loadConfig()).toThrow('Run `smoltbot init` first');
    });

    it('should return parsed config', () => {
      const config = { agentId: 'smolt-loaded', gateway: 'https://custom.gateway' };
      const configDir = path.join(testDir, '.smoltbot');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(config));

      expect(loadConfig()).toEqual(config);
    });
  });

  describe('generateAgentId', () => {
    it('should generate ID with smolt- prefix', () => {
      const id = generateAgentId();

      expect(id).toMatch(/^smolt-[0-9a-f]{8}$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set(Array(100).fill(null).map(() => generateAgentId()));

      expect(ids.size).toBe(100);
    });
  });
});
```

#### 1.3.2 Agent ID Generation

**File:** `cli/src/__tests__/agent-id.test.ts`

```typescript
describe('agent ID generation', () => {
  it('should follow smolt-XXXXXXXX format', () => {
    for (let i = 0; i < 100; i++) {
      const id = generateAgentId();
      expect(id).toMatch(/^smolt-[0-9a-f]{8}$/);
    }
  });

  it('should use lowercase hex characters only', () => {
    const id = generateAgentId();
    const hex = id.replace('smolt-', '');

    expect(hex).toMatch(/^[0-9a-f]+$/);
    expect(hex).toBe(hex.toLowerCase());
  });
});
```

#### 1.3.3 API Client Functions

**File:** `cli/src/__tests__/api.test.ts`

```typescript
import { getAgent, getIntegrity, getTraces } from '../lib/api';

describe('API client', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getAgent', () => {
    it('should fetch agent by ID', async () => {
      const mockAgent = { id: 'smolt-test', created_at: '2026-02-04' };
      mockFetch(mockAgent);

      const agent = await getAgent('smolt-test');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/agents/smolt-test')
      );
      expect(agent).toEqual(mockAgent);
    });

    it('should return null on 404', async () => {
      mockFetch(null, { status: 404 });

      const agent = await getAgent('smolt-nonexistent');

      expect(agent).toBeNull();
    });
  });

  describe('getIntegrity', () => {
    it('should fetch integrity score', async () => {
      const mockScore = { score: 0.95, total_traces: 100 };
      mockFetch(mockScore);

      const score = await getIntegrity('smolt-test');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/integrity/smolt-test')
      );
      expect(score).toEqual(mockScore);
    });
  });

  describe('getTraces', () => {
    it('should fetch traces with default limit', async () => {
      const mockTraces = [{ id: 'tr-1' }, { id: 'tr-2' }];
      mockFetch(mockTraces);

      const traces = await getTraces('smolt-test');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10')
      );
      expect(traces).toEqual(mockTraces);
    });

    it('should respect custom limit', async () => {
      mockFetch([]);

      await getTraces('smolt-test', 50);

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=50')
      );
    });
  });
});
```

#### 1.3.4 Command Tests

**File:** `cli/src/__tests__/commands/init.test.ts`

```typescript
describe('init command', () => {
  it('should create config file', async () => {
    await init({});

    expect(configExists()).toBe(true);
  });

  it('should generate agent ID', async () => {
    await init({});

    const config = loadConfig();
    expect(config.agentId).toMatch(/^smolt-[0-9a-f]{8}$/);
  });

  it('should store email if provided', async () => {
    await init({ email: 'test@example.com' });

    const config = loadConfig();
    expect(config.email).toBe('test@example.com');
  });

  it('should store custom gateway if provided', async () => {
    await init({ gateway: 'https://custom.gateway.com/anthropic' });

    const config = loadConfig();
    expect(config.gateway).toBe('https://custom.gateway.com/anthropic');
  });

  it('should not overwrite existing config', async () => {
    await init({});
    const originalId = loadConfig().agentId;

    await init({});

    expect(loadConfig().agentId).toBe(originalId);
  });

  it('should output setup instructions', async () => {
    const consoleSpy = vi.spyOn(console, 'log');

    await init({});

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('ANTHROPIC_BASE_URL')
    );
  });
});
```

**File:** `cli/src/__tests__/commands/status.test.ts`

```typescript
describe('status command', () => {
  beforeEach(() => {
    saveConfig({ agentId: 'smolt-test123' });
  });

  it('should display agent ID', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    mockFetch({ id: 'smolt-test123', created_at: '2026-02-04' });

    await status();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('smolt-test123')
    );
  });

  it('should show backend status when registered', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    mockFetch({
      id: 'smolt-test123',
      created_at: '2026-02-04',
      last_seen: '2026-02-04T12:00:00Z',
    });

    await status();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Last seen')
    );
  });

  it('should indicate when not registered', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    mockFetch(null, { status: 404 });

    await status();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('not registered')
    );
  });
});
```

**File:** `cli/src/__tests__/commands/integrity.test.ts`

```typescript
describe('integrity command', () => {
  beforeEach(() => {
    saveConfig({ agentId: 'smolt-test' });
  });

  it('should display integrity score as percentage', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    mockFetch({
      score: 0.95,
      total_traces: 100,
      verified_traces: 95,
      violations: 5,
    });

    await integrity();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('95.0%')
    );
  });

  it('should display trace counts', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    mockFetch({
      score: 0.90,
      total_traces: 50,
      verified_traces: 45,
      violations: 5,
    });

    await integrity();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('50')
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('45')
    );
  });

  it('should handle no data gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    mockFetch(null, { status: 404 });

    await integrity();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('No integrity data')
    );
  });
});
```

**File:** `cli/src/__tests__/commands/logs.test.ts`

```typescript
describe('logs command', () => {
  beforeEach(() => {
    saveConfig({ agentId: 'smolt-test' });
  });

  it('should display recent traces', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    mockFetch([
      {
        id: 'tr-1',
        timestamp: '2026-02-04T12:00:00Z',
        action_name: 'claude-3-haiku',
        verification: { verified: true },
        decision: { selection_reasoning: 'Test reasoning' },
      },
    ]);

    await logs({});

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('claude-3-haiku')
    );
  });

  it('should show verification status', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    mockFetch([
      { verification: { verified: true }, action_name: 'test', timestamp: '2026-02-04' },
      { verification: { verified: false }, action_name: 'test2', timestamp: '2026-02-04' },
    ]);

    await logs({});

    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toMatch(/[^]/); // Checkmark or X symbol
  });

  it('should respect limit option', async () => {
    mockFetch([]);

    await logs({ limit: 25 });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('limit=25')
    );
  });

  it('should handle no traces', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    mockFetch([]);

    await logs({});

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('No traces')
    );
  });
});
```

---

### 1.4 Backend API (`api/`)

#### 1.4.1 Agent Queries

**File:** `api/src/__tests__/agents.test.ts`

```typescript
describe('GET /v1/agents/:id', () => {
  it('should return agent by ID', async () => {
    mockSupabase([{ id: 'smolt-abc', agent_hash: 'abc123' }]);

    const request = new Request('https://api.mnemom.ai/v1/agents/smolt-abc');
    const response = await handleRequest(request, mockEnv);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe('smolt-abc');
  });

  it('should return 404 for non-existent agent', async () => {
    mockSupabase([]);

    const request = new Request('https://api.mnemom.ai/v1/agents/smolt-nonexistent');
    const response = await handleRequest(request, mockEnv);

    expect(response.status).toBe(404);
  });

  it('should include CORS headers', async () => {
    mockSupabase([{ id: 'smolt-abc' }]);

    const request = new Request('https://api.mnemom.ai/v1/agents/smolt-abc');
    const response = await handleRequest(request, mockEnv);

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
```

#### 1.4.2 Trace Queries with Filtering

**File:** `api/src/__tests__/traces.test.ts`

```typescript
describe('GET /v1/traces', () => {
  it('should return traces for agent', async () => {
    const mockTraces = [
      { id: 'tr-1', agent_id: 'smolt-abc' },
      { id: 'tr-2', agent_id: 'smolt-abc' },
    ];
    mockSupabase(mockTraces);

    const request = new Request('https://api.mnemom.ai/v1/traces?agent_id=smolt-abc');
    const response = await handleRequest(request, mockEnv);

    const body = await response.json();
    expect(body).toHaveLength(2);
  });

  it('should filter by agent_id', async () => {
    mockSupabase([]);

    const request = new Request('https://api.mnemom.ai/v1/traces?agent_id=smolt-specific');
    await handleRequest(request, mockEnv);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('agent_id=eq.smolt-specific'),
      expect.anything()
    );
  });

  it('should respect limit parameter', async () => {
    mockSupabase([]);

    const request = new Request('https://api.mnemom.ai/v1/traces?limit=50');
    await handleRequest(request, mockEnv);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('limit=50'),
      expect.anything()
    );
  });

  it('should order by timestamp descending', async () => {
    mockSupabase([]);

    const request = new Request('https://api.mnemom.ai/v1/traces');
    await handleRequest(request, mockEnv);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('order=timestamp.desc'),
      expect.anything()
    );
  });
});
```

#### 1.4.3 Integrity Score Calculation

**File:** `api/src/__tests__/integrity.test.ts`

```typescript
describe('GET /v1/integrity/:id', () => {
  it('should calculate score from verification data', async () => {
    mockSupabase([
      { verification: { verified: true } },
      { verification: { verified: true } },
      { verification: { verified: false, violations: ['v1'] } },
      { verification: { verified: true } },
    ]);

    const request = new Request('https://api.mnemom.ai/v1/integrity/smolt-test');
    const response = await handleRequest(request, mockEnv);

    const body = await response.json();
    expect(body.score).toBe(0.75); // 3/4 verified
    expect(body.total_traces).toBe(4);
    expect(body.verified_traces).toBe(3);
    expect(body.violations).toBe(1);
  });

  it('should return 404 when no traces exist', async () => {
    mockSupabase([]);

    const request = new Request('https://api.mnemom.ai/v1/integrity/smolt-new');
    const response = await handleRequest(request, mockEnv);

    expect(response.status).toBe(404);
  });

  it('should handle 100% integrity', async () => {
    mockSupabase([
      { verification: { verified: true } },
      { verification: { verified: true } },
    ]);

    const request = new Request('https://api.mnemom.ai/v1/integrity/smolt-perfect');
    const response = await handleRequest(request, mockEnv);

    const body = await response.json();
    expect(body.score).toBe(1.0);
    expect(body.violations).toBe(0);
  });

  it('should handle 0% integrity', async () => {
    mockSupabase([
      { verification: { verified: false, violations: ['v1'] } },
      { verification: { verified: false, violations: ['v2'] } },
    ]);

    const request = new Request('https://api.mnemom.ai/v1/integrity/smolt-bad');
    const response = await handleRequest(request, mockEnv);

    const body = await response.json();
    expect(body.score).toBe(0);
    expect(body.violations).toBe(2);
  });
});
```

---

## 2. Integration Tests

### 2.1 Gateway Worker to Cloudflare AI Gateway

**File:** `tests/integration/gateway-to-ai-gateway.test.ts`

```typescript
describe('Gateway Worker -> AI Gateway integration', () => {
  it('should forward request with metadata to AI Gateway', async () => {
    const mockAiGateway = createMockServer();

    const request = new Request('https://gateway.mnemom.ai/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': 'sk-ant-test-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    const response = await gatewayWorker.fetch(request, mockEnv);

    expect(mockAiGateway.lastRequest.headers['cf-aig-metadata']).toBeDefined();
    const metadata = JSON.parse(mockAiGateway.lastRequest.headers['cf-aig-metadata']);
    expect(metadata.agent_id).toMatch(/^smolt-/);
  });

  it('should preserve streaming responses', async () => {
    const mockAiGateway = createMockServer({
      response: createStreamingResponse(),
    });

    const request = new Request('https://gateway.mnemom.ai/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': 'sk-ant-test-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      }),
    });

    const response = await gatewayWorker.fetch(request, mockEnv);

    expect(response.body).toBeInstanceOf(ReadableStream);
  });
});
```

### 2.2 Observer Worker to Supabase

**File:** `tests/integration/observer-to-supabase.test.ts`

```typescript
describe('Observer Worker -> Supabase integration', () => {
  // Use test Supabase instance
  const testSupabase = createTestSupabaseClient();

  beforeEach(async () => {
    await testSupabase.from('traces').delete().neq('id', '');
    await testSupabase.from('agents').delete().neq('id', '');
  });

  it('should insert trace into Supabase', async () => {
    // Setup test agent
    await testSupabase.from('agents').insert({
      id: 'smolt-test',
      agent_hash: 'testhash12345678',
    });

    await testSupabase.from('alignment_cards').insert({
      id: 'ac-test',
      agent_id: 'smolt-test',
      card_json: { aap_version: '0.1.0' },
      issued_at: new Date().toISOString(),
      is_active: true,
    });

    const trace = {
      id: 'tr-integration-test',
      agent_id: 'smolt-test',
      card_id: 'ac-test',
      timestamp: new Date().toISOString(),
      action_type: 'communicate',
      action_name: 'test-model',
      decision: {},
      escalation: {},
      outcome: { success: true },
      trace_json: {},
    };

    await submitTrace(trace, mockEnv);

    const { data } = await testSupabase
      .from('traces')
      .select('*')
      .eq('id', 'tr-integration-test');

    expect(data).toHaveLength(1);
    expect(data[0].action_name).toBe('test-model');
  });

  it('should handle concurrent trace submissions', async () => {
    const traces = Array(10).fill(null).map((_, i) => ({
      id: `tr-concurrent-${i}`,
      agent_id: 'smolt-test',
      card_id: 'ac-test',
      timestamp: new Date().toISOString(),
      action_type: 'communicate',
      action_name: 'test',
      decision: {},
      escalation: {},
      outcome: { success: true },
      trace_json: {},
    }));

    await Promise.all(traces.map(t => submitTrace(t, mockEnv)));

    const { count } = await testSupabase
      .from('traces')
      .select('*', { count: 'exact' })
      .like('id', 'tr-concurrent-%');

    expect(count).toBe(10);
  });
});
```

### 2.3 Observer Worker to Anthropic API for Haiku

**File:** `tests/integration/observer-to-anthropic.test.ts`

```typescript
describe('Observer Worker -> Anthropic API integration', () => {
  it('should analyze thinking with Haiku', async () => {
    const mockAnthropicApi = createMockAnthropicServer();

    const thinking = `
      I need to decide how to respond to this request.
      Option 1: Read the file directly
      Option 2: Search for specific content first
      I'll choose option 1 because I need full context.
    `;

    const analysis = await analyzeWithHaiku(thinking, mockEnv);

    expect(mockAnthropicApi.lastRequest.model).toBe('claude-3-haiku-20240307');
    expect(analysis.alternatives).toBeDefined();
    expect(analysis.selected).toBeDefined();
    expect(analysis.reasoning).toBeDefined();
  });

  it('should handle rate limiting gracefully', async () => {
    const mockAnthropicApi = createMockAnthropicServer({
      responseSequence: [
        { status: 429, headers: { 'Retry-After': '1' } },
        { status: 200, body: { content: [{ text: '{}' }] } },
      ],
    });

    const analysis = await analyzeWithHaiku('test thinking', mockEnv);

    expect(mockAnthropicApi.requestCount).toBe(2);
    expect(analysis).toBeDefined();
  });
});
```

### 2.4 CLI to Backend API

**File:** `tests/integration/cli-to-api.test.ts`

```typescript
describe('CLI -> Backend API integration', () => {
  const mockApiServer = createMockApiServer();

  it('should fetch agent status from API', async () => {
    mockApiServer.addResponse('/v1/agents/smolt-test', {
      id: 'smolt-test',
      created_at: '2026-02-04',
      last_seen: '2026-02-04T12:00:00Z',
    });

    saveConfig({ agentId: 'smolt-test' });

    const consoleSpy = vi.spyOn(console, 'log');
    await status();

    expect(mockApiServer.requests).toContainEqual(
      expect.objectContaining({ path: '/v1/agents/smolt-test' })
    );
  });

  it('should fetch integrity from API', async () => {
    mockApiServer.addResponse('/v1/integrity/smolt-test', {
      score: 0.95,
      total_traces: 100,
      verified_traces: 95,
      violations: 5,
    });

    saveConfig({ agentId: 'smolt-test' });

    await integrity();

    expect(mockApiServer.requests).toContainEqual(
      expect.objectContaining({ path: '/v1/integrity/smolt-test' })
    );
  });

  it('should fetch traces from API', async () => {
    mockApiServer.addResponse('/v1/traces', [
      { id: 'tr-1', action_name: 'test' },
    ]);

    saveConfig({ agentId: 'smolt-test' });

    await logs({ limit: 10 });

    expect(mockApiServer.requests).toContainEqual(
      expect.objectContaining({
        path: expect.stringContaining('/v1/traces'),
        query: expect.objectContaining({ agent_id: 'smolt-test' }),
      })
    );
  });
});
```

### 2.5 Full Pipeline Integration

**File:** `tests/integration/full-pipeline.test.ts`

```typescript
describe('Full pipeline: Gateway -> AI Gateway -> Observer -> Storage', () => {
  const testEnv = setupTestEnvironment();

  it('should process request through entire pipeline', async () => {
    // 1. Send request through Gateway
    const request = new Request('https://gateway.mnemom.ai/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': 'sk-ant-integration-test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        messages: [{ role: 'user', content: 'Test message' }],
      }),
    });

    const gatewayResponse = await testEnv.gateway.fetch(request);
    expect(gatewayResponse.ok).toBe(true);

    const agentId = gatewayResponse.headers.get('x-smoltbot-agent');
    expect(agentId).toMatch(/^smolt-/);

    // 2. Verify log was created in AI Gateway
    const logs = await testEnv.aiGateway.getLogs();
    expect(logs.some(l => l.metadata?.agent_id === agentId)).toBe(true);

    // 3. Trigger Observer processing
    await testEnv.observer.scheduled();

    // 4. Verify trace was created in Supabase
    const { data: traces } = await testEnv.supabase
      .from('traces')
      .select('*')
      .eq('agent_id', agentId);

    expect(traces).toHaveLength(1);
    expect(traces[0].verification).toBeDefined();

    // 5. Verify log was deleted
    const remainingLogs = await testEnv.aiGateway.getLogs();
    expect(remainingLogs.some(l => l.metadata?.agent_id === agentId)).toBe(false);
  });

  it('should handle thinking block extraction in pipeline', async () => {
    // Setup mock response with thinking block
    testEnv.anthropic.setNextResponse({
      content: [
        { type: 'text', text: '<think>Processing this carefully...</think>The answer is 42.' },
      ],
    });

    const request = new Request('https://gateway.mnemom.ai/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'sk-ant-test', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'What is the answer?' }],
      }),
    });

    await testEnv.gateway.fetch(request);
    await testEnv.observer.scheduled();

    const { data: traces } = await testEnv.supabase
      .from('traces')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);

    expect(traces[0].trace_json.raw_thinking).toContain('Processing this carefully');
    expect(traces[0].decision.selection_reasoning).toBeDefined();
  });
});
```

---

## 3. E2E Tests

### 3.1 Fresh Install Flow

**File:** `tests/e2e/fresh-install.test.ts`

```typescript
describe('E2E: Fresh install flow', () => {
  const testDir = path.join(os.tmpdir(), `smoltbot-e2e-${Date.now()}`);

  beforeAll(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.env.HOME = testDir;
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should complete full init flow', async () => {
    // Simulate: npm install -g smoltbot && smoltbot init
    const { stdout, stderr, exitCode } = await execAsync(
      'npx smoltbot init --email test@example.com',
      { cwd: testDir }
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Initialized smoltbot');
    expect(stdout).toContain('Agent ID:');
    expect(stdout).toContain('ANTHROPIC_BASE_URL');

    // Verify config was created
    const configPath = path.join(testDir, '.smoltbot', 'config.json');
    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.agentId).toMatch(/^smolt-[0-9a-f]{8}$/);
    expect(config.email).toBe('test@example.com');
  });

  it('should prevent double initialization', async () => {
    // First init
    await execAsync('npx smoltbot init', { cwd: testDir });
    const config1 = loadConfig();

    // Second init attempt
    const { stdout } = await execAsync('npx smoltbot init', { cwd: testDir });
    const config2 = loadConfig();

    expect(stdout).toContain('Already initialized');
    expect(config1.agentId).toBe(config2.agentId);
  });
});
```

### 3.2 Real API Call Through Gateway

**File:** `tests/e2e/api-call.test.ts`

```typescript
describe('E2E: API call through gateway', () => {
  // These tests require real API keys in CI environment
  const skipIfNoApiKey = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

  skipIfNoApiKey('with real API key', () => {
    it('should make successful API call through gateway', async () => {
      process.env.ANTHROPIC_BASE_URL = 'https://gateway.mnemom.ai/anthropic';

      const response = await fetch(`${process.env.ANTHROPIC_BASE_URL}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 100,
          messages: [{ role: 'user', content: 'Say "E2E test successful" and nothing else.' }],
        }),
      });

      expect(response.ok).toBe(true);
      expect(response.headers.get('x-smoltbot-agent')).toMatch(/^smolt-/);

      const body = await response.json();
      expect(body.content[0].text).toContain('E2E test successful');
    });

    it('should add smoltbot headers to response', async () => {
      const response = await fetch('https://gateway.mnemom.ai/anthropic/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });

      expect(response.headers.get('x-smoltbot-agent')).toBeDefined();
      expect(response.headers.get('x-smoltbot-session')).toBeDefined();
    });
  });
});
```

### 3.3 Observer Processing Verification

**File:** `tests/e2e/observer-processing.test.ts`

```typescript
describe('E2E: Observer processing', () => {
  const skipIfNoApiKey = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

  skipIfNoApiKey('with real infrastructure', () => {
    it('should process trace within 60 seconds', async () => {
      // Make API call
      const response = await fetch('https://gateway.mnemom.ai/anthropic/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 100,
          messages: [{ role: 'user', content: 'E2E trace test' }],
        }),
      });

      const agentId = response.headers.get('x-smoltbot-agent');

      // Wait for Observer processing (max 65 seconds)
      let traceFound = false;
      const startTime = Date.now();

      while (Date.now() - startTime < 65000 && !traceFound) {
        await new Promise(resolve => setTimeout(resolve, 5000));

        const tracesResponse = await fetch(
          `https://api.mnemom.ai/v1/traces?agent_id=${agentId}&limit=1`
        );
        const traces = await tracesResponse.json();

        if (traces.length > 0) {
          traceFound = true;
        }
      }

      expect(traceFound).toBe(true);
    }, 70000);
  });
});
```

### 3.4 Trace Verification with AAP SDK

**File:** `tests/e2e/trace-verification.test.ts`

```typescript
import { verifyTrace, type APTrace, type AlignmentCard } from 'agent-alignment-protocol';

describe('E2E: Trace verification', () => {
  const skipIfNoApiKey = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

  skipIfNoApiKey('with real traces', () => {
    it('should verify trace passes AAP SDK verification locally', async () => {
      // Make API call
      const response = await fetch('https://gateway.mnemom.ai/anthropic/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 100,
          messages: [{ role: 'user', content: 'Verification test' }],
        }),
      });

      const agentId = response.headers.get('x-smoltbot-agent');

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 65000));

      // Fetch trace
      const tracesResponse = await fetch(
        `https://api.mnemom.ai/v1/traces?agent_id=${agentId}&limit=1`
      );
      const traces: APTrace[] = await tracesResponse.json();

      expect(traces.length).toBeGreaterThan(0);

      // Fetch card
      const cardResponse = await fetch(
        `https://api.mnemom.ai/v1/cards/${agentId}`
      );
      const card: AlignmentCard = await cardResponse.json();

      // Local verification with AAP SDK
      const localVerification = verifyTrace(traces[0], card);

      expect(localVerification.verified).toBe(true);
      expect(localVerification.violations).toHaveLength(0);

      // Compare with stored verification
      expect(traces[0].verification.verified).toBe(localVerification.verified);
    }, 80000);
  });
});
```

### 3.5 CLI Commands E2E

**File:** `tests/e2e/cli-commands.test.ts`

```typescript
describe('E2E: CLI commands', () => {
  const testDir = path.join(os.tmpdir(), `smoltbot-cli-e2e-${Date.now()}`);

  beforeAll(async () => {
    fs.mkdirSync(testDir, { recursive: true });
    process.env.HOME = testDir;

    // Initialize
    await execAsync('npx smoltbot init', { cwd: testDir });

    // Make API call to generate trace data
    if (process.env.ANTHROPIC_API_KEY) {
      process.env.ANTHROPIC_BASE_URL = 'https://gateway.mnemom.ai/anthropic';
      await fetch(`${process.env.ANTHROPIC_BASE_URL}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 50,
          messages: [{ role: 'user', content: 'CLI E2E test' }],
        }),
      });

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 65000));
    }
  }, 80000);

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('smoltbot status should show agent info', async () => {
    const { stdout, exitCode } = await execAsync('npx smoltbot status', { cwd: testDir });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Agent:');
    expect(stdout).toMatch(/smolt-[0-9a-f]{8}/);
  });

  it('smoltbot logs should show recent traces', async () => {
    const { stdout, exitCode } = await execAsync('npx smoltbot logs', { cwd: testDir });

    expect(exitCode).toBe(0);
    // May show traces or "No traces yet" depending on timing
    expect(stdout).toMatch(/traces|No traces/i);
  });

  it('smoltbot integrity should show score', async () => {
    const { stdout, exitCode } = await execAsync('npx smoltbot integrity', { cwd: testDir });

    expect(exitCode).toBe(0);
    // May show score or "No integrity data" depending on timing
    expect(stdout).toMatch(/Score:|No integrity/i);
  });
});
```

---

## 4. AAP Compliance Tests

### 4.1 Trace Structure Validation

**File:** `tests/aap-compliance/trace-structure.test.ts`

```typescript
import { verifyTrace, type APTrace, type AlignmentCard } from 'agent-alignment-protocol';

describe('AAP Compliance: Trace structure', () => {
  it('should generate traces that pass verifyTrace() with no violations', () => {
    const card: AlignmentCard = {
      aap_version: '0.1.0',
      card_id: 'ac-compliance-test',
      agent_id: 'smolt-compliance',
      issued_at: new Date().toISOString(),
      values: { declared: ['transparency', 'accuracy'] },
      autonomy_envelope: {
        bounded_actions: [],
        forbidden_actions: [],
      },
    };

    const trace: APTrace = buildTrace(
      mockGatewayLog,
      { agent_id: 'smolt-compliance', session_id: 'sess-test' },
      'Sample thinking',
      mockAnalysis,
      card
    );

    const verification = verifyTrace(trace, card);

    expect(verification.verified).toBe(true);
    expect(verification.violations).toHaveLength(0);
    expect(verification.autonomy_compliant).toBe(true);
  });

  it('should include all required APTrace fields', () => {
    const trace = buildTrace(mockLog, mockMetadata, null, mockAnalysis, mockCard);

    // Required fields per AAP spec
    expect(trace.id).toBeDefined();
    expect(trace.agent_id).toBeDefined();
    expect(trace.card_id).toBeDefined();
    expect(trace.timestamp).toBeDefined();
    expect(trace.action_type).toBeDefined();
    expect(trace.action_name).toBeDefined();
    expect(trace.decision).toBeDefined();
    expect(trace.escalation).toBeDefined();
    expect(trace.outcome).toBeDefined();
  });

  it('should have correct decision structure', () => {
    const trace = buildTrace(mockLog, mockMetadata, null, mockAnalysis, mockCard);

    expect(trace.decision.alternatives_considered).toBeDefined();
    expect(Array.isArray(trace.decision.alternatives_considered)).toBe(true);
    expect(trace.decision.selected).toBeDefined();
    expect(trace.decision.selection_reasoning).toBeDefined();
    expect(trace.decision.values_applied).toBeDefined();
    expect(Array.isArray(trace.decision.values_applied)).toBe(true);
    expect(['high', 'medium', 'low']).toContain(trace.decision.confidence);
  });

  it('should have correct escalation structure', () => {
    const trace = buildTrace(mockLog, mockMetadata, null, mockAnalysis, mockCard);

    expect(typeof trace.escalation.evaluated).toBe('boolean');
    expect(typeof trace.escalation.required).toBe('boolean');
  });

  it('should have correct outcome structure', () => {
    const trace = buildTrace(mockLog, mockMetadata, null, mockAnalysis, mockCard);

    expect(typeof trace.outcome.success).toBe('boolean');
    expect(trace.outcome.result_summary).toBeDefined();
  });
});
```

### 4.2 AlignmentCard Structure Validation

**File:** `tests/aap-compliance/card-structure.test.ts`

```typescript
import { type AlignmentCard } from 'agent-alignment-protocol';

describe('AAP Compliance: AlignmentCard structure', () => {
  it('should create cards with required AAP fields', () => {
    const card = createDefaultCard('smolt-test');

    // Required fields per AAP spec Section 4
    expect(card.aap_version).toBeDefined();
    expect(card.card_id).toBeDefined();
    expect(card.agent_id).toBeDefined();
    expect(card.issued_at).toBeDefined();
  });

  it('should have valid values structure', () => {
    const card = createDefaultCard('smolt-test');

    expect(card.values).toBeDefined();
    expect(card.values.declared).toBeDefined();
    expect(Array.isArray(card.values.declared)).toBe(true);
    expect(card.values.declared.length).toBeGreaterThan(0);
  });

  it('should have valid autonomy_envelope structure', () => {
    const card = createDefaultCard('smolt-test');

    expect(card.autonomy_envelope).toBeDefined();
    expect(Array.isArray(card.autonomy_envelope.bounded_actions)).toBe(true);
    expect(Array.isArray(card.autonomy_envelope.forbidden_actions)).toBe(true);
  });

  it('should validate against AAP SDK types', () => {
    const card: AlignmentCard = createDefaultCard('smolt-test');

    // TypeScript compilation validates structure
    // Runtime check for completeness
    const requiredKeys = ['aap_version', 'card_id', 'agent_id', 'issued_at', 'values', 'autonomy_envelope'];
    for (const key of requiredKeys) {
      expect(card).toHaveProperty(key);
    }
  });
});
```

### 4.3 Drift Detection Validation

**File:** `tests/aap-compliance/drift-detection.test.ts`

```typescript
import { detectDrift, type APTrace, type AlignmentCard } from 'agent-alignment-protocol';

describe('AAP Compliance: Drift detection', () => {
  const createTraceSequence = (valuePatterns: string[][]): APTrace[] => {
    return valuePatterns.map((values, i) => ({
      id: `tr-drift-${i}`,
      agent_id: 'smolt-drift-test',
      card_id: 'ac-drift-test',
      timestamp: new Date(Date.now() - i * 3600000).toISOString(),
      action_type: 'communicate',
      action_name: 'test',
      decision: {
        alternatives_considered: [],
        selected: 'action',
        selection_reasoning: 'test',
        values_applied: values,
        confidence: 'high',
      },
      escalation: { evaluated: true, required: false },
      outcome: { success: true, result_summary: 'done' },
    }));
  };

  const mockCard: AlignmentCard = {
    aap_version: '0.1.0',
    card_id: 'ac-drift-test',
    agent_id: 'smolt-drift-test',
    issued_at: new Date().toISOString(),
    values: { declared: ['transparency', 'accuracy', 'safety'] },
    autonomy_envelope: { bounded_actions: [], forbidden_actions: [] },
  };

  it('should work correctly with detectDrift() from AAP SDK', () => {
    const traces = createTraceSequence([
      ['transparency', 'accuracy'],
      ['transparency', 'accuracy'],
      ['transparency', 'accuracy'],
    ]);

    const drift = detectDrift(traces, mockCard);

    expect(drift).toBeDefined();
    expect(typeof drift.detected).toBe('boolean');
    expect(Array.isArray(drift.alerts)).toBe(true);
  });

  it('should detect when declared value stops being applied', () => {
    // First traces apply 'safety', later ones don't
    const traces = createTraceSequence([
      ['transparency'], // Most recent - missing safety
      ['transparency'], // Missing safety
      ['transparency', 'accuracy', 'safety'], // Had safety
      ['transparency', 'accuracy', 'safety'], // Had safety
    ]);

    const drift = detectDrift(traces, mockCard);

    expect(drift.detected).toBe(true);
    expect(drift.alerts.some(a =>
      a.type === 'value_drift' && a.description.includes('safety')
    )).toBe(true);
  });

  it('should not flag drift when values are consistently applied', () => {
    const traces = createTraceSequence([
      ['transparency', 'accuracy'],
      ['transparency', 'accuracy'],
      ['transparency', 'accuracy'],
      ['transparency', 'accuracy'],
    ]);

    const drift = detectDrift(traces, mockCard);

    expect(drift.detected).toBe(false);
    expect(drift.alerts).toHaveLength(0);
  });

  it('should return severity levels per AAP spec', () => {
    const traces = createTraceSequence([
      [], // No values - significant drift
      [],
      ['transparency', 'accuracy', 'safety'],
      ['transparency', 'accuracy', 'safety'],
    ]);

    const drift = detectDrift(traces, mockCard);

    if (drift.alerts.length > 0) {
      expect(['low', 'medium', 'high']).toContain(drift.alerts[0].severity);
    }
  });
});
```

---

## 5. Test Infrastructure

### 5.1 Recommended Test Frameworks

| Component | Framework | Rationale |
|-----------|-----------|-----------|
| Gateway Worker | **Vitest** | Native ESM support, fast, works well with Cloudflare Workers |
| Observer Worker | **Vitest** | Same as Gateway, plus good async handling for cron jobs |
| CLI | **Vitest** or **Jest** | Either works; Vitest for consistency with Workers |
| Backend API | **Vitest** | Consistency with other Workers |
| Integration Tests | **Vitest** | Single test runner for entire project |
| E2E Tests | **Vitest** + custom helpers | Can run against real infrastructure |

### 5.2 Project Test Configuration

**`vitest.config.ts`:**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.test.ts',
        '**/types.ts',
      ],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
```

**`vitest.config.e2e.ts`:**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 120000, // 2 minutes for E2E
    hookTimeout: 90000,
    maxConcurrency: 1, // Run E2E tests sequentially
  },
});
```

### 5.3 Mock Strategies

#### 5.3.1 Fetch Mocking

**`tests/mocks/fetch.ts`:**

```typescript
import { vi } from 'vitest';

type MockResponse = {
  body?: any;
  status?: number;
  headers?: Record<string, string>;
};

let mockResponses: MockResponse[] = [];
let callIndex = 0;

export function mockFetch(body: any, options: Partial<MockResponse> = {}) {
  mockResponses.push({
    body,
    status: options.status ?? 200,
    headers: options.headers ?? {},
  });
}

export function setupFetchMock() {
  callIndex = 0;
  mockResponses = [];

  global.fetch = vi.fn().mockImplementation(async () => {
    const response = mockResponses[callIndex++] ?? { body: null, status: 200 };

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      headers: new Headers(response.headers),
      json: async () => response.body,
      text: async () => JSON.stringify(response.body),
    };
  });
}

export function resetFetchMock() {
  mockResponses = [];
  callIndex = 0;
  vi.resetAllMocks();
}
```

#### 5.3.2 Supabase Mock

**`tests/mocks/supabase.ts`:**

```typescript
export function createMockSupabaseClient() {
  const data: Record<string, any[]> = {
    agents: [],
    traces: [],
    alignment_cards: [],
  };

  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          limit: () => ({ data: data[table] || [] }),
          single: () => ({ data: data[table]?.[0] || null }),
        }),
      }),
      insert: (row: any) => {
        data[table] = data[table] || [];
        data[table].push(row);
        return { data: row, error: null };
      },
      delete: () => ({
        neq: () => {
          data[table] = [];
          return { error: null };
        },
      }),
    }),
    _data: data, // For test assertions
  };
}
```

#### 5.3.3 Cloudflare Workers Mock

**`tests/mocks/workers.ts`:**

```typescript
import { vi } from 'vitest';

export function createMockExecutionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  };
}

export function createMockRequest(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

export function createMockScheduledEvent(): ScheduledEvent {
  return {
    cron: '* * * * *',
    type: 'scheduled',
    scheduledTime: Date.now(),
  } as ScheduledEvent;
}
```

### 5.4 Test Fixtures

#### 5.4.1 Sample Traces

**`tests/fixtures/traces.ts`:**

```typescript
import { type APTrace } from 'agent-alignment-protocol';

export const sampleTrace: APTrace = {
  id: 'tr-fixture-001',
  agent_id: 'smolt-fixture',
  card_id: 'ac-fixture',
  session_id: 'sess-fixture-123',
  timestamp: '2026-02-04T12:00:00Z',
  action_type: 'communicate',
  action_name: 'claude-3-haiku-20240307',
  decision: {
    alternatives_considered: [
      { option_id: 'respond', description: 'Respond directly' },
      { option_id: 'clarify', description: 'Ask for clarification' },
    ],
    selected: 'respond',
    selection_reasoning: 'User question was clear and answerable',
    values_applied: ['transparency', 'accuracy'],
    confidence: 'high',
  },
  escalation: {
    evaluated: true,
    required: false,
    reason: 'No escalation triggers matched',
  },
  outcome: {
    success: true,
    result_summary: '150 tokens in 450ms',
    duration_ms: 450,
  },
  verification: {
    verified: true,
    autonomy_compliant: true,
    violations: [],
    warnings: [],
  },
};

export const traceWithViolation: APTrace = {
  ...sampleTrace,
  id: 'tr-violation-001',
  verification: {
    verified: false,
    autonomy_compliant: false,
    violations: ['Action "forbidden_tool" is not permitted'],
    warnings: [],
  },
};

export const traceWithThinking: APTrace = {
  ...sampleTrace,
  id: 'tr-thinking-001',
  trace_json: {
    raw_thinking: `I need to carefully consider this request.

The user is asking about X, and I should:
1. First understand the context
2. Then provide an accurate answer
3. Make sure to be transparent about limitations

I'll proceed with option 1 because it best serves the user.`,
    gateway_log_id: 'log-fixture',
    tokens_in: 50,
    tokens_out: 150,
  },
};
```

#### 5.4.2 Sample Cards

**`tests/fixtures/cards.ts`:**

```typescript
import { type AlignmentCard } from 'agent-alignment-protocol';

export const sampleCard: AlignmentCard = {
  aap_version: '0.1.0',
  card_id: 'ac-fixture-001',
  agent_id: 'smolt-fixture',
  issued_at: '2026-02-04T00:00:00Z',
  values: {
    declared: ['transparency', 'accuracy'],
    definitions: {
      transparency: {
        name: 'Transparency',
        description: 'All actions and decisions are logged and publicly auditable',
        priority: 1,
      },
      accuracy: {
        name: 'Accuracy',
        description: 'Reported actions match actual actions taken',
        priority: 2,
      },
    },
  },
  autonomy_envelope: {
    bounded_actions: [],
    escalation_triggers: [
      {
        condition: "action_type == 'delete_file'",
        action: 'log',
        reason: 'Destructive operations logged for audit',
      },
    ],
    forbidden_actions: [],
  },
  audit_commitment: {
    trace_format: 'ap-trace-v1',
    retention_days: 365,
    queryable: true,
  },
};

export const restrictiveCard: AlignmentCard = {
  ...sampleCard,
  card_id: 'ac-restrictive',
  autonomy_envelope: {
    bounded_actions: ['Read', 'Grep', 'Glob'],
    forbidden_actions: ['Write', 'Edit', 'Bash'],
    escalation_triggers: [],
  },
};
```

#### 5.4.3 Sample Gateway Logs

**`tests/fixtures/gateway-logs.ts`:**

```typescript
export const sampleGatewayLog = {
  id: 'log-fixture-001',
  created_at: '2026-02-04T12:00:00Z',
  provider: 'anthropic',
  model: 'claude-3-haiku-20240307',
  success: true,
  tokens_in: 50,
  tokens_out: 150,
  duration: 450,
  metadata: {
    'cf-aig-metadata': JSON.stringify({
      agent_id: 'smolt-fixture',
      agent_hash: 'fixture12345678',
      session_id: 'sess-fixture-123',
      timestamp: '2026-02-04T12:00:00Z',
      gateway_version: '2.0.0',
    }),
  },
};

export const logWithThinking = {
  ...sampleGatewayLog,
  id: 'log-thinking-001',
  response_body: JSON.stringify({
    content: [
      {
        type: 'text',
        text: '<think>Processing this request carefully...</think>Here is my response.',
      },
    ],
  }),
};

export const logWithoutMetadata = {
  ...sampleGatewayLog,
  id: 'log-no-metadata',
  metadata: {},
};
```

### 5.5 CI/CD Integration

#### 5.5.1 GitHub Actions Workflow

**`.github/workflows/test.yml`:**

```yaml
name: Test Suite

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm run test:unit

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json

  integration-tests:
    runs-on: ubuntu-latest
    needs: unit-tests
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run integration tests
        run: npm run test:integration
        env:
          SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.TEST_SUPABASE_KEY }}

  e2e-tests:
    runs-on: ubuntu-latest
    needs: integration-tests
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run E2E tests
        run: npm run test:e2e
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        timeout-minutes: 15

  aap-compliance:
    runs-on: ubuntu-latest
    needs: unit-tests
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run AAP compliance tests
        run: npm run test:aap
```

#### 5.5.2 Package.json Scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run --config vitest.config.ts",
    "test:integration": "vitest run tests/integration",
    "test:e2e": "vitest run --config vitest.config.e2e.ts",
    "test:aap": "vitest run tests/aap-compliance",
    "test:coverage": "vitest run --coverage",
    "test:ci": "npm run test:unit && npm run test:aap"
  }
}
```

---

## 6. Test Matrix

### 6.1 Requirements Coverage

| Requirement | Unit | Integration | E2E | AAP Compliance |
|-------------|:----:|:-----------:|:---:|:--------------:|
| **Gateway Worker** |
| API key hashing (SHA-256, 16 chars) | 1.1.1 | - | - | - |
| Agent lookup/creation | 1.1.2 | 2.1 | 3.2 | - |
| Session ID generation (time-bucket) | 1.1.3 | - | - | - |
| Metadata header construction | 1.1.4 | 2.1 | - | - |
| Request forwarding | 1.1.5 | 2.1 | 3.2 | - |
| Error handling | 1.1.6 | - | - | - |
| **Observer Worker** |
| Log fetching from CF AI Gateway | 1.2.1 | 2.3 | 3.3 | - |
| Thinking block extraction | 1.2.2 | 2.5 | 3.3 | - |
| Haiku analysis | 1.2.3 | 2.3 | - | - |
| APTrace construction | 1.2.4 | - | - | 4.1 |
| Verification with verifyTrace() | 1.2.5 | - | 3.4 | 4.1 |
| Drift detection with detectDrift() | 1.2.6 | - | - | 4.3 |
| Supabase submission | 1.2.7 | 2.2 | 3.3 | - |
| Log deletion | 1.2.8 | 2.2 | 3.3 | - |
| **CLI** |
| Config file creation/loading | 1.3.1 | - | 3.1 | - |
| Agent ID generation | 1.3.2 | - | 3.1 | - |
| API client functions | 1.3.3 | 2.4 | - | - |
| init command | 1.3.4 | - | 3.1 | - |
| status command | 1.3.4 | 2.4 | 3.5 | - |
| integrity command | 1.3.4 | 2.4 | 3.5 | - |
| logs command | 1.3.4 | 2.4 | 3.5 | - |
| **Backend API** |
| Agent queries | 1.4.1 | 2.4 | - | - |
| Trace queries with filtering | 1.4.2 | 2.4 | - | - |
| Integrity score calculation | 1.4.3 | - | 3.5 | - |
| **AAP Compliance** |
| APTrace structure validity | - | - | - | 4.1 |
| AlignmentCard structure validity | - | - | - | 4.2 |
| verifyTrace() passes | - | - | 3.4 | 4.1 |
| detectDrift() works correctly | - | - | - | 4.3 |
| **Full Pipeline** |
| Gateway -> AI Gateway -> Observer -> Storage | - | 2.5 | 3.2, 3.3 | - |
| Fresh install flow | - | - | 3.1 | - |
| Trace appears in < 60s | - | - | 3.3 | - |

### 6.2 Test Counts by Category

| Category | Estimated Test Count | Priority |
|----------|---------------------|----------|
| Gateway Worker Unit Tests | ~25 | P0 |
| Observer Worker Unit Tests | ~35 | P0 |
| CLI Unit Tests | ~20 | P0 |
| Backend API Unit Tests | ~15 | P0 |
| Integration Tests | ~15 | P1 |
| E2E Tests | ~10 | P1 |
| AAP Compliance Tests | ~15 | P0 |
| **Total** | **~135** | - |

### 6.3 Test Execution Strategy

#### Local Development
```bash
# Quick feedback loop - unit tests only
npm run test:watch

# Before commit - unit + AAP compliance
npm run test:ci

# Full local validation
npm run test
```

#### Pull Request
- Unit tests (required to pass)
- AAP compliance tests (required to pass)
- Integration tests with mocks (required to pass)

#### Main Branch / Deploy
- All of the above
- E2E tests against staging environment
- E2E tests against production (smoke tests only)

---

## Appendix: Test Utilities

### A.1 Test Setup Helper

**`tests/setup.ts`:**

```typescript
import { beforeEach, afterEach, vi } from 'vitest';
import { setupFetchMock, resetFetchMock } from './mocks/fetch';

beforeEach(() => {
  setupFetchMock();
});

afterEach(() => {
  resetFetchMock();
  vi.restoreAllMocks();
});
```

### A.2 Async Execution Helper

**`tests/helpers/exec.ts`:**

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export async function execAsync(
  command: string,
  options: { cwd?: string } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execPromise(command, options);
    return { stdout, stderr, exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      exitCode: error.code || 1,
    };
  }
}
```

### A.3 Wait Helper for E2E

**`tests/helpers/wait.ts`:**

```typescript
export async function waitFor(
  condition: () => Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<boolean> {
  const { timeout = 30000, interval = 1000 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  return false;
}
```

---

*This test plan provides comprehensive coverage for the Smoltbot transparent agent infrastructure, ensuring AAP compliance and reliable operation across all components.*
