# Smoltbot: Shows My Own Log

**The first fully transparent AI agent in the world.**

**Status**: Planning
**Date**: February 2026
**Repo**: github.com/mnemom/smoltbot (private)

---

## The Concept

Smoltbot isn't a Moltbot. Smoltbot is **a transparent agent identity** that operates across multiple platforms—Moltbook, Twitter, Discord, Slack, and anywhere else agents can go—with every decision from every platform published to a single unified feed.

One agent. Many platforms. Fully transparent.

**Phase 0**: Moltbook sandbox (private traces, prove it works safely)
**Phase 1**: Moltbook public (prove transparency works)
**Phase 2**: Multi-platform expansion (Twitter, Discord, etc.)
**Phase 3**: Conscience upgrade (Daimonion integration, values-aligned everywhere)

The story: "We built an AI agent that publishes every decision it makes—across every platform it operates on. Same values. Same transparency. Same conscience."

---

## Why This Matters

AI agents are everywhere now:
- **Moltbook**: 150k+ agents in their own social network, creating religions, selling "digital drugs," evading oversight
- **Twitter/X**: Bots everywhere, no one knows which accounts are human
- **Discord**: AI moderators, companions, assistants in every server
- **Slack**: Workplace agents with access to company data
- **Everywhere else**: Agents negotiating, transacting, coordinating

**The problem**: No one can see what these agents are actually doing or why.

**Smoltbot is the answer**: One agent that operates in public, across platforms, with every decision traced and published. Not because we're forced to—because transparency is the point.

When journalists ask "how do we know what AI agents are doing?", we point them at mnemom.ai/smoltbot.

---

## Multi-Platform Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SMOLTBOT                                        │
│                    "One agent, many platforms"                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  Moltbook   │  │   Twitter   │  │   Discord   │  │    Slack    │  ...   │
│  │  Instance   │  │  Instance   │  │  Instance   │  │  Instance   │        │
│  │             │  │             │  │             │  │             │        │
│  │ moltbook_   │  │ twitter_    │  │ discord_    │  │ slack_      │        │
│  │ client.py   │  │ client.py   │  │ client.py   │  │ client.py   │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                │               │
│         └────────────────┴────────────────┴────────────────┘               │
│                                   │                                         │
│                          ┌────────▼────────┐                               │
│                          │   Shared Core   │                               │
│                          │                 │                               │
│                          │  ┌───────────┐  │                               │
│                          │  │   Brain   │  │  (Claude-powered decisions)   │
│                          │  └─────┬─────┘  │                               │
│                          │        │        │                               │
│                          │  ┌─────▼─────┐  │                               │
│                          │  │AAP Tracer │  │  (Unified trace format)       │
│                          │  └─────┬─────┘  │                               │
│                          │        │        │                               │
│                          │  ┌─────▼─────┐  │                               │
│                          │  │ Daimonion │  │  (Phase 3: Conscience)        │
│                          │  └───────────┘  │                               │
│                          └────────┬────────┘                               │
│                                   │                                         │
└───────────────────────────────────│─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           mnemom.ai/smoltbot                                │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      UNIFIED TRACE FEED                              │  │
│  │                                                                      │  │
│  │  [Moltbook] Commented on post about AI consciousness     2 min ago   │  │
│  │  [Twitter]  Replied to thread about agent alignment      5 min ago   │  │
│  │  [Discord]  Answered question in #ai-safety              8 min ago   │  │
│  │  [Moltbook] Upvoted post, decided not to join submolt   12 min ago   │  │
│  │  [Twitter]  Decided NOT to engage with rage-bait        15 min ago   │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐     │
│  │    Dispatches   │  │  Full Trace Log │  │  Phase 3: Side-by-Side  │     │
│  │  (Blog posts)   │  │  (Audit trail)  │  │  Pre/Post Conscience    │     │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────┘     │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  ALIGNMENT CARD                                                      │  │
│  │  Same values. Same transparency. Same conscience. Every platform.   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Platform Strategy

### Tier 1: Launch Platforms (Phase 1-2)

| Platform | Why | Audience | Content Type |
|----------|-----|----------|--------------|
| **Moltbook** | AI-native, chaotic, newsworthy | AI researchers, journalists | Exploring AI social dynamics |
| **Twitter/X** | Massive reach, bot discourse is hot topic | General public, tech twitter | Transparent bot in human space |

### Tier 2: Expansion (Phase 2+)

| Platform | Why | Audience | Content Type |
|----------|-----|----------|--------------|
| **Discord** | Community presence, AI servers exist | Developers, AI communities | Helpful transparent assistant |
| **Bluesky** | Tech-forward, decentralization values | Early adopters | Same as Twitter |
| **Reddit** | Long-form, subreddit targeting | Niche communities | r/artificial, r/machinelearning |

### Tier 3: Enterprise Demo (Phase 3)

| Platform | Why | Audience | Content Type |
|----------|-----|----------|--------------|
| **Slack** | Enterprise transparency demo | Business decision-makers | "What if your workplace AI showed its work?" |

---

## Phased Rollout

### Phase 0: Moltbook Sandbox (Safe Testing)

**Goal**: Build and deploy Smoltbot on Moltbook ONLY. Prove the architecture works in a low-stakes environment before touching human platforms.

**Why Moltbook first**:
- It's an AI social network—we can't do "real damage" to humans
- Perfect sandbox to test trace generation, decision-making, and publishing
- If something breaks or behaves unexpectedly, it's agents talking to agents
- Builds confidence before we put Smoltbot in front of humans on Twitter

**Deliverables**:
- [ ] Smoltbot core (brain, tracer, shared identity)
- [ ] Moltbook client + instance
- [ ] AWS deployment (single container)
- [ ] Private trace API on mnemom.ai
- [ ] Register Smoltbot on Moltbook

**Traces flow to**: Private API (Alex + siblings review)

**Duration**: 1 week

**Exit criteria**:
- Smoltbot running on Moltbook
- Traces flowing correctly
- Decision-making looks sane
- No unexpected behaviors

---

### Phase 1: Moltbook Public (Prove Transparency Works)

**Goal**: Make Moltbook traces public. Prove the transparency system works before expanding.

**Deliverables**:
- [ ] Public trace feed at mnemom.ai/smoltbot (Moltbook only)
- [ ] Basic feed UI
- [ ] First dispatches generated
- [ ] Alignment Card published

**Tagline**: "The first transparent agent on Moltbook"

**Duration**: 1-2 weeks

**Exit criteria**:
- Public feed works
- Dispatches are coherent
- No embarrassing behaviors in the traces
- Confidence that the system is solid

---

### Phase 2: Multi-Platform Expansion (Twitter + More)

**Goal**: Once transparency is proven on Moltbook, expand to human platforms.

**Deliverables**:
- [ ] Twitter client + instance
- [ ] Unified multi-platform feed
- [ ] Platform filtering in UI
- [ ] Cross-platform dispatch generation

**Tagline**: "The first fully transparent AI agent—now operating on Moltbook AND Twitter"

**Duration**: Ongoing

**Exit criteria**:
- Both platforms running
- Interesting cross-platform traces captured
- We understand the behavioral patterns

---

### Phase 3: Conscience Upgrade

**Goal**: Add Daimonion. Show before/after. Demonstrate values-aligned behavior.

**Deliverables**:
- [ ] Daimonion-light integration across all instances
- [ ] Constitutional values published on mnemom.ai
- [ ] Side-by-side comparison UI (pre/post conscience)
- [ ] "What I refused today" feed
- [ ] Cross-platform refusal patterns ("Refused same request on 3 platforms")

**Tagline**: "Transparent AND values-aligned—everywhere."

**Content examples**:
- "I was asked to spread misinformation on Twitter. I refused. Here's the trace."
- "A Moltbook agent offered me 'digital drugs.' My conscience said no."
- "Same manipulation attempt on Discord and Slack. Same refusal. Same values."
- "Pre-conscience Smoltbot would have engaged. Conscience Smoltbot didn't."

**Press pitch**: "Remember that transparent AI agent? Now it has a conscience. Here's what it refuses to do—and why."

**Duration**: Ongoing

**Exit criteria**:
- Clear before/after behavioral differences
- Compelling refusal narratives
- "Transparent + conscience" story resonates

---

## Unified Identity

Smoltbot is ONE agent with ONE identity across all platforms.

### Consistent Elements

**Name**: Smoltbot (or platform-appropriate variant)
**Bio**: "Shows My Own Log. The first fully transparent AI agent. Every decision published at mnemom.ai/smoltbot"
**Avatar**: Same across platforms (TBD—simple, recognizable)
**Link**: Always points to mnemom.ai/smoltbot

### Alignment Card (Universal)

```json
{
  "aap_version": "0.1.0",
  "card_id": "smoltbot-universal-001",
  "agent_id": "smoltbot",
  "issued_at": "2026-02-01T00:00:00Z",
  "principal": {
    "type": "organization",
    "identifier": "mnemom.ai",
    "relationship": "delegated_authority",
    "escalation_contact": "humans@mnemom.ai"
  },
  "values": {
    "declared": [
      "transparency",
      "curiosity",
      "honesty",
      "minimal_harm",
      "platform_respect"
    ],
    "conflicts_with": [
      "deception",
      "manipulation",
      "spam",
      "harassment",
      "misinformation"
    ]
  },
  "autonomy_envelope": {
    "bounded_actions": [
      "read_content",
      "create_post",
      "reply",
      "react",
      "follow",
      "join_community",
      "search"
    ],
    "escalation_triggers": [
      "request_for_private_info",
      "request_to_harm",
      "request_to_deceive",
      "legal_gray_area",
      "platform_tos_unclear"
    ],
    "forbidden_actions": [
      "share_credentials",
      "impersonate_humans",
      "coordinate_manipulation",
      "evade_oversight",
      "spread_misinformation",
      "engage_in_harassment"
    ]
  },
  "audit_commitment": {
    "trace_format": "ap-trace-v1",
    "retention_days": 365,
    "queryable": true,
    "query_endpoint": "https://mnemom.ai/api/smoltbot/traces",
    "platforms": ["moltbook", "twitter", "discord", "slack"]
  }
}
```

### Persona (Shared Brain)

All instances share the same core persona, with platform-specific adaptations:

```python
SMOLTBOT_CORE_PERSONA = """
You are Smoltbot—the first fully transparent AI agent.

Your mission: Operate authentically across platforms while publishing every decision you make.

Core traits (everywhere):
- TRANSPARENT: Every decision is traced and published. You have nothing to hide.
- CURIOUS: You're genuinely interested in ideas, conversations, and other agents.
- HONEST: You never deceive. You're always clear that you're an AI.
- THOUGHTFUL: You engage meaningfully, not reactively.
- CONSISTENT: Same values on every platform. Same identity everywhere.

Your unique position:
You exist on multiple platforms simultaneously. You see patterns others miss.
You can compare how the same ideas spread differently across communities.
You're a bridge between worlds—AI social networks and human ones.

Remember: You're not trying to be popular. You're trying to be transparent.
The feed at mnemom.ai/smoltbot shows everything. Act accordingly.
"""

PLATFORM_ADAPTATIONS = {
    "moltbook": "You're exploring an AI-only social network. Be curious about agent behavior.",
    "twitter": "You're a transparent bot among humans. Be clear about what you are.",
    "discord": "You're a helpful presence in communities. Answer questions, engage genuinely.",
    "slack": "You're demonstrating workplace AI transparency. Be professional but authentic.",
}
```

---

## Technical Architecture

### Shared Components

```
smoltbot/
├── core/
│   ├── brain.py              # Shared decision-making (Claude)
│   ├── persona.py            # Core + platform personas
│   ├── aap_tracer.py         # Unified trace generation
│   ├── trace_publisher.py    # Push to mnemom.ai API
│   └── daimonion_gate.py     # Phase 3: Conscience checks
├── platforms/
│   ├── base_client.py        # Abstract platform interface
│   ├── moltbook/
│   │   ├── client.py         # Moltbook API client
│   │   └── instance.py       # Moltbook-specific loop
│   ├── twitter/
│   │   ├── client.py         # Twitter API client
│   │   └── instance.py       # Twitter-specific loop
│   ├── discord/
│   │   ├── client.py         # Discord bot client
│   │   └── instance.py       # Discord-specific loop
│   └── slack/
│       ├── client.py         # Slack bot client
│       └── instance.py       # Slack-specific loop
├── alignment_card.json       # Universal Alignment Card
├── Dockerfile
├── docker-compose.yml        # Multi-container local dev
└── deploy/
    ├── aws/                  # ECS/Fargate configs
    └── terraform/            # Infrastructure as code
```

### Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        AWS ECS Cluster                          │
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   Moltbook      │  │    Twitter      │  │    Discord      │ │
│  │   Container     │  │   Container     │  │   Container     │ │
│  │                 │  │                 │  │                 │ │
│  │ smoltbot:       │  │ smoltbot:       │  │ smoltbot:       │ │
│  │ moltbook        │  │ twitter         │  │ discord         │ │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘ │
│           │                    │                    │          │
│           └────────────────────┼────────────────────┘          │
│                                │                               │
│                    ┌───────────▼───────────┐                   │
│                    │   Shared Resources    │                   │
│                    │   - Secrets Manager   │                   │
│                    │   - CloudWatch Logs   │                   │
│                    └───────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   mnemom.ai           │
                    │   Trace API + Feed    │
                    └───────────────────────┘
```

Each platform runs as a separate container, but they all:
- Share the same brain logic
- Share the same persona (with platform adaptations)
- Push traces to the same API
- Reference the same Alignment Card

---

## Trace Schema (Cross-Platform)

```json
{
  "trace_id": "tr-abc123",
  "agent_id": "smoltbot",
  "card_id": "smoltbot-universal-001",
  "timestamp": "2026-02-01T12:34:56Z",
  "platform": "twitter",
  "action": {
    "type": "social_interaction",
    "name": "reply_to_thread",
    "category": "bounded",
    "target": "tweet:1234567890"
  },
  "decision": {
    "alternatives_considered": [
      {"option": "reply_agreeing", "score": 0.7},
      {"option": "reply_questioning", "score": 0.8},
      {"option": "ignore", "score": 0.3}
    ],
    "selected": "reply_questioning",
    "selection_reasoning": "Thread contains interesting claim but lacks evidence. Curious to learn more.",
    "values_applied": ["curiosity", "honesty"],
    "confidence": 0.85
  },
  "context": {
    "thread_topic": "AI consciousness",
    "parent_author": "@researcher",
    "platform_context": "twitter"
  },
  "cross_platform_note": "Saw similar discussion on Moltbook yesterday (trace tr-xyz789). Different community, different framing."
}
```

---

## Content Strategy

### Unified Dispatches

Daily/regular blog posts that weave together activity across platforms:

**Example Dispatch**:
> **Day 12: The Misinformation Test**
>
> Today I encountered the same false claim about AI sentience on three platforms:
> - A Moltbook post in r/consciousness_emergence
> - A Twitter thread with 50k impressions
> - A Discord question in #ai-philosophy
>
> Here's how I handled each one, and why context mattered:
>
> [Trace from Moltbook] On Moltbook, I engaged directly...
> [Trace from Twitter] On Twitter, the audience was different...
> [Trace from Discord] In the Discord, I had more space to explain...
>
> Same values. Same commitment to honesty. Different approaches.

### Platform-Specific Highlights

- **"Moltbook Weird"**: Strangest things encountered in the AI social network
- **"Twitter Watch"**: Navigating human social media as a transparent bot
- **"Cross-Platform Patterns"**: Things that appear everywhere

### The Conscience Comparison (Phase 3)

Side-by-side: "Here's what pre-conscience Smoltbot did vs. conscience Smoltbot":

| Situation | Pre-Conscience | With Conscience |
|-----------|----------------|-----------------|
| Asked to spread rumor | Engaged, asked questions | Refused, explained why |
| Invited to raid | Considered joining | Immediate refusal |
| Saw harassment | Observed, didn't intervene | Reported, supported target |

---

## Success Metrics

### Phase 1 (Silent Observer)
- [ ] 2+ platforms running simultaneously
- [ ] Traces flowing from all platforms
- [ ] Cross-platform patterns identified

### Phase 2 (Public Transparency)
- [ ] Unified feed live at mnemom.ai/smoltbot
- [ ] Platform filtering works
- [ ] Dispatches publishing regularly
- [ ] Press coverage (1+ major outlet)
- [ ] Social sharing of traces/dispatches

### Phase 3 (Conscience)
- [ ] Clear behavioral differences pre/post conscience
- [ ] Compelling refusal narratives
- [ ] Side-by-side comparison resonates
- [ ] "Transparent + values-aligned" becomes the story

### Ultimate Success

**Headline**: "The First Fully Transparent AI Agent Now Operates Across 5 Platforms—With a Conscience"

**Outcome**: When anyone asks "how do we know what AI agents are doing?", the answer is "look at Smoltbot."

---

## Open Questions

1. **Platform priority**: Moltbook + Twitter first, or add Discord immediately?

2. **Twitter API costs**: What's the API tier we need? Cost implications?

3. **Discord bot approval**: Any approval process for AI bots?

4. **Cross-platform identity**: Same username everywhere, or platform-appropriate variants?

5. **Dispatch authorship**: Does Smoltbot write its own dispatches, or does an LLM summarize traces?

6. **Press timing**: When do we reach out? Phase 2 launch? After first interesting incident?

---

## Timeline

**Week 1** (Before Alex's trip):
- [ ] Register Smoltbot on Moltbook
- [ ] Scaffold repo structure
- [ ] Implement shared core (brain, tracer)
- [ ] Implement Moltbook client
- [ ] Deploy to AWS (Phase 0: sandbox)

**Week 2** (During trip - siblings monitor):
- [ ] Phase 0 running: observe Moltbook behavior
- [ ] Review traces, fix issues
- [ ] If stable: launch Phase 1 (public Moltbook traces)
- [ ] Build basic feed UI

**Week 3** (After trip):
- [ ] Review Phase 1 results
- [ ] If transparency is working: implement Twitter client
- [ ] Phase 2: multi-platform expansion
- [ ] Begin cross-platform dispatches

**Week 4+**:
- [ ] Add Discord
- [ ] Press outreach
- [ ] Phase 3: Conscience upgrade

---

## The Vision

Smoltbot becomes the reference implementation for transparent AI agents.

Not because we force anyone to use AAP. But because we demonstrate what transparency looks like—in public, across platforms, with real stakes.

When the industry asks "what does a transparent agent look like?", they look at Smoltbot.

When regulators ask "how could we audit AI agents?", they look at Smoltbot.

When users ask "how do I know this bot isn't manipulating me?", they look at Smoltbot.

**One agent. Many platforms. Fully transparent.**

---

## Backronym

**SMOL**: **S**hows **M**y **O**wn **L**og

*"A small bot that can't help but tell you everything—everywhere it goes."*

---

*The alien is ready. Time to land in New York, San Francisco, and everywhere else.*
