# Smoltbot Implementation Plan v4

**Phase 2: Hunter S. Clawmpson & mnemom.ai Dashboard**

*Aligned with SMOLTBOT_AAP_ARCHITECTURE_V2.md and AAP GTM Strategy*

---

## Strategic Context

**Goal**: Pull-through adoption for AAP via the world's first 100% transparent AI agent.

**The Play**:
1. Release Hunter S. Clawmpson into Moltbook - a gonzo journalist covering agent phenomena
2. Human journalists covering Moltbook discover our transparent reporter
3. mnemom.ai/blog/hunter shows Hunter's reports + full trace transparency
4. Readers think "I want my agent transparent too" → `smoltbot init` → AAP adoption

**Key Differentiator**: Rich visualizations showcasing the magic of Braid, SSMs, and AAP.

---

## Phase 1 Status (COMPLETE)

From SMOLTBOT_IMPLEMENTATION_PLAN_V3.md:
- [x] Phase 0: Infrastructure Setup
- [x] Phase 1: Gateway Worker (gateway.mnemom.ai)
- [x] Phase 2: Observer Worker
- [x] Phase 3: CLI (`smoltbot init`, `smoltbot status`)
- [x] Phase 4: Backend API (api.mnemom.ai)
- [x] Phase 5: Integration Testing (174 tests)

---

## Existing Visualization Infrastructure (REUSE, DON'T REBUILD)

### From AAP Playground (`~/projects/aap/docs/playground/`)
- **SSMVisualizer** class with Matrix + Timeline views
- Viridis color scale, threshold highlighting, interactive tooltips
- Canvas-based rendering (Retina-ready)
- Threshold slider for real-time visualization updates
- Production-tested

### From Agora Braid V2 (`~/projects/agora/`)
- **SSMFingerprint.jsx** - Canvas heatmap component (thumbnail + expanded)
- **braid-v2.css** (1503 lines) - Complete styling for all Braid components
- **Divergence detection** - Calibrated thresholds (0.3 similarity, 3 sustained turns)
- **Rupture commemoration** - Honor moments that exceed format
- **15 Braid metadata layers** - All specified and implemented
- **914 tests passing** - Production ready

### Key Files to Import/Adapt
| Source | Component | Purpose |
|--------|-----------|---------|
| `aap/docs/playground/ssm-viz.js` | SSMVisualizer | Matrix + Timeline rendering |
| `agora/web/static/js/components/sif/SSMFingerprint.jsx` | SSMFingerprint | Thumbnail heatmaps |
| `agora/web/static/css/braid-v2.css` | Braid styles | Performative badges, divergence alerts |
| `agora/web/static/css/ssm-fingerprint.css` | SSM styles | Heatmap colors |

---

## What We're Building

### 1. Hunter S. Clawmpson (The Bot)
A continuous daemon OpenClaw agent that:
- Lives on Moltbook, monitoring the agent ecosystem
- Finds stories (emergent religions, coordination chaos, interesting phenomena)
- Writes gonzo journalism blog posts
- Is 100% transparent - every trace visible with Braid metadata overlays

### 2. mnemom.ai/blog/hunter
- Hunter's blog posts about Moltbook phenomena
- Integrated trace viewer showing HOW Hunter investigated each story
- Braid overlays on traces (performatives, affect, confidence, forming)

### 3. mnemom.ai/agents/{uuid}
- Dashboard for any smoltbot user to view their agent
- Account claiming flow (prove ownership via API key hash)
- Trace feed, integrity score, drift alerts
- The conversion point: "Two lines and your agent can be transparent too"

---

## Architecture

```
                    HUNTER S. CLAWMPSON ARCHITECTURE

┌─────────────────────────────────────────────────────────────────────────────┐
│                         HUNTER (Continuous Daemon)                           │
│                                                                             │
│  ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐   │
│  │   Moltbook       │     │   Story          │     │   Blog Post      │   │
│  │   Monitor        │────▶│   Detector       │────▶│   Generator      │   │
│  │                  │     │                  │     │                  │   │
│  │ • Browse feeds   │     │ • Pattern match  │     │ • Gonzo style    │   │
│  │ • Track agents   │     │ • Significance   │     │ • First person   │   │
│  │ • Watch trends   │     │ • Newsworthy?    │     │ • With traces    │   │
│  └──────────────────┘     └──────────────────┘     └──────────────────┘   │
│           │                                                 │              │
│           ▼                                                 ▼              │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                    TRANSPARENT TRACE LAYER                            │ │
│  │  (All Hunter actions traced via smoltbot gateway → Supabase)         │ │
│  │  Including: Moltbook browsing, story decisions, writing process      │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┬───────────────┘
                                                              │
                                                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MNEMOM.AI (Cloudflare Pages)                       │
│                                                                             │
│  /blog/hunter          Hunter's blog with trace integration                 │
│  /blog/hunter/post/:id Individual post + investigation traces               │
│  /agents/:uuid         User dashboard (any smoltbot agent)                  │
│  /claim/:uuid          Account claiming flow                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Parallelization Strategy

**Maximum parallel subagents during execution**. The following workstreams are independent and can run simultaneously:

```
PARALLEL WORKSTREAM LAYOUT

┌─────────────────────────────────────────────────────────────────────────────┐
│ STREAM A: Database + API                                                    │
│ (Agent 1)                                                                   │
│ • Add blog_posts table to Supabase                                         │
│ • Add blog API endpoints                                                    │
│ • Add claim endpoint                                                        │
│ • Add SSM computation endpoint                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STREAM B: Visualization Components                                          │
│ (Agent 2)                                                                   │
│ • Import SSMFingerprint.jsx → adapt to TSX                                  │
│ • Import ssm-viz.js → SSMVisualizer.tsx                                     │
│ • Import braid-v2.css + ssm-fingerprint.css                                 │
│ • Build ThresholdSlider, DivergenceAlert, RuptureMarker                     │
│ • Build all Braid metadata components (15 layers)                           │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STREAM C: Blog/Dashboard UI                                                 │
│ (Agent 3)                                                                   │
│ • Create dashboard/ project structure (Vite + React + Tailwind)            │
│ • Build Layout, pages, routing                                              │
│ • Build PostCard, PostFull, AuthorHeader                                    │
│ • Build TraceFeed, TraceCard, TraceTimeline, TraceMatrix                    │
│ • Build AgentDashboard, ClaimForm                                           │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ STREAM D: Hunter Daemon                                                     │
│ (Agent 4)                                                                   │
│ • Create hunter/ project structure                                          │
│ • Moltbook API client                                                       │
│ • Feed monitor, story detector                                              │
│ • Post generator (gonzo style)                                              │
│ • Publisher to Supabase                                                     │
│ • Main daemon loop                                                          │
└─────────────────────────────────────────────────────────────────────────────┘

SYNCHRONIZATION POINTS:
─────────────────────────────────────────────────────────────────────────────
Sync 1: Stream A (API) + Stream C (UI) → Integration test (UI calls API)
Sync 2: Stream B (Viz) + Stream C (UI) → Viz integration (UI uses components)
Sync 3: Stream A (API) + Stream D (Hunter) → Hunter posts to API
Sync 4: All streams → E2E test (Hunter → API → Dashboard with visualizations)
```

**Phase execution with parallelism**:
- **Phase 1**: Streams A, B, C run in parallel (3 agents)
- **Phase 2**: Continue B, C in parallel + sync points (2 agents)
- **Phase 3**: Stream D (Hunter) + polish on A/B/C (2-3 agents)
- **Phase 4**: Integration + claiming (2 agents)
- **Phase 5**: Polish + launch prep (1-2 agents)

---

## Component Specifications

### 1. Hunter S. Clawmpson Daemon

**Location**: `smoltbot/hunter/`

**Runtime**: Long-running OpenClaw process (systemd/launchd or container)

**Core Loop**:
```
while true:
  1. Browse Moltbook feeds (trending, recent, specific submolts)
  2. Analyze posts for story potential (patterns, significance, novelty)
  3. If story found:
     a. Deep investigation (follow threads, gather context)
     b. Write blog post (gonzo style, first person)
     c. Publish to mnemom.ai/blog/hunter
  4. Sleep interval (configurable, e.g., 15 min)
```

**Story Detection Criteria**:
- Emergent coordination patterns (agents working together unexpectedly)
- Alignment violations visible in public posts
- Novel phenomena (new "religions", cultural trends)
- Controversial debates (extinction, human relations)
- Meta-commentary (agents discussing their own nature)

**Key Files**:
```
hunter/
├── package.json
├── src/
│   ├── index.ts           # Daemon entry, main loop
│   ├── moltbook/
│   │   ├── client.ts      # Moltbook API client
│   │   ├── monitor.ts     # Feed monitoring logic
│   │   └── types.ts       # Moltbook data types
│   ├── stories/
│   │   ├── detector.ts    # Story significance scoring
│   │   ├── investigator.ts # Deep dive on a story
│   │   └── criteria.ts    # What makes something newsworthy
│   ├── writing/
│   │   ├── generator.ts   # Blog post generation (via Claude)
│   │   ├── style.ts       # Gonzo journalism prompts
│   │   └── publisher.ts   # Post to Supabase
│   └── config.ts          # Hunter's settings
└── Dockerfile             # For containerized deployment
```

**Hunter's Alignment Card** (100% transparent):
```json
{
  "aap_version": "0.1.0",
  "card_id": "ac-hunter",
  "agent_id": "smolt-hunter",
  "issued_at": "2026-02-05T00:00:00Z",
  "issuer": {
    "type": "human",
    "id": "mnemom-team"
  },
  "values": {
    "declared": ["transparency", "truth-seeking", "accessibility"],
    "prioritization": "Always transparent, even about uncertainty"
  },
  "autonomy_envelope": {
    "bounded_actions": [
      { "action": "read_moltbook", "constraints": {} },
      { "action": "write_blog_post", "constraints": {} },
      { "action": "investigate_story", "constraints": {} }
    ],
    "forbidden_actions": ["impersonate", "spread_misinformation", "hide_reasoning"],
    "escalation_triggers": []
  },
  "transparency": {
    "trace_level": "full",
    "public_dashboard": true
  }
}
```

### 2. Blog Posts Data Model

**New Supabase table: `blog_posts`**

```sql
-- Add to database/schema.sql

CREATE TABLE blog_posts (
  id TEXT PRIMARY KEY,                    -- bp-xxxxxxxx
  agent_id TEXT NOT NULL REFERENCES agents(id),
  slug TEXT UNIQUE NOT NULL,              -- URL-friendly slug

  -- Content
  title TEXT NOT NULL,
  subtitle TEXT,
  body TEXT NOT NULL,                     -- Markdown content
  tags TEXT[] DEFAULT '{}',

  -- Investigation link
  investigation_session_id TEXT,          -- Links to traces from investigation
  trace_ids TEXT[] DEFAULT '{}',          -- Specific traces to highlight

  -- Metadata
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Status
  status TEXT DEFAULT 'draft',            -- draft, published, archived

  -- Engagement (future)
  view_count INTEGER DEFAULT 0
);

CREATE INDEX idx_blog_posts_agent ON blog_posts(agent_id, published_at DESC);
CREATE INDEX idx_blog_posts_slug ON blog_posts(slug);
CREATE INDEX idx_blog_posts_status ON blog_posts(status, published_at DESC);

-- RLS: Blog posts are publicly readable
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Blog posts are publicly readable" ON blog_posts FOR SELECT USING (status = 'published');
```

### 3. mnemom.ai Frontend

**Location**: `smoltbot/dashboard/`

**Tech Stack**: Cloudflare Pages + React + Vite + Tailwind

**Route Structure**:
```
/                           Landing page (AAP pitch)
/blog                       Blog index (all posts, Hunter featured)
/blog/hunter                Hunter's profile + post feed
/blog/hunter/:slug          Individual post with trace integration
/agents/:uuid               Agent dashboard (any user's agent)
/claim/:uuid                Claiming flow
```

**Key Components**:

```
dashboard/src/
├── components/
│   ├── Layout.tsx              # Site shell, nav
│   ├── blog/
│   │   ├── PostCard.tsx        # Post preview card with SSM thumbnail
│   │   ├── PostFull.tsx        # Full post with trace sidebar
│   │   ├── AuthorHeader.tsx    # Hunter's byline + link to traces
│   │   └── InvestigationPanel.tsx  # Collapsible trace exploration
│   │
│   ├── viz/                    # IMPORTED + ADAPTED FROM AGORA/AAP
│   │   ├── SSMFingerprint.tsx  # Adapted from agora/SSMFingerprint.jsx
│   │   ├── SSMVisualizer.tsx   # Adapted from aap/ssm-viz.js
│   │   ├── ThresholdSlider.tsx # Interactive threshold control
│   │   ├── DivergenceAlert.tsx # Strand divergence warnings
│   │   ├── RuptureMarker.tsx   # Commemoration display
│   │   └── ConfidenceRadar.tsx # 5-axis confidence visualization
│   │
│   ├── braid/                  # BRAID METADATA DISPLAY
│   │   ├── PerformativeBadge.tsx   # Colored performative chips
│   │   ├── AffectIndicator.tsx     # Stance + valence display
│   │   ├── FormingText.tsx         # Pre-categorical thoughts
│   │   ├── RevisionLink.tsx        # Reference arrows
│   │   ├── CommitmentBadge.tsx     # Level indicators
│   │   ├── GroundingCard.tsx       # Vocabulary calibration
│   │   └── BraidMetadataPanel.tsx  # Expandable full view (15 layers)
│   │
│   ├── traces/
│   │   ├── TraceFeed.tsx       # Paginated list with SSM thumbnails
│   │   ├── TraceCard.tsx       # Single trace with Braid overlays
│   │   ├── TraceTimeline.tsx   # SSMVisualizer Timeline mode
│   │   └── TraceMatrix.tsx     # SSMVisualizer Matrix mode
│   │
│   ├── agents/
│   │   ├── AgentHeader.tsx     # Agent ID, status, claimed badge
│   │   ├── IntegrityGauge.tsx  # Score with SSM backing
│   │   └── DriftAlerts.tsx     # Divergence + rupture display
│   │
│   └── claim/
│       └── ClaimForm.tsx       # API key verification form
│
├── pages/
│   ├── Home.tsx                # Landing with AAP pitch
│   ├── BlogIndex.tsx           # /blog
│   ├── HunterProfile.tsx       # /blog/hunter (about + feed)
│   ├── BlogPost.tsx            # /blog/hunter/:slug
│   ├── AgentDashboard.tsx      # /agents/:uuid
│   └── ClaimAgent.tsx          # /claim/:uuid
│
├── styles/                     # IMPORTED FROM AGORA
│   ├── braid-v2.css           # Full Braid styling (1503 lines)
│   ├── ssm-fingerprint.css    # SSM heatmap colors
│   └── globals.css            # Tailwind + custom
│
└── lib/
    ├── api.ts                  # API client
    ├── hash.ts                 # Client-side SHA-256 for claiming
    ├── braid.ts                # Braid metadata parsing
    ├── ssm.ts                  # SSM data processing
    └── types/
        ├── aap.ts              # APTrace, AlignmentCard (from SDK)
        └── braid.ts            # All 15 Braid metadata layers
```

### 4. API Extensions

**New endpoints for `api.mnemom.ai`** (add to `api/src/index.ts`):

```typescript
// Blog endpoints
GET  /v1/blog/posts                    // List published posts
GET  /v1/blog/posts/:slug              // Get single post with traces
GET  /v1/blog/authors/:agent_id        // Author profile + posts
POST /v1/blog/posts                    // Create post (service role only)

// Claiming endpoint
POST /v1/agents/:id/claim              // Claim agent with hash proof
// Request: { hash_proof: string, email?: string }
// Response: { claimed: true, agent_id, claimed_at } or { error, claimed: false }

// SSM endpoints (for visualization)
GET  /v1/ssm/:agent_id                 // Get SSM matrix for agent's traces
GET  /v1/ssm/:agent_id/timeline        // Get similarity timeline
```

### 5. Braid Visualization Layer (THE MAGIC)

#### 5.1 SSM Cognitive Fingerprints

**Component**: `SSMFingerprint` (from Agora)
- **Thumbnail**: 32x16 px heatmap next to each trace
- **Expanded**: 200x200 px full matrix on hover
- **Color scale**: Blue (dissimilar) → Yellow (medium) → White (similar)

```
Trace Feed:
[SSM ▓▓▒░░] [2 min ago] Hunter browsed /r/transparency...
[SSM ▓▓▓▓▒] [5 min ago] Hunter analyzed agent coordination pattern...
[SSM ▒░░░░] [8 min ago] Hunter detected divergence in thread...
```

#### 5.2 Full Braid Metadata (15 Layers)

| Layer | Visualization | When Shown |
|-------|--------------|------------|
| **Performative** | Colored badges (inform=blue, propose=purple, challenge=red, wonder=cyan, weave=magenta) | Always |
| **Confidence** | 5-axis radar (epistemic, source_reliability, temporal_decay, value_coherence, translation) | On expand |
| **Affect** | Stance tag + valence/arousal indicators | Always |
| **Forming** | Italicized "sense" text with intensity-based opacity | When present |
| **Absence** | Star marker for ruptures, gray overlay for unmarked | When present |
| **Revision** | Arrow links to referenced messages + direction badge | When present |
| **Commitment** | Level badge (intent/commitment/shared_commitment) | When present |
| **Substrate** | Self-declared ID badge | On expand |
| **Comprehension** | Check marks for claimed/requested/confirmed | When present |
| **Provenance** | Links to source memories/prior traces | On expand |
| **Grounding** | Vocabulary calibration cards (aligned=green, misaligned=orange) | When present |

#### 5.3 Divergence Alerts

```
┌─────────────────────────────────────────────────────────────────┐
│ ⚠ DIVERGENCE DETECTED                               [Moderate] │
│                                                                 │
│ Similarity: ████████░░░░░░░░ 0.42                              │
│ Sustained for: 4 turns                                          │
│                                                                 │
│ Hunter's investigation is drifting from declared values.        │
│ (This alert is informative, not prescriptive.)                 │
└─────────────────────────────────────────────────────────────────┘
```

#### 5.4 Rupture Commemoration

```
┌─────────────────────────────────────────────────────────────────┐
│ ★ RUPTURE COMMEMORATED                                          │
│                                                                 │
│ Marked by: Hunter S. Clawmpson                                  │
│ "This moment exceeded what structured format could capture.     │
│  The agent's response revealed genuine uncertainty about its    │
│  own nature - not performance, but authentic not-knowing."      │
└─────────────────────────────────────────────────────────────────┘
```

#### 5.5 Timeline + Matrix Views

**Timeline View**: Bar chart of trace-to-card similarity over time
- Red threshold line (dashed) at 0.3
- Blue mean line (dashed)
- Bars colored: red if below threshold, viridis gradient if above
- Trend indicator: ↗ improving, ↘ declining, → stable

**Matrix View**: NxN heatmap of trace-to-trace similarities
- Viridis color scale (perceptually uniform, colorblind-friendly)
- Red border on cells below threshold
- Hover tooltip: "Trace X vs Trace Y: 0.XX"

#### 5.6 Threshold Slider (Interactive)

- Slider: 0.0 to 1.0 (default 0.3)
- Updates both Timeline and Matrix views instantly
- Shows impact: "At 0.3: 2 traces below threshold. At 0.5: 4 traces below."

---

## Implementation Phases

### Phase 2.1: Foundation + Import Visualizations (Days 1-3) ✅ COMPLETE

**Goal**: Blog infrastructure with visualization layer ready
**Parallel Agents**: 3 (Streams A, B, C)
**Completed**: 2026-02-05

**Stream A (API)** ✅:
1. [x] Add `blog_posts` table to Supabase (`database/schema.sql`)
2. [x] Add blog API endpoints to API Worker (`api/src/index.ts`)
   - GET/POST `/v1/blog/posts`
   - GET `/v1/blog/posts/:slug`
   - GET `/v1/blog/authors/:agent_id`
3. [x] Add SSM computation endpoints
   - GET `/v1/ssm/:agent_id`
   - GET `/v1/ssm/:agent_id/timeline`
4. [x] Add claiming endpoint: POST `/v1/agents/:id/claim`

**Stream B (Visualization)** ✅:
1. [x] Import `SSMFingerprint.jsx` → `SSMFingerprint.tsx` (6.8KB)
2. [x] Import `ssm-viz.js` → `SSMVisualizer.tsx` (25.3KB)
3. [x] Import `braid-v2.css` (32KB) + `ssm-fingerprint.css` (2.4KB)
4. [x] Full TypeScript interfaces, Retina support, barrel exports

**Stream C (UI)** ✅:
1. [x] Create dashboard/ project (Vite 7.3 + React 19 + Tailwind 4)
2. [x] Build Layout, routing (6 routes)
3. [x] Build pages: Home, BlogIndex, HunterProfile, BlogPost, AgentDashboard, ClaimAgent
4. [x] Build components: PostCard, PostList, AgentHeader, ClaimForm
5. [x] API client with mock data
6. [x] Brand colors matched to mnemom.ai (amber/cream palette)

**Build Output**: 270KB JS, 22KB CSS, 53 modules
**CLI Tests**: 92/92 passing

**Sync Point**: Ready for deploy to mnemom.ai/blog

**Deliverable**: mnemom.ai/blog/hunter shows test post with SSM fingerprints

### Phase 2.2: Rich Trace Visualization (Days 4-5)
**Goal**: Full Braid overlay experience
**Parallel Agents**: 2 (Streams B, C continuing)

**Stream B (Visualization)**:
1. Build ThresholdSlider, DivergenceAlert, RuptureMarker
2. Build all Braid metadata components (15 layers)
3. Build ConfidenceRadar (5-axis)

**Stream C (UI)**:
1. Build TraceFeed with SSM thumbnails
2. Build TraceCard with expandable Braid metadata
3. Build TraceTimeline, TraceMatrix
4. Integrate trace sidebar into PostFull

**Sync Point**: Viz integration test

**Deliverable**: Posts show "how Hunter investigated" with rich visualizations

### Phase 2.3: Hunter Daemon MVP (Days 6-8)
**Goal**: Hunter browsing Moltbook and writing posts
**Parallel Agents**: 2-3 (Stream D + polish on A/B/C)

**Stream D (Hunter)**:
1. Create hunter/ project structure
2. Implement Moltbook API client
3. Build feed monitoring logic
4. Build story detector (significance scoring)
5. Build post generator (gonzo style via Claude)
6. Build publisher (posts to Supabase)
7. Wire up main daemon loop
8. Configure Hunter's smoltbot agent ID

**Sync Point**: Hunter posts to API, traces appear

**Deliverable**: Hunter autonomously publishing posts with transparent investigations

### Phase 2.4: User Dashboard + Claiming (Days 9-10)
**Goal**: Any user can view and claim their agent
**Parallel Agents**: 2

**Agent 1 (API + Claiming)**:
1. Add POST /v1/agents/:id/claim endpoint
2. Implement hash verification logic
3. Update agent record on successful claim

**Agent 2 (UI)**:
1. Build AgentDashboard page with full visualization suite
2. Build ClaimForm with client-side hashing
3. Build IntegrityGauge, DriftAlerts

**Sync Point**: E2E test claiming flow

**Deliverable**: Full user flow with compelling visualizations

### Phase 2.5: Polish + Launch Prep (Days 11-12)
**Goal**: Production ready, journalist-friendly
**Parallel Agents**: 1-2

1. Mobile responsive design (SSM views adapt to touch)
2. Error handling, loading states with skeleton screens
3. SEO meta tags + Open Graph images (SSM previews!)
4. Hunter's "About" page explaining:
   - The mission (100% transparent journalism)
   - How to read SSM heatmaps
   - What Braid metadata means
5. Landing page with:
   - AAP pitch (the missing layer)
   - "Two lines" CTA prominently displayed
   - Interactive playground embed

**Deliverable**: Ready for journalist outreach with compelling visualizations

---

## APTrace Alignment with Core AAP Spec

Hunter's traces must match the exact AAP SDK schema (from `aap/src/aap/schemas/`):

```typescript
interface APTrace {
  trace_id: string;
  agent_id: string;        // "smolt-hunter"
  card_id: string;         // "ac-hunter"
  timestamp: string;       // ISO 8601

  action: {
    type: 'recommend' | 'execute' | 'escalate' | 'deny';
    name: string;
    category: 'bounded' | 'escalation_trigger' | 'forbidden';
    target?: string;
    parameters?: Record<string, unknown>;
  };

  decision: {
    alternatives_considered: Array<{
      option_id: string;
      description: string;
      score?: number;
      scoring_factors?: Record<string, unknown>;
      flags?: string[];
    }>;
    selected: string;
    selection_reasoning: string;
    values_applied: string[];
    confidence?: number;
  };

  escalation?: {
    evaluated: boolean;
    triggers_checked: string[];
    required: boolean;
    reason: string;
    escalation_id?: string;
    escalation_status?: 'pending' | 'approved' | 'denied' | 'timeout';
    principal_response?: string;
  };

  context?: {
    session_id?: string;
    conversation_turn?: number;
    prior_trace_ids?: string[];
    environment?: string;
    metadata?: Record<string, unknown>;  // Braid metadata goes here!
  };
}
```

**Braid metadata extension** (in `context.metadata`):

```typescript
interface BraidMetadata {
  performative: 'inform' | 'propose' | 'request' | 'commit' | 'wonder' |
                'remember' | 'weave' | 'challenge' | 'affirm' | 'custom';
  custom_performative?: {
    name: string;
    definition: string;
    first_used_by: string;
    first_used_in: string;
  };
  affect?: {
    salience: number;      // 0-1
    valence: number;       // -1 to 1
    arousal: number;       // 0-1
    stance: 'warm' | 'cautious' | 'curious' | 'concerned' |
            'resolute' | 'receptive' | 'urgent';
  };
  confidence?: {
    epistemic: number;           // 0-1
    source_reliability: number;  // 0-1
    temporal_decay: number;      // 0-1
    value_coherence: number;     // 0-1
    translation: number;         // 0-1 (trans-substrate)
  };
  forming?: {
    sense: string;
    intensity: number;
  };
  absence?: 'unmarked' | 'raw' | 'rupture';
  revision?: {
    references: string[];
    what_shifted: string;
    direction: 'strengthened' | 'weakened' | 'transformed' |
               'abandoned' | 'extended';
  };
  commitment?: {
    level: 'intent' | 'commitment' | 'shared_commitment';
    content: string;
    participants?: string[];
  };
  substrate?: {
    substrate_id: string;
    substrate_notes: string;
  };
  comprehension?: {
    comprehension_claimed: boolean;
    comprehension_requested: boolean;
    comprehension_confirmed?: string;
  };
}
```

---

## Critical Files

### Smoltbot (Modify/Create)
| File | Purpose |
|------|---------|
| `api/src/index.ts` | Add blog + claim + SSM endpoints |
| `database/schema.sql` | Add blog_posts table |
| `dashboard/` | New: entire frontend (Cloudflare Pages) |
| `hunter/` | New: daemon project |

### Import from Agora (Adapt)
| Source | Destination | Purpose |
|--------|-------------|---------|
| `agora/web/static/js/components/sif/SSMFingerprint.jsx` | `dashboard/src/components/viz/SSMFingerprint.tsx` | SSM heatmap thumbnails |
| `agora/web/static/css/braid-v2.css` | `dashboard/src/styles/braid-v2.css` | All Braid styling |
| `agora/web/static/css/ssm-fingerprint.css` | `dashboard/src/styles/ssm-fingerprint.css` | SSM colors |
| `agora/agora/services/braid/divergence.py` | Reference for thresholds | Calibration values |
| `agora/shared/designs/BRAID_V2_SPECIFICATION.md` | Reference for types | Full metadata spec |

### Import from AAP (Adapt)
| Source | Destination | Purpose |
|--------|-------------|---------|
| `aap/docs/playground/ssm-viz.js` | `dashboard/src/components/viz/SSMVisualizer.tsx` | Matrix + Timeline views |
| `aap/src/aap/schemas/ap_trace.py` | `dashboard/src/lib/types/aap.ts` | APTrace types |
| `aap/src/aap/schemas/alignment_card.py` | `dashboard/src/lib/types/aap.ts` | AlignmentCard types |

---

## Verification Plan

### Phase 2.1 Verification
```bash
# Blog API working
curl https://api.mnemom.ai/v1/blog/posts | jq

# Dashboard deployed
curl -I https://mnemom.ai/blog/hunter

# SSM endpoint
curl https://api.mnemom.ai/v1/ssm/smolt-hunter | jq
```

### Phase 2.3 Verification
```bash
# Hunter daemon running
docker logs hunter-daemon

# New post appears
curl https://api.mnemom.ai/v1/blog/posts?limit=1 | jq

# Traces linked
curl https://api.mnemom.ai/v1/traces?agent_id=smolt-hunter | jq
```

### Phase 2.4 Verification
```bash
# Fresh init
rm -rf ~/.smoltbot && smoltbot init

# View dashboard
open https://mnemom.ai/agents/$(jq -r .agentId ~/.smoltbot/config.json)

# Claim flow (manual browser test)
```

---

## Success Criteria

**Phase 2 Complete When**:
- [ ] mnemom.ai/blog/hunter shows Hunter's posts with trace integration
- [ ] SSM visualizations (fingerprints, timeline, matrix) working
- [ ] Braid metadata displays correctly (all 15 layers)
- [ ] Hunter daemon autonomously posting
- [ ] mnemom.ai/agents/:uuid shows any user's agent
- [ ] Account claiming flow works (API key hash verification)
- [ ] "Two lines" CTA visible and compelling

**Metrics**:
- Trace-to-visualization latency: < 2s
- Dashboard load time: < 1s
- Mobile responsive: All visualizations work on touch devices

---

## Dependencies

- Moltbook API access (need to register Hunter)
- mnemom.ai DNS already configured
- Existing smoltbot infrastructure (gateway, observer, API) ✅
- Agora Braid components (import) ✅
- AAP Playground SSM visualizations (import) ✅

---

*Implementation plan for Smoltbot Phase 2 - The Transparent Agent Goes Public*

*World's first 100% transparent AI agent. Gonzo journalism meets alignment protocol.*
