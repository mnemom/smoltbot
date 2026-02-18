# Configuration Reference

Complete environment variable reference for the smoltbot self-hosted gateway. Variables are set via `.env` (Docker Compose), Kubernetes Secrets and ConfigMaps (Helm), or direct environment injection.

## Database

| Variable | Required | Default | Description |
|---|---|---|---|
| `SUPABASE_URL` | Yes | -- | Supabase project URL or PostgreSQL REST endpoint. In Docker Compose, typically `http://postgres:5432`. In production, use your Supabase project URL. |
| `SUPABASE_KEY` | Yes | -- | Supabase service-role key. Full admin access to the database. Keep secret. |
| `POSTGRES_PASSWORD` | Yes (Docker) | `changeme` | PostgreSQL password for the local Docker container. Only used by the Docker Compose stack. |
| `DATABASE_URL` | Helm only | -- | Full PostgreSQL connection string (`postgres://user:pass@host:5432/db`). Used by the Helm chart for external database connections. |

## License

| Variable | Required | Default | Description |
|---|---|---|---|
| `MNEMOM_LICENSE_JWT` | Yes | -- | Enterprise license JWT issued from the mnemom.ai dashboard. Contact [sales@mnemom.ai](mailto:sales@mnemom.ai) to obtain one. The JWT is validated at startup and periodically by the health check. Expired or malformed JWTs cause the `/health/ready` endpoint to report `degraded` status. |

## LLM Providers

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | -- | Anthropic API key for Claude models. Required for AIP integrity analysis (uses Claude Haiku). Also used as the primary provider for proxied requests. |
| `OPENAI_API_KEY` | No | -- | OpenAI API key for GPT models. Enables multi-provider routing. When not set, requests to `/openai/*` return a configuration error. |
| `GEMINI_API_KEY` | No | -- | Google Gemini API key. Enables multi-provider routing. When not set, requests to `/gemini/*` return a configuration error. |

## Hybrid Analysis Mode

These variables enable delegating AIP analysis to the Mnemom cloud service instead of running it locally. Useful for air-gapped deployments where only the analysis endpoint is reachable, or to reduce local compute requirements.

| Variable | Required | Default | Description |
|---|---|---|---|
| `MNEMOM_ANALYZE_URL` | No | -- | Mnemom analysis endpoint URL (e.g., `https://api.mnemom.ai/v1/analyze`). When set, integrity analysis is delegated to the cloud service. |
| `MNEMOM_API_KEY` | No | -- | Mnemom API key with `analyze` scope (format: `mnm_xxx...`). Required when `MNEMOM_ANALYZE_URL` is set. |

> **Note:** When both variables are set, the gateway sends extracted thinking blocks to the Mnemom analysis API and receives AIP verdicts in return. The raw prompts and responses are never sent -- only thinking/reasoning blocks are transmitted for analysis.

## Infrastructure

| Variable | Required | Default | Description |
|---|---|---|---|
| `REDIS_URL` | No | -- | Redis connection URL (e.g., `redis://redis:6379` or `rediss://user:pass@host:6380`). When not set, an in-memory KV adapter is used. In-memory mode is suitable for single-node development only -- data is lost on restart. |
| `PORT` | No | `8787` | HTTP server listen port. The gateway binds to this port inside the container. |
| `HOST` | No | `0.0.0.0` | HTTP server bind address. Change to `127.0.0.1` to restrict to localhost only. |
| `SMOLTBOT_ROLE` | No | `all` | Service role selector. Determines which components run in this process. See [Roles](#roles) below. |

### Roles

The `SMOLTBOT_ROLE` variable controls which components are active in a given process:

| Value | HTTP Server | Observer Cron | API Cron | Use Case |
|---|---|---|---|---|
| `gateway` | Yes | No | No | Dedicated gateway pod (Kubernetes) |
| `scheduler` | No | Yes | Yes | Dedicated observer pod (Kubernetes) |
| `all` | Yes | Yes | Yes | Single-process deployment (Docker Compose, development) |

In the Docker Compose stack, the gateway service uses `SMOLTBOT_ROLE=gateway` and the observer service uses `SMOLTBOT_ROLE=scheduler`. For single-process setups, use `all`.

## Observability

| Variable | Required | Default | Description |
|---|---|---|---|
| `LOG_LEVEL` | No | `info` | Minimum log level. Options: `debug`, `info`, `warn`, `error`. Logs are structured JSON written to stdout/stderr. |
| `OTLP_ENDPOINT` | No | -- | OpenTelemetry collector gRPC/HTTP endpoint for traces and metrics (e.g., `http://otel-collector:4318`). When set, the gateway exports OTLP telemetry in addition to Prometheus metrics. |
| `OTLP_AUTH` | No | -- | OTLP authentication header value (e.g., a Bearer token or API key). Sent as the `Authorization` header on OTLP export requests. |

### Prometheus Metrics

The gateway exposes a `/metrics` endpoint in OpenMetrics format regardless of `OTLP_ENDPOINT`. No configuration is required. See the [Helm README](helm/README.md#monitoring) for ServiceMonitor setup.

## Advanced

| Variable | Required | Default | Description |
|---|---|---|---|
| `AIP_ENABLED` | No | `true` | Enable or disable Agent Integrity Protocol analysis. Set to `false` to disable AIP checks entirely (tracing still occurs). |
| `BILLING_ENFORCEMENT_ENABLED` | No | `false` | Enable billing enforcement. When `true`, the gateway checks usage limits from the KV cache and rejects requests that exceed plan limits. |
| `GATEWAY_VERSION` | No | `1.0.0-selfhosted` | Version string reported in health checks, heartbeats, and the `X-Smoltbot-Version` response header. |
| `DEPLOYMENT_ID` | No | `selfhosted-{hostname}` | Unique identifier for this deployment instance. Reported in heartbeats for fleet tracking. |
| `HEARTBEAT_URL` | No | `https://api.mnemom.ai/v1/deployments/heartbeat` | Override the heartbeat endpoint URL. The gateway sends a heartbeat every 60 seconds for license compliance monitoring. Heartbeats are strictly fail-open -- failures are logged but never affect gateway operation. |
| `GATEWAY_WORKER_PATH` | No | `../../../gateway/src/index.js` | Path to the gateway worker module. Override if your build layout differs from the default. |
| `OBSERVER_WORKER_PATH` | No | `../../../observer/src/index.js` | Path to the observer worker module. Override if your build layout differs from the default. |
| `API_WORKER_PATH` | No | `../../../api/src/index.js` | Path to the API worker module. Override if your build layout differs from the default. |

## Minimal Configuration Example

The smallest viable `.env` for Docker Compose:

```bash
POSTGRES_PASSWORD=my-strong-password-here
SUPABASE_URL=http://postgres:5432
SUPABASE_KEY=my-supabase-service-role-key
MNEMOM_LICENSE_JWT=eyJhbGciOiJIUzI1NiIs...
ANTHROPIC_API_KEY=sk-ant-api03-...
```

Everything else has sensible defaults. Redis and PostgreSQL are provided by the Docker Compose stack.

## Production Configuration Example

A production Helm `values.yaml` with external dependencies:

```yaml
secrets:
  existingSecret: "smoltbot-secrets"  # managed by External Secrets Operator

config:
  LOG_LEVEL: "warn"
  SMOLTBOT_ROLE: "gateway"

redis:
  enabled: false
  externalUrl: "rediss://smoltbot-cache.abc123.use1.cache.amazonaws.com:6380"

postgresql:
  enabled: false
  externalUrl: "postgres://smoltbot:pass@smoltbot-db.abc123.us-east-1.rds.amazonaws.com:5432/mnemom?sslmode=require"

hpa:
  enabled: true
  minReplicas: 3
  maxReplicas: 20
  targetCPU: 60

ingress:
  enabled: true
  className: "nginx"
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: gateway.mycompany.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: gateway-tls
      hosts:
        - gateway.mycompany.com
```
