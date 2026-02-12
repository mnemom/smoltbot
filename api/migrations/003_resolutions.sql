-- Migration: Add resolutions table for acknowledge/resolve workflow
-- Allows principals to acknowledge warnings or modify alignment cards from the dashboard

CREATE TABLE IF NOT EXISTS resolutions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('checkpoint', 'trace')),
  target_id TEXT NOT NULL,
  resolution_type TEXT NOT NULL CHECK (resolution_type IN ('acknowledged', 'allow_action', 'add_value')),
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  UNIQUE(agent_id, target_type, target_id)
);

-- Index for fast lookups by agent
CREATE INDEX IF NOT EXISTS idx_resolutions_agent_id ON resolutions(agent_id);

-- Index for timeline queries (find resolved items for a given agent)
CREATE INDEX IF NOT EXISTS idx_resolutions_agent_target ON resolutions(agent_id, target_type, target_id);

-- Enable RLS
ALTER TABLE resolutions ENABLE ROW LEVEL SECURITY;

-- Policy: service role can do everything
CREATE POLICY "Service role full access on resolutions"
  ON resolutions FOR ALL
  USING (true)
  WITH CHECK (true);
