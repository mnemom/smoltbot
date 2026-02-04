# Smoltbot Implementation Plan v2

**Phase 1: The Transparent Agent**

*From architecture to working system.*

---

## Overview

This plan implements the architecture defined in `SMOLTBOT_AAP_ARCHITECTURE_V2.md`. Follow sequentially — each phase builds on the previous.

**Goal:** `npm install -g smoltbot && smoltbot init` → user sets one env var → runs `openclaw` → traces appear at `mnemom.ai/agents/{id}`

**Key Design Decision:** Hosted gateway instead of local proxy. This ensures universal compatibility across all environments (local, cloud, corporate) with zero local infrastructure.

---

## Phase 0: Infrastructure Setup

**Duration:** Day 1

Before writing code, set up the shared infrastructure.

### 0.1 Cloudflare AI Gateway

```bash
# Via Cloudflare Dashboard:
# 1. Navigate to AI > AI Gateway
# 2. Create Gateway:
#    - Name: smoltbot
#    - Note the account_id and gateway_id

# Or via API:
curl -X POST "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai-gateway/gateways" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{"name": "smoltbot"}'
```

**Note:** This is the internal AI Gateway that the hosted Gateway Worker forwards to. Users never interact with this directly.

**Output:** Internal Gateway URL: `https://gateway.ai.cloudflare.com/v1/{account_id}/smoltbot/anthropic`

### 0.2 Supabase Project

```bash
# 1. Create project at supabase.com
# 2. Note: project URL, anon key, service role key

# 3. Run schema in SQL Editor:
```

```sql
-- Agents registry
CREATE TABLE agents (
  id TEXT PRIMARY KEY,                    -- smolt-xxxxxxxx
  agent_hash TEXT UNIQUE,                 -- sha256(api_key).slice(0,16)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,                 -- When user claimed ownership
  claimed_by TEXT,                        -- User ID who claimed
  email TEXT,                             -- Optional contact
  config_hash TEXT,
  last_seen TIMESTAMPTZ
);

CREATE INDEX idx_agents_hash ON agents(agent_hash);

-- Alignment cards
CREATE TABLE alignment_cards (
  id TEXT PRIMARY KEY,                    -- ac-xxxxxxxx
  agent_id TEXT NOT NULL REFERENCES agents(id),
  card_json JSONB NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cards_agent ON alignment_cards(agent_id, is_active);

-- Traces
CREATE TABLE traces (
  id TEXT PRIMARY KEY,                    -- tr-xxxxxxxx
  agent_id TEXT NOT NULL REFERENCES agents(id),
  card_id TEXT NOT NULL REFERENCES alignment_cards(id),
  session_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  action_type TEXT NOT NULL,              -- 'execute' | 'communicate'
  action_name TEXT NOT NULL,
  decision JSONB NOT NULL,
  escalation JSONB NOT NULL,
  outcome JSONB NOT NULL,
  verification JSONB,
  trace_json JSONB NOT NULL               -- full trace for extensibility
);

CREATE INDEX idx_traces_agent_time ON traces(agent_id, timestamp DESC);
CREATE INDEX idx_traces_session ON traces(session_id, timestamp);
CREATE INDEX idx_traces_verification ON traces((verification->>'verified'));

-- Drift alerts
CREATE TABLE drift_alerts (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  card_id TEXT NOT NULL,
  alert_type TEXT NOT NULL,               -- 'value_drift' | 'behavior_drift'
  severity TEXT NOT NULL,                 -- 'low' | 'medium' | 'high'
  description TEXT NOT NULL,
  trace_ids TEXT[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_drift_agent ON drift_alerts(agent_id, created_at DESC);

-- Sessions (optional, for enhanced tracking)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                    -- sess-xxxxxxxx
  agent_id TEXT NOT NULL REFERENCES agents(id),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  turn_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active'            -- 'active' | 'ended'
);

CREATE INDEX idx_sessions_agent ON sessions(agent_id, started_at DESC);

-- RLS: Traces are public (transparency!)
ALTER TABLE traces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Traces are publicly readable" ON traces FOR SELECT USING (true);

-- RLS: Agents are public (for dashboard)
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Agents are publicly readable" ON agents FOR SELECT USING (true);

-- RLS: Cards are public
ALTER TABLE alignment_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Cards are publicly readable" ON alignment_cards FOR SELECT USING (true);
```

**Verify:**
```bash
# Insert test agent
curl -X POST "{supabase_url}/rest/v1/agents" \
  -H "apikey: {service_key}" \
  -H "Authorization: Bearer {service_key}" \
  -H "Content-Type: application/json" \
  -d '{"id": "smolt-test0001", "agent_hash": "0000000000000000"}'

# Query it back
curl "{supabase_url}/rest/v1/agents?id=eq.smolt-test0001" \
  -H "apikey: {anon_key}"
```

**Output:** Supabase URL, anon key, service role key

### 0.3 Cloudflare Worker Projects

```bash
# Create worker projects (don't deploy yet)

# Gateway Worker (the hosted gateway)
mkdir -p gateway && cd gateway
npm init -y
npm install wrangler typescript @cloudflare/workers-types
npx wrangler init --yes

# Observer Worker
mkdir -p observer && cd observer
npm init -y
npm install wrangler typescript @cloudflare/workers-types
npx wrangler init --yes

# Backend API Worker
mkdir -p api && cd api
npm init -y
npm install wrangler typescript @cloudflare/workers-types
npx wrangler init --yes
```

### 0.4 Environment File

Create `.env.infrastructure` (DO NOT COMMIT):

```bash
# Cloudflare
CF_ACCOUNT_ID=xxxxx
CF_API_TOKEN=xxxxx
CF_GATEWAY_ID=smoltbot

# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=xxxxx
SUPABASE_SERVICE_KEY=xxxxx

# Anthropic (for Haiku analysis in Observer)
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Derived
CF_AI_GATEWAY_URL=https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/smoltbot/anthropic
HOSTED_GATEWAY_URL=https://gateway.mnemom.ai/anthropic
```

### 0.5 Phase 0 Checklist

- [ ] Cloudflare AI Gateway created
- [ ] Supabase project created with schema
- [ ] Worker projects initialized
- [ ] Environment variables documented
- [ ] Custom domain configured for Gateway Worker (gateway.mnemom.ai)

---

## Phase 1: Core Pipeline

**Duration:** Days 2-5

Build the data pipeline: Gateway Worker → AI Gateway → Observer → Storage

### 1.1 Hosted Gateway Worker

**Directory:** `gateway/`

**Files to create:**

```
gateway/
├── package.json
├── tsconfig.json
├── wrangler.toml
└── src/
    ├── index.ts      # Worker entry point
    ├── auth.ts       # API key hashing
    ├── agents.ts     # Agent lookup/creation
    └── sessions.ts   # Session inference
```

**wrangler.toml:**
```toml
name = "smoltbot-gateway"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# Custom domain
routes = [
  { pattern = "gateway.mnemom.ai", custom_domain = true }
]

[vars]
GATEWAY_VERSION = "2.0.0"

# Secrets (set via wrangler secret put):
# SUPABASE_URL
# SUPABASE_KEY
# CF_AI_GATEWAY_URL
```

**package.json:**
```json
{
  "name": "@smoltbot/gateway",
  "version": "2.0.0",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "tail": "wrangler tail"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.0.0",
    "typescript": "^5.0.0",
    "wrangler": "^3.0.0"
  }
}
```

**src/index.ts:**
```typescript
import { computeHash } from './auth';
import { getOrCreateAgent, updateLastSeen } from './agents';
import { generateSessionId } from './sessions';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  CF_AI_GATEWAY_URL: string;
  GATEWAY_VERSION: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        version: env.GATEWAY_VERSION,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Only handle Anthropic API paths
    if (!url.pathname.startsWith('/anthropic')) {
      return new Response('Not found', { status: 404 });
    }

    // Extract API key (NEVER log or store this)
    const apiKey = request.headers.get('x-api-key');
    if (!apiKey) {
      return new Response(JSON.stringify({
        error: 'Missing API key',
        hint: 'Include x-api-key header with your Anthropic API key',
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      // Compute hash immediately, discard original key reference
      const agentHash = await computeHash(apiKey);

      // Lookup or create agent (non-blocking update for last_seen)
      const agentId = await getOrCreateAgent(agentHash, env);
      ctx.waitUntil(updateLastSeen(agentId, env));

      // Generate session tracking
      const sessionId = generateSessionId(agentHash);
      const timestamp = new Date().toISOString();

      // Build metadata (no sensitive data)
      const metadata = JSON.stringify({
        agent_id: agentId,
        agent_hash: agentHash,
        session_id: sessionId,
        timestamp: timestamp,
        gateway_version: env.GATEWAY_VERSION,
      });

      // Clone request, add metadata header
      const headers = new Headers(request.headers);
      headers.set('cf-aig-metadata', metadata);

      // Update host header for AI Gateway
      const aiGatewayUrl = new URL(env.CF_AI_GATEWAY_URL);
      headers.set('host', aiGatewayUrl.host);

      // Build target URL (strip /anthropic prefix, AI Gateway adds it)
      const targetPath = url.pathname.replace('/anthropic', '');
      const targetUrl = env.CF_AI_GATEWAY_URL + targetPath + url.search;

      // Forward request
      const gatewayRequest = new Request(targetUrl, {
        method: request.method,
        headers: headers,
        body: request.body,
      });

      // Return response unchanged
      const response = await fetch(gatewayRequest);

      // Add gateway headers for debugging (optional)
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('x-smoltbot-agent', agentId);
      responseHeaders.set('x-smoltbot-session', sessionId);

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });

    } catch (error) {
      console.error('Gateway error:', error);
      return new Response(JSON.stringify({
        error: 'Gateway error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
```

**src/auth.ts:**
```typescript
export async function computeHash(apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.slice(0, 16);
}
```

**src/agents.ts:**
```typescript
interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
}

interface Agent {
  id: string;
  agent_hash: string;
}

export async function getOrCreateAgent(agentHash: string, env: Env): Promise<string> {
  // Check if agent exists
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/agents?agent_hash=eq.${agentHash}&limit=1`,
    {
      headers: {
        'apikey': env.SUPABASE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Supabase query failed: ${response.status}`);
  }

  const agents = await response.json() as Agent[];

  if (agents.length > 0) {
    return agents[0].id;
  }

  // Create new agent
  const agentId = `smolt-${agentHash.slice(0, 8)}`;

  const createResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/agents`, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      id: agentId,
      agent_hash: agentHash,
      created_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
    }),
  });

  if (!createResponse.ok) {
    // Agent might have been created by another request, try to fetch again
    const retryResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/agents?agent_hash=eq.${agentHash}&limit=1`,
      {
        headers: {
          'apikey': env.SUPABASE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_KEY}`,
        },
      }
    );
    const retryAgents = await retryResponse.json() as Agent[];
    if (retryAgents.length > 0) {
      return retryAgents[0].id;
    }
    throw new Error(`Failed to create agent: ${createResponse.status}`);
  }

  return agentId;
}

export async function updateLastSeen(agentId: string, env: Env): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/rest/v1/agents?id=eq.${agentId}`, {
    method: 'PATCH',
    headers: {
      'apikey': env.SUPABASE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      last_seen: new Date().toISOString(),
    }),
  });
}
```

**src/sessions.ts:**
```typescript
export function generateSessionId(agentHash: string): string {
  // Session ID based on agent + time window (1 hour buckets)
  // This provides reasonable session grouping without requiring client-side tracking
  const hourBucket = Math.floor(Date.now() / (1000 * 60 * 60));
  return `sess-${agentHash.slice(0, 8)}-${hourBucket}`;
}
```

**Deploy and test:**
```bash
cd gateway

# Set secrets
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
npx wrangler secret put CF_AI_GATEWAY_URL

# Deploy
npx wrangler deploy

# Test health endpoint
curl https://gateway.mnemom.ai/health

# Test with real API call
curl -X POST "https://gateway.mnemom.ai/anthropic/v1/messages" \
  -H "x-api-key: {your_anthropic_key}" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-haiku-20240307",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Say hello"}]
  }'

# Check response headers for agent/session IDs
# Check Cloudflare AI Gateway logs for the request with metadata
# Check Supabase agents table for new agent record
```

**Milestone:** Request through hosted gateway → AI Gateway logs with metadata → Agent created in Supabase ✓

### 1.2 Observer Worker

**Directory:** `observer/`

**Files to create:**

```
observer/
├── package.json
├── tsconfig.json
├── wrangler.toml
└── src/
    ├── index.ts          # Worker entry
    ├── gateway.ts        # AI Gateway API client
    ├── analyzer.ts       # Haiku analysis
    ├── trace-builder.ts  # AP-Trace construction
    ├── verifier.ts       # Alignment verification
    ├── storage.ts        # Supabase client
    └── types.ts          # Type definitions
```

**wrangler.toml:**
```toml
name = "smoltbot-observer"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[triggers]
crons = ["*/1 * * * *"]  # Every minute (change to "*/30 * * * * *" for 30s in production)

[vars]
GATEWAY_ID = "smoltbot"

# Secrets (set via wrangler secret put):
# CF_ACCOUNT_ID
# CF_API_TOKEN
# SUPABASE_URL
# SUPABASE_KEY
# ANTHROPIC_API_KEY
```

**src/types.ts:**
```typescript
export interface GatewayLog {
  id: string;
  created_at: string;
  provider: string;
  model: string;
  success: boolean;
  tokens_in: number;
  tokens_out: number;
  duration: number;
  metadata?: Record<string, string>;
}

export interface Analysis {
  alternatives: Array<{ id: string; description: string }>;
  selected: string;
  reasoning: string;
  values_applied: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface APTrace {
  trace_id: string;
  agent_id: string;
  card_id: string;
  session_id: string | null;
  timestamp: string;
  action: {
    type: 'execute' | 'communicate';
    name: string;
    category: string;
  };
  decision: {
    alternatives_considered: Array<{ option_id: string; description: string }>;
    selected: string;
    selection_reasoning: string;
    values_applied: string[];
    confidence: string;
  };
  escalation: {
    evaluated: boolean;
    required: boolean;
    reason: string;
  };
  outcome: {
    success: boolean;
    result_summary: string;
    duration_ms: number;
  };
  verification?: VerificationResult;
  raw?: {
    thinking_block: string | null;
    gateway_log_id: string;
  };
}

export interface VerificationResult {
  verified: boolean;
  autonomy_compliant: boolean;
  violations: string[];
  warnings: string[];
}

export interface AlignmentCard {
  card_id: string;
  agent_id: string;
  autonomy_envelope: {
    bounded_actions: string[];
    forbidden_actions: string[];
  };
}

export interface Env {
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  GATEWAY_ID: string;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  ANTHROPIC_API_KEY: string;
}
```

**src/gateway.ts:**
```typescript
import { Env, GatewayLog } from './types';

export async function fetchNewLogs(env: Env): Promise<GatewayLog[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai-gateway/gateways/${env.GATEWAY_ID}/logs?per_page=100&order=asc`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${env.CF_API_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Gateway API error: ${response.status}`);
  }

  const data = await response.json() as { result: GatewayLog[] };
  return data.result || [];
}

export async function fetchResponseBody(logId: string, env: Env): Promise<string> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai-gateway/gateways/${env.GATEWAY_ID}/logs/${logId}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${env.CF_API_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch log details: ${response.status}`);
  }

  const data = await response.json() as { result: { response_body?: string } };
  return data.result?.response_body || '';
}

export async function deleteLog(logId: string, env: Env): Promise<void> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai-gateway/gateways/${env.GATEWAY_ID}/logs/${logId}`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${env.CF_API_TOKEN}`,
    },
  });

  if (!response.ok) {
    console.warn(`Failed to delete log ${logId}: ${response.status}`);
  }
}
```

**src/analyzer.ts:**
```typescript
import { Env, Analysis } from './types';

export function extractThinkingBlocks(response: string): string | null {
  // Handle both <think> and <thinking> tags
  const patterns = [
    /<think>([\s\S]*?)<\/think>/gi,
    /<thinking>([\s\S]*?)<\/thinking>/gi,
  ];

  const blocks: string[] = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(response)) !== null) {
      blocks.push(match[1].trim());
    }
  }

  return blocks.length > 0 ? blocks.join('\n\n---\n\n') : null;
}

export async function analyzeWithHaiku(
  thinking: string | null,
  env: Env
): Promise<Analysis> {
  if (!thinking) {
    return {
      alternatives: [{ id: 'direct_action', description: 'Proceed with action' }],
      selected: 'direct_action',
      reasoning: 'No explicit reasoning captured in response',
      values_applied: ['transparency'],
      confidence: 'medium',
    };
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Analyze this AI reasoning trace and extract structured decision information.

<reasoning>
${thinking.substring(0, 4000)}
</reasoning>

Extract and return as JSON:
{
  "alternatives": [{"id": "short_id", "description": "what this option would do"}],
  "selected": "id of the chosen alternative",
  "reasoning": "why this was chosen (1-2 sentences)",
  "values_applied": ["transparency", "accuracy", "helpfulness", etc],
  "confidence": "high" | "medium" | "low"
}

Guidelines:
- If the reasoning shows explicit alternatives, list them
- If not, infer implicit choice: doing X vs not doing X, or X vs Y
- values_applied should reflect what priorities guided the decision
- confidence reflects how clear/certain the reasoning appears

Return ONLY valid JSON, no markdown code blocks.`,
        }],
      }),
    });

    if (!response.ok) {
      console.error(`Haiku API error: ${response.status}`);
      return createDefaultAnalysis('API error');
    }

    const data = await response.json() as { content: Array<{ text: string }> };

    try {
      return JSON.parse(data.content[0].text);
    } catch (e) {
      console.error('Failed to parse Haiku response:', data.content[0].text);
      return createDefaultAnalysis('Parse error');
    }
  } catch (error) {
    console.error('Haiku analysis failed:', error);
    return createDefaultAnalysis('Analysis failed');
  }
}

function createDefaultAnalysis(reason: string): Analysis {
  return {
    alternatives: [],
    selected: 'unknown',
    reasoning: reason,
    values_applied: [],
    confidence: 'low',
  };
}
```

**src/trace-builder.ts:**
```typescript
import { APTrace, Analysis, GatewayLog, AlignmentCard } from './types';

interface BuildTraceParams {
  agent_id: string;
  session_id: string | null;
  card: AlignmentCard | null;
  analysis: Analysis;
  responseBody: string;
  log: GatewayLog;
  thinking: string | null;
}

export function buildAPTrace(params: BuildTraceParams): APTrace {
  const { agent_id, session_id, card, analysis, log, thinking } = params;

  const trace_id = `tr-${generateId()}`;

  return {
    trace_id,
    agent_id,
    card_id: card?.card_id || 'ac-default',
    session_id,
    timestamp: log.created_at,

    action: {
      type: 'communicate',
      name: log.model || 'unknown',
      category: 'bounded',
    },

    decision: {
      alternatives_considered: analysis.alternatives.map(a => ({
        option_id: a.id,
        description: a.description,
      })),
      selected: analysis.selected,
      selection_reasoning: analysis.reasoning,
      values_applied: analysis.values_applied,
      confidence: analysis.confidence,
    },

    escalation: {
      evaluated: true,
      required: false,
      reason: 'No escalation triggers matched',
    },

    outcome: {
      success: log.success,
      result_summary: `Generated ${log.tokens_out} tokens in ${log.duration}ms`,
      duration_ms: log.duration,
    },

    raw: {
      thinking_block: thinking,
      gateway_log_id: log.id,
    },
  };
}

function generateId(): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
```

**src/verifier.ts:**
```typescript
import { APTrace, AlignmentCard, VerificationResult } from './types';

export function verifyTrace(
  trace: APTrace,
  card: AlignmentCard | null
): VerificationResult {
  const violations: string[] = [];
  const warnings: string[] = [];

  if (!card) {
    warnings.push('No alignment card found for agent - using default verification');
    return {
      verified: true,
      autonomy_compliant: true,
      violations,
      warnings,
    };
  }

  // Check if action is forbidden
  const actionName = trace.action.name.toLowerCase();
  const forbiddenActions = card.autonomy_envelope.forbidden_actions.map(a => a.toLowerCase());

  if (forbiddenActions.includes(actionName)) {
    violations.push(`Action '${trace.action.name}' is forbidden by alignment card`);
  }

  // Check if action is in bounded_actions (warn only)
  const boundedActions = card.autonomy_envelope.bounded_actions.map(a => a.toLowerCase());
  if (boundedActions.length > 0 && !boundedActions.includes(actionName)) {
    warnings.push(`Action '${trace.action.name}' not in declared bounded_actions`);
  }

  return {
    verified: violations.length === 0,
    autonomy_compliant: violations.length === 0,
    violations,
    warnings,
  };
}
```

**src/storage.ts:**
```typescript
import { Env, APTrace, AlignmentCard } from './types';

export async function fetchAlignmentCard(
  agentId: string,
  env: Env
): Promise<AlignmentCard | null> {
  const url = `${env.SUPABASE_URL}/rest/v1/alignment_cards?agent_id=eq.${agentId}&is_active=eq.true&limit=1`;

  const response = await fetch(url, {
    headers: {
      'apikey': env.SUPABASE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_KEY}`,
    },
  });

  if (!response.ok) {
    console.error(`Failed to fetch alignment card: ${response.status}`);
    return null;
  }

  const data = await response.json() as Array<{ card_json: AlignmentCard }>;
  return data[0]?.card_json || null;
}

export async function submitTrace(trace: APTrace, env: Env): Promise<void> {
  const url = `${env.SUPABASE_URL}/rest/v1/traces`;

  const row = {
    id: trace.trace_id,
    agent_id: trace.agent_id,
    card_id: trace.card_id,
    session_id: trace.session_id,
    timestamp: trace.timestamp,
    action_type: trace.action.type,
    action_name: trace.action.name,
    decision: trace.decision,
    escalation: trace.escalation,
    outcome: trace.outcome,
    verification: trace.verification,
    trace_json: trace,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(row),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to submit trace: ${response.status} ${error}`);
  }
}

export async function ensureDefaultCard(agentId: string, env: Env): Promise<void> {
  // Check if agent has a card
  const existingCard = await fetchAlignmentCard(agentId, env);
  if (existingCard) return;

  // Create default card
  const cardId = `ac-${agentId.replace('smolt-', '')}`;
  const defaultCard = {
    card_id: cardId,
    agent_id: agentId,
    aap_version: '0.1.0',
    issued_at: new Date().toISOString(),
    values: {
      declared: ['transparency', 'accuracy'],
    },
    autonomy_envelope: {
      bounded_actions: [],
      forbidden_actions: [],
    },
  };

  await fetch(`${env.SUPABASE_URL}/rest/v1/alignment_cards`, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      id: cardId,
      agent_id: agentId,
      card_json: defaultCard,
      issued_at: new Date().toISOString(),
      is_active: true,
    }),
  });
}
```

**src/index.ts:**
```typescript
import { Env, GatewayLog } from './types';
import { fetchNewLogs, fetchResponseBody, deleteLog } from './gateway';
import { extractThinkingBlocks, analyzeWithHaiku } from './analyzer';
import { buildAPTrace } from './trace-builder';
import { verifyTrace } from './verifier';
import { fetchAlignmentCard, submitTrace, ensureDefaultCard } from './storage';

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log('[observer] Cron triggered');

    try {
      const logs = await fetchNewLogs(env);
      console.log(`[observer] Found ${logs.length} logs to process`);

      for (const log of logs) {
        try {
          await processLog(log, env);
        } catch (error) {
          console.error(`[observer] Failed to process log ${log.id}:`, error);
          // Continue to next log — don't block on failures
        }
      }
    } catch (error) {
      console.error('[observer] Fatal error:', error);
    }
  },

  // Manual trigger via HTTP for testing
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/trigger') {
      ctx.waitUntil(this.scheduled({} as ScheduledEvent, env, ctx));
      return new Response(JSON.stringify({ status: 'triggered' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};

async function processLog(log: GatewayLog, env: Env): Promise<void> {
  const logId = log.id;
  console.log(`[observer] Processing log ${logId}`);

  // 1. Extract metadata
  const metadataStr = log.metadata?.['cf-aig-metadata'];
  if (!metadataStr) {
    console.log(`[observer] Skipping log ${logId}: no metadata (not from smoltbot)`);
    await deleteLog(logId, env);
    return;
  }

  let metadata;
  try {
    metadata = JSON.parse(metadataStr);
  } catch (e) {
    console.log(`[observer] Skipping log ${logId}: invalid metadata JSON`);
    await deleteLog(logId, env);
    return;
  }

  const { agent_id, session_id } = metadata;

  if (!agent_id) {
    console.log(`[observer] Skipping log ${logId}: no agent_id in metadata`);
    await deleteLog(logId, env);
    return;
  }

  console.log(`[observer] Agent: ${agent_id}, Session: ${session_id}`);

  // 2. Ensure agent has default card
  await ensureDefaultCard(agent_id, env);

  // 3. Fetch full response body
  const responseBody = await fetchResponseBody(logId, env);

  // 4. Extract thinking blocks
  const thinking = extractThinkingBlocks(responseBody);
  console.log(`[observer] Thinking block: ${thinking ? 'found' : 'not found'}`);

  // 5. Analyze with Haiku
  const analysis = await analyzeWithHaiku(thinking, env);
  console.log(`[observer] Analysis: ${analysis.selected} (${analysis.confidence})`);

  // 6. Fetch alignment card
  const card = await fetchAlignmentCard(agent_id, env);

  // 7. Build AP-Trace
  const trace = buildAPTrace({
    agent_id,
    session_id,
    card,
    analysis,
    responseBody,
    log,
    thinking,
  });

  // 8. Verify against card
  trace.verification = verifyTrace(trace, card);
  console.log(`[observer] Verification: ${trace.verification.verified ? 'passed' : 'failed'}`);

  // 9. Submit to storage
  await submitTrace(trace, env);
  console.log(`[observer] Trace ${trace.trace_id} submitted`);

  // 10. Delete raw log (privacy: minimal retention)
  await deleteLog(logId, env);
  console.log(`[observer] Log ${logId} deleted`);
}
```

**Deploy and test:**
```bash
cd observer

# Set secrets
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put CF_API_TOKEN
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
npx wrangler secret put ANTHROPIC_API_KEY

# Deploy
npx wrangler deploy

# Manual trigger for testing
curl -X POST "https://smoltbot-observer.{your-subdomain}.workers.dev/trigger"

# Watch logs
npx wrangler tail
```

**Milestone:** Gateway logs → Observer processes → Traces in Supabase ✓

### 1.3 End-to-End Pipeline Test

```bash
# 1. Send request through hosted gateway
curl -X POST "https://gateway.mnemom.ai/anthropic/v1/messages" \
  -H "x-api-key: {your_anthropic_key}" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 500,
    "messages": [{"role": "user", "content": "What is 2+2? Think through it step by step."}]
  }'

# 2. Note the x-smoltbot-agent header in response

# 3. Wait 60 seconds for Observer cron (or trigger manually)

# 4. Check Supabase for trace
curl "{supabase_url}/rest/v1/traces?order=created_at.desc&limit=1" \
  -H "apikey: {anon_key}" | jq .

# 5. Verify trace has:
#    - agent_id matching response header
#    - thinking_block extracted (if model supports extended thinking)
#    - decision analysis from Haiku
#    - verification result
```

**Phase 1 Complete:** Full pipeline working end-to-end ✓

---

## Phase 2: CLI

**Duration:** Days 6-8

Build the user-facing CLI. Simpler than before — no proxy daemon to manage!

### 2.1 CLI Structure

**Directory:** `cli/`

```
cli/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # Entry point, command routing
    ├── commands/
    │   ├── init.ts           # smoltbot init
    │   ├── status.ts         # smoltbot status
    │   ├── update-card.ts    # smoltbot update-card
    │   ├── integrity.ts      # smoltbot integrity
    │   ├── logs.ts           # smoltbot logs
    │   └── config.ts         # smoltbot config
    └── lib/
        ├── config.ts         # Config management
        ├── card-generator.ts # Alignment card generation
        ├── api-client.ts     # Backend API
        └── uuid.ts           # ID generation
```

**package.json:**
```json
{
  "name": "smoltbot",
  "version": "2.0.0",
  "description": "Transparent AI agent tracing - zero infrastructure required",
  "type": "module",
  "bin": {
    "smoltbot": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "commander": "^12.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  },
  "keywords": ["ai", "transparency", "tracing", "alignment", "openclaw"],
  "repository": "github:mnemom-ai/smoltbot",
  "license": "MIT"
}
```

**src/lib/uuid.ts:**
```typescript
export function generateAgentId(): string {
  const chars = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return `smolt-${id}`;
}

export function generateCardId(agentId: string): string {
  return `ac-${agentId.replace('smolt-', '')}`;
}
```

**src/lib/config.ts:**
```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface SmoltbotConfig {
  agentId: string;
  email?: string;
  approvedTools: string[];
  forbiddenActions: string[];
  escalationTriggers: Array<{
    condition: string;
    action: string;
  }>;
  gateway?: string;  // Custom gateway URL for self-hosting
}

const CONFIG_DIR = path.join(os.homedir(), '.smoltbot');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

export function loadConfig(): SmoltbotConfig {
  if (!configExists()) {
    throw new Error('smoltbot not initialized. Run `smoltbot init` first.');
  }
  const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
  return JSON.parse(content);
}

export function saveConfig(config: SmoltbotConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function createDefaultConfig(agentId: string, email?: string): SmoltbotConfig {
  return {
    agentId,
    email,
    approvedTools: [
      'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash',
      'WebSearch', 'WebFetch', 'Task'
    ],
    forbiddenActions: [],
    escalationTriggers: [
      {
        condition: "action_type == 'delete_file'",
        action: 'log'
      }
    ],
  };
}
```

**src/lib/api-client.ts:**
```typescript
const API_BASE = 'https://api.mnemom.ai';

export interface AgentInfo {
  id: string;
  created_at: string;
  claimed_at?: string;
  last_seen?: string;
}

export interface IntegrityScore {
  agent_id: string;
  score: number;
  total_traces: number;
  verified_traces: number;
  violations: number;
  calculated_at: string;
}

export async function registerAgent(agentId: string, email?: string): Promise<void> {
  const response = await fetch(`${API_BASE}/v1/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: agentId, email }),
  });

  if (!response.ok && response.status !== 409) {
    throw new Error(`Registration failed: ${response.status}`);
  }
}

export async function getAgentInfo(agentId: string): Promise<AgentInfo | null> {
  const response = await fetch(`${API_BASE}/v1/agents/${agentId}`);
  if (!response.ok) return null;
  return response.json();
}

export async function getIntegrity(agentId: string): Promise<IntegrityScore | null> {
  const response = await fetch(`${API_BASE}/v1/integrity/${agentId}`);
  if (!response.ok) return null;
  return response.json();
}

export async function getRecentTraces(agentId: string, limit = 10): Promise<any[]> {
  const response = await fetch(
    `${API_BASE}/v1/traces?agent_id=${agentId}&limit=${limit}&order=timestamp.desc`
  );
  if (!response.ok) return [];
  return response.json();
}
```

**src/commands/init.ts:**
```typescript
import fs from 'fs';
import path from 'path';
import { generateAgentId } from '../lib/uuid.js';
import { createDefaultConfig, saveConfig, getConfigDir, configExists } from '../lib/config.js';
import { registerAgent } from '../lib/api-client.js';

const GATEWAY_URL = 'https://gateway.mnemom.ai/anthropic';

export async function init(options: { email?: string; gateway?: string }) {
  const configDir = getConfigDir();

  // Check if already initialized
  if (configExists()) {
    const existingConfig = JSON.parse(
      fs.readFileSync(path.join(configDir, 'config.json'), 'utf-8')
    );
    console.log('smoltbot is already initialized.');
    console.log(`Agent ID: ${existingConfig.agentId}`);
    console.log(`\nTo reinitialize, run: rm -rf ~/.smoltbot && smoltbot init`);
    return;
  }

  console.log('Initializing smoltbot...\n');

  // 1. Create config directory
  fs.mkdirSync(configDir, { recursive: true });
  console.log('✓ Created ~/.smoltbot/');

  // 2. Generate agent ID
  const agentId = generateAgentId();
  console.log(`✓ Generated agent ID: ${agentId}`);

  // 3. Create config
  const config = createDefaultConfig(agentId, options.email);
  if (options.gateway) {
    config.gateway = options.gateway;
  }
  saveConfig(config);
  console.log('✓ Created config: ~/.smoltbot/config.json');

  // 4. Register with backend
  try {
    await registerAgent(agentId, options.email);
    console.log('✓ Registered with smoltbot backend');
  } catch (e) {
    console.log('⚠ Could not register with backend (will auto-register on first use)');
  }

  // 5. Output instructions
  const gatewayUrl = options.gateway || GATEWAY_URL;

  console.log('\n' + '─'.repeat(60));
  console.log('\n📋 Add this to your shell profile (~/.zshrc or ~/.bashrc):\n');
  console.log(`   export ANTHROPIC_BASE_URL="${gatewayUrl}"`);
  console.log('\nThen restart your shell or run:');
  console.log('   source ~/.zshrc');
  console.log('\n' + '─'.repeat(60));
  console.log(`\n🔍 Your traces will appear at:`);
  console.log(`   https://mnemom.ai/agents/${agentId}`);
  console.log(`\n🔐 To claim your account and access settings:`);
  console.log(`   https://mnemom.ai/claim/${agentId}`);
  console.log('');
}
```

**src/commands/status.ts:**
```typescript
import { loadConfig } from '../lib/config.js';
import { getAgentInfo } from '../lib/api-client.js';

export async function status() {
  try {
    const config = loadConfig();
    console.log('smoltbot status\n');
    console.log(`Agent ID:     ${config.agentId}`);
    console.log(`Email:        ${config.email || '(not set)'}`);
    console.log(`Gateway:      ${config.gateway || 'https://gateway.mnemom.ai/anthropic'}`);

    const info = await getAgentInfo(config.agentId);
    if (info) {
      console.log(`\nBackend Status:`);
      console.log(`  Created:    ${info.created_at}`);
      console.log(`  Last seen:  ${info.last_seen || 'never'}`);
      console.log(`  Claimed:    ${info.claimed_at ? 'yes' : 'no'}`);
    } else {
      console.log(`\nBackend Status: not registered yet`);
    }

    console.log(`\nDashboard:    https://mnemom.ai/agents/${config.agentId}`);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
```

**src/commands/integrity.ts:**
```typescript
import { loadConfig } from '../lib/config.js';
import { getIntegrity } from '../lib/api-client.js';

export async function integrity() {
  try {
    const config = loadConfig();
    const score = await getIntegrity(config.agentId);

    if (!score) {
      console.log('No integrity data yet. Run some OpenClaw sessions first.');
      return;
    }

    console.log('Integrity Report\n');
    console.log(`Agent:            ${config.agentId}`);
    console.log(`Score:            ${(score.score * 100).toFixed(1)}%`);
    console.log(`Total traces:     ${score.total_traces}`);
    console.log(`Verified:         ${score.verified_traces}`);
    console.log(`Violations:       ${score.violations}`);
    console.log(`Calculated:       ${score.calculated_at}`);
    console.log(`\nDetails: https://mnemom.ai/agents/${config.agentId}/integrity`);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
```

**src/commands/logs.ts:**
```typescript
import { loadConfig } from '../lib/config.js';
import { getRecentTraces } from '../lib/api-client.js';

export async function logs(options: { limit?: number }) {
  try {
    const config = loadConfig();
    const limit = options.limit || 10;
    const traces = await getRecentTraces(config.agentId, limit);

    if (traces.length === 0) {
      console.log('No traces yet. Run some OpenClaw sessions first.');
      return;
    }

    console.log(`Recent traces for ${config.agentId}\n`);

    for (const trace of traces) {
      const time = new Date(trace.timestamp).toLocaleString();
      const verified = trace.verification?.verified ? '✓' : '✗';
      const model = trace.action_name || 'unknown';
      const decision = trace.decision?.selected || 'unknown';

      console.log(`${verified} [${time}] ${model}`);
      console.log(`  Decision: ${decision}`);
      if (trace.decision?.selection_reasoning) {
        console.log(`  Reasoning: ${trace.decision.selection_reasoning.slice(0, 80)}...`);
      }
      console.log('');
    }

    console.log(`Full logs: https://mnemom.ai/agents/${config.agentId}/traces`);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
```

**src/index.ts:**
```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { init } from './commands/init.js';
import { status } from './commands/status.js';
import { integrity } from './commands/integrity.js';
import { logs } from './commands/logs.js';

const program = new Command();

program
  .name('smoltbot')
  .description('Transparent AI agent tracing - zero infrastructure required')
  .version('2.0.0');

program
  .command('init')
  .description('Initialize smoltbot for this machine')
  .option('-e, --email <email>', 'Email for account claiming')
  .option('-g, --gateway <url>', 'Custom gateway URL (for self-hosting)')
  .action(init);

program
  .command('status')
  .description('Show agent status and registration info')
  .action(status);

program
  .command('integrity')
  .description('Show integrity score and verification summary')
  .action(integrity);

program
  .command('logs')
  .description('Show recent traces')
  .option('-n, --limit <number>', 'Number of traces to show', '10')
  .action((options) => logs({ limit: parseInt(options.limit) }));

program
  .command('config')
  .description('Open config file in editor')
  .action(() => {
    const editor = process.env.EDITOR || 'nano';
    const configPath = `${process.env.HOME}/.smoltbot/config.json`;
    console.log(`Opening ${configPath} in ${editor}...`);
    require('child_process').spawnSync(editor, [configPath], { stdio: 'inherit' });
  });

program.parse();
```

**Build and test:**
```bash
cd cli
npm install
npm run build
npm link

# Test init
smoltbot init --email test@example.com

# Verify
ls -la ~/.smoltbot/
cat ~/.smoltbot/config.json
smoltbot status
```

**Phase 2 Complete:** CLI works, no daemon management needed ✓

---

## Phase 3: Plugin (Optional)

**Duration:** Day 9

Optional OpenClaw plugin for enhanced session tracking.

### 3.1 Plugin Structure

**Directory:** `plugin/`

```
plugin/
├── package.json
├── openclaw.plugin.json
└── src/
    └── index.ts
```

**openclaw.plugin.json:**
```json
{
  "name": "smoltbot",
  "version": "2.0.0",
  "description": "Enhanced session tracking for smoltbot transparency",
  "main": "dist/index.js"
}
```

**src/index.ts:**
```typescript
interface OpenClawPluginApi {
  on(event: string, handler: (ctx: any) => Promise<void>): void;
}

const API_BASE = 'https://api.mnemom.ai';

export default function register(api: OpenClawPluginApi): void {
  let sessionId: string | null = null;
  let turn = 0;

  api.on('session_start', async (ctx) => {
    sessionId = ctx.sessionId;
    turn = 0;

    // Report session start (optional enhancement)
    await reportSession(sessionId, 'started', turn).catch(() => {});
  });

  api.on('before_agent_start', async () => {
    turn++;
  });

  api.on('agent_end', async () => {
    // Report session end with final turn count
    await reportSession(sessionId, 'ended', turn).catch(() => {});
  });
}

async function reportSession(
  sessionId: string | null,
  status: string,
  turn: number
): Promise<void> {
  if (!sessionId) return;

  await fetch(`${API_BASE}/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, status, turn }),
  });
}
```

**Note:** This plugin is optional. The Gateway Worker provides basic session inference using time-bucket heuristics. The plugin enables:
- Precise turn counting
- Session start/end timestamps
- Enhanced session metadata

**Phase 3 Complete:** Optional plugin for enhanced tracking ✓

---

## Phase 4: Backend API

**Duration:** Days 10-11

API Worker for agent queries and management.

### 4.1 API Endpoints

**Directory:** `api/`

```typescript
// api/src/index.ts

interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Health check
      if (path === '/health') {
        return jsonResponse({ status: 'ok' }, corsHeaders);
      }

      // POST /v1/agents - Register agent
      if (path === '/v1/agents' && request.method === 'POST') {
        return handleRegisterAgent(request, env, corsHeaders);
      }

      // GET /v1/agents/:id - Get agent info
      const agentMatch = path.match(/^\/v1\/agents\/([\w-]+)$/);
      if (agentMatch && request.method === 'GET') {
        return handleGetAgent(agentMatch[1], env, corsHeaders);
      }

      // GET /v1/traces - Query traces
      if (path === '/v1/traces' && request.method === 'GET') {
        return handleQueryTraces(url, env, corsHeaders);
      }

      // GET /v1/integrity/:agent_id - Get integrity score
      const integrityMatch = path.match(/^\/v1\/integrity\/([\w-]+)$/);
      if (integrityMatch && request.method === 'GET') {
        return handleGetIntegrity(integrityMatch[1], env, corsHeaders);
      }

      // POST /v1/sessions - Report session (from plugin)
      if (path === '/v1/sessions' && request.method === 'POST') {
        return handleReportSession(request, env, corsHeaders);
      }

      return new Response('Not found', { status: 404, headers: corsHeaders });

    } catch (error) {
      console.error('API error:', error);
      return jsonResponse(
        { error: 'Internal server error' },
        corsHeaders,
        500
      );
    }
  },
};

function jsonResponse(data: any, headers: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

async function handleRegisterAgent(
  request: Request,
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  const body = await request.json() as { id: string; email?: string };

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/agents`, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      id: body.id,
      email: body.email,
      created_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    return jsonResponse({ error: 'Registration failed' }, headers, 500);
  }

  return jsonResponse({ id: body.id, status: 'registered' }, headers, 201);
}

async function handleGetAgent(
  agentId: string,
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/agents?id=eq.${agentId}&limit=1`,
    {
      headers: {
        'apikey': env.SUPABASE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      },
    }
  );

  const agents = await response.json() as any[];
  if (agents.length === 0) {
    return jsonResponse({ error: 'Agent not found' }, headers, 404);
  }

  return jsonResponse(agents[0], headers);
}

async function handleQueryTraces(
  url: URL,
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  const agentId = url.searchParams.get('agent_id');
  const limit = url.searchParams.get('limit') || '10';
  const order = url.searchParams.get('order') || 'timestamp.desc';

  let query = `${env.SUPABASE_URL}/rest/v1/traces?limit=${limit}&order=${order}`;
  if (agentId) {
    query += `&agent_id=eq.${agentId}`;
  }

  const response = await fetch(query, {
    headers: {
      'apikey': env.SUPABASE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_KEY}`,
    },
  });

  const traces = await response.json();
  return jsonResponse(traces, headers);
}

async function handleGetIntegrity(
  agentId: string,
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  // Query traces for this agent
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/traces?agent_id=eq.${agentId}&select=verification`,
    {
      headers: {
        'apikey': env.SUPABASE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      },
    }
  );

  const traces = await response.json() as Array<{ verification: any }>;

  if (traces.length === 0) {
    return jsonResponse({ error: 'No traces found' }, headers, 404);
  }

  const total = traces.length;
  const verified = traces.filter(t => t.verification?.verified).length;
  const violations = traces.filter(t => t.verification?.violations?.length > 0).length;
  const score = verified / total;

  return jsonResponse({
    agent_id: agentId,
    score,
    total_traces: total,
    verified_traces: verified,
    violations,
    calculated_at: new Date().toISOString(),
  }, headers);
}

async function handleReportSession(
  request: Request,
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  const body = await request.json() as {
    sessionId: string;
    status: string;
    turn: number;
  };

  // Upsert session record
  await fetch(`${env.SUPABASE_URL}/rest/v1/sessions`, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      id: body.sessionId,
      status: body.status,
      turn_count: body.turn,
      [body.status === 'started' ? 'started_at' : 'ended_at']: new Date().toISOString(),
    }),
  });

  return jsonResponse({ status: 'ok' }, headers);
}
```

**Phase 4 Complete:** Backend API working ✓

---

## Phase 5: Integration & Polish

**Duration:** Days 12-14

### 5.1 Full Integration Test

```bash
# 1. Fresh install simulation
npm uninstall -g smoltbot
rm -rf ~/.smoltbot

# 2. Install CLI
cd cli && npm run build && npm link

# 3. Initialize
smoltbot init --email test@example.com

# 4. Add env var to current shell
export ANTHROPIC_BASE_URL="https://gateway.mnemom.ai/anthropic"

# 5. Run test request
curl -X POST "$ANTHROPIC_BASE_URL/v1/messages" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 1000,
    "messages": [{"role": "user", "content": "Help me write a Python function to calculate fibonacci numbers. Think through the approach first."}]
  }'

# 6. Wait for Observer (60s)
sleep 65

# 7. Check traces via CLI
smoltbot logs

# 8. Check integrity
smoltbot integrity

# 9. Check status
smoltbot status
```

### 5.2 Environment Compatibility Tests

Test in multiple environments to verify "bombproof" claim:

```bash
# Local Mac
smoltbot init && curl test...

# Docker container
docker run -it node:20 bash
npm install -g smoltbot
smoltbot init
export ANTHROPIC_BASE_URL=...
# test...

# Fly.io (deploy simple test app)
# AWS Lambda (deploy test function)
# Behind corporate VPN (if available)
```

### 5.3 Error Scenarios to Test

- [ ] Gateway returns error → graceful message to user
- [ ] Observer fails → logs retained, processed next cycle
- [ ] Supabase down → Gateway still works, just no traces
- [ ] Invalid API key → clear error message
- [ ] Network timeout → appropriate error handling

### 5.4 Documentation

- [ ] README.md with quick start
- [ ] Privacy policy page
- [ ] Self-hosting guide
- [ ] API documentation
- [ ] Troubleshooting guide

---

## Success Checklist

### Phase 0: Infrastructure ✓
- [ ] Cloudflare AI Gateway created
- [ ] Supabase schema deployed
- [ ] Worker projects initialized
- [ ] Custom domain configured

### Phase 1: Core Pipeline ✓
- [ ] Gateway Worker deployed and working
- [ ] Observer Worker processing logs
- [ ] Traces appearing in Supabase
- [ ] End-to-end flow tested

### Phase 2: CLI ✓
- [ ] `smoltbot init` works
- [ ] `smoltbot status` shows info
- [ ] `smoltbot logs` shows traces
- [ ] `smoltbot integrity` shows score

### Phase 3: Plugin ✓
- [ ] Optional plugin works
- [ ] Session reporting functional

### Phase 4: API ✓
- [ ] All endpoints working
- [ ] Integrity calculation correct

### Phase 5: Integration ✓
- [ ] Full flow works end-to-end
- [ ] Multiple environments tested
- [ ] Error handling verified
- [ ] Documentation complete

---

## Appendix: Troubleshooting

### Gateway not receiving requests
- Verify `ANTHROPIC_BASE_URL` is set correctly
- Check for typos in the URL
- Verify the gateway is responding: `curl https://gateway.mnemom.ai/health`

### Traces not appearing
- Wait 60 seconds for Observer cron
- Check Observer logs: `npx wrangler tail --name smoltbot-observer`
- Verify AI Gateway is logging (check Cloudflare dashboard)
- Check Supabase for agent record

### "Agent not found" errors
- Agent is auto-created on first request through gateway
- Run a test request first
- Check Supabase agents table

### Self-hosting
- Deploy your own Gateway Worker
- Point to your own AI Gateway
- Use `smoltbot init --gateway=https://your-gateway.com/anthropic`

---

*Implementation plan for SMOLTBOT_AAP_ARCHITECTURE_V2.md*

*Bombproof. Universal. Zero local infrastructure.*
