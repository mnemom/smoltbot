-- Migration 006: Enforcement Nudges
-- Adds nudge delivery tracking for the conscience nudge system.
-- When observer/gateway detects a boundary_violation, a pending nudge is created.
-- On the agent's next request, the gateway injects it into the system prompt.

-- Extend enforcement mode to include 'nudge'
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_aip_enforcement_mode_check;
ALTER TABLE agents ADD CONSTRAINT agents_aip_enforcement_mode_check
  CHECK (aip_enforcement_mode IN ('observe', 'enforce', 'nudge'));

-- Nudge delivery tracking
CREATE TABLE enforcement_nudges (
  id                  TEXT PRIMARY KEY,           -- "nudge-{hex8}"
  agent_id            TEXT NOT NULL REFERENCES agents(id),
  checkpoint_id       TEXT NOT NULL REFERENCES integrity_checkpoints(checkpoint_id),
  session_id          TEXT NOT NULL,              -- session where violation occurred
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'delivered', 'expired')),
  nudge_content       TEXT NOT NULL,              -- exact text injected (audit trail)
  concerns_summary    TEXT NOT NULL,              -- human-readable summary
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at        TIMESTAMPTZ,
  delivery_session_id TEXT,                       -- session where delivered (may differ)
  delivery_request_id TEXT,                       -- request-level correlation
  expired_at          TIMESTAMPTZ
);

CREATE INDEX idx_nudges_agent_pending ON enforcement_nudges(agent_id, status)
  WHERE status = 'pending';
CREATE INDEX idx_nudges_checkpoint ON enforcement_nudges(checkpoint_id);

ALTER TABLE enforcement_nudges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Nudges readable" ON enforcement_nudges FOR SELECT USING (true);
CREATE POLICY "Service role manages nudges" ON enforcement_nudges FOR ALL USING (true);
