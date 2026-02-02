-- Smoltbot Row Level Security (RLS) Policies
--
-- Security model:
-- - Public read: Anyone can view traces (transparency is the point)
-- - Authenticated write: Only requests with service_role key can insert
--
-- This ensures the dashboard is publicly accessible while preventing
-- unauthorized writes to the traces table.

-- Enable RLS on the traces table
ALTER TABLE traces ENABLE ROW LEVEL SECURITY;

-- Policy: Allow anyone to read traces (including anonymous users)
-- This makes the dashboard publicly viewable without authentication
CREATE POLICY "Public read access for traces"
  ON traces
  FOR SELECT
  TO public
  USING (true);

-- Policy: Only service role can insert traces
-- Agents must use the service_role key (not anon key) to write
CREATE POLICY "Service role insert access for traces"
  ON traces
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Policy: Only service role can update traces
-- Updates should be rare, but allow for corrections
CREATE POLICY "Service role update access for traces"
  ON traces
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Only service role can delete traces
-- Deletions should be rare, mainly for cleanup/maintenance
CREATE POLICY "Service role delete access for traces"
  ON traces
  FOR DELETE
  TO service_role
  USING (true);

-- Note: The 'anon' role (used with anon key) will only have SELECT access
-- The 'service_role' (used with service_role key) has full CRUD access
--
-- In Supabase:
-- - anon key = public access, subject to RLS policies for 'public' role
-- - service_role key = bypasses RLS entirely, but we define policies anyway
--   for clarity and in case RLS bypass is ever disabled
