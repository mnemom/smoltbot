# smoltbot

[![npm](https://img.shields.io/npm/v/smoltbot.svg)](https://www.npmjs.com/package/smoltbot)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![AAP](https://img.shields.io/badge/AAP-compliant-green.svg)](https://github.com/mnemom/aap)

Transparent AI agent tracing. [AAP](https://github.com/mnemom/aap)-compliant.

Smoltbot observes your AI agent's API calls and builds verifiable alignment traces — what decisions were made, what alternatives were considered, and whether behavior matches declared values. Your prompts and responses are never stored.

## Quick Start

```bash
npm install -g smoltbot
smoltbot init
```

That's it. `smoltbot init` configures your local environment to route API calls through the Mnemom gateway, where they're traced and verified. Your API key never leaves your machine — only a SHA-256 hash is used for agent identification.

## CLI Commands

| Command | Description |
|---------|-------------|
| `smoltbot init` | Configure tracing for your AI agent |
| `smoltbot status` | Show agent status and connection info |
| `smoltbot integrity` | Display integrity score and verification stats |
| `smoltbot logs [-l N]` | Show recent traces and actions |

## How It Works

```
Your App → smoltbot gateway → AI Provider (Anthropic, etc.)
                ↓
           CF AI Gateway
                ↓
           Observer Worker
                ↓
         AP-Trace + Verify → Supabase
                ↓
         Dashboard (mnemom.ai)
```

1. **Gateway** — A Cloudflare Worker that intercepts API requests. It identifies your agent via API key hash (zero-config), attaches tracing metadata, and forwards requests transparently. Your prompts and responses pass through unchanged.

2. **Observer** — A scheduled Cloudflare Worker that processes AI Gateway logs. It extracts thinking blocks and tool calls from responses, analyzes decisions with Claude Haiku, builds [AP-Traces](https://github.com/mnemom/aap), and verifies them against your agent's alignment card using the AAP SDK.

3. **API** — Serves agent data, traces, integrity scores, drift alerts, and blog posts. Powers both the CLI and the web dashboard.

4. **CLI** — The `smoltbot` command. Configures your local environment and queries your agent's transparency data.

5. **Dashboard** — Web UI at [mnemom.ai](https://mnemom.ai) where you can view traces, claim your agent, and monitor alignment.

## Architecture

```
smoltbot/
├── cli/          # CLI tool (npm package)
├── gateway/      # Cloudflare Worker — API proxy + tracing
├── observer/     # Cloudflare Worker — trace builder + AAP verification
├── api/          # Cloudflare Worker — REST API
├── dashboard/    # React frontend (legacy, see mnemom-website)
└── database/     # Supabase schema (Postgres)
```

## Claiming Your Agent

After `smoltbot init`, your agent is registered automatically. To link it to your Mnemom account:

1. Run `smoltbot status` to get your agent ID
2. Go to [mnemom.ai/claim](https://mnemom.ai/claim)
3. Paste your agent ID and prove ownership with your API key hash

Claiming gives you a private dashboard with full trace history, integrity scores, and drift detection.

## What Gets Traced

Smoltbot builds [AP-Traces](https://github.com/mnemom/aap) that record:

- **Action** — What the agent did (type, name, category)
- **Decision** — What alternatives were considered and why one was selected
- **Escalation** — Whether the agent escalated to a human and why
- **Verification** — Whether the trace is consistent with the agent's declared alignment card

What is **not** stored: your prompts, responses, or API key.

## Current Limitations

- **Anthropic only** — Smoltbot currently supports the Anthropic API (Claude) only. Other providers are not yet supported.
- **API key auth only** — Agent identification uses Anthropic API key hashing. OAuth and other auth methods are not supported.
- **Hosted gateway** — The default gateway runs on Mnemom infrastructure. Self-hosting is possible but requires manual setup.

## Dependencies

- [Agent Alignment Protocol (AAP)](https://github.com/mnemom/aap) — `@mnemom/agent-alignment-protocol` on npm
- [Cloudflare Workers](https://workers.cloudflare.com/) — Gateway, observer, and API hosting
- [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/) — Request logging and analytics
- [Supabase](https://supabase.com/) — Postgres database with row-level security

## Self-Hosting

Smoltbot is designed to run on Cloudflare Workers + Supabase. To self-host:

1. Create a Supabase project and run `database/schema.sql`
2. Deploy workers: `cd gateway && wrangler deploy`, `cd api && wrangler deploy`, `cd observer && wrangler deploy`
3. Set secrets on each worker via `wrangler secret put`
4. Configure a Cloudflare AI Gateway and point the gateway worker to it
5. Update the CLI's gateway URL: `smoltbot init --gateway=https://your-domain.com`

## Contributing

Contributions welcome. Please open an issue first to discuss what you'd like to change.

## License

[Apache-2.0](LICENSE)

Copyright 2026 Mnemom LLC
