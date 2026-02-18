# Troubleshooting

Common issues and their solutions for the smoltbot self-hosted gateway. Each section includes the symptom, cause, and resolution steps.

---

## Gateway Won't Start

**Symptom:** The gateway container exits immediately or logs `EnvValidationError`.

**Cause:** Required environment variables are missing.

**Solution:**

```bash
# Check the gateway logs for the specific missing variables
docker compose logs gateway | head -20

# The error message lists the missing variables, e.g.:
#   Missing required environment variables:
#     SUPABASE_URL
#     SUPABASE_KEY
#     ANTHROPIC_API_KEY
```

Verify your `.env` file contains all required variables. See the [Configuration Reference](CONFIGURATION.md) for the complete list.

---

## Port Conflict

**Symptom:** `Error: listen EADDRINUSE: address already in use :::8787` or Docker reports a port binding conflict.

**Cause:** Another process is using port 8787 on the host.

**Solution:**

```bash
# Find what is using the port
lsof -i :8787

# Option 1: Stop the conflicting process
kill <PID>

# Option 2: Change the gateway port in .env
PORT=9090
docker compose up -d
```

---

## Redis Connection Refused

**Symptom:** Health check reports `"redis": { "ok": false }` or logs show `ECONNREFUSED` to Redis.

**Cause:** Redis is not running, the URL is wrong, or a firewall is blocking the connection.

**Solution:**

```bash
# Docker Compose: check Redis container status
docker compose ps redis
docker compose exec redis redis-cli ping

# Verify REDIS_URL format
# Correct: redis://redis:6379
# Correct (with auth): redis://:password@redis:6379
# Correct (TLS): rediss://redis:6380
# Wrong: http://redis:6379

# Kubernetes: check Redis pod
kubectl get pods -n smoltbot -l app=redis
kubectl exec -n smoltbot <redis-pod> -- redis-cli ping
```

If Redis is unreachable and you need the gateway running immediately, remove `REDIS_URL` from the configuration. The gateway will fall back to an in-memory KV adapter. This is a temporary measure -- in-memory mode loses cache data on restart.

---

## PostgreSQL Connection Failed

**Symptom:** Migration container fails or health check reports `"supabase": { "ok": false }`.

**Cause:** Wrong credentials, PostgreSQL not ready, SSL configuration mismatch, or migrations not applied.

**Solution:**

```bash
# Docker Compose: check PostgreSQL status
docker compose ps postgres
docker compose exec postgres pg_isready -U smoltbot

# Verify connection manually
docker compose exec postgres psql -U smoltbot -d smoltbot -c "SELECT 1;"

# Check migration status
docker compose logs migrate

# Kubernetes: check PostgreSQL connectivity from a gateway pod
kubectl exec -n smoltbot <gateway-pod> -- sh -c \
  'wget -qO- http://localhost:8787/health/ready'
```

For external PostgreSQL (RDS, Cloud SQL), ensure:
- The connection string includes `?sslmode=require` if SSL is enforced.
- The database user has CREATE TABLE and INSERT privileges for migrations.
- Security groups / firewall rules allow traffic from gateway pods on port 5432.

---

## License Validation Errors

**Symptom:** Health check reports `"license": { "ok": false, "warning": "license_expired" }` or `"license_parse_error"`.

**Cause:** The license JWT is expired, malformed, or uses the wrong signing secret.

**Solution:**

```bash
# Decode the JWT payload to check expiration (requires jq)
echo "$MNEMOM_LICENSE_JWT" | cut -d. -f2 | base64 -d 2>/dev/null | jq .

# Check the "exp" field -- it should be a Unix timestamp in the future
# Current time: date +%s
```

| Warning | Cause | Fix |
|---|---|---|
| `license_expired` | JWT `exp` claim is in the past | Request a renewed license from sales@mnemom.ai |
| `license_parse_error` | JWT is malformed (not 3 dot-separated parts) | Check for truncation or encoding issues in your `.env` or Secret |

> **Note:** License validation failures cause the `/health/ready` probe to return `degraded` status but do not prevent the gateway from serving requests. The license check is informational.

Clock skew can also cause false expiration. Ensure the host clock is synchronized via NTP:

```bash
# Check time sync (Linux)
timedatectl status

# Force NTP sync
sudo timedatectl set-ntp true
```

---

## Upstream LLM API Errors

**Symptom:** Requests to `/anthropic/*`, `/openai/*`, or `/gemini/*` return 502 or connection errors.

**Cause:** Missing or invalid API keys, network access blocked, or upstream rate limiting.

**Solution:**

```bash
# Test connectivity from inside the gateway container
docker compose exec gateway sh -c \
  'wget -qO- --spider https://api.anthropic.com/ 2>&1'

# Verify API key is set (check for empty value)
docker compose exec gateway sh -c 'echo "Key length: ${#ANTHROPIC_API_KEY}"'
```

| Error | Cause | Fix |
|---|---|---|
| `401 Unauthorized` | API key is invalid or revoked | Verify the key in your provider's dashboard |
| `403 Forbidden` | Key lacks required permissions | Check API key scope and organization settings |
| `429 Too Many Requests` | Upstream rate limit | Reduce request rate or request a limit increase |
| Connection timeout | Firewall blocking HTTPS egress | Allow outbound traffic to port 443 |

Ensure these hosts are reachable from the gateway:
- `api.anthropic.com`
- `api.openai.com`
- `generativelanguage.googleapis.com`

---

## High Memory Usage

**Symptom:** Gateway containers are OOMKilled or memory usage grows over time.

**Cause:** Node.js heap not tuned for the container's memory limit, or too many concurrent requests buffering large responses.

**Solution:**

```bash
# Set the Node.js heap limit to 75% of the container memory limit
# For a 512Mi container limit, use ~384MB
docker compose exec gateway sh -c 'node --max-old-space-size=384 dist/entrypoint.js'
```

For Kubernetes, set the `NODE_OPTIONS` environment variable:

```yaml
config:
  NODE_OPTIONS: "--max-old-space-size=384"
```

If memory growth is gradual, check for:
- Large numbers of concurrent streaming responses (each buffers in memory).
- Redis connection pool accumulation (check `REDIS_URL` is correct).
- Background task accumulation (check `gateway_background_tasks_total` metric).

---

## Heartbeat Failures

**Symptom:** Logs show `[heartbeat] Failed to send heartbeat: ...` warnings.

**Cause:** Network access to `api.mnemom.ai` is blocked by a firewall, or DNS resolution fails.

**Solution:**

```bash
# Test connectivity
docker compose exec gateway sh -c \
  'wget -qO- --spider https://api.mnemom.ai/ 2>&1'

# Check DNS resolution
docker compose exec gateway sh -c 'nslookup api.mnemom.ai'
```

> **Note:** Heartbeat failures are strictly fail-open. They are logged as warnings but never affect gateway operation. The heartbeat is used for license compliance monitoring and aggregate deployment telemetry only. If your environment cannot reach `api.mnemom.ai`, the gateway operates normally without it.

To suppress the warnings, you can set `HEARTBEAT_URL` to an empty value or point it at a local endpoint.

---

## Migration Failures

**Symptom:** The `migrate` service exits with a non-zero code or logs `FAIL` for a migration file.

**Cause:** Insufficient database permissions, schema conflicts from manual changes, or a corrupt migration state.

**Solution:**

```bash
# Check migration logs
docker compose logs migrate

# Check which migrations have been applied
docker compose exec postgres psql -U smoltbot -d smoltbot \
  -c "SELECT * FROM _schema_migrations ORDER BY applied_at;"

# Re-run migrations (idempotent -- skips already-applied files)
docker compose up migrate
```

If a migration is partially applied (transaction failed mid-way), the tracking row is not inserted and the migration will be retried on next run. If the retry fails due to existing objects:

```bash
# Connect to PostgreSQL and manually fix the schema
docker compose exec postgres psql -U smoltbot -d smoltbot

# After fixing, mark the migration as applied
INSERT INTO _schema_migrations (filename) VALUES ('0042_problematic_migration.sql');
```

---

## Health Check Failures

**Symptom:** Kubernetes probes fail, causing pod restarts. Or `curl /health/ready` returns 503.

**Cause:** The gateway is still starting up, or a dependency (Redis, PostgreSQL) is unavailable.

**Solution:**

```bash
# Check which health checks are failing
curl -s http://localhost:8787/health/ready | jq .

# The response shows individual check status:
# {
#   "status": "degraded",
#   "checks": {
#     "redis": { "ok": false, "latencyMs": 5001 },
#     "supabase": { "ok": true, "latencyMs": 12 },
#     "license": { "ok": true }
#   }
# }
```

For Kubernetes startup probe failures, increase the startup probe tolerance:

```yaml
probes:
  startup:
    initialDelaySeconds: 10
    periodSeconds: 5
    failureThreshold: 60  # allow up to 5 minutes for startup
```

---

## Logs Not Appearing

**Symptom:** No log output from the gateway, or only partial logs visible.

**Cause:** `LOG_LEVEL` is set too high, the container log driver is misconfigured, or logs are being written to a file instead of stdout.

**Solution:**

```bash
# Set LOG_LEVEL to debug for maximum verbosity
LOG_LEVEL=debug

# Verify Docker log driver (should be json-file or journald)
docker inspect gateway --format='{{.HostConfig.LogConfig.Type}}'

# Check if logs are being truncated by Docker
docker compose logs --no-log-prefix gateway | wc -l
```

The gateway writes all logs to stdout as structured JSON. If you are using a log aggregator (ELK, Loki, CloudWatch), ensure it is configured to parse JSON log lines and that the `message` field is indexed.

---

## Getting Further Help

If the issue is not listed here:

1. Set `LOG_LEVEL=debug` and reproduce the issue.
2. Collect the gateway and observer logs.
3. Check the `/health/ready` and `/metrics` endpoints for clues.
4. Open an issue at [github.com/mnemom/smoltbot/issues](https://github.com/mnemom/smoltbot/issues) with the logs, your deployment method (Docker/Helm), and the smoltbot version (`GATEWAY_VERSION`).
5. For urgent production issues, email [support@mnemom.ai](mailto:support@mnemom.ai).
