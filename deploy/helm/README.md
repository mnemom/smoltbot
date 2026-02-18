# Kubernetes Deployment (Helm)

Production-grade deployment of the smoltbot self-hosted gateway on Kubernetes using the `mnemom-gateway` Helm chart.

## Prerequisites

| Requirement | Minimum Version |
|---|---|
| Kubernetes | 1.27+ |
| Helm | 3.12+ |
| kubectl | Configured with cluster access |
| License | Mnemom enterprise JWT ([sales@mnemom.ai](mailto:sales@mnemom.ai)) |
| API key | Anthropic API key (required); OpenAI and Gemini keys (optional) |
| Network | Outbound HTTPS to LLM provider APIs from pods |

## Quick Install

```bash
# Add the Mnemom Helm repository
helm repo add mnemom https://charts.mnemom.ai
helm repo update

# Install with required secrets
helm install smoltbot mnemom/mnemom-gateway \
  --namespace smoltbot --create-namespace \
  --set secrets.values.SUPABASE_URL="https://your-project.supabase.co" \
  --set secrets.values.SUPABASE_KEY="your-service-role-key" \
  --set secrets.values.ANTHROPIC_API_KEY="sk-ant-..." \
  --set secrets.values.MNEMOM_LICENSE_JWT="eyJ..." \
  --set secrets.values.DATABASE_URL="postgres://..." \
  --set secrets.values.REDIS_URL="redis://..."
```

Or install from the local chart source:

```bash
helm install smoltbot ./deploy/helm/mnemom-gateway \
  --namespace smoltbot --create-namespace \
  -f my-values.yaml
```

## Configuration

The chart is configured through `values.yaml`. Create a `my-values.yaml` file with your overrides.

### Key Sections

#### Image

```yaml
image:
  repository: ghcr.io/mnemom/gateway
  pullPolicy: IfNotPresent
  tag: ""  # defaults to Chart.AppVersion
```

#### Replicas

```yaml
replicaCount: 2  # gateway pods

observer:
  replicas: 1    # observer/scheduler pods
```

#### Secrets

You can either provide secrets inline or reference an existing Kubernetes Secret:

```yaml
# Option A: Inline values (the chart creates a Secret resource)
secrets:
  values:
    SUPABASE_URL: "https://your-project.supabase.co"
    SUPABASE_KEY: "your-service-role-key"
    ANTHROPIC_API_KEY: "sk-ant-..."
    MNEMOM_LICENSE_JWT: "eyJ..."
    DATABASE_URL: "postgres://user:pass@host:5432/mnemom"
    REDIS_URL: "redis://redis:6379"

# Option B: Use a pre-existing Secret
secrets:
  existingSecret: "my-smoltbot-secrets"
```

> **Note:** For production, use an external secret manager (e.g., External Secrets Operator, Sealed Secrets) rather than storing secrets in `values.yaml`.

#### Non-sensitive Configuration

```yaml
config:
  LOG_LEVEL: "info"       # debug, info, warn, error
  SMOLTBOT_ROLE: "gateway"
  PORT: "8787"
```

### External Dependencies

#### Redis

The chart can deploy an internal Redis instance or connect to an external one:

```yaml
# Internal Redis (default)
redis:
  enabled: true
  architecture: standalone
  auth:
    enabled: false

# External Redis
redis:
  enabled: false
  externalUrl: "redis://my-redis-cluster.example.com:6379"
```

For production, use an external managed Redis service (AWS ElastiCache, GCP Memorystore, Azure Cache for Redis) with TLS and authentication.

#### PostgreSQL

Similarly, the chart can deploy an internal PostgreSQL instance or connect to an external one:

```yaml
# Internal PostgreSQL (default)
postgresql:
  enabled: true
  auth:
    database: mnemom
    username: mnemom
    password: "a-strong-password"

# External PostgreSQL
postgresql:
  enabled: false
  externalUrl: "postgres://user:pass@rds.example.com:5432/mnemom?sslmode=require"
```

For production, use an external managed PostgreSQL service (AWS RDS, GCP Cloud SQL, Azure Database for PostgreSQL) with automated backups, SSL, and high availability.

### TLS / Ingress

Enable the Ingress resource and configure TLS with cert-manager:

```yaml
ingress:
  enabled: true
  className: "nginx"
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
  hosts:
    - host: gateway.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: gateway-tls
      hosts:
        - gateway.example.com
```

Prerequisites for TLS:
1. Install [cert-manager](https://cert-manager.io/docs/installation/helm/): `helm install cert-manager jetstack/cert-manager --set installCRDs=true`
2. Create a ClusterIssuer for Let's Encrypt
3. Ensure your DNS points to the Ingress controller's external IP

### Scaling

Enable the Horizontal Pod Autoscaler for the gateway deployment:

```yaml
hpa:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPU: 70
  targetMemory: ""  # leave empty to scale on CPU only
```

The HPA requires the [Metrics Server](https://github.com/kubernetes-sigs/metrics-server) to be installed in the cluster. When HPA is enabled, the `replicaCount` field is ignored.

A Pod Disruption Budget is enabled by default to ensure at least one gateway pod remains available during voluntary disruptions:

```yaml
pdb:
  enabled: true
  minAvailable: 1
```

### Monitoring

Enable the Prometheus ServiceMonitor to scrape the `/metrics` endpoint:

```yaml
metrics:
  serviceMonitor:
    enabled: true
    labels:
      release: prometheus  # match your Prometheus Operator's selector
    interval: "30s"
    path: /metrics
    port: http
```

The gateway exposes these Prometheus metrics:

| Metric | Type | Labels | Description |
|---|---|---|---|
| `gateway_requests_total` | Counter | `provider`, `status` | Total proxy requests |
| `gateway_request_duration_seconds` | Histogram | `provider` | Request latency |
| `gateway_aip_checks_total` | Counter | `verdict` | AIP integrity checks |
| `gateway_cache_operations_total` | Counter | `operation`, `result` | KV cache operations |
| `gateway_cron_runs_total` | Counter | `job`, `result` | Cron job executions |
| `gateway_background_tasks_total` | Counter | `task` | Background tasks via waitUntil |

Plus default Node.js process metrics (`process_*`, `nodejs_*`).

### Security

#### Pod Security

The chart enforces security best practices by default:

```yaml
podSecurityContext:
  runAsNonRoot: true
  runAsUser: 65534       # nobody
  fsGroup: 65534
  seccompProfile:
    type: RuntimeDefault

containerSecurityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop:
      - ALL
```

#### Network Policy

A NetworkPolicy is enabled by default that restricts pod traffic to:

- **Ingress:** Port 8787 (gateway HTTP) from any source
- **Egress:** DNS (53/UDP+TCP), Redis (6379/TCP), PostgreSQL (5432/TCP), HTTPS (443/TCP) to any external IP

```yaml
networkPolicy:
  enabled: true  # default
```

#### RBAC

The chart creates a dedicated ServiceAccount. Annotate it for cloud IAM integration:

```yaml
serviceAccount:
  create: true
  annotations:
    # AWS IRSA
    eks.amazonaws.com/role-arn: "arn:aws:iam::123456789:role/smoltbot-gateway"
    # GCP Workload Identity
    # iam.gke.io/gcp-service-account: "smoltbot@project.iam.gserviceaccount.com"
```

## Upgrading

```bash
# Update the Helm repo
helm repo update

# Review changes
helm diff upgrade smoltbot mnemom/mnemom-gateway -f my-values.yaml

# Upgrade
helm upgrade smoltbot mnemom/mnemom-gateway \
  --namespace smoltbot \
  -f my-values.yaml

# Verify rollout
kubectl rollout status deployment/smoltbot-mnemom-gateway-gateway -n smoltbot
kubectl rollout status deployment/smoltbot-mnemom-gateway-observer -n smoltbot
```

Database migrations run automatically as a Helm pre-install/pre-upgrade hook. The migration Job has a `backoffLimit` of 3 and a 5-minute deadline.

See the [Upgrade Guide](../UPGRADE.md) for detailed procedures, rollback instructions, and breaking changes policy.

## Uninstalling

```bash
helm uninstall smoltbot --namespace smoltbot
```

> **Warning:** This removes all Kubernetes resources created by the chart. If you deployed internal Redis or PostgreSQL, their PersistentVolumeClaims may be retained depending on your StorageClass reclaim policy. Verify with `kubectl get pvc -n smoltbot`.

To remove the namespace entirely:

```bash
kubectl delete namespace smoltbot
```

## Advanced Configuration

### Topology Spread and Affinity

Distribute gateway pods across availability zones:

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels:
        app.kubernetes.io/component: gateway
```

### Node Selectors and Tolerations

```yaml
nodeSelector:
  node-role.kubernetes.io/worker: ""

tolerations:
  - key: "dedicated"
    operator: "Equal"
    value: "ai-gateway"
    effect: "NoSchedule"
```

### Resource Tuning

Default resource requests and limits:

```yaml
# Gateway pods
resources:
  requests:
    cpu: "100m"
    memory: "256Mi"
  limits:
    cpu: "1"
    memory: "512Mi"

# Observer pods
observer:
  resources:
    requests:
      cpu: "50m"
      memory: "128Mi"
    limits:
      cpu: "500m"
      memory: "256Mi"
```

Adjust based on your traffic volume. The gateway is I/O-bound (proxying LLM API calls), so CPU limits can typically stay low. Memory limits should accommodate the Node.js heap plus request buffering.
