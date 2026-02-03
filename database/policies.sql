-- Smoltbot Row Level Security (RLS) Policies
--
-- Security Model (Proxy Architecture):
-- ┌─────────────────────────────────────────────────────────────────────┐
-- │  Plugin (client)  →  Proxy API  →  Supabase (service_role)         │
-- │                                                                     │
-- │  - Plugin has NO database credentials                               │
-- │  - Proxy validates, rate-limits, then writes with service_role     │
-- │  - service_role bypasses RLS (full write access, server-side only) │
-- │  - Public read access for transparency (the whole point)           │
-- └─────────────────────────────────────────────────────────────────────┘
--
-- This design allows us to:
-- - Swap databases without client changes
-- - Add rate limiting, validation at the proxy layer
-- - Keep write credentials server-side only
-- - Scale the proxy independently

-- Enable RLS on the traces table
ALTER TABLE traces ENABLE ROW LEVEL SECURITY;

-- Policy: Public read access (transparency is the point)
-- Anyone can view any agent's traces - that's the whole value proposition
CREATE POLICY "traces_public_read"
  ON traces
  FOR SELECT
  TO public
  USING (true);

-- Policy: Service role has full write access
-- Only the proxy API uses this (server-side, never exposed to clients)
CREATE POLICY "traces_service_write"
  ON traces
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Policy: Service role can update (rare, for corrections)
CREATE POLICY "traces_service_update"
  ON traces
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Service role can delete (maintenance only)
CREATE POLICY "traces_service_delete"
  ON traces
  FOR DELETE
  TO service_role
  USING (true);

-- Note: The anon key (public) can ONLY SELECT
-- All writes go through the proxy which uses service_role server-side
--
-- To verify policies:
--   SELECT * FROM pg_policies WHERE tablename = 'traces';
