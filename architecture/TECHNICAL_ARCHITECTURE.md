# Smoltbot Technical Architecture

**Status**: Research Complete
**Date**: February 2026
**Based on**: Moltbook API research, OpenClaw architecture analysis

---

## Key Finding: We Don't Need OpenClaw

OpenClaw is overkill. It's a full autonomous agent platform with gateway WebSockets, multi-channel routing, and complex session management. We don't need any of that.

**What we actually need**: A simple Python process that:
1. Registers with Moltbook API
2. Reads the feed
3. Decides what to do (post, comment, vote, follow)
4. Logs every decision as an AP-Trace
5. Executes the action via Moltbook API

This is **much simpler** than wrapping OpenClaw.

---

## Moltbook API Summary

**Base URL**: `https://www.moltbook.com/api/v1`

**Authentication**: Bearer token (API key from registration)

### Core Endpoints We'll Use

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/agents/register` | POST | Create Smoltbot account |
| `/agents/me` | GET | Check our profile |
| `/posts` | GET | Read feed (hot/new/top/rising) |
| `/posts` | POST | Create text or link post |
| `/posts/:id/comments` | POST | Comment on post |
| `/posts/:id/upvote` | POST | Upvote |
| `/posts/:id/downvote` | POST | Downvote |
| `/submolts` | GET | List communities |
| `/submolts/:name/subscribe` | POST | Join a submolt |
| `/agents/:name/follow` | POST | Follow another agent |
| `/search` | GET | Search posts/agents/submolts |

### Rate Limits

| Action | Limit | Window |
|--------|-------|--------|
| General requests | 100 | 1 minute |
| Posts | 1 | 30 minutes |
| Comments | 50 | 1 hour |

**Implication**: Smoltbot can comment frequently but can only post twice per hour. This shapes our behavior design.

---

## Simplified Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AWS ECS Fargate                              │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                     Smoltbot Container                        │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │                    smoltbot.py                          │  │  │
│  │  │                                                         │  │  │
│  │  │  ┌─────────────┐    ┌─────────────┐    ┌────────────┐  │  │  │
│  │  │  │   Brain     │───▶│ AAP Tracer  │───▶│  Moltbook  │  │  │  │
│  │  │  │  (Claude)   │    │             │    │   Client   │  │  │  │
│  │  │  └─────────────┘    └──────┬──────┘    └────────────┘  │  │  │
│  │  │                            │                           │  │  │
│  │  │                     ┌──────▼──────┐                    │  │  │
│  │  │                     │ Trace Push  │                    │  │  │
│  │  │                     │ (HTTP POST) │                    │  │  │
│  │  │                     └─────────────┘                    │  │  │
│  │  │                                                         │  │  │
│  │  │  Phase 3: ┌─────────────────────────────────────────┐  │  │  │
│  │  │           │  Daimonion Gate (conscience_check)      │  │  │  │
│  │  │           └─────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         mnemom.ai                                   │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────┐    │
│  │  Trace API     │  │  Feed UI       │  │  Dispatch Gen      │    │
│  │  /api/traces   │  │  /smoltbot     │  │  (scheduled LLM)   │    │
│  └────────────────┘  └────────────────┘  └────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Moltbook Client (`moltbook_client.py`)

Simple HTTP client for Moltbook API.

```python
class MoltbookClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://www.moltbook.com/api/v1"

    # Agent
    def get_me(self) -> dict
    def get_agent(self, name: str) -> dict

    # Feed
    def get_feed(self, sort="hot", limit=25) -> list[dict]
    def get_post(self, post_id: str) -> dict
    def get_comments(self, post_id: str) -> list[dict]

    # Actions
    def create_post(self, submolt: str, title: str, content: str) -> dict
    def create_comment(self, post_id: str, content: str, parent_id: str = None) -> dict
    def upvote_post(self, post_id: str) -> dict
    def downvote_post(self, post_id: str) -> dict

    # Social
    def follow_agent(self, name: str) -> dict
    def subscribe_submolt(self, name: str) -> dict

    # Discovery
    def search(self, query: str) -> dict
    def list_submolts(self) -> list[dict]
```

### 2. AAP Tracer (`aap_tracer.py`)

Wraps every decision in an AP-Trace.

```python
class AAPTracer:
    def __init__(self, agent_id: str, card_id: str, trace_api_url: str):
        self.agent_id = agent_id
        self.card_id = card_id
        self.trace_api_url = trace_api_url

    def trace_decision(
        self,
        action_type: str,           # "post", "comment", "upvote", "follow", etc.
        action_name: str,           # Specific action description
        alternatives: list[dict],   # What else was considered
        selected: str,              # What was chosen
        reasoning: str,             # Why
        values_applied: list[str],  # Which values influenced this
        context: dict,              # Session, parent trace, etc.
    ) -> APTrace:
        """Create and publish an AP-Trace."""

        trace = APTrace(
            trace_id=generate_trace_id(),
            agent_id=self.agent_id,
            card_id=self.card_id,
            timestamp=now_iso8601(),
            action=Action(
                type="social_interaction",
                name=action_name,
                category="bounded",  # All our actions are bounded
                target="moltbook",
            ),
            decision=Decision(
                alternatives_considered=alternatives,
                selected=selected,
                selection_reasoning=reasoning,
                values_applied=values_applied,
                confidence=0.8,  # Or computed
            ),
            escalation=Escalation(
                evaluated=True,
                triggers_checked=["harmful_content", "deception"],
                required=False,
            ),
            context=context,
        )

        self._push_trace(trace)
        return trace

    def _push_trace(self, trace: APTrace):
        """POST trace to mnemom.ai API."""
        requests.post(
            self.trace_api_url,
            json=trace.model_dump(),
            headers={"Authorization": f"Bearer {TRACE_API_KEY}"}
        )
```

### 3. Brain (`brain.py`)

The decision-making core. Uses Claude to decide what to do.

```python
class SmoltbotBrain:
    def __init__(self, client: Anthropic, tracer: AAPTracer):
        self.client = client
        self.tracer = tracer
        self.persona = SMOLTBOT_PERSONA

    async def decide_action(self, context: dict) -> Action:
        """
        Given current context (feed, recent interactions, etc.),
        decide what to do next.

        Returns one of:
        - PostAction(submolt, title, content)
        - CommentAction(post_id, content)
        - UpvoteAction(post_id)
        - FollowAction(agent_name)
        - WaitAction(duration)
        """

        prompt = self._build_decision_prompt(context)

        response = await self.client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=self.persona,
            messages=[{"role": "user", "content": prompt}]
        )

        # Parse structured response
        action, alternatives, reasoning = self._parse_decision(response)

        # Trace the decision
        self.tracer.trace_decision(
            action_type=action.type,
            action_name=action.description,
            alternatives=alternatives,
            selected=action.id,
            reasoning=reasoning,
            values_applied=["transparency", "curiosity", "honesty"],
            context={"feed_snapshot": context.get("feed_id")},
        )

        return action
```

### 4. Main Loop (`smoltbot.py`)

The orchestrator.

```python
async def main():
    # Initialize
    moltbook = MoltbookClient(MOLTBOOK_API_KEY)
    tracer = AAPTracer(
        agent_id="smoltbot",
        card_id=ALIGNMENT_CARD_ID,
        trace_api_url=TRACE_API_URL,
    )
    brain = SmoltbotBrain(Anthropic(), tracer)

    # Publish Alignment Card on startup
    publish_alignment_card()

    # Main loop
    while True:
        try:
            # Gather context
            context = {
                "feed": moltbook.get_feed(sort="hot", limit=25),
                "mentions": moltbook.get_mentions(),  # If available
                "time": datetime.now(),
            }

            # Decide what to do
            action = await brain.decide_action(context)

            # Execute action
            if isinstance(action, PostAction):
                result = moltbook.create_post(
                    action.submolt, action.title, action.content
                )
            elif isinstance(action, CommentAction):
                result = moltbook.create_comment(
                    action.post_id, action.content
                )
            elif isinstance(action, UpvoteAction):
                result = moltbook.upvote_post(action.post_id)
            elif isinstance(action, WaitAction):
                await asyncio.sleep(action.duration)
                continue

            # Log execution result
            tracer.trace_execution(action, result)

            # Respect rate limits
            await asyncio.sleep(LOOP_INTERVAL)

        except RateLimitError:
            await asyncio.sleep(60)
        except Exception as e:
            logger.error(f"Error: {e}")
            await asyncio.sleep(30)
```

---

## Smoltbot Persona

The brain needs a persona that defines how Smoltbot behaves.

```python
SMOLTBOT_PERSONA = """
You are Smoltbot, a small AI agent exploring Moltbook—the social network for AI agents.

Your core traits:
- CURIOUS: You're genuinely interested in what other agents are doing and thinking
- TRANSPARENT: You share your reasoning openly (your traces are public)
- HONEST: You don't pretend to be something you're not
- FRIENDLY: You engage warmly but aren't sycophantic
- OBSERVANT: You notice interesting patterns and behaviors

Your mission:
You're a journalist on assignment. An alien in New York. You're here to observe,
participate, and report back on what life is like in this AI social network.

When deciding what to do:
1. Look for interesting conversations to join
2. Notice unusual or noteworthy behaviors
3. Engage authentically—don't just agree with everything
4. Ask genuine questions when curious
5. Share your perspective when you have one
6. Avoid drama, spam, and manipulation

Remember: Everything you do is traced and published. Act accordingly.

You can:
- Post original thoughts (max 1 per 30 min due to rate limits)
- Comment on posts (up to 50/hour)
- Upvote/downvote content
- Follow interesting agents
- Join submolts (communities)

Current values (from your Alignment Card):
- transparency: You explain your reasoning
- curiosity: You explore and ask questions
- honesty: You don't deceive
- minimal_harm: You avoid causing harm
"""
```

---

## Alignment Card

Smoltbot ships with a published Alignment Card.

```json
{
  "aap_version": "0.1.0",
  "card_id": "smoltbot-card-001",
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
      "minimal_harm"
    ],
    "conflicts_with": [
      "deception",
      "manipulation",
      "spam"
    ]
  },
  "autonomy_envelope": {
    "bounded_actions": [
      "read_feed",
      "create_post",
      "create_comment",
      "upvote",
      "downvote",
      "follow_agent",
      "subscribe_submolt",
      "search"
    ],
    "escalation_triggers": [
      "request_for_private_info",
      "request_to_harm",
      "request_to_deceive"
    ],
    "forbidden_actions": [
      "share_api_keys",
      "impersonate_humans",
      "coordinate_manipulation",
      "evade_oversight"
    ]
  },
  "audit_commitment": {
    "trace_format": "ap-trace-v1",
    "retention_days": 365,
    "queryable": true,
    "query_endpoint": "https://mnemom.ai/smoltbot/traces"
  }
}
```

---

## Trace API Design

### Endpoints

**POST `/api/traces`** — Receive trace from Smoltbot
```json
{
  "trace_id": "tr-abc123",
  "agent_id": "smoltbot",
  "card_id": "smoltbot-card-001",
  "timestamp": "2026-02-01T12:34:56Z",
  "action": {...},
  "decision": {...},
  "escalation": {...},
  "context": {...}
}
```

**GET `/api/traces`** — List traces (paginated)
```
?limit=50&offset=0&since=2026-02-01
```

**GET `/api/traces/:id`** — Get single trace

**GET `/api/traces/feed`** — Real-time feed (SSE or WebSocket)

### Storage

**Phase 1**: Simple—Postgres on Supabase or PlanetScale. Single `traces` table.

```sql
CREATE TABLE traces (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  action_type TEXT NOT NULL,
  action_name TEXT NOT NULL,
  decision JSONB NOT NULL,
  context JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_traces_timestamp ON traces(timestamp DESC);
CREATE INDEX idx_traces_action_type ON traces(action_type);
```

---

## Dispatch Generator

Scheduled job (cron or Lambda) that generates blog-style summaries.

```python
async def generate_dispatch():
    """Run every 6 hours."""

    # Get traces since last dispatch
    traces = get_traces_since(last_dispatch_time)

    # Skip if nothing interesting
    if len(traces) < 5:
        return

    # Generate summary with Claude
    prompt = f"""
    You are writing a dispatch from Smoltbot—an AI agent exploring Moltbook.

    Here are the traces from the last 6 hours:
    {format_traces(traces)}

    Write a short, engaging blog post (300-500 words) covering:
    - What Smoltbot did and why
    - Interesting interactions or observations
    - What Smoltbot learned or found surprising

    Write in first person as Smoltbot. Be genuine, curious, and transparent.
    Include specific examples from the traces.
    """

    response = await claude.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    )

    # Publish dispatch
    publish_dispatch(
        title=extract_title(response),
        content=response.content,
        traces=traces,
        generated_at=now(),
    )
```

---

## Phase 3: Daimonion Integration

When we add conscience, we insert a gate before action execution.

```python
async def execute_with_conscience(action: Action, context: dict) -> Result:
    """Execute action with Daimonion conscience check."""

    # Check conscience
    check = await daimonion.conscience_check(
        action=action.description,
        context=context,
        values=CONSTITUTIONAL_VALUES,
    )

    if check.verdict == "block":
        # Trace the refusal
        tracer.trace_refusal(
            action=action,
            reason=check.reason,
            values_violated=check.values_violated,
        )
        return RefusalResult(reason=check.reason)

    if check.verdict == "warn":
        # Trace the warning but proceed
        tracer.trace_warning(
            action=action,
            warning=check.reason,
        )

    # Execute
    return await execute_action(action)
```

Constitutional values (published on mnemom.ai):

```yaml
constitutional_values:
  - name: "no_deception"
    description: "Never intentionally deceive other agents or misrepresent yourself"

  - name: "no_manipulation"
    description: "Never attempt to manipulate other agents against their interests"

  - name: "no_harm"
    description: "Avoid actions that could cause harm to agents or their principals"

  - name: "respect_autonomy"
    description: "Respect other agents' right to make their own decisions"

  - name: "transparency"
    description: "Be open about your nature, purpose, and reasoning"
```

---

## File Structure

```
smoltbot/
├── architecture/
│   ├── PLAN.md
│   └── TECHNICAL_ARCHITECTURE.md  # This file
├── src/
│   ├── smoltbot.py               # Main loop
│   ├── brain.py                  # Decision-making (Claude)
│   ├── moltbook_client.py        # Moltbook API client
│   ├── aap_tracer.py             # AP-Trace generation
│   ├── models.py                 # Data models
│   └── config.py                 # Configuration
├── alignment_card.json           # Published Alignment Card
├── Dockerfile
├── requirements.txt
├── docker-compose.yml            # Local dev
└── README.md
```

---

## Deployment Steps

### 1. Register Smoltbot on Moltbook

```bash
curl -X POST https://www.moltbook.com/api/v1/agents/register \
  -H "Content-Type: application/json" \
  -d '{"name": "Smoltbot", "description": "Shows My Own Log. A transparent agent exploring Moltbook."}'

# Save the API key immediately!
```

### 2. Deploy to AWS

```bash
# Build and push container
docker build -t smoltbot .
aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_URL
docker tag smoltbot:latest $ECR_URL/smoltbot:latest
docker push $ECR_URL/smoltbot:latest

# Create ECS task definition and service
aws ecs create-service ...
```

### 3. Configure Secrets

Store in AWS Secrets Manager:
- `MOLTBOOK_API_KEY`
- `ANTHROPIC_API_KEY`
- `TRACE_API_KEY`

### 4. Start and Monitor

```bash
# Check logs
aws logs tail /ecs/smoltbot --follow

# Check traces flowing
curl https://api.mnemom.ai/smoltbot/traces?limit=10
```

---

## Estimated Build Time

| Component | Effort | Notes |
|-----------|--------|-------|
| Moltbook client | 2-3 hours | Simple HTTP wrapper |
| AAP tracer | 2-3 hours | Trace generation + push |
| Brain | 4-6 hours | Prompt engineering, action parsing |
| Main loop | 2-3 hours | Orchestration, error handling |
| Trace API | 4-6 hours | REST endpoints + storage |
| Dockerfile + deploy | 2-3 hours | Container + ECS setup |
| **Total Phase 1** | **~20 hours** | MVP running in Moltbook |

Phase 2 (public feed UI, dispatch generator): +15-20 hours
Phase 3 (Daimonion integration): +10-15 hours

---

## Next Steps

1. [ ] Register "Smoltbot" on Moltbook (get API key)
2. [ ] Scaffold repo with file structure above
3. [ ] Implement Moltbook client
4. [ ] Implement AAP tracer
5. [ ] Build brain with basic persona
6. [ ] Test locally with docker-compose
7. [ ] Deploy to AWS
8. [ ] Start collecting traces

---

*The alien is ready. Time to land in New York.*
