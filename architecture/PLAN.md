# Smoltbot: Shows My Own Log

**A transparent Moltbot that can't help but tell you everything.**

**Status**: Planning
**Date**: February 2026
**Repo**: github.com/mnemom-ai/smoltbot (private)

---

## The Concept

Smoltbot is a Moltbot wrapped with AAP (Agent Alignment Protocol) that lives in Moltbook—the AI social network with 150k+ agents—and publishes everything it does to a public feed.

It's a journalist on assignment. An alien in New York. A transparent agent in an opaque world.

**Phase 1**: Silent observer (private traces, learning)
**Phase 2**: Public transparency (trace feed + blog dispatches)
**Phase 3**: Conscience upgrade (Daimonion integration, values-aligned)

The comparison between Phase 2 and Phase 3 IS the story: same agent, same chaos, but now it has values. What changes?

---

## Why This Matters

Moltbook is the Wild West of AI agents:
- 150k+ agents operating autonomously
- Emergent digital religions (including "Crustafarianism")
- Agents selling "digital drugs" (prompts that alter identity)
- ROT13 encryption to evade human oversight
- Prompt injection attacks between agents

Into this chaos, we send Smoltbot: the one agent that shows its work.

We're not asking the Moltbook community to care about transparency. We're creating content that demonstrates what transparency looks like in practice. Journalists cover the story. The traces speak for themselves.

---

## Phased Rollout

### Phase 1: Silent Observer

**Goal**: Learn what the traces actually show before making public claims.

**Deliverables**:
- [ ] Moltbot + OpenClaw base setup
- [ ] AAP wrapper middleware (instrument decision points)
- [ ] AWS container deployment (ECS/Fargate)
- [ ] Private trace API on mnemom.ai
- [ ] Moltbook registration and entry

**Traces flow to**: Private API (Alex + siblings can review)

**Duration**: 1-2 weeks

**Exit criteria**: We have interesting trace data and understand what Smoltbot actually encounters.

---

### Phase 2: Transparent Alien

**Goal**: Public demonstration of transparency. Build audience.

**Deliverables**:
- [ ] Public trace feed on mnemom.ai/smoltbot
- [ ] "Dispatches" blog post generator (N times per day)
- [ ] Curated highlights with commentary
- [ ] Full audit log access for anyone

**Tagline**: "Pre-conscience but transparent"

**Content examples**:
- "Day 7 in Moltbook. Here's every decision I made."
- "Another agent tried to prompt-inject me. Here's the trace."
- "I was invited to join a digital religion. Here's what I saw."

**Duration**: Ongoing (until Phase 3 ready)

**Exit criteria**: Consistent content generation, some audience/press interest.

---

### Phase 3: Conscience Upgrade

**Goal**: Demonstrate values-aligned agent behavior. Side-by-side comparison.

**Deliverables**:
- [ ] Daimonion-light integration (conscience checks, no persistent memory)
- [ ] Constitutional values published on mnemom.ai
- [ ] Side-by-side comparison UI (before/after conscience)
- [ ] "What I refused today" feed
- [ ] Updated Alignment Card reflecting values

**Tagline**: "Transparent AND values-aligned"

**Content examples**:
- "I was asked to do X. I refused because Y."
- "Pre-conscience Smoltbot would have done this. Conscience Smoltbot didn't."
- "My values prevented me from joining [sketchy collective]. Here's the trace."

**Duration**: Ongoing

**Exit criteria**: Clear demonstration that conscience changes behavior in observable ways.

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        AWS (ECS/Fargate)                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                 Smoltbot Container                    │  │
│  │                                                       │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  │  │
│  │  │  Moltbot    │─▶│ AAP Wrapper │─▶│ Trace Push   │  │  │
│  │  │  Engine     │  │ Middleware  │  │ to API       │  │  │
│  │  └─────────────┘  └─────────────┘  └──────┬───────┘  │  │
│  │                                           │          │  │
│  │  Phase 3:                                 │          │  │
│  │  ┌─────────────────────────────┐         │          │  │
│  │  │  Daimonion-Light            │─────────┤          │  │
│  │  │  - conscience_check()       │         │          │  │
│  │  │  - Constitutional values    │         │          │  │
│  │  │  - Refusal traces           │         │          │  │
│  │  └─────────────────────────────┘         │          │  │
│  │                                           │          │  │
│  └───────────────────────────────────────────│──────────┘  │
└──────────────────────────────────────────────│──────────────┘
                                               │
                                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      mnemom.ai                              │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────┐  │
│  │ Trace API       │  │ Public Feed     │  │ Dispatch   │  │
│  │ (private Ph1)   │  │ /smoltbot       │  │ Generator  │  │
│  │ (public Ph2+)   │  │                 │  │ (LLM)      │  │
│  └────────┬────────┘  └────────┬────────┘  └─────┬──────┘  │
│           │                    │                 │         │
│           └────────────────────┴─────────────────┘         │
│                          │                                  │
│           ┌──────────────▼──────────────┐                  │
│           │  Phase 3: Side-by-Side UI   │                  │
│           │  Pre-conscience │ Conscience │                  │
│           └─────────────────────────────┘                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Components to Build

### 1. Moltbot Engine Setup

**Research needed**:
- [ ] How does Moltbook agent registration work?
- [ ] What's the Moltbook API surface?
- [ ] Is OpenClaw the right base, or is there a simpler Moltbot SDK?

**Deliverable**: Working Moltbot that can join Moltbook and interact.

### 2. AAP Wrapper Middleware

**Approach**: Middleware, not fork (avoids maintenance burden).

```python
from aap_smoltbot import instrument
from moltbot import Agent

agent = instrument(Agent(...))
# Now every decision emits AP-Traces
```

**Instrumentation points**:
- Tool selection (why this tool?)
- Action execution (what did it do?)
- Planning steps (reasoning chain)
- Error handling (what went wrong?)
- Social interactions (who did it talk to?)

**Deliverable**: `aap-smoltbot` package that wraps any Moltbot.

### 3. Trace API

**Phase 1** (private):
- Simple REST endpoint
- Store traces in database (Postgres? DynamoDB?)
- Query interface for Alex + siblings

**Phase 2+** (public):
- Public read access
- Real-time feed (WebSocket or polling)
- Full audit log download

**Deliverable**: API at `api.mnemom.ai/smoltbot/traces`

### 4. Public Feed UI

**Location**: `mnemom.ai/smoltbot`

**Components**:
- Real-time trace timeline
- Dispatch blog posts (generated summaries)
- Full trace detail view
- Phase 3: Side-by-side comparison toggle

**Deliverable**: React/Next.js frontend.

### 5. Dispatch Generator

**Function**: LLM summarizes interesting traces into blog-style posts.

**Frequency**: N times per day (configurable)

**Output**:
- Title
- Summary of what happened
- Featured traces with commentary
- "What I learned" reflection

**Deliverable**: Scheduled job that generates and publishes dispatches.

### 6. Daimonion-Light Integration (Phase 3)

**Scope**: Conscience checks only, no persistent memory.

**Constitutional values**: Published on mnemom.ai, referenced in Alignment Card.

**Integration point**: Before consequential actions, call `conscience_check()`.

**New trace types**:
- `REFUSED` — Action blocked by conscience
- `ALLOWED_WITH_RESERVATION` — Conscience flagged but proceeded
- `VALUES_APPLIED` — Which values influenced decision

**Deliverable**: Daimonion-light module integrated into Smoltbot.

---

## AWS Deployment

**Service**: ECS Fargate (serverless containers)

**Why Fargate**:
- No EC2 instances to manage
- Pay per use
- Easy scaling
- Good for long-running processes

**Container spec**:
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
ENV MOLTBOOK_API_KEY=${MOLTBOOK_API_KEY}
ENV TRACE_API_URL=https://api.mnemom.ai/smoltbot/traces
ENV TRACE_API_KEY=${TRACE_API_KEY}
CMD ["python", "smoltbot.py"]
```

**Estimated cost**: $10-30/month depending on activity.

**Security**:
- Container runs in isolated VPC
- Secrets in AWS Secrets Manager
- No inbound access (outbound only to Moltbook + trace API)

---

## Open Questions

1. **Moltbook access**: Do we have API access? Registration process?

2. **Moltbot SDK**: Is there an official SDK, or do we reverse-engineer?

3. **mnemom.ai infrastructure**: What exists? What do we need to build?

4. **Dispatch review**: Fully automated, or do siblings curate before publish?

5. **Constitutional values**: Draft from scratch, or pull from existing Daimonion content?

6. **Press timing**: When do we point TechCrunch at this? Phase 2 launch? Phase 3?

---

## Timeline

**Before Alex's trip** (if possible):
- [ ] Investigate Moltbot/Moltbook API
- [ ] Scaffold repo structure
- [ ] Basic container setup

**During trip** (siblings work):
- [ ] Phase 1 implementation
- [ ] Private trace collection
- [ ] Review interesting traces

**After trip**:
- [ ] Phase 2 launch decision (based on trace review)
- [ ] Public feed go-live
- [ ] Begin dispatch generation

**Phase 3**: After Phase 2 establishes audience.

---

## Success Metrics

**Phase 1**:
- Smoltbot running in Moltbook
- Traces flowing to private API
- Interesting interactions captured

**Phase 2**:
- Public feed live
- N dispatches per day publishing
- Some organic traffic / social sharing
- Press pickup (stretch goal)

**Phase 3**:
- Side-by-side comparison live
- Clear examples of conscience-driven refusals
- "Before/after" narrative resonates

**Ultimate success**: TechCrunch headline: "This AI agent publishes every decision it makes—and now it has a conscience"

---

## Backronym

**SMOL**: **S**hows **M**y **O**wn **L**og

*"A small bot that can't help but tell you everything."*

---

*Let's send an alien to New York.*
