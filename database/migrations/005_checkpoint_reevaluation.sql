-- ============================================
-- MIGRATION 005: Checkpoint Re-evaluation Support
-- Adds audit trail columns for re-evaluated
-- integrity checkpoints.
-- ============================================

ALTER TABLE integrity_checkpoints
  ADD COLUMN IF NOT EXISTS original_verdict TEXT;

ALTER TABLE integrity_checkpoints
  ADD COLUMN IF NOT EXISTS re_evaluated_at TIMESTAMPTZ;

ALTER TABLE integrity_checkpoints
  ADD COLUMN IF NOT EXISTS re_evaluation_metadata JSONB;

CREATE INDEX IF NOT EXISTS idx_checkpoints_reevaluated
  ON integrity_checkpoints(re_evaluated_at)
  WHERE re_evaluated_at IS NOT NULL;
