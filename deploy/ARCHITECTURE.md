# Architecture

This document describes how the smoltbot gateway components fit together in each deployment mode and how the self-hosted runtime adapts the Cloudflare Workers codebase to run on standard Node.js infrastructure.

## Deployment Diagrams

### Managed (Cloud)

The default managed deployment runs entirely on Cloudflare infrastructure:

```
                          Cloudflare Edge
                    ┌──────────────────────────┐
                    │                          │
  Client ──HTTPS──► │  Gateway Worker          │
                    │    │                     │
                    │    ├──► CF AI Gateway ───┼──► api.anthropic.com
                    │    │       │             │    api.openai.com
                    │    │       │             │    generativelanguage.googleapis.com
                    │    │       ▼             │
                    │    │   AI Gateway Logs   │
                    │    │       │             │
                    │    │       ▼             │
                    │    │  Observer Worker    │
                    │    │    (cron: 1 min)    │
                    │    │       │             │
                    │    ▼       ▼             │
                    │  Supabase (PostgreSQL)   │
                    │  Cloudflare KV (cache)   │
                    └──────────────────────────┘
```

- All traffic flows through Cloudflare's edge network.
- CF AI Gateway provides request logging, rate limiting, and analytics.
- The Observer Worker runs on a cron trigger every minute to process logs.
- Supabase provides PostgreSQL with row-level security.
- Cloudflare KV provides a global key-value cache for billing and rate limit data.

### Docker Compose (Self-Hosted)

Single-host deployment with all services in Docker containers:

```
                    Docker Host
              ┌─────────────────────────────┐
              │                             │
  Client ─────► Gateway Container (:8787)   │
              │    │           │            │
              │    │           └──────────────────► api.anthropic.com
              │    │                        │       api.openai.com
              │    ▼                        │       generativelanguage.googleapis.com
              │  Redis Container (:6379)    │
              │    (KV cache)              │
              │    │                        │
              │    ▼                        │
              │  PostgreSQL Container       │
              │    (:5432)                 │
              │    │                        │
              │    ▼                        │
              │  Observer Container         │
              │    (cron: 1 min)           │
              │                             │
              │  Migrate Container          │
              │    (one-shot init)          │
              └─────────────────────────────┘
```

- The Gateway container serves HTTP requests and proxies to LLM APIs directly.
- Redis replaces Cloudflare KV for caching.
- PostgreSQL replaces Supabase for data storage.
- The Observer container runs as a scheduler process with cron jobs.
- The Migrate container runs once at startup to apply database migrations.
- No Cloudflare dependency -- all AI Gateway URLs are rewritten to direct upstream calls.

### Kubernetes (Helm)

Production multi-node deployment with scaling and high availability:

```
              Kubernetes Cluster
        ┌──────────────────────────────────────┐
        │                                      │
        │  Ingress Controller                  │
        │    │                                 │
        │    ▼                                 │
  Client ──► Service (:8787)                   │
        │    │                                 │
        │    ├──► Gateway Pod (replica 1)  ────┼──► LLM APIs (443)
        │    ├──► Gateway Pod (replica 2)  ────┤
        │    └──► Gateway Pod (replica N)  ────┤
        │         │           │                │
        │         ▼           ▼                │
        │       Redis       PostgreSQL         │
        │       (6379)      (5432)             │
        │         │                            │
        │         ▼                            │
        │    Observer Pod (replica 1)          │
        │      (cron scheduler)                │
        │                                      │
        │    Migration Job                     │
        │      (Helm hook: pre-install/        │
        │       pre-upgrade)                   │
        │                                      │
        │    ServiceMonitor ──► Prometheus      │
        │    NetworkPolicy                     │
        │    HPA (optional)                    │
        │    PDB                               │
        └──────────────────────────────────────┘
```

- Multiple Gateway pods behind a Kubernetes Service provide high availability.
- The Ingress controller terminates TLS and routes traffic to the Service.
- HPA scales gateway pods based on CPU/memory utilization.
- The Observer runs as a single-replica Deployment (scheduler role).
- Database migrations run as a Helm pre-install/pre-upgrade hook Job.
- A ServiceMonitor enables Prometheus scraping of the `/metrics` endpoint.
- NetworkPolicy restricts pod-to-pod and egress traffic.
- PDB ensures at least one gateway pod is available during disruptions.

## Components

### Gateway

The Gateway is the HTTP entry point for all AI API calls. It:

1. Receives requests from your application on port 8787.
2. Identifies the agent via API key hash (SHA-256 of the API key header).
3. Routes requests to the appropriate upstream LLM provider (Anthropic, OpenAI, Gemini).
4. Injects AIP (Agent Integrity Protocol) analysis into thinking-capable model responses.
5. Records alignment traces and integrity check results.
6. Enforces billing limits and rate limits via the KV cache.
7. Delivers enforcement nudges when integrity violations are detected.

In self-hosted mode, the Gateway runs as a Hono HTTP server on Node.js 22.

### Observer

The Observer is a background process that:

1. Runs on a 1-minute cron schedule.
2. Processes recent AI API call logs from the database.
3. Extracts thinking blocks (Anthropic, Gemini) or reasoning summaries (OpenAI).
4. Analyzes decisions using Claude Haiku to build AP-Traces.
5. Verifies traces against the agent's alignment card using the AAP SDK.
6. Runs AIP integrity checks and records verdicts.
7. Creates enforcement nudges for detected violations.

The API worker also runs a 6-hour cron for background maintenance tasks (drift analysis, email sequences, billing reconciliation).

### Migration Runner

A one-shot process that:

1. Waits for PostgreSQL to be reachable (up to 30 seconds).
2. Creates the `_schema_migrations` tracking table if it does not exist.
3. Applies SQL files from `database/migrations/` in alphabetical order.
4. Wraps each migration and its tracking insert in a single transaction.
5. Skips already-applied migrations for idempotent execution.

In Docker Compose, it runs as a `service_completed_successfully` dependency. In Kubernetes, it runs as a Helm pre-install/pre-upgrade hook Job.

## Data Flow: Request Lifecycle

A single AI API request through the self-hosted gateway follows this path:

```
1. Client sends POST /anthropic/v1/messages
       │
2. Hono router matches the catch-all route
       │
3. NodeExecutionContext created for background work
       │
4. Request delegated to gateway worker's fetch() handler
       │
5. Gateway identifies agent by API key hash
       │
6. Gateway constructs AI Gateway URL (sentinel)
       │
7. Fetch interceptor rewrites sentinel URL to https://api.anthropic.com/v1/messages
       │
8. Fetch interceptor strips CF-specific headers (cf-aig-metadata, cf-aig-authorization)
       │
9. Request forwarded to upstream Anthropic API
       │
10. Response received, AIP headers set (X-AIP-Verdict, etc.)
       │
11. Background tasks queued via ctx.waitUntil():
       - Trace recording to PostgreSQL
       - Cache update in Redis
       - Integrity check scheduling
       │
12. Response streamed back to client
       │
13. ExecutionContext drains background promises (up to 30s)
```

## Adaptation Layer

The self-hosted runtime adapts Cloudflare Worker APIs to Node.js equivalents:

| Cloudflare Workers API | Self-Hosted Replacement | Implementation |
|---|---|---|
| `globalThis.fetch` | Fetch interceptor | `fetch-interceptor.ts` -- rewrites AI Gateway URLs |
| Cloudflare KV | Redis (ioredis) or in-memory Map | `kv-adapter.ts` -- KVNamespace interface |
| `ExecutionContext.waitUntil()` | Promise collector with drain | `execution-context.ts` |
| Cron Triggers | node-cron scheduler | `entrypoint.ts` -- 1-min and 6-hour schedules |
| Worker Env bindings | `process.env` mapping | `env-builder.ts` -- typed env construction |
| `console.log` | Structured JSON logger | `logger.ts` -- leveled JSON output |
| CF AI Gateway routing | Direct upstream fetch | `fetch-interceptor.ts` -- URL rewriting |

### AI Gateway Bypass

In managed mode, the gateway routes all LLM API calls through Cloudflare AI Gateway, which provides request logging, analytics, and caching. In self-hosted mode, there is no CF AI Gateway.

The fetch interceptor solves this by:

1. Setting `CF_AI_GATEWAY_URL` to a sentinel value (`https://self-hosted-gateway.internal`).
2. Monkey-patching `globalThis.fetch` to intercept requests targeting the sentinel.
3. Extracting the provider name and API path from the sentinel URL.
4. Rewriting the URL to the real upstream provider API (`api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`).
5. Stripping CF-specific headers that upstream APIs would reject.

This approach requires zero changes to the gateway worker source code. The same worker code runs identically on Cloudflare and on Node.js.
