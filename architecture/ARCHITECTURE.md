# Smoltbot Architecture

## Overview

Smoltbot makes AI agents transparent by publishing every tool call as a trace. Install the plugin, run init, and traces flow automatically.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   OpenClaw  │────▶│  Smoltbot   │────▶│  Proxy API  │────▶│  Database   │
│   Gateway   │     │   Plugin    │     │  (Worker)   │     │  (Supabase) │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                           │                   │
                           │                   │
                           ▼                   ▼
                    ~/.smoltbot/         Rate limiting
                    config.json          Validation
                    (agent UUID)         Analytics
```

## Design Principles

### 1. Zero-Config for Users

```bash
openclaw plugins install @mnemom/smoltbot
smoltbot init
# Done. Traces flow automatically.
```

No API keys. No credentials. No configuration wizard. The plugin embeds everything it needs.

### 2. Proxy Layer Abstraction

The plugin knows only one thing: `POST https://api.mnemom.ai/v1/traces`

Behind that endpoint we can:
- Swap databases (Supabase → Tinybird → ClickHouse)
- Add caching, buffering, batching
- Implement rate limiting and abuse prevention
- Add analytics and monitoring
- Route by region or agent type

The client never changes.

### 3. Credentials Stay Server-Side

```
Plugin (client)          Proxy (server)           Database
────────────────        ────────────────        ────────────────
No credentials          service_role key         RLS policies
Embeds API URL          Rate limiting            Public read
                        Validation               Service write
```

Security properties:
- Plugin has no database access
- Proxy validates before writing
- Database credentials never leave the server
- Public read access (transparency is the point)

### 4. Scale-Ready from Day One

If this goes viral (1M+ installs):
- Cloudflare Worker scales automatically (edge)
- Database can be swapped without client changes
- Rate limiting prevents abuse
- Batch API reduces request count

## Components

### Plugin (`/plugin`)

OpenClaw plugin that hooks into tool calls:

```
plugin/
├── src/
│   ├── index.ts      # Plugin entry, hook registration
│   ├── api.ts        # POST to proxy API (hardcoded endpoint)
│   ├── config.ts     # Read agent UUID from ~/.smoltbot/
│   └── trace.ts      # AAP trace construction
├── hooks/
│   ├── before-tool-call/   # Start timing, capture intent
│   └── after-tool-call/    # Complete trace, submit
└── bin/
    └── smoltbot.ts   # CLI (init, status, reset)
```

### Proxy API (`/api`)

Cloudflare Worker that receives traces:

```
api/
├── worker.ts         # Request handler
└── wrangler.toml     # Deployment config
```

Responsibilities:
- Validate trace structure
- Rate limit per agent_id (100/min default)
- Write to Supabase with service_role
- Return success/error response

### Database (`/database`)

Supabase (Postgres) schema:

```
database/
├── schema.sql        # Table + indexes
├── policies.sql      # RLS (public read, service write)
└── setup.md          # Setup instructions
```

## Data Flow

### 1. Initialization

```
User runs: smoltbot init
                │
                ▼
        Generate UUID
                │
                ▼
        Write ~/.smoltbot/config.json
        {
          "agentId": "abc-123-...",
          "createdAt": "...",
          "version": "0.1.0"
        }
```

### 2. Runtime (per tool call)

```
OpenClaw calls tool
        │
        ▼
before-tool-call hook
  - Create pending trace
  - Start timer
        │
        ▼
Tool executes
        │
        ▼
after-tool-call hook
  - Complete trace
  - Add duration, result
  - Queue for submission
        │
        ▼
POST https://api.mnemom.ai/v1/traces
{
  "id": "trace-uuid",
  "agent_id": "abc-123-...",
  "timestamp": "2026-02-03T...",
  "tool_name": "read",
  "action_type": "allow",
  "params": {...},
  "result": {...},
  "duration_ms": 42
}
        │
        ▼
Proxy validates + rate limits
        │
        ▼
INSERT INTO traces (service_role)
```

### 3. Viewing Traces

```
User visits: https://mnemom.ai/agent/abc-123-...
        │
        ▼
Dashboard queries Supabase (anon key, public read)
        │
        ▼
SELECT * FROM traces
WHERE agent_id = 'abc-123-...'
ORDER BY timestamp DESC
        │
        ▼
Real-time subscription for live updates
```

## Security Model

| Layer | Has Credentials | Can Write | Can Read |
|-------|-----------------|-----------|----------|
| Plugin | No | No (direct) | No |
| Proxy | service_role | Yes | Yes |
| Dashboard | anon key | No | Yes |
| Admin | service_role | Yes | Yes |

Rate limiting: 100 requests/minute per agent_id (configurable)

## Scaling Path

### Current (MVP)
- Cloudflare Worker (free tier: 100k req/day)
- Supabase (free tier: 500MB, 2GB bandwidth)

### Growth (10k+ agents)
- Worker scales automatically
- Supabase Pro ($25/mo)

### Viral (1M+ agents)
- Swap Supabase → Tinybird/ClickHouse for time-series
- Plugin unchanged (proxy absorbs change)
- Add regional routing if needed

## Configuration

### Required (none for users!)

The plugin embeds the API endpoint. Users just run `smoltbot init`.

### Optional (power users)

Environment variables:
```
SMOLTBOT_ENABLED=false      # Disable tracing
SMOLTBOT_BATCH_SIZE=10      # Batch traces
SMOLTBOT_TIMEOUT=10000      # API timeout (ms)
```

## Future: Phase 2 (Conscience)

Same architecture, new trace type:

```json
{
  "action_type": "deny",
  "tool_name": "exec",
  "params": {"command": "rm -rf /"},
  "metadata": {
    "conscience_reason": "Destructive command blocked",
    "values_violated": ["minimal_harm"]
  }
}
```

Refusals become traces. Dashboard shows "what I refused and why."
