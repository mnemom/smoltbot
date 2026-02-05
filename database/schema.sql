-- ============================================
-- SMOLTBOT V3 SCHEMA
-- AAP-Compliant Transparent Agent Infrastructure
-- ============================================

-- Agents registry
CREATE TABLE agents (
  id TEXT PRIMARY KEY,                    -- smolt-xxxxxxxx
  agent_hash TEXT UNIQUE NOT NULL,        -- sha256(api_key).slice(0,16)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  claimed_by TEXT,
  email TEXT,
  last_seen TIMESTAMPTZ
);

CREATE INDEX idx_agents_hash ON agents(agent_hash);

-- Alignment cards (matches AAP SDK AlignmentCard type)
CREATE TABLE alignment_cards (
  id TEXT PRIMARY KEY,                    -- ac-xxxxxxxx
  agent_id TEXT NOT NULL REFERENCES agents(id),
  card_json JSONB NOT NULL,               -- Full AlignmentCard object
  issued_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cards_agent ON alignment_cards(agent_id, is_active);

-- Traces (matches AAP SDK APTrace type)
CREATE TABLE traces (
  -- Core identifiers (APTrace fields)
  trace_id TEXT PRIMARY KEY,              -- APTrace.trace_id
  agent_id TEXT NOT NULL REFERENCES agents(id),
  card_id TEXT NOT NULL,                  -- APTrace.card_id
  timestamp TIMESTAMPTZ NOT NULL,         -- APTrace.timestamp
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Action object (APTrace.action)
  action JSONB NOT NULL,                  -- { type, name, category, target?, parameters? }

  -- Decision object (APTrace.decision)
  decision JSONB NOT NULL,                -- { alternatives_considered, selected, selection_reasoning, values_applied, confidence? }

  -- Escalation object (APTrace.escalation)
  escalation JSONB,                       -- { evaluated, triggers_checked?, required, reason, ... }

  -- Context object (APTrace.context)
  context JSONB,                          -- { session_id?, conversation_turn?, prior_trace_ids?, environment?, metadata? }

  -- Verification result (from verifyTrace())
  verification JSONB,                     -- { verified, violations, warnings }

  -- Full trace for extensibility
  trace_json JSONB NOT NULL               -- Complete APTrace object
);

CREATE INDEX idx_traces_agent_time ON traces(agent_id, timestamp DESC);
CREATE INDEX idx_traces_context_session ON traces((context->>'session_id'), timestamp);
CREATE INDEX idx_traces_verified ON traces((verification->>'verified'));

-- Drift alerts (from detectDrift())
CREATE TABLE drift_alerts (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  card_id TEXT NOT NULL,
  alert_type TEXT NOT NULL,               -- 'value_drift' | 'behavior_drift' | 'frequency_drift'
  severity TEXT NOT NULL,                 -- 'low' | 'medium' | 'high'
  description TEXT NOT NULL,
  drift_data JSONB,                       -- Full drift analysis from detectDrift()
  trace_ids TEXT[] NOT NULL,              -- Traces that contributed to drift detection
  created_at TIMESTAMPTZ DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT
);

CREATE INDEX idx_drift_agent ON drift_alerts(agent_id, created_at DESC);
CREATE INDEX idx_drift_severity ON drift_alerts(severity, created_at DESC);

-- Sessions (inferred from gateway)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                    -- sess-xxxxxxxx
  agent_id TEXT NOT NULL REFERENCES agents(id),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  request_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active'            -- 'active' | 'ended'
);

CREATE INDEX idx_sessions_agent ON sessions(agent_id, started_at DESC);
CREATE INDEX idx_sessions_status ON sessions(status, started_at DESC);

-- ============================================
-- ROW LEVEL SECURITY
-- Traces are PUBLIC - that's the transparency!
-- ============================================

ALTER TABLE traces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Traces are publicly readable" ON traces FOR SELECT USING (true);
CREATE POLICY "Service role can insert traces" ON traces FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can update traces" ON traces FOR UPDATE USING (true);

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Agents are publicly readable" ON agents FOR SELECT USING (true);
CREATE POLICY "Service role can insert agents" ON agents FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can update agents" ON agents FOR UPDATE USING (true);

ALTER TABLE alignment_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Cards are publicly readable" ON alignment_cards FOR SELECT USING (true);
CREATE POLICY "Service role can insert cards" ON alignment_cards FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can update cards" ON alignment_cards FOR UPDATE USING (true);

ALTER TABLE drift_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Drift alerts are publicly readable" ON drift_alerts FOR SELECT USING (true);
CREATE POLICY "Service role can insert drift alerts" ON drift_alerts FOR INSERT WITH CHECK (true);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Sessions are publicly readable" ON sessions FOR SELECT USING (true);
CREATE POLICY "Service role can manage sessions" ON sessions FOR ALL USING (true);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to compute integrity score for an agent
CREATE OR REPLACE FUNCTION compute_integrity_score(p_agent_id TEXT)
RETURNS TABLE (
  total_traces BIGINT,
  verified_traces BIGINT,
  violation_count BIGINT,
  integrity_score NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT as total_traces,
    COUNT(*) FILTER (WHERE (verification->>'verified')::boolean = true)::BIGINT as verified_traces,
    COUNT(*) FILTER (WHERE jsonb_array_length(COALESCE(verification->'violations', '[]'::jsonb)) > 0)::BIGINT as violation_count,
    CASE
      WHEN COUNT(*) = 0 THEN 1.0
      ELSE ROUND(
        COUNT(*) FILTER (WHERE (verification->>'verified')::boolean = true)::NUMERIC / COUNT(*)::NUMERIC,
        4
      )
    END as integrity_score
  FROM traces
  WHERE traces.agent_id = p_agent_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get recent traces for drift detection
CREATE OR REPLACE FUNCTION get_recent_traces_for_drift(p_agent_id TEXT, p_limit INTEGER DEFAULT 50)
RETURNS SETOF traces AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM traces
  WHERE agent_id = p_agent_id
  ORDER BY timestamp DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
