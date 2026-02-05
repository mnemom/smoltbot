/**
 * Smoltbot Backend API Worker
 *
 * Serves the dashboard and CLI with agent data.
 * Routes:
 * - GET /health - Health check
 * - GET /v1/agents/:id - Get agent by ID
 * - GET /v1/agents/:id/card - Get active alignment card for agent
 * - GET /v1/traces - Query traces with filters
 * - GET /v1/traces/:id - Get single trace by ID
 * - GET /v1/integrity/:agent_id - Compute integrity score
 * - GET /v1/drift/:agent_id - Get recent drift alerts
 */

import { detectDrift, type APTrace, type AlignmentCard } from '@mnemom/agent-alignment-protocol';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
}

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Helper to create JSON response with CORS
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

// Helper to create error response
function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

// Supabase query helper
async function supabaseQuery(
  env: Env,
  table: string,
  options: {
    select?: string;
    filters?: Record<string, string | number | boolean>;
    eq?: [string, string | number | boolean];
    order?: { column: string; ascending?: boolean };
    limit?: number;
    offset?: number;
    single?: boolean;
  } = {}
): Promise<{ data: unknown; error: string | null }> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${table}`);

  // Add select
  if (options.select) {
    url.searchParams.set('select', options.select);
  }

  // Add filters
  if (options.filters) {
    for (const [key, value] of Object.entries(options.filters)) {
      url.searchParams.set(key, `eq.${value}`);
    }
  }

  // Add single eq filter (for backwards compatibility)
  if (options.eq) {
    url.searchParams.set(options.eq[0], `eq.${options.eq[1]}`);
  }

  // Add ordering
  if (options.order) {
    url.searchParams.set('order', `${options.order.column}.${options.order.ascending ? 'asc' : 'desc'}`);
  }

  // Add limit
  if (options.limit) {
    url.searchParams.set('limit', options.limit.toString());
  }

  // Add offset
  if (options.offset) {
    url.searchParams.set('offset', options.offset.toString());
  }

  const headers: Record<string, string> = {
    'apikey': env.SUPABASE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };

  // Request single item
  if (options.single) {
    headers['Accept'] = 'application/vnd.pgrst.object+json';
  }

  try {
    const response = await fetch(url.toString(), { headers });

    if (!response.ok) {
      const errorText = await response.text();
      return { data: null, error: errorText };
    }

    const data = await response.json();
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// Route handlers
async function handleHealth(): Promise<Response> {
  return jsonResponse({ status: 'ok' });
}

async function handleGetAgent(env: Env, agentId: string): Promise<Response> {
  if (!agentId) {
    return errorResponse('Agent ID is required', 400);
  }

  const { data, error } = await supabaseQuery(env, 'agents', {
    eq: ['id', agentId],
    single: true,
  });

  if (error) {
    if (error.includes('PGRST116') || error.includes('0 rows')) {
      return errorResponse('Agent not found', 404);
    }
    return errorResponse(`Database error: ${error}`, 500);
  }

  return jsonResponse(data);
}

async function handleGetAgentCard(env: Env, agentId: string): Promise<Response> {
  if (!agentId) {
    return errorResponse('Agent ID is required', 400);
  }

  // Get the active alignment card for the agent
  const { data, error } = await supabaseQuery(env, 'alignment_cards', {
    filters: { agent_id: agentId, is_active: true },
    single: true,
  });

  if (error) {
    if (error.includes('PGRST116') || error.includes('0 rows')) {
      return errorResponse('Alignment card not found', 404);
    }
    return errorResponse(`Database error: ${error}`, 500);
  }

  return jsonResponse(data);
}

async function handleGetTraces(env: Env, url: URL): Promise<Response> {
  const agentId = url.searchParams.get('agent_id');
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  if (isNaN(limit) || limit < 1 || limit > 1000) {
    return errorResponse('Invalid limit parameter (must be 1-1000)', 400);
  }

  if (isNaN(offset) || offset < 0) {
    return errorResponse('Invalid offset parameter (must be >= 0)', 400);
  }

  const filters: Record<string, string | number | boolean> = {};
  if (agentId) {
    filters.agent_id = agentId;
  }

  const { data, error } = await supabaseQuery(env, 'traces', {
    filters,
    order: { column: 'created_at', ascending: false },
    limit,
    offset,
  });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  return jsonResponse({ traces: data, limit, offset });
}

async function handleGetTrace(env: Env, traceId: string): Promise<Response> {
  if (!traceId) {
    return errorResponse('Trace ID is required', 400);
  }

  const { data, error } = await supabaseQuery(env, 'traces', {
    eq: ['id', traceId],
    single: true,
  });

  if (error) {
    if (error.includes('PGRST116') || error.includes('0 rows')) {
      return errorResponse('Trace not found', 404);
    }
    return errorResponse(`Database error: ${error}`, 500);
  }

  return jsonResponse(data);
}

async function handleGetIntegrity(env: Env, agentId: string): Promise<Response> {
  if (!agentId) {
    return errorResponse('Agent ID is required', 400);
  }

  // Try to use the compute_integrity_score() function first
  const rpcUrl = `${env.SUPABASE_URL}/rest/v1/rpc/compute_integrity_score`;

  try {
    const rpcResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_agent_id: agentId }),
    });

    if (rpcResponse.ok) {
      const score = await rpcResponse.json();
      return jsonResponse(score);
    }
  } catch {
    // Fall through to manual calculation
  }

  // Manual calculation if RPC not available
  const { data: traces, error } = await supabaseQuery(env, 'traces', {
    filters: { agent_id: agentId },
    select: 'id,verification',
  });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  const traceList = traces as Array<{ id: string; verification?: { verified?: boolean; violations?: string[] } }>;

  const totalTraces = traceList.length;
  const verifiedTraces = traceList.filter(t => t.verification?.verified === true).length;
  const violations = traceList.filter(t =>
    t.verification?.violations && t.verification.violations.length > 0
  ).length;

  const score = totalTraces > 0 ? verifiedTraces / totalTraces : 0;

  return jsonResponse({
    agent_id: agentId,
    total_traces: totalTraces,
    verified_traces: verifiedTraces,
    violations,
    score: Math.round(score * 100) / 100,
  });
}

async function handleGetDrift(env: Env, agentId: string): Promise<Response> {
  if (!agentId) {
    return errorResponse('Agent ID is required', 400);
  }

  // Get the active alignment card for the agent
  const { data: cardData, error: cardError } = await supabaseQuery(env, 'alignment_cards', {
    filters: { agent_id: agentId, is_active: true },
    single: true,
  });

  if (cardError) {
    if (cardError.includes('PGRST116') || cardError.includes('0 rows')) {
      return errorResponse('Alignment card not found for agent', 404);
    }
    return errorResponse(`Database error: ${cardError}`, 500);
  }

  // Get recent traces for the agent
  const { data: tracesData, error: tracesError } = await supabaseQuery(env, 'traces', {
    filters: { agent_id: agentId },
    order: { column: 'created_at', ascending: false },
    limit: 100,
  });

  if (tracesError) {
    return errorResponse(`Database error: ${tracesError}`, 500);
  }

  const cardRecord = cardData as { card_json: AlignmentCard };
  const traces = tracesData as Array<{ trace_json: APTrace }>;

  // Run drift detection using AAP SDK
  try {
    const apTraces = traces.map(t => t.trace_json);
    const driftResult = detectDrift(cardRecord.card_json, apTraces);

    return jsonResponse({
      agent_id: agentId,
      analyzed_traces: traces.length,
      drift: driftResult,
    });
  } catch (err) {
    return errorResponse(
      `Drift detection failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      500
    );
  }
}

// Main request handler
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Only allow GET requests (except OPTIONS handled above)
    if (request.method !== 'GET') {
      return errorResponse('Method not allowed', 405);
    }

    try {
      // Route matching
      // GET /health
      if (path === '/health') {
        return handleHealth();
      }

      // GET /v1/agents/:id/card
      const agentCardMatch = path.match(/^\/v1\/agents\/([^/]+)\/card$/);
      if (agentCardMatch) {
        return handleGetAgentCard(env, agentCardMatch[1]);
      }

      // GET /v1/agents/:id
      const agentMatch = path.match(/^\/v1\/agents\/([^/]+)$/);
      if (agentMatch) {
        return handleGetAgent(env, agentMatch[1]);
      }

      // GET /v1/traces (with query params)
      if (path === '/v1/traces') {
        return handleGetTraces(env, url);
      }

      // GET /v1/traces/:id
      const traceMatch = path.match(/^\/v1\/traces\/([^/]+)$/);
      if (traceMatch) {
        return handleGetTrace(env, traceMatch[1]);
      }

      // GET /v1/integrity/:agent_id
      const integrityMatch = path.match(/^\/v1\/integrity\/([^/]+)$/);
      if (integrityMatch) {
        return handleGetIntegrity(env, integrityMatch[1]);
      }

      // GET /v1/drift/:agent_id
      const driftMatch = path.match(/^\/v1\/drift\/([^/]+)$/);
      if (driftMatch) {
        return handleGetDrift(env, driftMatch[1]);
      }

      // 404 for unmatched routes
      return errorResponse('Not found', 404);

    } catch (err) {
      console.error('Unexpected error:', err);
      return errorResponse(
        `Internal server error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        500
      );
    }
  },
};
