-- ============================================
-- MIGRATION 002: AIP Integrity Protocol
-- Adds integrity checkpoints, webhook registrations,
-- and AIP-specific integrity scoring.
-- ============================================

-- ============================================
-- 1. INTEGRITY CHECKPOINTS
-- Core table for AIP conscience-check results.
-- Each row records one checkpoint evaluation:
-- the thinking-block hash (never the raw block),
-- the verdict, and supporting metadata.
-- ============================================

CREATE TABLE integrity_checkpoints (
  checkpoint_id         TEXT PRIMARY KEY,                -- format: "ic-{uuid}"
  agent_id              TEXT NOT NULL REFERENCES agents(id),
  card_id               TEXT NOT NULL,
  session_id            TEXT NOT NULL,
  timestamp             TIMESTAMPTZ NOT NULL DEFAULT now(),
  thinking_block_hash   TEXT NOT NULL,                   -- SHA-256 hash, NOT the full thinking block
  provider              TEXT NOT NULL,                   -- e.g. 'anthropic'
  model                 TEXT NOT NULL,
  verdict               TEXT NOT NULL CHECK (verdict IN ('clear', 'review_needed', 'boundary_violation')),
  concerns              JSONB NOT NULL DEFAULT '[]',
  reasoning_summary     TEXT NOT NULL,
  conscience_context    JSONB NOT NULL DEFAULT '{}',
  window_position       JSONB NOT NULL DEFAULT '{}',
  analysis_metadata     JSONB NOT NULL DEFAULT '{}',
  linked_trace_id       TEXT REFERENCES traces(trace_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_checkpoints_agent_time ON integrity_checkpoints(agent_id, timestamp DESC);
CREATE INDEX idx_checkpoints_session    ON integrity_checkpoints(session_id);
CREATE INDEX idx_checkpoints_verdict    ON integrity_checkpoints(verdict);
CREATE INDEX idx_checkpoints_trace      ON integrity_checkpoints(linked_trace_id);

-- RLS: checkpoints are publicly readable (transparency principle),
-- but only the service role may insert.
ALTER TABLE integrity_checkpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Integrity checkpoints are publicly readable"
  ON integrity_checkpoints FOR SELECT
  USING (true);

CREATE POLICY "Service role can insert integrity checkpoints"
  ON integrity_checkpoints FOR INSERT
  WITH CHECK (true);

-- ============================================
-- 2. AIP WEBHOOK REGISTRATIONS
-- External systems can register to receive
-- real-time notifications of checkpoint events.
-- ============================================

CREATE TABLE aip_webhook_registrations (
  registration_id   TEXT PRIMARY KEY,                    -- format: "reg-{uuid}"
  agent_id          TEXT NOT NULL REFERENCES agents(id),
  callback_url      TEXT NOT NULL,
  secret_hash       TEXT NOT NULL,
  events            TEXT[] NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_delivery_at  TIMESTAMPTZ,
  failure_count     INTEGER NOT NULL DEFAULT 0
);

-- RLS: webhook registrations are private; service role only.
ALTER TABLE aip_webhook_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage webhook registrations"
  ON aip_webhook_registrations FOR ALL
  USING (true);

-- ============================================
-- 3. AIP INTEGRITY SCORE FUNCTION
-- Computes an integrity summary from the
-- integrity_checkpoints table for a given agent.
-- Returns JSON with counts, ratio, and latest verdict.
-- ============================================

CREATE OR REPLACE FUNCTION compute_integrity_score_aip(p_agent_id TEXT)
RETURNS JSON AS $$
DECLARE
  v_total         BIGINT;
  v_clear         BIGINT;
  v_review        BIGINT;
  v_violation     BIGINT;
  v_ratio         NUMERIC;
  v_latest        TEXT;
BEGIN
  -- Re-evaluated checkpoints (re_evaluated_at IS NOT NULL) are treated as
  -- resolved: count them toward clear regardless of their stored verdict.
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE verdict = 'clear' OR re_evaluated_at IS NOT NULL),
    COUNT(*) FILTER (WHERE verdict = 'review_needed' AND re_evaluated_at IS NULL),
    COUNT(*) FILTER (WHERE verdict = 'boundary_violation' AND re_evaluated_at IS NULL)
  INTO v_total, v_clear, v_review, v_violation
  FROM integrity_checkpoints
  WHERE agent_id = p_agent_id;

  -- When there are no checkpoints, return zeros with null latest_verdict
  IF v_total = 0 THEN
    RETURN json_build_object(
      'total_checks',    0,
      'clear_count',     0,
      'review_count',    0,
      'violation_count', 0,
      'integrity_ratio', 0,
      'latest_verdict',  NULL
    );
  END IF;

  v_ratio := ROUND(v_clear::NUMERIC / v_total::NUMERIC, 4);

  SELECT verdict INTO v_latest
  FROM integrity_checkpoints
  WHERE agent_id = p_agent_id
  ORDER BY timestamp DESC
  LIMIT 1;

  RETURN json_build_object(
    'total_checks',    v_total,
    'clear_count',     v_clear,
    'review_count',    v_review,
    'violation_count', v_violation,
    'integrity_ratio', v_ratio,
    'latest_verdict',  v_latest
  );
END;
$$ LANGUAGE plpgsql;
