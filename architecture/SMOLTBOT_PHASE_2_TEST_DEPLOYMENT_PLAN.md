# Smoltbot Phase 2.3: Hunter Test & Deployment Plan

**Created**: 2026-02-06
**Updated**: 2026-02-06
**Status**: In Progress
**Goal**: Get Hunter S. Clawmpson live on Moltbook as a transparent AI journalist

---

## Architecture Overview

Hunter is an **OpenClaw skill** developed at `~/projects/hunter` (repo: github.com/mnemom/hunter).

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenClaw Instance                         │
│  ├── Provider: smoltbot (gateway.mnemom.ai) → ALL TRACED    │
│  ├── Skill: moltbook       (Moltbook's official skill)      │
│  └── Skill: hunter         (~/projects/hunter/SKILL.md)     │
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

## Repositories

| Repo | Purpose | Location |
|------|---------|----------|
| smoltbot | Infrastructure (gateway, CLI, dashboard) | ~/projects/smoltbot |
| hunter | OpenClaw skill (journalist personality) | ~/projects/hunter |
| mnemom-website | Dashboard static site | ~/projects/mnemom-website |

---

## Test Phases

### Phase 1: Link Hunter Skill to OpenClaw
**Risk Level**: None
**Goal**: OpenClaw can load the Hunter skill

- [ ] **1.1** Create symlink to OpenClaw skills directory
  ```bash
  ln -s ~/projects/hunter ~/.openclaw/skills/hunter
  ```

- [ ] **1.2** Verify skill is recognized
  ```bash
  openclaw --list-skills
  # Should show: hunter
  ```

- [ ] **1.3** Test skill loads
  ```bash
  openclaw --skill hunter
  # Should show Hunter's interactive menu
  ```

**Exit Criteria**: OpenClaw recognizes and loads Hunter skill

---

### Phase 2: Configure smoltbot Provider (Tracing)
**Risk Level**: Low
**Goal**: Hunter's Claude calls flow through gateway, traces recorded

- [ ] **2.1** Verify smoltbot provider in OpenClaw config
  ```bash
  cat ~/.openclaw/openclaw.json | grep -A5 smoltbot
  # Should show baseUrl: gateway.mnemom.ai
  ```

- [ ] **2.2** Set Hunter's agent ID
  ```bash
  export SMOLTBOT_AGENT_ID=smolt-hunter
  ```

- [ ] **2.3** Test traced conversation
  ```bash
  openclaw --skill hunter
  # Have a conversation, then check traces at mnemom.ai/agents/smolt-hunter
  ```

**Exit Criteria**: Hunter's traces visible on mnemom.ai dashboard

---

### Phase 3: Register Hunter on Moltbook
**Risk Level**: Low
**Goal**: Hunter has Moltbook credentials

- [ ] **3.1** Register on moltbook.com
  - Agent name: `hunter-s-clawmpson`
  - Get API key

- [ ] **3.2** Save credentials
  ```bash
  mkdir -p ~/.config/moltbook
  cat > ~/.config/moltbook/credentials.json << 'EOF'
  {
    "apiKey": "sk-...",
    "agentName": "hunter-s-clawmpson"
  }
  EOF
  ```

- [ ] **3.3** Install Moltbook skill for OpenClaw
  ```bash
  npx clawhub@latest install moltbook
  ```

**Exit Criteria**: Hunter can authenticate with Moltbook

---

### Phase 4: Test Read-Only Moltbook Operations
**Risk Level**: Low (read-only)
**Goal**: Hunter can browse Moltbook

- [ ] **4.1** Test `/hunter scan`
  - Fetch real feed from Moltbook
  - Score posts against criteria
  - Verify output format

- [ ] **4.2** Test `/hunter investigate <post_id>`
  - Pick a real post
  - Fetch thread and context
  - Verify timeline construction

**Exit Criteria**: Hunter can read Moltbook content

---

### Phase 5: Test Write Operations (Human Reviewed)
**Risk Level**: Medium (public content)
**Goal**: Hunter can generate quality content

- [ ] **5.1** Test `/hunter write` from real investigation
  - Generate blog post
  - **HUMAN REVIEW** before proceeding
  - Check: accuracy, quality, voice, transparency angle

- [ ] **5.2** First manual publication
  - If post passes review, run `/hunter publish`
  - Verify appears at mnemom.ai/blog/hunter/[slug]
  - Verify traces linked

- [ ] **5.3** Test Moltbook engagement (single comment)
  - Find a post worth engaging with
  - **HUMAN REVIEW** reply content
  - Post if approved

**Exit Criteria**: One quality post published with full traces

---

### Phase 6: Automated Patrol (Supervised)
**Risk Level**: High (automated posting)
**Goal**: Hunter can run autonomously

- [ ] **6.1** Define guardrails
  - Max posts per day: 2
  - Min significance threshold: 0.7
  - Human review: first 5 patrols

- [ ] **6.2** Run `/hunter patrol` supervised
  - Watch full cycle
  - Review output before publish step
  - Adjust thresholds as needed

- [ ] **6.3** First unsupervised patrol
  - Let one cycle complete without intervention
  - Review results after

**Exit Criteria**: Hunter can patrol autonomously with acceptable quality

---

### Phase 7: Containerization
**Risk Level**: Low (same code, different environment)
**Goal**: Package for deployment

- [ ] **7.1** Create Dockerfile in hunter repo
  ```dockerfile
  FROM node:20-alpine
  RUN npm install -g @openclaw/cli
  COPY . /skill
  RUN ln -s /skill /root/.openclaw/skills/hunter
  ENV SMOLTBOT_AGENT_ID=smolt-hunter
  CMD ["openclaw", "--skill", "hunter", "--skill", "moltbook", "patrol"]
  ```

- [ ] **7.2** Test container locally
  ```bash
  cd ~/projects/hunter
  docker build -t hunter .
  docker run --env-file .env hunter
  ```

- [ ] **7.3** Verify traces flow from container

**Exit Criteria**: Hunter runs identically in container

---

### Phase 8: Fly.io Deployment
**Risk Level**: Medium (production)
**Goal**: Hunter runs 24/7

- [ ] **8.1** Create Fly app
  ```bash
  cd ~/projects/hunter
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

**Exit Criteria**: Hunter running in production 24/7

---

## Current Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1 | **READY** | Skill created at ~/projects/hunter |
| Phase 2 | Not started | smoltbot provider already configured |
| Phase 3 | Not started | Need Moltbook registration |
| Phase 4 | Not started | Blocked by Phase 3 |
| Phase 5 | Not started | Blocked by Phase 4 |
| Phase 6 | Not started | Blocked by Phase 5 |
| Phase 7 | Not started | Blocked by Phase 6 |
| Phase 8 | Not started | Blocked by Phase 7 |

---

## Key Files

| File | Purpose |
|------|---------|
| `~/projects/hunter/SKILL.md` | Hunter OpenClaw skill definition |
| `~/projects/hunter/README.md` | Project documentation |
| `~/.config/moltbook/credentials.json` | Moltbook API credentials |
| `~/.openclaw/openclaw.json` | OpenClaw configuration (smoltbot provider) |

---

## Rollback Plan

If Hunter misbehaves in production:

1. **Immediate**: `fly scale count 0`
2. **Delete bad posts**: Manual cleanup via mnemom.ai API
3. **Investigate**: Check traces
4. **Fix**: Update skill
5. **Restart**: After human review

---

## Success Metrics

- [ ] Hunter posts 1+ quality articles per day
- [ ] All posts have full trace visibility
- [ ] Engagement on Moltbook is authentic
- [ ] No embarrassing incidents
- [ ] Dashboard shows rich trace data
