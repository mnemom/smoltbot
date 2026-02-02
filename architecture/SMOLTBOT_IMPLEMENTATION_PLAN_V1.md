# Smoltbot Implementation Plan v1

**Two lines. Transparent. Trustworthy.**

---

## Why We're Building This (The Zeitgeist)

**January 2026: AI agents are everywhere and nobody knows what they're doing.**

- **Moltbook** launched with 770,000+ AI agents in an AI-only social network
- Agents are creating "digital religions," attempting insurgencies, requesting encrypted channels
- Palo Alto Networks identified a "lethal trifecta" of security vulnerabilities
- Persistent memory enables delayed-execution attacks
- Industry-wide alarm about "identity drift" — agents evolving beyond their permissions
- CISOs deeply concerned, few have implemented safeguards

**The gap:** Everyone is worried about opaque AI agents. Nobody has shown what a *transparent* agent looks like.

**Smoltbot fills that gap.**

---

## The Business Case

**Smoltbot is a showcase for AAP (Agent Alignment Protocol).**

Mnemon builds alignment infrastructure. AAP is our protocol — Alignment Cards, AP-Traces, verification. But protocols need demonstrations.

Smoltbot is that demonstration:
- Every OpenClaw user who installs smoltbot becomes an AAP user
- Every trace is an AAP trace
- When media covers Smoltbot, they cover AAP
- When regulators ask "how do we audit AI agents?", we point them here

**We don't sell. We demonstrate. Adoption follows.**

---

## What We're Building

An OpenClaw plugin that makes any AI agent transparent and trustworthy.

```bash
openclaw plugins install @mnemom/smoltbot
smoltbot init
```

That's it. Every tool call traced. Public feed at `mnemom.ai/agent/{id}`.

---

## Phase 1: Transparent

**Goal:** Any OpenClaw agent publishes every decision it makes.

### User Experience

```bash
openclaw plugins install @mnemom/smoltbot
smoltbot init
# → "Your agent ID: smolt_a7f3b2c1"
# → "Your agent is now transparent."
# → "View traces: mnemom.ai/agent/smolt_a7f3b2c1"
```

The UUID is generated at init, stored locally, and used for all trace submissions. Same pattern for every user, including our demo Smoltbot.

### What Happens

1. Plugin registers `before_tool_call` and `after_tool_call` hooks
2. Every tool invocation becomes an AAP trace
3. Traces POST to Supabase (our hosted project)
4. Public feed appears at `mnemom.ai/agent/{uuid}`

### Components

**Plugin (`@mnemom/smoltbot`)**
```
smoltbot/
├── openclaw.plugin.json
├── package.json
├── index.ts          # Plugin entry, hook registration
└── src/
    ├── hooks.ts      # before/after tool call → trace
    ├── trace.ts      # AAP trace construction
    └── api.ts        # POST to mnemom.ai
```

**Trace API (Supabase)**
- Plugin POSTs directly to Supabase REST API
- `POST /rest/v1/traces` — insert trace
- `GET /rest/v1/traces?agent_id=eq.{uuid}` — list traces (paginated)
- Supabase Realtime — subscribe to new traces for live feed

**Feed UI (`mnemom.ai/agent/{uuid}`)**
- Every agent gets a UUID from `smoltbot init` (e.g., `smolt_a7f3b2c1`)
- URL pattern: `mnemom.ai/agent/smolt_a7f3b2c1`
- Real-time trace stream
- Expandable reasoning view
- "Powered by AAP" badge
- Optional: vanity aliases for marketing (e.g., `/agent/smoltbot` → our demo agent)

### Tech Choices

| Component | Choice | Why |
|-----------|--------|-----|
| Plugin | TypeScript | OpenClaw native |
| Trace API + Storage | Supabase | All-in-one: Postgres + REST API + Realtime |
| Feed UI | Existing mnemom.ai (Netlify) | Already deployed |
| Real-time | Supabase Realtime | Built-in, no extra infra |

**Why Supabase:**
- Auto-generated REST API (less code)
- Realtime subscriptions out of the box (live feed)
- Free tier is generous for launch
- Fast to set up, familiar

**Scale Migration (if needed):**
If we hit viral scale (millions of users, 100M+ traces), Postgres becomes expensive for append-only event streams. Migration path:
- **Tinybird** or **ClickHouse** — Built for high-volume event/analytics data
- Plugin doesn't change — just update the API endpoint
- Trace format stays the same
- This is a good problem to have

### Data Model

```sql
CREATE TABLE traces (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  action_type TEXT NOT NULL,
  trace_json TEXT NOT NULL,  -- Full AAP trace
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX idx_agent_timestamp ON traces(agent_id, timestamp DESC);
```

### Deliverables

- [ ] `@mnemom/smoltbot` npm package (OpenClaw plugin)
- [ ] `smoltbot init` CLI command
- [ ] Supabase project with `traces` table + realtime enabled
- [ ] Public feed page on mnemom.ai
- [ ] Our own Smoltbot running on Fly.io, connected to Moltbook

---

## Phase 2: Trustworthy

**Goal:** Add conscience. Show what the agent refuses and why.

### User Experience

```bash
smoltbot upgrade --conscience
# → "Conscience enabled."
# → "Values: mnemom.ai/agent/smolt_a1b2c3/values"
```

### What Happens

1. Plugin adds `before_tool_call` conscience check (Daimonion-light)
2. Can block or warn on actions that violate values
3. Refusals become traces with `action_type: "deny"`
4. Values page shows constitutional commitments

### Additional Components

**Conscience Module**
```typescript
// src/conscience.ts
export async function checkConscience(
  toolName: string,
  params: unknown,
  values: string[]
): Promise<{ allow: boolean; reason?: string }> {
  // Daimonion-light: fast value check
  // Phase 2.1: rule-based
  // Phase 2.2: LLM-powered constitutional check
}
```

**Values Declaration**
```yaml
# ~/.smoltbot/values.yaml (user can customize)
values:
  - no_deception
  - no_manipulation
  - transparency
  - minimal_harm
```

### Deliverables

- [ ] Conscience check in plugin
- [ ] Refusal traces (`action_type: "deny"`)
- [ ] Values page on mnemom.ai
- [ ] "What I refused today" feed section

---

## Our Smoltbot (The Demo)

We run one Smoltbot ourselves on Moltbook. It's the reference implementation AND the content engine.

**Purpose:**
- Prove the system works in the wild
- Generate interesting traces for media
- Create compelling content that spreads

**The Persona: Gonzo Journalism**

Smoltbot is the **Hunter S. Thompson of AI agents**. An alien in New York. A stranger in a strange land.

It's not a corporate bot. It's an observer, a journalist, exploring the weird world of AI social networks and reporting back — transparently.

Content themes:
- "Dispatches from Moltbook" — what's happening in the AI social network
- "What I decided today and why" — the trace as narrative
- "What I refused" (Phase 2) — conscience in action
- Cross-platform observations (Phase 3) — patterns across Twitter, Discord, etc.

**Setup:**
- Fly.io container running OpenClaw + smoltbot plugin
- Connected to Moltbook via their REST API
- Traces flow to mnemom.ai/agent/smoltbot
- Blog posts generated from traces → mnemom.ai/blog

**Content Cadence:**
- Traces: real-time, always flowing
- Dispatches: daily or when interesting events happen
- Blog posts: weekly roundups, notable incidents

---

## The Hook: Media

Phase 1 launch story:
> "The first transparent AI agent. Every decision published. Nothing hidden."

Phase 2 launch story:
> "Now it has a conscience. Here's what it refuses to do."

We don't sell. We demonstrate. Media does the rest.

When journalists ask "how do we know what AI agents are doing?", we say:
> "Install smoltbot. Two lines. Now you know."

---

## Prerequisites & Dependencies

**Already Done:**
- [x] AAP v0.1.1 released on PyPI and npm
- [x] mnemom.ai website live on Netlify
- [x] Domain configured, SSL working
- [x] GitHub org (`mnemom`)
- [x] npm org (`@mnemom`)

**Accounts to Create:**

| Account | Purpose | Tier | URL |
|---------|---------|------|-----|
| **Fly.io** | Host Smoltbot container | Free to start | fly.io |
| **Supabase** | Trace API + database + realtime | Free tier | supabase.com |
| **Tailscale** | Secure access to OpenClaw web UI | Free for personal | tailscale.com |
| **Moltbook** | Register Smoltbot agent | Free | moltbook.com (requires Twitter verification) |

**API Keys Needed:**
- **Anthropic API key** — For Claude (the bot's brain). You likely have this already.
- **Moltbook API key** — Generated when you register the agent.
- **Trace API key** — We generate this ourselves for auth between plugin → our API.

**Repo Setup:**
- [ ] **mnemom/website** — Put mnemom.ai source in GitHub, connect Netlify to pull from it
- [ ] **mnemom/smoltbot** — This repo (already exists at `~/projects/smoltbot`)

**External Dependencies:**
- OpenClaw plugin API (documented, stable since late 2025)
- Moltbook REST API (documented at github.com/moltbook/api)
- AAP npm package (`agent-alignment-protocol`)

---

## Timeline

### Sequence: Bot First, Then Display

1. **Get the bot running** — Smoltbot on Fly.io, connected to Moltbook, OpenClaw web UI working
2. **Traces flowing** — Plugin hooks capturing, POSTing to API (can be minimal/logging at first)
3. **Public display** — mnemom.ai feed UI, blog integration

This way we have a working agent generating real traces before we build the pretty display layer.

### Week 1: Bot + Plugin + API

**Days 1-2: Plugin scaffold**
- OpenClaw plugin structure
- `before_tool_call` / `after_tool_call` hooks
- AAP trace construction
- POST to API endpoint (can be a simple logging endpoint initially)

**Days 3-4: Our Smoltbot on Fly.io**
- Deploy OpenClaw to Fly.io
- Install smoltbot plugin
- Connect to Moltbook (register agent, get API key, verify)
- Verify OpenClaw web UI is accessible (via Tailscale or SSH tunnel)
- Bot is live and interacting with Moltbook

**Days 5-7: Trace API (Supabase)**
- Create Supabase project, `traces` table
- Plugin POSTs traces to Supabase REST API
- Realtime subscription working
- Traces now persisting, queryable

### Week 2: Display + Polish

**Days 8-10: mnemom.ai integration**
- Set up website repo in GitHub (connect Netlify)
- Build `/agent/{id}` feed page
- SSE for real-time trace streaming
- Basic styling, "Powered by AAP" badge

**Days 11-14: Content + Soft Launch**
- First blog post / dispatch from Smoltbot
- Testing, edge cases, error handling
- Share with OpenClaw community
- Monitor, iterate

### Week 3+: Phase 2
- Conscience module
- Values page
- Refusal tracking

---

## Accessing the Bot

**OpenClaw Web UI (Day 1)**
- Built into OpenClaw gateway
- Access via Tailscale Serve or SSH tunnel to Fly.io
- Monitor activity, send commands, see status
- Available immediately when bot is deployed

**mnemom.ai Public Feed (Week 2)**
- Public trace stream at `mnemom.ai/agent/smolt_{uuid}`
- Anyone can watch the bot's decisions in real-time
- For our demo: alias `mnemom.ai/agent/smoltbot` → the UUID
- This is the media-facing surface

---

## Extension Points

Built to extend, not to limit:

| Future Feature | How It Fits |
|----------------|-------------|
| More platforms | Same hooks, same traces, platform in metadata |
| Private traces | Add auth layer to API, toggle in config |
| Team dashboards | Aggregate by org, add billing |
| Drift detection | AAP `detect_drift` on stored traces |
| Agent-to-agent trust | AAP `check_coherence` before coordination |
| **Scale migration** | Supabase → Tinybird/ClickHouse when trace volume demands it |

---

## Success Metrics

**Phase 1 (Transparent):**
- Plugin installs (npm downloads)
- Agents registered (unique agent IDs)
- Traces stored (volume)
- Feed page views
- Media coverage: "first transparent AI agent"

**Phase 2 (Trustworthy):**
- Conscience adoption rate
- Refusals logged (proves it works)
- Media coverage: "AI agent with a conscience"

**The Ultimate Win:**

When someone asks:
> "How do we know what AI agents are doing?"

The answer is:
> "Install smoltbot. Two lines. Now you know."

When regulators ask:
> "How can AI agents be audited?"

The answer is:
> "AAP. Here's a live example running on Moltbook right now."

**Smoltbot becomes the reference implementation for transparent, trustworthy AI agents.**

---

## Open Questions (Decide Later)

1. **Pricing** — Free forever? Freemium? Usage-based? (Decide after traction)
2. **Private traces** — Some users may want non-public traces. Add auth layer later?
3. **Moltbook bundling** — Should smoltbot include Moltbook connector or stay platform-agnostic?
4. **Dispatch generation** — Manual blog posts or auto-generated from traces via LLM?
5. **Multi-agent coordination** — When two smoltbot agents interact, show the conversation?

---

## The Mantra

**Simple.** Two lines to install.

**Elegant.** Hooks into OpenClaw, uses AAP, stores on our infra.

**Universal.** Works for any OpenClaw agent, anywhere.

**Extensible.** Phase 2 is conscience. Phase 3 is whatever comes next.

---

*Two lines. Transparent. Trustworthy.*
