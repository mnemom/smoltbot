# Docker Compose Quickstart

Get the smoltbot self-hosted gateway running on a single host in under 5 minutes.

This guide brings up PostgreSQL, Redis, runs database migrations, and starts the gateway and observer services using Docker Compose.

## Prerequisites

| Requirement | Minimum Version |
|---|---|
| Docker | 24.0+ |
| Docker Compose | v2.20+ (integrated `docker compose`) |
| RAM | 2 GB available |
| Disk | 1 GB for images + database storage |
| License | Mnemom enterprise JWT ([sales@mnemom.ai](mailto:sales@mnemom.ai)) |
| API key | Anthropic API key (required); OpenAI and Gemini keys (optional) |
| Network | Outbound HTTPS to LLM provider APIs |

Verify your Docker installation:

```bash
docker --version    # Docker 24.0+
docker compose version  # Docker Compose v2.20+
```

## Step 1: Clone and Configure

```bash
git clone https://github.com/mnemom/smoltbot.git
cd smoltbot/deploy/docker

cp .env.example .env
```

Edit `.env` and fill in the required values:

```bash
# Required -- database password for the local PostgreSQL container
POSTGRES_PASSWORD=a-strong-random-password

# Required -- Supabase-compatible database access
SUPABASE_URL=http://postgres:5432
SUPABASE_KEY=your-supabase-service-role-key

# Required -- enterprise license
MNEMOM_LICENSE_JWT=eyJhbGciOiJIUzI1NiIs...

# Required -- at least one LLM provider
ANTHROPIC_API_KEY=sk-ant-...

# Optional -- additional providers
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AI...
```

> **Note:** See the [Configuration Reference](../CONFIGURATION.md) for all available environment variables.

## Step 2: Start Services

```bash
docker compose up -d
```

This builds and starts five services in order:

1. **postgres** -- PostgreSQL 16 with persistent volume
2. **redis** -- Redis 7 with append-only persistence
3. **migrate** -- One-shot container that applies database migrations
4. **gateway** -- Hono HTTP server on port 8787
5. **observer** -- Background scheduler for trace processing

The `migrate` service runs once and exits. The gateway waits for both `migrate` (completed) and `redis` (healthy) before starting.

First startup takes 1-2 minutes to build images. Subsequent starts are near-instant.

## Step 3: Verify Health

```bash
curl http://localhost:8787/health/ready
```

Expected response:

```json
{
  "status": "ok",
  "checks": {
    "redis": { "ok": true, "latencyMs": 1 },
    "supabase": { "ok": true, "latencyMs": 5 },
    "license": { "ok": true }
  },
  "timestamp": "2026-02-17T12:00:00.000Z"
}
```

Additional health endpoints:

| Endpoint | Purpose |
|---|---|
| `/health/live` | Liveness probe -- always 200 if process is alive |
| `/health/ready` | Readiness probe -- checks Redis, PostgreSQL, and license |
| `/health/startup` | Startup probe -- 503 until initialization completes |
| `/metrics` | Prometheus metrics in OpenMetrics format |

## Step 4: Connect Your First Agent

Point your agent at the self-hosted gateway:

```bash
smoltbot init --gateway=http://localhost:8787
```

Or set the environment variable directly in your application:

```bash
export SMOLTBOT_GATEWAY_URL=http://localhost:8787
```

The gateway proxies requests to the configured LLM providers. API calls flow through unchanged while alignment traces and integrity checks are recorded locally.

## Stopping and Restarting

```bash
# Stop all services (preserves data volumes)
docker compose down

# Stop and remove data volumes (destructive -- deletes database)
docker compose down -v

# Restart a single service
docker compose restart gateway

# Restart all services
docker compose up -d
```

## Viewing Logs

```bash
# All services
docker compose logs -f

# Single service
docker compose logs -f gateway

# Last 100 lines
docker compose logs --tail=100 gateway

# Observer scheduler logs
docker compose logs -f observer
```

Logs are structured JSON by default. Each line contains a `timestamp`, `level`, `service`, and `message` field suitable for ingestion by log aggregators.

Set `LOG_LEVEL=debug` in `.env` for verbose output during troubleshooting.

## Upgrading

```bash
# Pull the latest source
git pull origin main

# Rebuild images and restart
docker compose up -d --build

# Migrations run automatically via the migrate service
```

The `migrate` service is idempotent -- it tracks applied migrations in a `_schema_migrations` table and skips already-applied files. See the [Upgrade Guide](../UPGRADE.md) for detailed procedures and rollback instructions.

## Troubleshooting

### Gateway container exits immediately

Check that all required environment variables are set:

```bash
docker compose logs gateway | head -20
```

Look for `Missing required environment variables` in the output. The gateway requires `SUPABASE_URL`, `SUPABASE_KEY`, and `ANTHROPIC_API_KEY` at minimum.

### Port 8787 already in use

Change the host port mapping in `.env`:

```bash
PORT=9090
```

### Redis connection refused

Ensure the Redis container is running and healthy:

```bash
docker compose ps redis
docker compose exec redis redis-cli ping
```

### Migration fails

Check migration logs:

```bash
docker compose logs migrate
```

Common causes: incorrect `POSTGRES_PASSWORD`, PostgreSQL not ready (rare -- the compose file uses health checks), or schema conflicts from a previous partial migration.

### Cannot reach LLM APIs

The gateway container needs outbound HTTPS access. If running behind a corporate proxy, configure Docker's proxy settings:

```bash
# ~/.docker/config.json
{
  "proxies": {
    "default": {
      "httpProxy": "http://proxy:3128",
      "httpsProxy": "http://proxy:3128"
    }
  }
}
```

See the [Troubleshooting Guide](../TROUBLESHOOTING.md) for additional issues and solutions.
