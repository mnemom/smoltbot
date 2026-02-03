/**
 * Smoltbot Trace API - Cloudflare Worker
 *
 * This proxy layer:
 * - Receives traces from smoltbot plugins
 * - Validates trace structure
 * - Rate limits per agent_id
 * - Writes to Supabase (or any backend)
 *
 * Deploy: wrangler deploy
 */

export interface Env {
  // Supabase credentials (stored in Worker secrets)
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;

  // Rate limiting KV namespace (optional)
  RATE_LIMIT?: KVNamespace;
}

/**
 * AAP Trace structure
 */
interface AAPTrace {
  id: string;
  agent_id: string;
  timestamp: string;
  tool_name: string;
  action_type: 'allow' | 'deny' | 'error';
  params?: unknown;
  result?: unknown;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Batch request structure
 */
interface BatchRequest {
  batch: AAPTrace[];
}

/**
 * Validate trace structure
 */
function validateTrace(trace: unknown): trace is AAPTrace {
  if (!trace || typeof trace !== 'object') return false;
  const t = trace as Record<string, unknown>;

  return (
    typeof t.id === 'string' &&
    typeof t.agent_id === 'string' &&
    typeof t.timestamp === 'string' &&
    typeof t.tool_name === 'string' &&
    ['allow', 'deny', 'error'].includes(t.action_type as string)
  );
}

/**
 * Check rate limit (simple per-agent limit)
 */
async function checkRateLimit(
  agentId: string,
  kv: KVNamespace | undefined
): Promise<{ allowed: boolean; remaining: number }> {
  if (!kv) {
    return { allowed: true, remaining: 999 };
  }

  const key = `rate:${agentId}`;
  const window = 60; // 1 minute window
  const limit = 100; // 100 requests per minute per agent

  const current = await kv.get(key);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  await kv.put(key, String(count + 1), { expirationTtl: window });
  return { allowed: true, remaining: limit - count - 1 };
}

/**
 * Write trace to Supabase
 */
async function writeToSupabase(
  trace: AAPTrace,
  env: Env
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/traces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        id: trace.id,
        agent_id: trace.agent_id,
        timestamp: Date.parse(trace.timestamp),
        tool_name: trace.tool_name,
        action_type: trace.action_type,
        params: trace.params,
        result: trace.result,
        duration_ms: trace.duration_ms,
        trace_json: trace,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Supabase error: ${response.status} ${error}` };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Handle single trace POST
 */
async function handleSingleTrace(
  trace: AAPTrace,
  env: Env
): Promise<Response> {
  // Rate limit check
  const rateCheck = await checkRateLimit(trace.agent_id, env.RATE_LIMIT);
  if (!rateCheck.allowed) {
    return new Response(
      JSON.stringify({ success: false, error: 'Rate limit exceeded' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  // Write to database
  const result = await writeToSupabase(trace, env);

  if (!result.success) {
    return new Response(
      JSON.stringify({ success: false, error: result.error }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ success: true, trace_id: trace.id }),
    {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Remaining': String(rateCheck.remaining),
      },
    }
  );
}

/**
 * Handle batch trace POST
 */
async function handleBatchTrace(
  traces: AAPTrace[],
  env: Env
): Promise<Response> {
  if (traces.length === 0) {
    return new Response(
      JSON.stringify({ success: true, accepted: 0, rejected: 0 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Rate limit check on first trace's agent_id
  const rateCheck = await checkRateLimit(traces[0].agent_id, env.RATE_LIMIT);
  if (!rateCheck.allowed) {
    return new Response(
      JSON.stringify({ success: false, error: 'Rate limit exceeded', accepted: 0, rejected: traces.length }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Write all traces (batch insert)
  const rows = traces.map(trace => ({
    id: trace.id,
    agent_id: trace.agent_id,
    timestamp: Date.parse(trace.timestamp),
    tool_name: trace.tool_name,
    action_type: trace.action_type,
    params: trace.params,
    result: trace.result,
    duration_ms: trace.duration_ms,
    trace_json: trace,
  }));

  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/traces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(rows),
    });

    if (!response.ok) {
      const error = await response.text();
      return new Response(
        JSON.stringify({ success: false, error, accepted: 0, rejected: traces.length }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, accepted: traces.length, rejected: 0 }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: String(error), accepted: 0, rejected: traces.length }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Main request handler
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Only accept POST to /v1/traces
    const url = new URL(request.url);
    if (url.pathname !== '/v1/traces' || request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if batch request
    if (body && typeof body === 'object' && 'batch' in body) {
      const batchReq = body as BatchRequest;
      if (!Array.isArray(batchReq.batch)) {
        return new Response(
          JSON.stringify({ error: 'batch must be an array' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Validate all traces
      const validTraces: AAPTrace[] = [];
      for (const trace of batchReq.batch) {
        if (validateTrace(trace)) {
          validTraces.push(trace);
        }
      }

      if (validTraces.length === 0) {
        return new Response(
          JSON.stringify({ error: 'No valid traces in batch', accepted: 0, rejected: batchReq.batch.length }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const response = await handleBatchTrace(validTraces, env);
      // Add CORS headers to response
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
      return new Response(response.body, { status: response.status, headers: newHeaders });
    }

    // Single trace request
    if (!validateTrace(body)) {
      return new Response(
        JSON.stringify({ error: 'Invalid trace structure' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const response = await handleSingleTrace(body, env);
    // Add CORS headers to response
    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
    return new Response(response.body, { status: response.status, headers: newHeaders });
  },
};
