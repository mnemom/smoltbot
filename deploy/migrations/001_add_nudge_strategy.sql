-- Add nudge_strategy column to agents table
-- Controls when nudges are created for boundary violations:
--   always:    every boundary violation creates a nudge (default)
--   sampling:  nudge on a percentage of violations
--   threshold: only nudge after N violations in a session
--   off:       no nudging, observe only

ALTER TABLE agents ADD COLUMN IF NOT EXISTS nudge_strategy text NOT NULL DEFAULT 'always';
