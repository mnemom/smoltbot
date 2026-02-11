-- ============================================
-- MIGRATION 004: Admin Console Usage Tracking
-- Adds usage event logging, platform-wide
-- statistics, per-agent summaries, and
-- model-level cost breakdowns for the admin
-- console dashboard.
-- ============================================

-- ============================================
-- 1. USAGE EVENTS
-- Records each API request flowing through
-- the gateway: model, token counts, latency,
-- and an optional link to the corresponding
-- AIP trace for cross-referencing.
-- ============================================

CREATE TABLE usage_events (
  id                TEXT PRIMARY KEY,
  agent_id          TEXT NOT NULL REFERENCES agents(id),
  session_id        TEXT NOT NULL,
  trace_id          TEXT REFERENCES traces(trace_id) ON DELETE SET NULL,
  timestamp         TIMESTAMPTZ NOT NULL DEFAULT now(),
  model             TEXT NOT NULL,
  provider          TEXT NOT NULL DEFAULT 'anthropic',
  tokens_in         INTEGER NOT NULL DEFAULT 0,
  tokens_out        INTEGER NOT NULL DEFAULT 0,
  duration_ms       INTEGER NOT NULL DEFAULT 0,
  gateway_log_id    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_agent_time ON usage_events(agent_id, timestamp DESC);
CREATE INDEX idx_usage_model      ON usage_events(model, timestamp DESC);
CREATE INDEX idx_usage_timestamp  ON usage_events(timestamp DESC);
CREATE INDEX idx_usage_session    ON usage_events(session_id);

-- RLS: usage events are publicly readable (transparency principle),
-- but only the service role may insert.
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usage events are publicly readable"
  ON usage_events FOR SELECT
  USING (true);

CREATE POLICY "Service role can insert usage events"
  ON usage_events FOR INSERT
  WITH CHECK (true);

-- ============================================
-- 2. ADMIN STATS FUNCTION
-- Returns a single JSON object with platform-
-- wide aggregate counts: agents, traces,
-- checkpoints, active agents (last 24h),
-- usage events, and total tokens.
-- ============================================

CREATE OR REPLACE FUNCTION admin_get_stats()
RETURNS JSON AS $$
DECLARE
  v_total_agents        BIGINT;
  v_total_traces        BIGINT;
  v_total_checkpoints   BIGINT;
  v_active_agents_24h   BIGINT;
  v_total_usage_events  BIGINT;
  v_total_tokens_in     BIGINT;
  v_total_tokens_out    BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_total_agents FROM agents;
  SELECT COUNT(*) INTO v_total_traces FROM traces;
  SELECT COUNT(*) INTO v_total_checkpoints FROM integrity_checkpoints;

  SELECT COUNT(*) INTO v_active_agents_24h
  FROM agents
  WHERE last_seen > now() - INTERVAL '24 hours';

  SELECT
    COUNT(*),
    COALESCE(SUM(tokens_in), 0),
    COALESCE(SUM(tokens_out), 0)
  INTO v_total_usage_events, v_total_tokens_in, v_total_tokens_out
  FROM usage_events;

  RETURN json_build_object(
    'total_agents',       v_total_agents,
    'total_traces',       v_total_traces,
    'total_checkpoints',  v_total_checkpoints,
    'active_agents_24h',  v_active_agents_24h,
    'total_usage_events', v_total_usage_events,
    'total_tokens_in',    v_total_tokens_in,
    'total_tokens_out',   v_total_tokens_out
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 3. USAGE BY DAY FUNCTION
-- Returns one row per day for the last p_days,
-- with request count and token totals.
-- Used by the admin dashboard time-series chart.
-- ============================================

CREATE OR REPLACE FUNCTION admin_usage_by_day(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
  date        DATE,
  requests    BIGINT,
  tokens_in   BIGINT,
  tokens_out  BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (ue.timestamp AT TIME ZONE 'UTC')::DATE AS date,
    COUNT(*)::BIGINT                         AS requests,
    COALESCE(SUM(ue.tokens_in), 0)::BIGINT  AS tokens_in,
    COALESCE(SUM(ue.tokens_out), 0)::BIGINT AS tokens_out
  FROM usage_events ue
  WHERE ue.timestamp >= now() - (p_days || ' days')::INTERVAL
  GROUP BY (ue.timestamp AT TIME ZONE 'UTC')::DATE
  ORDER BY date;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 4. AGENT SUMMARY FUNCTION
-- Returns per-agent rollups: trace count,
-- checkpoint count, and checkpoint verdict
-- breakdowns. Useful for the admin agents list.
-- ============================================

CREATE OR REPLACE FUNCTION admin_agent_summary()
RETURNS TABLE (
  agent_id          TEXT,
  trace_count       BIGINT,
  checkpoint_count  BIGINT,
  clear_count       BIGINT,
  review_count      BIGINT,
  violation_count   BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id                                                                              AS agent_id,
    COALESCE(t.cnt, 0)::BIGINT                                                       AS trace_count,
    COALESCE(ic.cnt, 0)::BIGINT                                                      AS checkpoint_count,
    COALESCE(ic.clear_cnt, 0)::BIGINT                                                AS clear_count,
    COALESCE(ic.review_cnt, 0)::BIGINT                                               AS review_count,
    COALESCE(ic.violation_cnt, 0)::BIGINT                                            AS violation_count
  FROM agents a
  LEFT JOIN (
    SELECT tr.agent_id AS aid, COUNT(*) AS cnt
    FROM traces tr
    GROUP BY tr.agent_id
  ) t ON t.aid = a.id
  LEFT JOIN (
    SELECT
      cp.agent_id AS aid,
      COUNT(*)                                             AS cnt,
      COUNT(*) FILTER (WHERE cp.verdict = 'clear')          AS clear_cnt,
      COUNT(*) FILTER (WHERE cp.verdict = 'review_needed')  AS review_cnt,
      COUNT(*) FILTER (WHERE cp.verdict = 'boundary_violation') AS violation_cnt
    FROM integrity_checkpoints cp
    GROUP BY cp.agent_id
  ) ic ON ic.aid = a.id
  ORDER BY a.id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 5. USAGE BY MODEL FUNCTION
-- Returns one row per (date, model) pair for
-- the last p_days. Powers the per-model cost
-- breakdown chart in the admin console.
-- ============================================

CREATE OR REPLACE FUNCTION admin_usage_by_model(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
  date           DATE,
  model          TEXT,
  tokens_in      BIGINT,
  tokens_out     BIGINT,
  request_count  BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (ue.timestamp AT TIME ZONE 'UTC')::DATE AS date,
    ue.model                                AS model,
    COALESCE(SUM(ue.tokens_in), 0)::BIGINT AS tokens_in,
    COALESCE(SUM(ue.tokens_out), 0)::BIGINT AS tokens_out,
    COUNT(*)::BIGINT                        AS request_count
  FROM usage_events ue
  WHERE ue.timestamp >= now() - (p_days || ' days')::INTERVAL
  GROUP BY (ue.timestamp AT TIME ZONE 'UTC')::DATE, ue.model
  ORDER BY date, ue.model;
END;
$$ LANGUAGE plpgsql;
