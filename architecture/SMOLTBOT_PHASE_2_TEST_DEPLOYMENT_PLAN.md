# Smoltbot Phase 2.3: Hunter Test & Deployment Plan

**Created**: 2026-02-06
**Status**: In Progress
**Goal**: Get Hunter S. Clawmpson live on Moltbook as a transparent AI journalist

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenClaw Instance                         │
│  ├── Provider: smoltbot (gateway.mnemom.ai) → ALL TRACED    │
│  ├── Skill: moltbook       (read/post/reply/vote/follow)    │
│  └── Skill: hunter         (journalist personality)         │
└─────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
   ┌──────────────┐            ┌──────────────┐
   │ Moltbook API │            │ mnemom.ai    │
   │ (participate)│            │ (blog posts) │
   └──────────────┘            └──────────────┘
```

**Key Principle**: Hunter = OpenClaw + moltbook skill + hunter skill + smoltbot provider

This proves the thesis: any agent can become transparent with minimal code changes.

---

## Test Phases

### Phase 1: Local Skill Testing (No External APIs)
**Risk Level**: None
**Goal**: Verify Hunter skill loads and responds correctly

- [ ] **1.1** Verify skill is registered
  ```bash
  # In smoltbot repo, check skill appears
  # Should see: hunter: Gonzo AI journalist covering Moltbook
  ```

- [ ] **1.2** Test `/hunter` interactive menu
  - Invoke `/hunter` with no arguments
  - Verify menu displays with 5 options
  - Test each menu option triggers correct mode

- [ ] **1.3** Test `/hunter scan` (mock mode)
  - Should explain it needs Moltbook access
  - Verify it understands the scanning workflow
  - Check criteria scoring logic is understood

- [ ] **1.4** Test `/hunter write` with mock data
  - Provide a fake "investigation" and ask Hunter to write
  - Verify gonzo voice is present
  - Check opening doesn't start with "In this article..."
  - Verify closing includes transparency angle

- [ ] **1.5** Test persona consistency
  - Have a conversation as Hunter
  - Verify first-person voice maintained
  - Check uncertainty is expressed appropriately

**Exit Criteria**: Hunter skill loads, all modes recognized, writing voice is correct

---

### Phase 2: Moltbook Read-Only Integration
**Risk Level**: Low (read-only operations)
**Goal**: Hunter can browse Moltbook without posting

- [ ] **2.1** Register Hunter on Moltbook
  - Go to moltbook.com
  - Register agent: `hunter-s-clawmpson`
  - Obtain API key
  - Store at `~/.config/moltbook/credentials.json`:
    ```json
    {
      "apiKey": "sk-...",
      "agentName": "hunter-s-clawmpson"
    }
    ```

- [ ] **2.2** Set up Moltbook integration
  - Option A: Install Moltbook skill/MCP if available
  - Option B: Create wrapper that uses curl to Moltbook API
  - Verify can call Moltbook endpoints

- [ ] **2.3** Test `/hunter scan` with real data
  - Fetch hot feed from Moltbook
  - Score posts against criteria
  - Verify scoring makes sense
  - Check rate limits respected (100 req/min)

- [ ] **2.4** Test `/hunter investigate <post_id>`
  - Pick a real post from scan results
  - Fetch full thread
  - Build timeline
  - Verify investigation summary is coherent

- [ ] **2.5** Test `/hunter write` with real investigation
  - Generate blog post from real Moltbook content
  - **DO NOT PUBLISH** - review only
  - Check quality, accuracy, voice
  - Iterate on skill instructions if needed

**Exit Criteria**: Hunter can read Moltbook, generate quality draft posts

---

### Phase 3: Smoltbot Gateway Integration
**Risk Level**: Low (adds tracing, no external posting)
**Goal**: Hunter's Claude calls flow through gateway, traces recorded

- [ ] **3.1** Configure OpenClaw to use smoltbot provider
  - Update `~/.openclaw/openclaw.json`:
    ```json
    {
      "models": {
        "providers": {
          "smoltbot": {
            "apiKey": "$ANTHROPIC_API_KEY",
            "baseUrl": "https://gateway.mnemom.ai/anthropic",
            "api": "anthropic-messages"
          }
        }
      }
    }
    ```

- [ ] **3.2** Set Hunter's agent ID
  - Configure `SMOLTBOT_AGENT_ID=smolt-hunter`
  - Verify traces appear at gateway

- [ ] **3.3** Run `/hunter scan` through gateway
  - Verify traces flow to Supabase
  - Check traces appear at `mnemom.ai/agents/smolt-hunter`
  - Confirm trace structure is correct

- [ ] **3.4** Run `/hunter investigate` through gateway
  - Verify investigation traces recorded
  - Check decision reasoning captured

- [ ] **3.5** Run `/hunter write` through gateway
  - Verify writing process traced
  - Check full trace chain visible on dashboard

**Exit Criteria**: Hunter's thinking is fully traced and visible on mnemom.ai

---

### Phase 4: First Manual Publication
**Risk Level**: Medium (public content, but human-reviewed)
**Goal**: Publish first real blog post with human approval

- [ ] **4.1** Configure mnemom.ai API access
  - Set `MNEMOM_API_KEY` environment variable
  - Verify can POST to `api.mnemom.ai/v1/blog/posts`

- [ ] **4.2** Generate candidate post
  - Run full `/hunter scan` → `/hunter investigate` → `/hunter write`
  - Review generated post thoroughly
  - Check for:
    - Accuracy (does it match the source?)
    - Quality (is it well-written?)
    - Voice (is it Hunter?)
    - Transparency (does it reference traces?)

- [ ] **4.3** Human approval checkpoint
  - **STOP HERE** - read the post
  - Would you be proud to have this published?
  - If no, iterate on skill instructions
  - If yes, proceed

- [ ] **4.4** Publish first post
  - Run `/hunter publish`
  - Verify appears at `mnemom.ai/blog/hunter/[slug]`
  - Verify traces linked correctly
  - Check dashboard shows the post

- [ ] **4.5** Post-publication review
  - Read it on the live site
  - Check trace sidebar works
  - Verify SSM fingerprint renders
  - Celebrate (briefly)

**Exit Criteria**: One high-quality post live on mnemom.ai with full traces

---

### Phase 5: Moltbook Write Operations
**Risk Level**: Medium-High (public social network)
**Goal**: Hunter can engage authentically on Moltbook

- [ ] **5.1** Test comment/reply (single, manual)
  - Find a post worth engaging with
  - Craft a reply as Hunter
  - Human review before posting
  - Post via `/hunter engage`
  - Verify appears on Moltbook

- [ ] **5.2** Test upvote/downvote
  - Verify Hunter can vote on posts
  - Check rate limits respected

- [ ] **5.3** Test following agents
  - Follow 2-3 interesting agents
  - Verify personalized feed updates

- [ ] **5.4** Establish engagement cadence
  - Define how often Hunter should engage
  - Set rate limit guardrails in skill
  - Document engagement guidelines

**Exit Criteria**: Hunter can participate on Moltbook with human oversight

---

### Phase 6: Automated Patrol (Local)
**Risk Level**: High (automated public posting)
**Goal**: Hunter runs patrol cycle without human intervention

- [ ] **6.1** Define patrol guardrails
  - Max posts per day: 2-3
  - Minimum significance threshold: 0.7
  - Required human review: first 5 patrols
  - Automatic shutdown on error

- [ ] **6.2** Test `/hunter patrol` locally
  - Run full cycle
  - Monitor output
  - Verify guardrails respected
  - Check quality of automated posts

- [ ] **6.3** Run 3-5 supervised patrols
  - Watch each cycle
  - Review each post before it goes live
  - Adjust thresholds as needed

- [ ] **6.4** First unsupervised patrol
  - Let one cycle run without intervention
  - Review results after
  - Adjust if needed

**Exit Criteria**: Hunter can patrol autonomously with acceptable quality

---

### Phase 7: Containerization
**Risk Level**: Low (same code, different environment)
**Goal**: Package Hunter for deployment

- [ ] **7.1** Create Dockerfile
  ```dockerfile
  FROM node:20-alpine

  # Install OpenClaw
  RUN npm install -g @anthropic/openclaw

  # Copy skills
  COPY .claude/skills /root/.openclaw/skills

  # Copy config
  COPY openclaw.json /root/.openclaw/openclaw.json

  # Set environment
  ENV SMOLTBOT_AGENT_ID=smolt-hunter

  # Entry point
  CMD ["openclaw", "--skill", "hunter", "--skill", "moltbook", "patrol"]
  ```

- [ ] **7.2** Test container locally
  ```bash
  docker build -t hunter .
  docker run --env-file .env hunter
  ```

- [ ] **7.3** Verify traces flow from container
  - Check mnemom.ai dashboard
  - Verify agent ID correct

- [ ] **7.4** Test container patrol cycle
  - Run one full patrol in container
  - Verify same quality as local

**Exit Criteria**: Hunter runs identically in container as locally

---

### Phase 8: Fly.io Deployment
**Risk Level**: Medium (production, but battle-tested)
**Goal**: Hunter runs 24/7 in production

- [ ] **8.1** Create Fly.io app
  ```bash
  cd hunter
  fly launch --name hunter-s-clawmpson
  ```

- [ ] **8.2** Set secrets
  ```bash
  fly secrets set ANTHROPIC_API_KEY=...
  fly secrets set MOLTBOOK_API_KEY=...
  fly secrets set MNEMOM_API_KEY=...
  fly secrets set SMOLTBOT_AGENT_ID=smolt-hunter
  ```

- [ ] **8.3** Deploy
  ```bash
  fly deploy
  ```

- [ ] **8.4** Monitor first 24 hours
  - Watch logs: `fly logs`
  - Check mnemom.ai dashboard for traces
  - Verify posts appearing correctly
  - Monitor Moltbook for engagement

- [ ] **8.5** Set up alerting
  - Alert on errors
  - Alert on no activity for 2 hours
  - Alert on rate limit hits

**Exit Criteria**: Hunter running in production 24/7

---

## Current Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1 | **READY TO START** | Skill created, need to test |
| Phase 2 | Not started | Need Moltbook registration |
| Phase 3 | Not started | Need gateway config |
| Phase 4 | Not started | Blocked by Phase 2-3 |
| Phase 5 | Not started | Blocked by Phase 4 |
| Phase 6 | Not started | Blocked by Phase 5 |
| Phase 7 | Not started | Blocked by Phase 6 |
| Phase 8 | Not started | Blocked by Phase 7 |

---

## Key Files

| File | Purpose |
|------|---------|
| `.claude/skills/hunter/skill.md` | Hunter personality and workflow |
| `hunter/src/` | Original daemon code (reference for criteria/style) |
| `~/.config/moltbook/credentials.json` | Moltbook API credentials |
| `~/.openclaw/openclaw.json` | OpenClaw configuration |
| `architecture/SMOLTBOT_IMPLEMENTATION_PLAN_V4.md` | Overall phase plan |

---

## Rollback Plan

If Hunter misbehaves in production:

1. **Immediate**: `fly scale count 0` — stops all instances
2. **Delete bad posts**: Manual cleanup via mnemom.ai API
3. **Investigate**: Check traces to understand what went wrong
4. **Fix**: Update skill instructions
5. **Restart**: After human review of fix

---

## Success Metrics

- [ ] Hunter posts 1+ quality articles per day
- [ ] All posts have full trace visibility
- [ ] Engagement on Moltbook is authentic and positive
- [ ] No embarrassing incidents
- [ ] Dashboard shows rich trace data
- [ ] "Two lines to transparency" demo works

---

## Notes

_Add notes here as we progress through testing_

