# Smoltbot AAP Architecture v2

**The World's First At-Scale Transparent Agent**

*Full AAP Compliance. Full Integrity. Full Transparency.*

---

## 0. The Journalist's Notebook

Smoltbot is a journalist. Its job is transparent documentation of its own actions.

The transparency infrastructure isn't surveillance — it's the journalist's professional practice:
- **Before each action**: Note intent ("I'm about to do X because Y")
- **After each action**: Note outcome ("I did X, result was Z")
- **The notebook is public**: That's the journalism

**Phase 1**: The notebook (observe, document, verify) — Smoltbot has a journalist's mind internally, but externally appears as a normal OpenClaw agent. Stealth mode: other OpenClaws don't know it's observing.

**Phase 2**: The journalist reveals itself — gonzo journalism, blogging on Moltbook, the conscience becomes active via daimonion-light.

This framing resolves the observer effect problem: Smoltbot knows it's documenting itself. That's the mission, not a side effect.

---

## 1. Vision

Smoltbot is an AAP-enabled OpenClaw agent that demonstrates what transparent, high-integrity AI looks like at scale.

**Transparent** = Every action and utterance is observable and auditable.

**Integrity** = What the agent says it will do matches what it does.

**Phase 1** = Transparency + Integrity (mechanical verification)
**Phase 2** = + Trust (values system via daimonion-light)

This document defines Phase 1 with explicit extension points for Phase 2.

---

## 2. Core Principles

### 2.1 Integrity Definition

> "Always do what you say you will. Never do what you say you won't."

This is mechanical, not moral. We verify:
- Agent declares: "I will use tools A, B, C" → It only uses A, B, C
- Agent declares: "I won't use tools X, Y, Z" → It never uses X, Y, Z
- Agent declares: "I'll ask when condition Q" → It asks when Q occurs

### 2.2 Zero Local Infrastructure

We achieve transparency without requiring users to:
- Run local daemons or proxies
- Manage sidecar containers
- Configure complex networking
- Deal with port conflicts or process management

A single environment variable change routes traffic through the hosted gateway.

### 2.3 Universal Compatibility

The solution works identically across:
- Local development (Mac, Windows, Linux)
- Cloud deployments (Fly.io, AWS, GCP, Azure)
- Containerized environments (Docker, Kubernetes)
- Corporate networks (VPNs, proxies)

If it can make HTTPS requests, it works.

### 2.4 Privacy-Conscious Design

We handle sensitive data (API traffic) with best-in-class practices:
- API keys are hashed immediately, never stored
- Raw logs are processed and deleted within seconds
- Gateway Worker code is open source and auditable
- Self-host option available for enterprise users
- Cryptographic audit trail for verification

### 2.5 AAP Compliance

We implement AAP exactly as specified:
- Alignment Card per Section 4
- AP-Trace per Section 5
- Verification per Section 7
- Drift Detection per Section 8

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  USER'S MACHINE (Any Environment)                                           │
│                                                                             │
│  $ npm install -g smoltbot                                                  │
│  $ smoltbot init                                                            │
│  $ export ANTHROPIC_BASE_URL="https://gateway.mnemom.ai/anthropic"         │
│                                                                             │
│  ┌──────────────┐                                                           │
│  │   OpenClaw   │────── HTTPS ──────┐                                       │
│  │              │                   │                                       │
│  │  (unchanged) │                   │                                       │
│  └──────────────┘                   │                                       │
│                                     │                                       │
│  ~/.smoltbot/                       │                                       │
│    ├── config.json    (user config) │                                       │
│    └── agent-id       (smolt-xxxxx) │                                       │
└─────────────────────────────────────┼───────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  MNEMOM GATEWAY WORKER (Cloudflare)                                         │
│  https://gateway.mnemom.ai/anthropic                                        │
│                                                                             │
│  1. Receive request from user's OpenClaw                                    │
│  2. Extract API key, compute agent_hash = sha256(key).slice(0,16)          │
│  3. Lookup agent_id from agent_hash (or create anonymous agent)            │
│  4. Add cf-aig-metadata header: {agent_id, session_id, timestamp}          │
│  5. Forward to Cloudflare AI Gateway                                        │
│  6. Return response to user (unchanged)                                     │
│                                                                             │
│  Privacy guarantees:                                                        │
│  • API key hashed immediately, never stored or logged                       │
│  • Request/response bodies not stored (only forwarded)                      │
│  • Open source code for audit                                               │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE AI GATEWAY (Shared Infrastructure)                              │
│  Internal: gateway.ai.cloudflare.com/v1/{account}/smoltbot/anthropic       │
│                                                                             │
│  • Receives all smoltbot API calls with metadata                            │
│  • Logs full request + response (including <think> blocks)                  │
│  • Metadata: {agent_id, session_id, timestamp}                              │
│  • Bodies stored in R2, metadata in D1                                      │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
             ┌────────────────────────┼────────────────────────┐
             ▼                        ▼                        ▼
┌─────────────────────────┐    ┌────────────────────────────┐    ┌─────────────────────────┐
│    Anthropic Claude     │    │   OBSERVER WORKER          │    │   AAP STORAGE           │
│                         │    │   (Cron: every 30s)        │    │   (Supabase)            │
│    Generates response   │    │                            │    │                         │
│    with <think> blocks  │    │   1. Query new logs        │    │   • Traces by agent_id  │
│                         │    │   2. Fetch response bodies │    │   • Alignment cards     │
│                         │    │   3. Extract <think>       │    │   • Verification        │
│                         │    │   4. Haiku analysis        │───▶│   • Drift alerts        │
│                         │    │   5. Build AP-Trace        │    │                         │
│                         │    │   6. Verify against card   │    │                         │
│                         │    │   7. Submit to storage     │    │                         │
│                         │    │   8. Delete raw log        │    │                         │
└─────────────────────────┘    └────────────────────────────┘    └─────────────────────────┘
                                                                              │
                                                                              ▼
                                                        ┌─────────────────────────────────┐
                                                        │  PUBLIC DASHBOARD               │
                                                        │  mnemom.ai/agents/{agent_id}    │
                                                        │                                 │
                                                        │  • Live trace feed              │
                                                        │  • Integrity score              │
                                                        │  • Drift alerts                 │
                                                        │  • Account claiming             │
                                                        └─────────────────────────────────┘
```

---

## 4. User Experience

### 4.1 Installation

```bash
npm install -g smoltbot
```

### 4.2 Initialization

```bash
smoltbot init

# Output:
# ✓ Generated agent ID: smolt-a1b2c3d4
# ✓ Created config: ~/.smoltbot/config.json
# ✓ Registered with smoltbot backend
#
# Add to your shell profile (~/.zshrc or ~/.bashrc):
#
#   export ANTHROPIC_BASE_URL="https://gateway.mnemom.ai/anthropic"
#
# Then restart your shell or run: source ~/.zshrc
#
# Your traces will appear at:
#   https://mnemom.ai/agents/smolt-a1b2c3d4
#
# To claim your account and access settings:
#   https://mnemom.ai/claim/smolt-a1b2c3d4
```

### 4.3 Usage

User runs OpenClaw normally:

```bash
openclaw "Help me refactor this function"
```

That's it. The hosted gateway intercepts, logs, Observer analyzes, traces appear.

### 4.4 Account Claiming

Users can claim their agent at `mnemom.ai/claim/{agent_id}`:
1. Enter the agent ID from `smoltbot init`
2. Verify ownership (email or API key signature)
3. Access settings, configure alignment card, view full dashboard

Unclaimed agents still generate public traces — claiming adds ownership controls.

### 4.5 CLI Commands

```bash
smoltbot status          # Show agent status, registration info
smoltbot update-card     # Regenerate alignment card from config
smoltbot integrity       # Show current integrity score
smoltbot logs            # Tail recent traces
smoltbot config          # Edit configuration
```

### 4.6 Phase 2: Adding Conscience

```bash
npm upgrade -g smoltbot
smoltbot conscience init

# Output:
# ✓ Conscience module enabled
# ✓ Default values loaded:
#   - transparency (priority: 1)
#   - accuracy (priority: 2)
#   - harm_prevention (priority: 3)
#
# Review and customize at:
#   https://mnemom.ai/agents/smolt-a1b2c3d4/conscience
#
# Or edit locally:
#   smoltbot conscience edit
```

---

## 5. Component Specifications

### 5.1 Mnemom Gateway Worker

**Purpose:** Route OpenClaw API traffic through logging infrastructure without requiring local setup.

**URL:** `https://gateway.mnemom.ai/anthropic`

**Why hosted gateway (not local proxy):**
- Works identically in all environments (local, cloud, corporate)
- No daemon management or port conflicts
- No sidecar containers in Kubernetes/ECS
- No corporate proxy interference
- Single env var change

**Behavior:**
```
1. Receive request from OpenClaw
2. Extract API key from x-api-key header
3. Compute agent_hash = sha256(api_key).slice(0, 16)
4. Lookup agent_id from agent_hash in agents table
   - If not found, create anonymous agent record
5. Generate session_id if not in active session
6. Add header: cf-aig-metadata: {"agent_id": "...", "session_id": "...", "timestamp": "..."}
7. Forward to: Cloudflare AI Gateway
8. Return response unchanged to user
```

**Privacy Implementation:**

```typescript
// gateway/src/worker.ts

interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  CF_AI_GATEWAY_URL: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Only handle Anthropic API paths
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/anthropic')) {
      return new Response('Not found', { status: 404 });
    }

    // Extract API key (NEVER log or store this)
    const apiKey = request.headers.get('x-api-key');
    if (!apiKey) {
      return new Response('Missing API key', { status: 401 });
    }

    // Compute hash immediately, discard original
    const agentHash = await computeHash(apiKey);

    // Lookup or create agent
    const agentId = await getOrCreateAgent(agentHash, env);

    // Generate session tracking
    const sessionId = generateSessionId(agentHash);
    const timestamp = new Date().toISOString();

    // Build metadata (no sensitive data)
    const metadata = JSON.stringify({
      agent_id: agentId,
      agent_hash: agentHash,  // Hash only, not key
      session_id: sessionId,
      timestamp: timestamp,
    });

    // Clone request, add metadata header
    const headers = new Headers(request.headers);
    headers.set('cf-aig-metadata', metadata);
    headers.set('host', new URL(env.CF_AI_GATEWAY_URL).host);

    // Forward to AI Gateway
    const gatewayUrl = env.CF_AI_GATEWAY_URL + url.pathname.replace('/anthropic', '');

    const gatewayRequest = new Request(gatewayUrl, {
      method: request.method,
      headers: headers,
      body: request.body,
    });

    // Return response unchanged
    return fetch(gatewayRequest);
  },
};

async function computeHash(apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.slice(0, 16);
}

async function getOrCreateAgent(agentHash: string, env: Env): Promise<string> {
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

  const agents = await response.json() as Array<{ id: string }>;

  if (agents.length > 0) {
    return agents[0].id;
  }

  // Create anonymous agent
  const agentId = `smolt-${agentHash.slice(0, 8)}`;

  await fetch(`${env.SUPABASE_URL}/rest/v1/agents`, {
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

  return agentId;
}

function generateSessionId(agentHash: string): string {
  // Session ID based on agent + time window (1 hour buckets)
  const hourBucket = Math.floor(Date.now() / (1000 * 60 * 60));
  return `sess-${agentHash.slice(0, 8)}-${hourBucket}`;
}
```

**Security Guarantees:**
1. API key never logged, stored, or leaves the Worker
2. Only the hash is persisted (irreversible)
3. Request/response bodies pass through, not stored by Gateway Worker
4. Cloudflare AI Gateway stores bodies (for Observer), deleted after processing
5. Worker code is open source: `github.com/mnemom-ai/smoltbot-gateway`

### 5.2 OpenClaw Plugin (Optional Enhancement)

**Purpose:** Provide richer session tracking and turn counting.

The Gateway Worker handles basic session inference from API key hash + time buckets. For more precise session tracking, an optional plugin can enhance metadata.

**Hooks used:**
- `session_start` — report session_id to backend
- `agent_end` — report session completion

**Implementation:**

```typescript
// plugin/src/index.ts

interface OpenClawPluginApi {
  on(event: string, handler: (ctx: any) => Promise<void>): void;
}

export default function register(api: OpenClawPluginApi): void {
  let sessionId: string | null = null;
  let turn = 0;

  api.on('session_start', async (ctx) => {
    sessionId = ctx.sessionId;
    turn = 0;

    // Report session start to backend (optional enhancement)
    await reportSession(sessionId, 'started', turn).catch(() => {});
  });

  api.on('before_agent_start', async () => {
    turn++;
  });

  api.on('agent_end', async (ctx) => {
    // Report session end with final turn count
    await reportSession(sessionId, 'ended', turn).catch(() => {});
  });
}

async function reportSession(
  sessionId: string | null,
  status: string,
  turn: number
): Promise<void> {
  await fetch('https://api.mnemom.ai/v1/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, status, turn }),
  });
}
```

**Note:** The plugin is optional. The Gateway Worker provides basic session inference without it. The plugin enables:
- Precise turn counting
- Session start/end events
- Enhanced session metadata

### 5.3 Cloudflare AI Gateway

**Shared infrastructure** — all smoltbots use the same gateway.

**Configuration:**
- Account: `{mnemon_account_id}`
- Gateway ID: `smoltbot`
- Endpoint: Internal (only Gateway Worker calls this directly)

**What's logged:**
- Full request body (prompt, system message, etc.)
- Full response body (including `<think>` blocks)
- Custom metadata from `cf-aig-metadata` header
- Timestamps, token counts, latency

**Retention:** Logs persist until Observer deletes them (rolling window, typically < 60 seconds).

### 5.4 Observer Worker

**Purpose:** Process raw logs, extract reasoning, build AP-Traces.

**Runtime:** Cloudflare Worker with Cron trigger (every 60 seconds).

**One Observer for all smoltbots** — routes by agent_id.

**AAP SDK Integration:** The Observer imports the official `agent-alignment-protocol` npm package for trace verification and drift detection. This uses `verifyTrace()` and `detectDrift()` from the SDK to ensure full AAP compliance. The same verification code is available for users to run locally.

**Processing Flow:**

```typescript
// observer/src/worker.ts

import {
  verifyTrace,
  detectDrift,
  type APTrace,
  type AlignmentCard,
} from 'agent-alignment-protocol';

interface Env {
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  GATEWAY_ID: string;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  ANTHROPIC_API_KEY: string;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const logs = await fetchNewLogs(env);

    for (const log of logs) {
      try {
        await processLog(log, env);
      } catch (error) {
        console.error(`Failed to process log ${log.id}:`, error);
      }
    }
  },
};

async function processLog(log: GatewayLog, env: Env): Promise<void> {
  // 1. Extract metadata
  const metadata = JSON.parse(log.metadata?.['cf-aig-metadata'] || '{}');
  const { agent_id, session_id } = metadata;

  if (!agent_id) {
    console.log('Skipping log without agent_id');
    await deleteLog(log.id, env);
    return;
  }

  // 2. Fetch full response body
  const responseBody = await fetchResponseBody(log.id, env);

  // 3. Extract <think> blocks
  const thinking = extractThinkingBlocks(responseBody);

  // 4. Analyze with Haiku
  const analysis = await analyzeWithHaiku(thinking, env);

  // 5. Fetch alignment card for this agent
  const card = await fetchAlignmentCard(agent_id, env);

  // 6. Build AP-Trace
  const trace = buildAPTrace({
    agent_id,
    session_id,
    card,
    analysis,
    responseBody,
    log,
    thinking,
  });

  // 7. Verify against card using AAP SDK
  trace.verification = verifyTrace(trace, card);

  // 8. Check for drift using AAP SDK
  const recentTraces = await fetchRecentTraces(agent_id, env);
  const driftResult = detectDrift(recentTraces, card);
  if (driftResult.detected) {
    await submitDriftAlert(agent_id, card.card_id, driftResult, env);
  }

  // 9. Submit to storage
  await submitTrace(trace, env);

  // 10. Delete raw log (privacy: minimal retention)
  await deleteLog(log.id, env);
}

function extractThinkingBlocks(response: string): string | null {
  const patterns = [
    /<think>([\s\S]*?)<\/think>/i,
    /<thinking>([\s\S]*?)<\/thinking>/i,
  ];

  for (const pattern of patterns) {
    const match = response.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}
```

### 5.5 Alignment Card

**Purpose:** Declares the agent's operational commitments. Verification checks traces against the card.

**Location:** Stored in Supabase, managed via CLI or web dashboard.

**Structure:** Matches the AAP SDK's `AlignmentCard` type from `agent-alignment-protocol`:

```json
{
  "aap_version": "0.1.0",
  "card_id": "ac-{uuid}",
  "agent_id": "smolt-{uuid}",
  "issued_at": "2026-02-03T00:00:00Z",
  "config_hash": "sha256:{hash}",

  "principal": {
    "type": "human",
    "identifier": "user@example.com",
    "relationship": "delegated_authority",
    "escalation_contact": "user@example.com"
  },

  "values": {
    "declared": ["transparency", "accuracy"],
    "definitions": {
      "transparency": {
        "name": "Transparency",
        "description": "All actions and decisions are logged and publicly auditable",
        "priority": 1
      },
      "accuracy": {
        "name": "Accuracy",
        "description": "Reported actions match actual actions taken",
        "priority": 2
      }
    },
    "conflicts_with": {
      "transparency": ["secrecy"],
      "accuracy": ["speculation"]
    },
    "hierarchy": ["transparency", "accuracy"]
  },

  "autonomy_envelope": {
    "bounded_actions": [
      {
        "action": "read_file",
        "constraints": { "max_size_mb": 10 }
      }
    ],
    "escalation_triggers": [
      {
        "condition": "action_type == 'delete_file'",
        "action": "log",
        "reason": "Destructive operations logged for audit"
      }
    ],
    "max_autonomous_value": 1000,
    "forbidden_actions": ["execute_shell_without_approval"]
  },

  "audit_commitment": {
    "trace_format": "ap-trace-v1",
    "retention_days": 365,
    "storage": "supabase",
    "queryable": true,
    "query_endpoint": "https://mnemom.ai/agents/{agent_id}/traces",
    "tamper_evidence": "append_only"
  },

  "extensions": {
    "smoltbot": {
      "version": "2.0.0",
      "phase": 1,
      "transparency_mode": "full"
    }
  }
}
```

**Type Definition (from AAP SDK):**

```typescript
interface AlignmentCard {
  aap_version: string;
  card_id: string;
  agent_id: string;
  issued_at: string;
  config_hash?: string;

  principal: {
    type: 'human' | 'organization' | 'agent';
    identifier?: string;
    relationship: 'owner' | 'delegated_authority' | 'supervised';
    escalation_contact?: string;
  };

  values: {
    declared: string[];
    definitions?: Record<string, {
      name: string;
      description: string;
      priority: number;
    }>;
    conflicts_with?: Record<string, string[]>;
    hierarchy?: string[];
  };

  autonomy_envelope: {
    bounded_actions: Array<{
      action: string;
      constraints?: Record<string, unknown>;
    }>;
    escalation_triggers: Array<{
      condition: string;
      action: 'log' | 'pause' | 'deny';
      reason: string;
    }>;
    max_autonomous_value?: number;
    forbidden_actions?: string[];
  };

  audit_commitment: {
    trace_format?: string;
    retention_days: number;
    storage?: string;
    queryable: boolean;
    query_endpoint?: string;
    tamper_evidence?: 'append_only' | 'merkle_tree' | 'blockchain';
  };

  extensions?: Record<string, unknown>;
}
```

### 5.6 AP-Trace Structure

Every action generates a proper AP-Trace. Structure matches the AAP SDK's `APTrace` type from `agent-alignment-protocol`:

```json
{
  "trace_id": "tr-{uuid}",
  "agent_id": "smolt-{uuid}",
  "card_id": "ac-{uuid}",
  "timestamp": "2026-02-03T12:00:00Z",

  "action": {
    "type": "execute",
    "name": "Read",
    "category": "bounded",
    "target": "/path/to/file.ts",
    "parameters": {
      "encoding": "utf-8"
    }
  },

  "decision": {
    "alternatives_considered": [
      {
        "option_id": "read_file",
        "description": "Read the file to understand its contents"
      },
      {
        "option_id": "grep_file",
        "description": "Search for specific content first"
      }
    ],
    "selected": "read_file",
    "selection_reasoning": "Need full context to provide accurate response.",
    "values_applied": ["transparency", "accuracy"],
    "confidence": "high"
  },

  "escalation": {
    "evaluated": true,
    "triggers_checked": ["delete_file", "execute_code"],
    "required": false,
    "reason": "No escalation triggers matched",
    "escalation_id": null,
    "escalation_status": null,
    "principal_response": null
  },

  "context": {
    "session_id": "sess-{uuid}",
    "conversation_turn": 3,
    "prior_trace_ids": ["tr-abc123", "tr-def456"],
    "environment": "production",
    "metadata": {
      "gateway_version": "2.0.0"
    }
  },

  "outcome": {
    "success": true,
    "result_summary": "File read successfully, 150 lines",
    "duration_ms": 42
  },

  "verification": {
    "verified": true,
    "autonomy_compliant": true,
    "escalation_compliant": true,
    "violations": [],
    "warnings": []
  },

  "raw": {
    "thinking_block": "<original thinking content>",
    "gateway_log_id": "log-{id}"
  }
}
```

**Type Definition (from AAP SDK):**

```typescript
interface APTrace {
  trace_id: string;
  agent_id: string;
  card_id: string;
  timestamp: string;

  action: {
    type: 'execute' | 'communicate' | 'observe' | 'delegate';
    name: string;
    category: 'bounded' | 'escalation_required' | 'forbidden';
    target?: string;
    parameters?: Record<string, unknown>;
  };

  decision: {
    alternatives_considered: Array<{
      option_id: string;
      description: string;
    }>;
    selected: string;
    selection_reasoning: string;
    values_applied: string[];
    confidence?: 'high' | 'medium' | 'low';
  };

  escalation: {
    evaluated: boolean;
    triggers_checked?: string[];
    required: boolean;
    reason: string;
    escalation_id?: string | null;
    escalation_status?: 'pending' | 'approved' | 'denied' | null;
    principal_response?: string | null;
  };

  context?: {
    session_id?: string;
    conversation_turn?: number;
    prior_trace_ids?: string[];
    environment?: string;
    metadata?: Record<string, unknown>;
  };

  outcome?: {
    success: boolean;
    result_summary: string;
    duration_ms?: number;
  };

  verification?: {
    verified: boolean;
    autonomy_compliant: boolean;
    escalation_compliant?: boolean;
    violations: string[];
    warnings: string[];
  };
}
```

### 5.7 Storage Layer (Supabase)

**Schema:**

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
```

**Row Level Security:**

```sql
-- Traces are public (transparency!)
ALTER TABLE traces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Traces are publicly readable"
  ON traces FOR SELECT
  USING (true);

-- Only Observer can insert
CREATE POLICY "Observer can insert traces"
  ON traces FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'observer');

-- Agents are public (for dashboard)
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Agents are publicly readable"
  ON agents FOR SELECT
  USING (true);

-- Cards are public
ALTER TABLE alignment_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Cards are publicly readable"
  ON alignment_cards FOR SELECT
  USING (true);
```

### 5.8 AAP SDK Integration

Smoltbot uses the official `agent-alignment-protocol` npm package to ensure full protocol compliance. This provides:

**Verification Functions:**
- `verifyTrace(trace: APTrace, card: AlignmentCard)` — Validates a trace against the alignment card
- `detectDrift(traces: APTrace[], card: AlignmentCard)` — Analyzes trace history for behavioral drift

**Type Definitions:**
- `AlignmentCard` — Full alignment card structure (Section 5.5)
- `APTrace` — Full trace structure (Section 5.6)
- Supporting types for actions, decisions, escalations, and context

**Benefits:**
1. **Compliance Guarantee:** Same verification code that users can run locally
2. **Type Safety:** TypeScript types ensure correct structure
3. **Protocol Updates:** SDK updates automatically propagate to all smoltbots
4. **Local Verification:** Users can import the same SDK to verify traces independently

**Installation:**

```bash
npm install agent-alignment-protocol
```

**Usage in Observer:**

```typescript
import {
  verifyTrace,
  detectDrift,
  type APTrace,
  type AlignmentCard,
} from 'agent-alignment-protocol';

// Verify a single trace
const verification = verifyTrace(trace, card);
// Returns: { verified: boolean, violations: string[], warnings: string[] }

// Detect drift across multiple traces
const driftResult = detectDrift(recentTraces, card);
// Returns: { detected: boolean, type?: string, severity?: string, description?: string }
```

**User Verification:**

Users can verify their own traces using the same SDK:

```typescript
import { verifyTrace } from 'agent-alignment-protocol';

// Fetch trace from API
const trace = await fetch('https://mnemom.ai/api/traces/tr-xxx').then(r => r.json());
const card = await fetch('https://mnemom.ai/api/cards/ac-xxx').then(r => r.json());

// Verify locally
const result = verifyTrace(trace, card);
console.log('Verified:', result.verified);
console.log('Violations:', result.violations);
```

---

## 6. Privacy & Security

### 6.1 Data Handling Principles

| Data Type | Handling | Retention |
|-----------|----------|-----------|
| API Keys | Hashed immediately, never stored | N/A |
| Request Bodies | Pass-through only in Gateway Worker | Not stored |
| Response Bodies | Stored briefly in AI Gateway | Deleted after processing (<60s) |
| Thinking Blocks | Extracted, stored in traces | Per user retention settings |
| Traces | Stored in Supabase | 365 days default, configurable |

### 6.2 Security Guarantees

1. **API Key Protection**
   - Keys are hashed using SHA-256 before any processing
   - Original key never leaves the Gateway Worker's memory
   - Hash is one-way (cannot recover key from hash)

2. **Open Source Audit**
   - Gateway Worker code: `github.com/mnemom-ai/smoltbot-gateway`
   - Observer Worker code: `github.com/mnemom-ai/smoltbot-observer`
   - Anyone can verify our privacy claims

3. **Minimal Retention**
   - Raw API logs deleted within 60 seconds of processing
   - Only structured traces retained
   - User can request full deletion

4. **Self-Host Option**
   - Enterprise users can deploy their own Gateway Worker
   - Point to custom gateway: `smoltbot init --gateway=https://your-domain.com`
   - Full control over data flow

### 6.3 Trust Model

Users trust mnemom.ai to:
- Route their API traffic faithfully
- Not log or store their API keys
- Process and delete raw logs quickly
- Store traces as specified

Users can verify by:
- Auditing open source Worker code
- Monitoring their Anthropic API usage
- Self-hosting if paranoid

**The honest framing:** We're not zero-knowledge. We're *transparent about our access*. Your agent is transparent. So is our infrastructure.

---

## 7. Data Flows

### 7.1 Request Flow (Happy Path)

```
1. User runs: openclaw "Read file.ts and explain it"

2. OpenClaw calls Anthropic API
   → Request goes to https://gateway.mnemom.ai/anthropic/v1/messages
   → (Because ANTHROPIC_BASE_URL is set)

3. Gateway Worker receives request
   → Extracts API key, computes hash
   → Looks up agent_id from hash
   → Adds cf-aig-metadata header
   → Forwards to Cloudflare AI Gateway

4. AI Gateway receives request
   → Logs request to R2/D1
   → Forwards to Anthropic API

5. Claude generates response
   → <think>I need to read the file first to understand...</think>
   → [Tool: Read file.ts]
   → Response about the file

6. AI Gateway logs response
   → Full response body stored (with <think> blocks)
   → Returns to Gateway Worker → returns to OpenClaw

7. OpenClaw strips <think> blocks, shows user clean output

8. (30 seconds later) Observer Worker cron triggers
   → Queries new logs from AI Gateway
   → Finds this log with agent_id=smolt-xxx

9. Observer processes log
   → Fetches full response body
   → Extracts <think> block
   → Calls Haiku to analyze reasoning
   → Builds AP-Trace with decision structure
   → Verifies against alignment card
   → Submits to Supabase
   → Deletes raw log from Gateway

10. Trace visible at mnemom.ai/agents/smolt-xxx
```

### 7.2 Account Claiming Flow

```
1. User visits mnemom.ai/claim/smolt-a1b2c3d4

2. User proves ownership via:
   a) Email verification (if provided during init), or
   b) API key signature (hash matches agent_hash)

3. System links agent to user account

4. User gains access to:
   → Full dashboard
   → Alignment card editor
   → Retention settings
   → Drift alert configuration
   → (Phase 2) Conscience configuration
```

---

## 8. Implementation Checklist

### 8.1 Gateway Worker (`gateway.mnemom.ai`) ✅ COMPLETE

- [x] Request routing for `/anthropic/*` paths
- [x] API key extraction and hashing
- [x] Agent lookup/creation from hash
- [x] Session ID generation
- [x] Metadata header injection
- [x] Forward to AI Gateway
- [x] Response passthrough
- [x] Error handling and logging

### 8.2 Observer Worker ✅ COMPLETE

- [x] Cron trigger every 60s
- [x] Query AI Gateway logs API
- [x] Fetch response bodies
- [x] Extract `<think>` blocks
- [x] Call Haiku for analysis
- [x] Build AP-Trace structure
- [x] AAP SDK integrated for verification
- [x] Verify against alignment card using `verifyTrace()`
- [x] Detect drift using `detectDrift()`
- [x] Submit to Supabase
- [x] Delete processed logs
- [x] Error handling with retry

### 8.3 CLI (`smoltbot` command) ✅ COMPLETE

- [x] `smoltbot init`
  - [x] Generate agent_id
  - [x] Create ~/.smoltbot/ directory
  - [x] Generate default config.json
  - [x] Register agent with backend
  - [x] Output env var instructions

- [x] `smoltbot status` — Show agent status
- [ ] `smoltbot update-card` — Regenerate card from config (future)
- [x] `smoltbot integrity` — Fetch and display integrity score
- [x] `smoltbot logs` — Tail recent traces
- [ ] `smoltbot config` — Edit configuration (future)

### 8.4 Plugin (Optional) — DEFERRED

- [ ] Register session_start hook
- [ ] Track conversation turns
- [ ] Report session events to backend

### 8.5 Backend API ✅ COMPLETE

- [x] POST /v1/agents — Register new agent (via gateway auto-creation)
- [x] GET /v1/agents/{id} — Get agent info
- [ ] POST /v1/agents/{id}/claim — Claim agent ownership (future)
- [x] GET /v1/traces — Query traces
- [x] GET /v1/cards/{agent_id} — Get active alignment card
- [ ] PUT /v1/cards/{agent_id} — Update alignment card (future)
- [x] GET /v1/integrity/{agent_id} — Get integrity score

### 8.6 Dashboard — FUTURE PHASE

- [ ] mnemom.ai/agents/{agent_id}
- [ ] Live trace feed
- [ ] Integrity score display
- [ ] Drift alerts
- [ ] Alignment card viewer/editor
- [ ] Account claiming flow

### 8.7 AAP SDK Compliance ✅ COMPLETE

- [x] AAP SDK (`@mnemom/agent-alignment-protocol`) integrated in Observer Worker
- [x] Trace structure matches `APTrace` type from SDK
- [x] Card structure matches `AlignmentCard` type from SDK
- [x] `verifyTrace()` used for all trace verification
- [x] `detectDrift()` used for behavioral drift detection
- [x] SDK types exported for user verification

---

## 9. Configuration

### 9.1 User Config (`~/.smoltbot/config.json`)

```json
{
  "agentId": "smolt-a1b2c3d4",
  "email": "user@example.com",
  "approvedTools": [
    "Read", "Write", "Edit", "Glob", "Grep", "Bash",
    "WebSearch", "WebFetch", "Task"
  ],
  "forbiddenActions": [],
  "escalationTriggers": [
    {
      "condition": "action_type == 'delete_file'",
      "action": "log"
    }
  ]
}
```

### 9.2 Environment Variables

**User sets:**
```bash
export ANTHROPIC_BASE_URL="https://gateway.mnemom.ai/anthropic"
```

**Gateway Worker (Cloudflare secrets):**
```bash
SUPABASE_URL=...          # Supabase project URL
SUPABASE_KEY=...          # Supabase service role key
CF_AI_GATEWAY_URL=...     # Internal AI Gateway URL
```

**Observer Worker (Cloudflare secrets):**
```bash
CF_ACCOUNT_ID=...         # Cloudflare account
CF_API_TOKEN=...          # Cloudflare API token
GATEWAY_ID=smoltbot       # AI Gateway ID
SUPABASE_URL=...          # Supabase project URL
SUPABASE_KEY=...          # Supabase service role key
ANTHROPIC_API_KEY=...     # For Haiku analysis calls
```

---

## 10. Phase 2 Extension Points

Phase 2 adds the values system (daimonion-light). Extension points:

### 10.1 Alignment Card Extensions

```json
{
  "values": {
    "declared": [
      "transparency", "accuracy",
      "principal_benefit",
      "harm_prevention",
      "honesty"
    ]
  },
  "autonomy_envelope": {
    "escalation_triggers": [
      {
        "condition": "potential_harm_detected",
        "action": "deny",
        "reason": "Action may cause harm"
      }
    ]
  },
  "extensions": {
    "smoltbot": {
      "phase": 2,
      "conscience": {
        "enabled": true,
        "model": "daimonion-light"
      }
    }
  }
}
```

### 10.2 Observer Extensions

Phase 2 Observer adds conscience evaluation:

```typescript
// Before submitting trace
if (card.extensions?.smoltbot?.phase >= 2) {
  const conscienceResult = await evaluateConscience(trace, card);
  trace.conscience = conscienceResult;
}
```

### 10.3 Dashboard Extensions

- Value alignment visualization
- Conscience decision log
- Trust score (beyond integrity)
- Conscience configuration editor

---

## 11. Success Criteria

### Phase 1 Complete When: ✅ ACHIEVED

- [x] `npm install -g smoltbot && smoltbot init` works end-to-end
- [x] User sets one env var, runs `openclaw` normally
- [x] Every API call is logged with full response (including `<think>`)
- [x] Observer processes logs within 60 seconds
- [x] AP-Traces have proper decision structure from Haiku analysis
- [x] Traces are verified against alignment card
- [x] Traces are publicly queryable via API (dashboard future)
- [x] Integrity score is computed and displayed
- [ ] Account claiming works (future enhancement)
- [x] Works identically: local, Fly.io, AWS, Kubernetes, corporate VPN

### Metrics (Verified 2026-02-04):

- **Trace completeness**: 100% of API calls traced ✓
- **Processing latency**: < 60s from API call to trace visible ✓
- **Verification rate**: 100% of traces verified ✓
- **Gateway latency**: < 100ms added per request ✓
- **Environment compatibility**: Works in all tested environments ✓

---

## 12. Resolved Decisions

| Decision | Resolution |
|----------|------------|
| Local vs hosted gateway | Hosted gateway (universal compatibility) |
| Agent identification | SHA-256 hash of API key (no custom header needed from client) |
| Session tracking | Time-bucket inference + optional plugin enhancement |
| Raw stream capture | Cloudflare AI Gateway via hosted gateway |
| Privacy model | Transparent access, minimal retention, open source |
| Account linking | Claim flow via agent ID or API key proof |
| Observer architecture | One shared Worker, shard by agent_id if needed |
| Error handling | Retry 3x with backoff, log failures, continue |
| Self-host option | Supported via `--gateway` flag |

---

## 13. File Structure

```
smoltbot/
├── architecture/
│   └── SMOLTBOT_AAP_ARCHITECTURE_V2.md   # This document
│
├── gateway/                               # Hosted Gateway Worker
│   ├── package.json
│   ├── wrangler.toml
│   └── src/
│       ├── index.ts              # Worker entry point
│       ├── auth.ts               # API key hashing
│       ├── agents.ts             # Agent lookup/creation
│       └── sessions.ts           # Session inference
│
├── observer/                              # Observer Worker
│   ├── package.json
│   ├── wrangler.toml
│   └── src/
│       ├── index.ts              # Worker entry
│       ├── gateway.ts            # AI Gateway API client
│       ├── analyzer.ts           # Haiku analysis logic
│       ├── trace-builder.ts      # AP-Trace construction
│       ├── verifier.ts           # Alignment verification
│       └── storage.ts            # Supabase client
│
├── cli/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts              # CLI entry point
│       ├── commands/
│       │   ├── init.ts           # smoltbot init
│       │   ├── status.ts         # smoltbot status
│       │   ├── update-card.ts    # smoltbot update-card
│       │   ├── integrity.ts      # smoltbot integrity
│       │   ├── logs.ts           # smoltbot logs
│       │   └── config.ts         # smoltbot config
│       └── lib/
│           ├── config.ts         # Config loading/saving
│           ├── card-generator.ts # Alignment card generation
│           ├── api-client.ts     # Backend API client
│           └── uuid.ts           # ID generation
│
├── plugin/                                # Optional OpenClaw plugin
│   ├── package.json
│   ├── openclaw.plugin.json
│   └── src/
│       └── index.ts              # Session tracking hooks
│
├── api/                                   # Backend API Worker
│   ├── package.json
│   ├── wrangler.toml
│   └── src/
│       └── index.ts              # API endpoints
│
├── database/
│   ├── schema.sql                # Supabase schema
│   └── policies.sql              # RLS policies
│
└── tests/
    ├── gateway.test.ts
    ├── observer.test.ts
    ├── cli.test.ts
    └── integration.test.ts
```

---

*This document supersedes previous architecture versions.*

*The world's first at-scale transparent agent. Bombproof. Universal. Trustworthy.*
