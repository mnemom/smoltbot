# Smoltbot Database Setup

This guide walks you through setting up Supabase as the backend for Smoltbot's trace storage.

## 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in (or create an account)
2. Click **New Project**
3. Choose your organization
4. Enter project details:
   - **Name**: `smoltbot` (or your preferred name)
   - **Database Password**: Generate a strong password and save it
   - **Region**: Choose the closest region to your users
5. Click **Create new project** and wait for provisioning (~2 minutes)

## 2. Run the Schema

1. In your Supabase dashboard, go to **SQL Editor** (left sidebar)
2. Click **New query**
3. Copy the contents of `schema.sql` and paste into the editor
4. Click **Run** (or press Cmd/Ctrl + Enter)
5. Verify the table was created by going to **Table Editor** - you should see the `traces` table

## 3. Set Up Row Level Security (RLS)

1. Still in **SQL Editor**, create a new query
2. Copy the contents of `policies.sql` and paste into the editor
3. Click **Run**
4. Verify RLS is enabled:
   - Go to **Authentication** > **Policies**
   - You should see the `traces` table with 4 policies listed

## 4. Enable Realtime

Realtime allows the dashboard to receive live updates as new traces come in.

1. Go to **Database** > **Replication** (in left sidebar)
2. Find the `traces` table in the list
3. Toggle on the replication switch for `traces`
4. Alternatively, run this SQL:

```sql
-- Enable realtime for traces table
ALTER PUBLICATION supabase_realtime ADD TABLE traces;
```

## 5. Get Your API Credentials

1. Go to **Settings** > **API** (in left sidebar)
2. Note down these values:

### Project URL
```
https://<project-ref>.supabase.co
```

### API Keys

- **anon (public) key**: Use this in the dashboard for read-only access
- **service_role key**: Use this in agents for write access (keep secret!)

## 6. Configure Smoltbot

Create a `.env` file in your project root (or set environment variables):

```bash
# For the dashboard (public, read-only)
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJI...

# For agents (secret, write access)
SUPABASE_SERVICE_KEY=eyJhbGciOiJI...
```

**Important**: Never commit the service key to version control!

## 7. Test the Setup

### Test read access (should work with anon key):

```bash
curl 'https://<project-ref>.supabase.co/rest/v1/traces?limit=1' \
  -H "apikey: <anon-key>" \
  -H "Authorization: Bearer <anon-key>"
```

### Test write access (should work with service key):

```bash
curl 'https://<project-ref>.supabase.co/rest/v1/traces' \
  -X POST \
  -H "apikey: <service-key>" \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test-trace-001",
    "agent_id": "test-agent",
    "timestamp": 1234567890000,
    "tool_name": "test_tool",
    "action_type": "allow",
    "trace_json": {"test": true}
  }'
```

### Test write fails with anon key (should return 403):

```bash
curl 'https://<project-ref>.supabase.co/rest/v1/traces' \
  -X POST \
  -H "apikey: <anon-key>" \
  -H "Authorization: Bearer <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test-trace-002",
    "agent_id": "test-agent",
    "timestamp": 1234567890000,
    "tool_name": "test_tool",
    "action_type": "allow",
    "trace_json": {"test": true}
  }'
```

## Troubleshooting

### "permission denied for table traces"
- Make sure you ran the `policies.sql` file
- Check that RLS is enabled on the table
- Verify you're using the correct API key (service key for writes)

### Realtime not working
- Verify replication is enabled for the `traces` table
- Check browser console for WebSocket connection errors
- Ensure your Supabase plan supports Realtime (free tier does)

### Slow queries
- The schema includes indexes for common query patterns
- For very large datasets, consider adding partitioning by timestamp
- Monitor query performance in Supabase dashboard under **Database** > **Query Performance**

## Schema Reference

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Unique trace ID (primary key) |
| `agent_id` | TEXT | Identifier for the agent instance |
| `timestamp` | INTEGER | Unix timestamp in milliseconds |
| `tool_name` | TEXT | Name of the tool that was called |
| `action_type` | TEXT | 'allow', 'deny', or 'error' |
| `params` | JSONB | Parameters passed to the tool |
| `result` | JSONB | Result returned by the tool |
| `duration_ms` | INTEGER | Execution time in milliseconds |
| `trace_json` | JSONB | Full AAP trace for extensibility |
| `created_at` | TIMESTAMPTZ | When the trace was inserted |
