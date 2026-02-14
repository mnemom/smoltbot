-- ============================================
-- MIGRATION 007: Fix AIP Integrity RPC
-- The compute_integrity_score_aip function was
-- written before re-evaluation support (005).
-- It counted re-evaluated checkpoints as active
-- reviews/violations, inflating the stats.
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
