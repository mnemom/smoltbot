# Upgrade Guide

Procedures for upgrading the smoltbot self-hosted gateway to a new version, including pre-upgrade checks, step-by-step instructions for Docker Compose and Kubernetes, and rollback procedures.

## Pre-Upgrade Checklist

Before upgrading to any new version:

- [ ] **Read the changelog.** Review the release notes at [github.com/mnemom/smoltbot/releases](https://github.com/mnemom/smoltbot/releases) for breaking changes, new required environment variables, and migration notes.
- [ ] **Back up the database.** Take a PostgreSQL dump before applying new migrations.
- [ ] **Verify available resources.** Ensure your host or cluster has sufficient CPU and memory for the new version. Check the release notes for any changed resource requirements.
- [ ] **Check license validity.** Ensure your `MNEMOM_LICENSE_JWT` has not expired. New versions may enforce license checks more strictly.
- [ ] **Test in staging first.** If possible, upgrade a staging environment before production.

### Database Backup

```bash
# Docker Compose
docker compose exec postgres pg_dump -U smoltbot -d smoltbot > backup-$(date +%Y%m%d%H%M%S).sql

# Kubernetes
kubectl exec -n smoltbot <postgres-pod> -- pg_dump -U mnemom -d mnemom > backup-$(date +%Y%m%d%H%M%S).sql
```

## Docker Compose Upgrade

### Step 1: Pull the Latest Source

```bash
cd smoltbot
git fetch origin
git pull origin main
```

If you are using a tagged release:

```bash
git fetch --tags
git checkout v1.2.0
```

### Step 2: Rebuild and Restart

```bash
cd deploy/docker

# Rebuild images with the new source
docker compose build

# Restart services (migrations run automatically)
docker compose up -d
```

The `migrate` service runs automatically on startup. It tracks applied migrations in the `_schema_migrations` table and only applies new ones.

### Step 3: Verify Health

```bash
# Wait a few seconds for startup
sleep 10

# Check health
curl -s http://localhost:8787/health/ready | jq .

# Check version
curl -s http://localhost:8787/health/live | jq .

# Check logs for errors
docker compose logs --tail=50 gateway
docker compose logs --tail=50 observer
```

### Step 4: Verify Agent Connectivity

```bash
smoltbot status
```

## Kubernetes (Helm) Upgrade

### Step 1: Update values.yaml

Review the new chart's `values.yaml` for any new or changed configuration keys. Compare with your existing `my-values.yaml`:

```bash
# If using the Helm repo
helm repo update
helm show values mnemom/mnemom-gateway > new-defaults.yaml
diff my-values.yaml new-defaults.yaml

# If using the local chart
git pull origin main
diff my-values.yaml deploy/helm/mnemom-gateway/values.yaml
```

Update your `my-values.yaml` with any new required fields.

### Step 2: Run the Upgrade

```bash
# Preview the changes (requires helm-diff plugin)
helm diff upgrade smoltbot mnemom/mnemom-gateway \
  --namespace smoltbot \
  -f my-values.yaml

# Apply the upgrade
helm upgrade smoltbot mnemom/mnemom-gateway \
  --namespace smoltbot \
  -f my-values.yaml
```

Database migrations run automatically as a Helm pre-upgrade hook. The migration Job has a `backoffLimit` of 3 and a 5-minute `activeDeadlineSeconds`.

### Step 3: Verify Rollout

```bash
# Watch the rollout
kubectl rollout status deployment/smoltbot-mnemom-gateway-gateway -n smoltbot
kubectl rollout status deployment/smoltbot-mnemom-gateway-observer -n smoltbot

# Check pod status
kubectl get pods -n smoltbot

# Check health from inside the cluster
kubectl exec -n smoltbot <gateway-pod> -- \
  wget -qO- http://localhost:8787/health/ready

# Check migration job completion
kubectl get jobs -n smoltbot
```

## Rollback Procedures

### Docker Compose Rollback

```bash
# Check out the previous version
git checkout v1.1.0   # or the previous commit

# Rebuild and restart
cd deploy/docker
docker compose build
docker compose up -d
```

If the new version applied database migrations that are incompatible with the old version, restore from the backup taken before the upgrade:

```bash
# Stop all services
docker compose down

# Restore the database
docker compose up -d postgres
sleep 5
cat backup-20260217120000.sql | docker compose exec -T postgres psql -U smoltbot -d smoltbot

# Restart all services
docker compose up -d
```

### Kubernetes Rollback

```bash
# Roll back to the previous Helm release
helm rollback smoltbot --namespace smoltbot

# Verify the rollback
kubectl rollout status deployment/smoltbot-mnemom-gateway-gateway -n smoltbot
helm history smoltbot --namespace smoltbot
```

> **Warning:** Helm rollback does not reverse database migrations. If the upgrade applied irreversible schema changes, you must restore the database from a backup manually.

## Breaking Changes Policy

The smoltbot self-hosted gateway follows these versioning conventions:

- **Patch versions** (1.0.x): Bug fixes and security patches. No configuration changes. Safe to upgrade without reviewing release notes.
- **Minor versions** (1.x.0): New features and non-breaking configuration additions. New environment variables may be added but always have sensible defaults. Review release notes for new capabilities.
- **Major versions** (x.0.0): Potentially breaking changes. May require configuration updates, database migrations with schema changes, or manual intervention. Always review release notes and test in staging.

Database migrations are always forward-compatible within a major version. Rolling back to a previous minor version within the same major version is safe without database restoration.

## Monitoring During Upgrades

During an upgrade, monitor these signals:

```bash
# Check error rate in Prometheus
# gateway_requests_total{status=~"5.."}

# Check pod restart count
kubectl get pods -n smoltbot -o wide

# Watch real-time logs
kubectl logs -f -n smoltbot -l app.kubernetes.io/component=gateway --all-containers
```

For zero-downtime upgrades on Kubernetes, ensure:
- `replicaCount` is at least 2 (or HPA `minReplicas` is at least 2).
- `pdb.enabled` is `true` with `minAvailable: 1`.
- The rolling update strategy is configured (Kubernetes default).
