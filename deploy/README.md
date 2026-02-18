# smoltbot Self-Hosted Gateway

The smoltbot self-hosted gateway lets you run the Mnemom AI agent tracing infrastructure on your own infrastructure. All AI API calls, alignment traces, and integrity checks stay within your network boundary. Your prompts, responses, and API keys never leave your environment.

The self-hosted gateway is functionally identical to the managed Mnemom cloud service. It runs the same gateway, observer, and API workers adapted from Cloudflare Workers to a standard Node.js runtime with Hono, Redis, and PostgreSQL.

## Deployment Paths

| | Managed (Cloud) | Docker Compose | Kubernetes (Helm) |
|---|---|---|---|
| **Best for** | Getting started, small teams | Single-node, dev/staging | Production, multi-node |
| **Infrastructure** | None (hosted by Mnemom) | Docker host with 2 GB RAM | K8s 1.27+ cluster |
| **Setup time** | 2 minutes | 5 minutes | 15-30 minutes |
| **Scaling** | Automatic | Vertical only | Horizontal (HPA) |
| **High availability** | Built-in | No | Yes (2+ replicas) |
| **TLS** | Included | BYO reverse proxy | Ingress + cert-manager |
| **Monitoring** | Dashboard at mnemom.ai | Prometheus /metrics | ServiceMonitor + Grafana |
| **Data residency** | Mnemom cloud (US) | Your infrastructure | Your infrastructure |
| **License required** | No (free tier available) | Yes | Yes |
| **Offline / air-gapped** | No | Yes (hybrid analysis) | Yes (hybrid analysis) |

## Quick Links

- **[Docker Compose Quickstart](docker/README.md)** -- Get running in 5 minutes on a single host.
- **[Kubernetes / Helm Guide](helm/README.md)** -- Production deployment with scaling, TLS, and monitoring.
- **[Architecture](ARCHITECTURE.md)** -- How components fit together in each deployment mode.
- **[Configuration Reference](CONFIGURATION.md)** -- Complete environment variable reference.
- **[Troubleshooting](TROUBLESHOOTING.md)** -- Common issues and solutions.
- **[Upgrade Guide](UPGRADE.md)** -- Version upgrade procedures and rollback.

## Prerequisites

All self-hosted deployments require:

1. **A Mnemom enterprise license JWT** -- Contact [sales@mnemom.ai](mailto:sales@mnemom.ai) to obtain one.
2. **At least one LLM provider API key** -- Anthropic is required; OpenAI and Gemini are optional.
3. **Network access to upstream LLM APIs** -- `api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com` on port 443.

## How It Works

The self-hosted gateway adapts the same Cloudflare Worker code that powers the managed service to run on Node.js 22. A fetch interceptor rewrites Cloudflare AI Gateway URLs to direct upstream API calls. A Redis-backed KV adapter replaces Cloudflare KV. A cron scheduler replaces Cloudflare Cron Triggers. The result is identical tracing and integrity checking behavior without any Cloudflare dependency.

```
Your App --> smoltbot gateway --> Anthropic / OpenAI / Gemini
                |           |
              Redis     PostgreSQL
                |
           Observer (cron)
                |
         AP-Trace + AIP Verify
```

## Support

- Documentation: [docs.mnemom.ai/smoltbot/self-hosted](https://docs.mnemom.ai/smoltbot/self-hosted)
- Email: [support@mnemom.ai](mailto:support@mnemom.ai)
- GitHub Issues: [github.com/mnemom/smoltbot/issues](https://github.com/mnemom/smoltbot/issues)
