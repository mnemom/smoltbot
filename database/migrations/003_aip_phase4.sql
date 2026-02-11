-- ============================================
-- MIGRATION 003: AIP Phase 4 Enhancements
-- Adds per-agent enforcement mode, per-card
-- conscience values, webhook delivery tracking,
-- webhook HMAC signing secret, and checkpoint
-- source tracking.
-- ============================================

-- ============================================
-- 1. PER-AGENT ENFORCEMENT MODE
-- Controls whether AIP conscience checks are
-- passive ('observe') or actively block actions
-- that fail integrity checks ('enforce').
-- ============================================

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS aip_enforcement_mode TEXT NOT NULL DEFAULT 'observe'
  CHECK (aip_enforcement_mode IN ('observe', 'enforce'));

-- ============================================
-- 2. PER-CARD CONSCIENCE VALUES
-- Optional JSONB overrides for conscience
-- thresholds and weights on each alignment card.
-- NULL means the SDK defaults are used.
-- ============================================

ALTER TABLE alignment_cards
  ADD COLUMN IF NOT EXISTS conscience_values JSONB;

-- ============================================
-- 3. WEBHOOK DELIVERY TRACKING
-- Records each individual delivery attempt for
-- a webhook registration + checkpoint pair.
-- Supports retry logic via status and attempts.
-- ============================================

CREATE TABLE IF NOT EXISTS aip_webhook_deliveries (
  id              TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES aip_webhook_registrations(registration_id) ON DELETE CASCADE,
  checkpoint_id   TEXT NOT NULL REFERENCES integrity_checkpoints(checkpoint_id),
  event_type      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  response_status INTEGER,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deliveries_registration ON aip_webhook_deliveries(registration_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON aip_webhook_deliveries(status) WHERE status = 'pending';

-- RLS: webhook deliveries are private; service role only.
ALTER TABLE aip_webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage webhook deliveries"
  ON aip_webhook_deliveries FOR ALL
  USING (true);

-- ============================================
-- 4. WEBHOOK HMAC SIGNING SECRET
-- Stores the raw secret used to compute HMAC
-- signatures on outgoing webhook payloads.
-- The existing secret_hash column holds only
-- the hash for verification; this column holds
-- the secret needed for signing.
-- ============================================

ALTER TABLE aip_webhook_registrations
  ADD COLUMN IF NOT EXISTS secret TEXT;

-- ============================================
-- 5. CHECKPOINT SOURCE TRACKING
-- Records whether a checkpoint was created by
-- the observer (SDK-side) or the gateway
-- (server-side enforcement).
-- ============================================

ALTER TABLE integrity_checkpoints
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'observer';
