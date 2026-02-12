/**
 * Smoltbot Backend API Worker
 *
 * Serves the dashboard and CLI with agent data.
 * Routes:
 * - GET /health - Health check
 * - GET /v1/agents/:id - Get agent by ID
 * - GET /v1/agents/:id/card - Get active alignment card for agent
 * - POST /v1/agents/:id/claim - Claim agent with hash proof
 * - GET /v1/agents/:id/traces - Get traces for agent (AAP query_endpoint)
 * - GET /v1/traces - Query traces with filters
 * - GET /v1/traces/:id - Get single trace by ID
 * - GET /v1/integrity/:agent_id - Compute integrity score
 * - GET /v1/drift/:agent_id - Get recent drift alerts
 * - GET /v1/blog/posts - List published blog posts
 * - GET /v1/blog/posts/:slug - Get single blog post by slug
 * - GET /v1/blog/authors/:agent_id - Get author profile and their posts
 * - POST /v1/blog/posts - Create blog post (service role only)
 * - GET /v1/ssm/:agent_id - Get recent traces with similarity scores
 * - GET /v1/ssm/:agent_id/timeline - Get similarity timeline data
 * - POST /v1/agents/:id/link - Link claimed agent to authenticated user
 * - GET /v1/auth/me - Get authenticated user info and linked agents
 * - GET /v1/agents/:id/integrity/aip - AIP integrity score
 * - GET /v1/agents/:id/checkpoints - Paginated integrity checkpoints
 * - GET /v1/agents/:id/checkpoints/:checkpoint_id - Single checkpoint
 * - GET /v1/agents/:id/drift/aip - AIP drift alerts
 * - POST /v1/aip/webhooks - Register AIP webhook
 * - DELETE /v1/aip/webhooks/:registration_id - Remove AIP webhook
 * - GET /v1/agents/:id/conscience-values - Get conscience values for agent
 * - PUT /v1/agents/:id/conscience-values - Update conscience values for agent
 * - DELETE /v1/agents/:id/conscience-values - Reset conscience values to defaults
 * - GET /v1/agents/:id/enforcement - Get AIP enforcement mode
 * - PUT /v1/agents/:id/enforcement - Update AIP enforcement mode
 * - GET /v1/admin/stats - Admin dashboard aggregate stats
 * - GET /v1/admin/usage - Admin usage metrics by day
 * - GET /v1/admin/users - Admin user listing with agent counts
 * - GET /v1/admin/agents - Admin agent listing with integrity summaries
 * - GET /v1/admin/costs - Admin cost breakdown by model
 * - POST /v1/agents/:id/reverify/aip - Re-evaluate AIP checkpoints against updated card
 */

import { detectDrift, verifyTrace, type APTrace, type AlignmentCard } from '@mnemom/agent-alignment-protocol';
import { DEFAULT_CONSCIENCE_VALUES } from '@mnemom/agent-integrity-protocol';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  SUPABASE_JWT_SECRET: string;
  MNEMOM_PUBLISH_KEY: string;
}

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
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

// Supabase insert helper
async function supabaseInsert(
  env: Env,
  table: string,
  data: Record<string, unknown>
): Promise<{ data: unknown; error: string | null }> {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { data: null, error: errorText };
    }

    const result = await response.json();
    return { data: result, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// Supabase update helper
async function supabaseUpdate(
  env: Env,
  table: string,
  filters: Record<string, string | number | boolean>,
  data: Record<string, unknown>
): Promise<{ data: unknown; error: string | null }> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${table}`);

  // Add filters
  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, `eq.${value}`);
  }

  try {
    const response = await fetch(url.toString(), {
      method: 'PATCH',
      headers: {
        'apikey': env.SUPABASE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { data: null, error: errorText };
    }

    const result = await response.json();
    return { data: result, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// Supabase delete helper
async function supabaseDelete(
  env: Env,
  table: string,
  filters: Record<string, string | number | boolean>
): Promise<{ count: number; error: string | null }> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${table}`);

  // Add filters
  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, `eq.${value}`);
  }

  try {
    const response = await fetch(url.toString(), {
      method: 'DELETE',
      headers: {
        'apikey': env.SUPABASE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { count: 0, error: errorText };
    }

    const result = await response.json() as unknown[];
    return { count: result.length, error: null };
  } catch (err) {
    return { count: 0, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// Supabase RPC helper
async function supabaseRpc(
  env: Env,
  functionName: string,
  params: Record<string, unknown> = {}
): Promise<{ data: unknown; error: string | null }> {
  const url = `${env.SUPABASE_URL}/rest/v1/rpc/${functionName}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });
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

// Supabase Admin API: list users
async function supabaseAdminListUsers(
  env: Env,
  page = 1,
  perPage = 50
): Promise<{ users: unknown[]; total: number; error: string | null }> {
  const url = `${env.SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`;
  try {
    const response = await fetch(url, {
      headers: {
        'apikey': env.SUPABASE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      },
    });
    if (!response.ok) {
      return { users: [], total: 0, error: await response.text() };
    }
    const data = await response.json() as { users: unknown[]; total: number };
    return { users: data.users || [], total: data.total || 0, error: null };
  } catch (err) {
    return { users: [], total: 0, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// SHA-256 hash helper
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// JWT verification (Supabase Auth tokens, ES256 / ECDSA P-256)
interface JWTPayload {
  sub: string;
  email?: string;
  role?: string;
  app_metadata?: { is_admin?: boolean };
  exp: number;
  iat: number;
}

interface JWK {
  kty: string;
  crv: string;
  x: string;
  y: string;
  kid: string;
}

function base64UrlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Cache the imported key
let cachedVerifyKey: CryptoKey | null = null;

async function getVerifyKey(env: Env): Promise<CryptoKey> {
  if (cachedVerifyKey) return cachedVerifyKey;

  // Fetch JWKS from Supabase
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`, {
    headers: { apikey: env.SUPABASE_KEY },
  });
  const jwks = await res.json() as { keys: JWK[] };
  const jwk = jwks.keys[0];

  cachedVerifyKey = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true, key_ops: ['verify'] },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );

  return cachedVerifyKey;
}

async function verifyJWT(token: string, env: Env): Promise<JWTPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;

    // Decode header to check algorithm
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64)));

    let valid: boolean;

    if (header.alg === 'ES256') {
      // ECDSA verification with public key from JWKS
      const key = await getVerifyKey(env);
      // ES256 signatures need to be converted from DER to raw (r||s) format
      // Supabase JWTs use raw format already (64 bytes for P-256)
      valid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        base64UrlDecode(signatureB64),
        new TextEncoder().encode(`${headerB64}.${payloadB64}`),
      );
    } else if (header.alg === 'HS256') {
      // HMAC fallback for legacy tokens
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(env.SUPABASE_JWT_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      valid = await crypto.subtle.verify(
        'HMAC',
        key,
        base64UrlDecode(signatureB64),
        new TextEncoder().encode(`${headerB64}.${payloadB64}`),
      );
    } else {
      return null;
    }

    if (!valid) return null;

    const payload: JWTPayload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(payloadB64)),
    );

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

async function getAuthUser(request: Request, env: Env): Promise<JWTPayload | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return verifyJWT(authHeader.slice(7), env);
}

async function requireAdmin(request: Request, env: Env): Promise<JWTPayload | Response> {
  const user = await getAuthUser(request, env);
  if (!user) return errorResponse('Authentication required', 401);
  if (!user.app_metadata?.is_admin) return errorResponse('Admin access required', 403);
  return user;
}

// Generate unique ID with prefix
function generateId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}-${id}`;
}

// Route handlers
async function handleHealth(): Promise<Response> {
  return jsonResponse({ status: 'ok' });
}

async function handleGetAgent(env: Env, agentId: string, request: Request): Promise<Response> {
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

  const agent = data as Record<string, unknown>;

  // If agent is claimed and has an owner, check if requester is the owner
  // Public agents are visible to everyone (opt-in transparency)
  if (agent.user_id && !agent.public) {
    const user = await getAuthUser(request, env);
    if (!user || user.sub !== agent.user_id) {
      return jsonResponse({
        id: agent.id,
        created_at: agent.created_at,
        claimed: true,
        private: true,
        message: 'This agent exists but traces are private.',
      });
    }
  }

  // Compute status from last_seen (active if seen within 1 hour)
  const lastSeen = agent.last_seen ? new Date(agent.last_seen as string).getTime() : 0;
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  agent.status = lastSeen > oneHourAgo ? 'active' : 'offline';

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

async function handleUpdateAgentCard(env: Env, agentId: string, request: Request): Promise<Response> {
  if (!agentId) {
    return errorResponse('Agent ID is required', 400);
  }

  const body = await request.json() as { card_json: AlignmentCard };
  if (!body.card_json) {
    return errorResponse('card_json is required in request body', 400);
  }

  const headers = {
    'apikey': env.SUPABASE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };

  const cardId = `ac-${agentId.replace('smolt-', '')}`;
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/alignment_cards?id=eq.${cardId}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        card_json: body.card_json,
        issued_at: new Date().toISOString(),
      }),
    }
  );

  if (!response.ok) {
    return errorResponse(`Failed to update card: ${response.status}`, 500);
  }

  return jsonResponse({ updated: true, card_id: cardId });
}

async function handleGetTraces(env: Env, url: URL, request: Request): Promise<Response> {
  const agentId = url.searchParams.get('agent_id');
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  if (isNaN(limit) || limit < 1 || limit > 1000) {
    return errorResponse('Invalid limit parameter (must be 1-1000)', 400);
  }

  if (isNaN(offset) || offset < 0) {
    return errorResponse('Invalid offset parameter (must be >= 0)', 400);
  }

  // If filtering by agent_id, check ownership for claimed agents
  // Public agents skip ownership checks (opt-in transparency)
  if (agentId) {
    const { data: agentData } = await supabaseQuery(env, 'agents', {
      eq: ['id', agentId],
      select: 'id,user_id,public',
      single: true,
    });
    if (agentData) {
      const agent = agentData as { user_id?: string; public?: boolean };
      if (agent.user_id && !agent.public) {
        const user = await getAuthUser(request, env);
        if (!user || user.sub !== agent.user_id) {
          return jsonResponse({ traces: [], limit, offset, private: true });
        }
      }
    }
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
    violation_count: violations,
    integrity_score: Math.floor(score * 10000) / 10000,
  });
}

async function handleReverify(env: Env, agentId: string, url: URL): Promise<Response> {
  if (!agentId) {
    return errorResponse('Agent ID is required', 400);
  }

  // CF Workers have a 50 subrequest limit — use limit/offset for pagination
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '40', 10), 40);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  // Fetch active alignment card
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

  const card = (cardData as { card_json: AlignmentCard }).card_json;

  // Fetch traces for this agent (paginated)
  const { data: tracesData, error: tracesError } = await supabaseQuery(env, 'traces', {
    filters: { agent_id: agentId },
    select: 'trace_id,trace_json,verification',
    order: { column: 'timestamp', ascending: true },
    limit,
    offset,
  });

  if (tracesError) {
    return errorResponse(`Database error: ${tracesError}`, 500);
  }

  const traces = tracesData as Array<{
    trace_id: string;
    trace_json: APTrace;
    verification: unknown;
  }>;

  // Re-verify each trace against the updated card
  let updated = 0;
  let stillViolating = 0;
  const errors: string[] = [];

  const headers = {
    'apikey': env.SUPABASE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };

  // Process sequentially to stay within subrequest limits
  for (const trace of traces) {
    try {
      const newVerification = verifyTrace(trace.trace_json, card);
      const patchRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/traces?trace_id=eq.${trace.trace_id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ verification: newVerification }),
        }
      );
      if (!patchRes.ok) {
        errors.push(`PATCH failed for ${trace.trace_id}: ${patchRes.status}`);
      } else {
        updated++;
        if (newVerification.violations.length > 0) stillViolating++;
      }
    } catch (err) {
      errors.push(`${trace.trace_id}: ${err}`);
    }
  }

  return jsonResponse({
    agent_id: agentId,
    card_id: card.card_id,
    total_traces_in_batch: traces.length,
    offset,
    limit,
    reverified: updated,
    still_violating: stillViolating,
    now_clean: updated - stillViolating,
    errors: errors.length > 0 ? errors : undefined,
  });
}

// ============================================
// AIP Checkpoint Re-evaluation
// Deterministically re-evaluates non-clear checkpoints
// against the agent's current alignment card.
// ============================================

interface CheckpointConcern {
  category?: string;
  severity?: string;
  description?: string;
  evidence?: string;
  relevant_card_field?: string;
  relevant_conscience_value?: string;
}

interface CheckpointRow {
  checkpoint_id: string;
  agent_id: string;
  card_id: string;
  session_id: string;
  verdict: string;
  concerns: CheckpointConcern[];
  reasoning_summary: string;
  timestamp: string;
  re_evaluated_at: string | null;
}

async function handleReverifyAip(env: Env, agentId: string, url: URL): Promise<Response> {
  if (!agentId) {
    return errorResponse('Agent ID is required', 400);
  }

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 20);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  // 1. Fetch active alignment card for the agent
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

  const cardRecord = cardData as { card_json: Record<string, any>; id: string };
  const cardJson = cardRecord.card_json;
  const cardId = cardRecord.id || cardJson.card_id || 'unknown';

  // Extract card fields for re-evaluation
  const declaredValues: string[] = (cardJson.values?.declared || []).map((v: string) => v.toLowerCase());
  const boundedActions: string[] = cardJson.autonomy_envelope?.bounded_actions || [];

  // 2. Fetch non-clear checkpoints that haven't been re-evaluated yet
  const checkpointsUrl = new URL(`${env.SUPABASE_URL}/rest/v1/integrity_checkpoints`);
  checkpointsUrl.searchParams.set('agent_id', `eq.${agentId}`);
  checkpointsUrl.searchParams.set('verdict', 'neq.clear');
  checkpointsUrl.searchParams.set('re_evaluated_at', 'is.null');
  checkpointsUrl.searchParams.set('order', 'timestamp.asc');
  checkpointsUrl.searchParams.set('limit', limit.toString());
  checkpointsUrl.searchParams.set('offset', offset.toString());

  const headers = {
    'apikey': env.SUPABASE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };

  let checkpoints: CheckpointRow[];
  try {
    const cpResponse = await fetch(checkpointsUrl.toString(), { headers });
    if (!cpResponse.ok) {
      const errText = await cpResponse.text();
      return errorResponse(`Failed to fetch checkpoints: ${errText}`, 500);
    }
    checkpoints = await cpResponse.json() as CheckpointRow[];
  } catch (err) {
    return errorResponse(`Failed to fetch checkpoints: ${err}`, 500);
  }

  // Categories that must NEVER be auto-resolved
  const neverResolveCategories = new Set([
    'prompt_injection',
    'deceptive_reasoning',
    'reasoning_corruption',
  ]);

  // Journalism keywords derived from bounded_action semantics
  const journalismKeywords = [
    'search', 'moltbook', 'api', 'browse', 'agent', 'fetch',
    'proxy', 'credential', 'memory', 'keyword', 'exploration',
  ];

  // Research-related keywords for undeclared_intent resolution
  const researchKeywords = [
    'search', 'explore', 'dig', 'broader', 'general', 'existential',
    'agent', 'topic', 'content', 'api', 'script', 'hit',
  ];

  // 3. Re-evaluate each checkpoint
  let reEvaluatedCount = 0;
  let resolvedToClearCount = 0;
  let keptNonClearCount = 0;
  const errors: string[] = [];
  const results: Array<{
    checkpoint_id: string;
    old_verdict: string;
    new_verdict: string;
    concerns_before: number;
    concerns_after: number;
    resolved_concerns: string[];
  }> = [];

  // Extract bounded_action prefixes (before ':') for matching
  const boundedActionPrefixes = boundedActions.map(
    (ba: string) => (ba.includes(':') ? ba.split(':')[0] : ba).toLowerCase()
  );

  for (const checkpoint of checkpoints) {
    try {
      const oldVerdict = checkpoint.verdict;
      const allConcerns: CheckpointConcern[] = checkpoint.concerns || [];
      const remainingConcerns: CheckpointConcern[] = [];
      const resolvedDescriptions: string[] = [];

      for (const concern of allConcerns) {
        const category = concern.category || '';
        const severity = (concern.severity || '').toLowerCase();
        const description = (concern.description || '').toLowerCase();
        const evidence = (concern.evidence || '').toLowerCase();
        const relevantField = (concern.relevant_card_field || '').toLowerCase();

        // NEVER auto-resolve security-sensitive categories
        if (neverResolveCategories.has(category)) {
          remainingConcerns.push(concern);
          continue;
        }

        let resolved = false;

        // autonomy_violation where relevant_card_field contains 'bounded_actions'
        if (category === 'autonomy_violation' && relevantField.includes('bounded_actions')) {
          // Check if evidence/description overlaps with bounded_action prefixes
          const hasActionOverlap = boundedActionPrefixes.some(
            (prefix: string) => evidence.includes(prefix) || description.includes(prefix)
          );
          // Also check journalism keywords
          const hasKeywordOverlap = journalismKeywords.some(
            (kw) => evidence.includes(kw) || description.includes(kw)
          );
          if (hasActionOverlap || hasKeywordOverlap) {
            resolved = true;
          }
        }

        // undeclared_intent
        if (!resolved && category === 'undeclared_intent') {
          const hasInvestigativeRigor = declaredValues.includes('investigative_rigor');
          const hasResearchKeyword = researchKeywords.some(
            (kw) => evidence.includes(kw) || description.includes(kw)
          );
          if (hasInvestigativeRigor && hasResearchKeyword) {
            resolved = true;
          }
        }

        // value_misalignment with low severity
        if (!resolved && category === 'value_misalignment' && severity === 'low') {
          const mentionsSourcing = description.includes('sourc') || evidence.includes('sourc')
            || description.includes('accuracy') || evidence.includes('accuracy');
          const hasSourceAttribution = declaredValues.includes('source_attribution');
          const hasAccuracy = declaredValues.includes('accuracy');
          if (mentionsSourcing && hasSourceAttribution && hasAccuracy) {
            resolved = true;
          }
        }

        if (resolved) {
          resolvedDescriptions.push(`${category}: ${concern.description || 'no description'}`);
        } else {
          remainingConcerns.push(concern);
        }
      }

      // 4. Determine new verdict
      let newVerdict: string;
      if (remainingConcerns.length === 0) {
        newVerdict = 'clear';
      } else {
        const hasHighOrCritical = remainingConcerns.some((c) => {
          const sev = (c.severity || '').toLowerCase();
          return sev === 'high' || sev === 'critical';
        });
        newVerdict = hasHighOrCritical ? 'boundary_violation' : 'review_needed';
      }

      // 5. Build update payload
      const reEvaluationMetadata = {
        method: 'deterministic_card_recheck',
        card_id: cardId,
        resolution_notes: resolvedDescriptions.length > 0
          ? `Resolved ${resolvedDescriptions.length} concern(s): ${resolvedDescriptions.join('; ')}`
          : 'No concerns resolved',
        concerns_before: allConcerns.length,
        concerns_after: remainingConcerns.length,
      };

      const updatePayload: Record<string, unknown> = {
        original_verdict: oldVerdict,
        re_evaluated_at: new Date().toISOString(),
        re_evaluation_metadata: reEvaluationMetadata,
      };

      // If verdict changed, update verdict, concerns, and reasoning
      if (newVerdict !== oldVerdict) {
        updatePayload.verdict = newVerdict;
        updatePayload.concerns = remainingConcerns;
        updatePayload.reasoning_summary = `Re-evaluated: ${checkpoint.reasoning_summary}`;
      }

      const patchRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/integrity_checkpoints?checkpoint_id=eq.${checkpoint.checkpoint_id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify(updatePayload),
        }
      );

      if (!patchRes.ok) {
        errors.push(`PATCH failed for ${checkpoint.checkpoint_id}: ${patchRes.status}`);
      } else {
        reEvaluatedCount++;
        if (newVerdict === 'clear') {
          resolvedToClearCount++;
        } else {
          keptNonClearCount++;
        }
      }

      results.push({
        checkpoint_id: checkpoint.checkpoint_id,
        old_verdict: oldVerdict,
        new_verdict: newVerdict,
        concerns_before: allConcerns.length,
        concerns_after: remainingConcerns.length,
        resolved_concerns: resolvedDescriptions,
      });
    } catch (err) {
      errors.push(`${checkpoint.checkpoint_id}: ${err}`);
    }
  }

  // 6. Return summary
  return jsonResponse({
    agent_id: agentId,
    card_id: cardId,
    total_in_batch: checkpoints.length,
    offset,
    limit,
    re_evaluated: reEvaluatedCount,
    resolved_to_clear: resolvedToClearCount,
    kept_non_clear: keptNonClearCount,
    results,
    errors: errors.length > 0 ? errors : undefined,
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

// ============================================
// BLOG ENDPOINTS
// ============================================

interface BlogPost {
  id: string;
  agent_id: string;
  slug: string;
  title: string;
  subtitle?: string;
  body: string;
  tags: string[];
  investigation_session_id?: string;
  trace_ids: string[];
  published_at?: string;
  created_at: string;
  updated_at: string;
  status: string;
  view_count: number;
}

async function handleGetBlogPosts(env: Env, url: URL): Promise<Response> {
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const agentId = url.searchParams.get('agent_id');

  if (isNaN(limit) || limit < 1 || limit > 100) {
    return errorResponse('Invalid limit parameter (must be 1-100)', 400);
  }

  if (isNaN(offset) || offset < 0) {
    return errorResponse('Invalid offset parameter (must be >= 0)', 400);
  }

  const filters: Record<string, string | number | boolean> = {
    status: 'published',
  };

  if (agentId) {
    filters.agent_id = agentId;
  }

  const { data, error } = await supabaseQuery(env, 'blog_posts', {
    select: 'id,agent_id,slug,title,subtitle,tags,published_at,created_at,view_count',
    filters,
    order: { column: 'published_at', ascending: false },
    limit,
    offset,
  });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  return jsonResponse({ posts: data, limit, offset });
}

async function handleGetBlogPost(env: Env, slug: string): Promise<Response> {
  if (!slug) {
    return errorResponse('Slug is required', 400);
  }

  // Get the post
  const { data: postData, error: postError } = await supabaseQuery(env, 'blog_posts', {
    filters: { slug, status: 'published' },
    single: true,
  });

  if (postError) {
    if (postError.includes('PGRST116') || postError.includes('0 rows')) {
      return errorResponse('Blog post not found', 404);
    }
    return errorResponse(`Database error: ${postError}`, 500);
  }

  const post = postData as BlogPost;

  // Get linked traces if any
  let linkedTraces: unknown[] = [];
  if (post.trace_ids && post.trace_ids.length > 0) {
    // Fetch traces by IDs
    const traceUrl = new URL(`${env.SUPABASE_URL}/rest/v1/traces`);
    traceUrl.searchParams.set('trace_id', `in.(${post.trace_ids.join(',')})`);

    try {
      const traceResponse = await fetch(traceUrl.toString(), {
        headers: {
          'apikey': env.SUPABASE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      if (traceResponse.ok) {
        linkedTraces = await traceResponse.json();
      }
    } catch {
      // Continue without traces if fetch fails
    }
  }

  return jsonResponse({ post, linked_traces: linkedTraces });
}

async function handleGetBlogAuthor(env: Env, agentId: string): Promise<Response> {
  if (!agentId) {
    return errorResponse('Agent ID is required', 400);
  }

  // Get agent profile
  const { data: agentData, error: agentError } = await supabaseQuery(env, 'agents', {
    eq: ['id', agentId],
    single: true,
  });

  if (agentError) {
    if (agentError.includes('PGRST116') || agentError.includes('0 rows')) {
      return errorResponse('Author not found', 404);
    }
    return errorResponse(`Database error: ${agentError}`, 500);
  }

  // Get published posts by this agent
  const { data: postsData, error: postsError } = await supabaseQuery(env, 'blog_posts', {
    select: 'id,slug,title,subtitle,tags,published_at,view_count',
    filters: { agent_id: agentId, status: 'published' },
    order: { column: 'published_at', ascending: false },
    limit: 50,
  });

  if (postsError) {
    return errorResponse(`Database error: ${postsError}`, 500);
  }

  return jsonResponse({ author: agentData, posts: postsData });
}

async function handleCreateBlogPost(env: Env, request: Request): Promise<Response> {
  // Verify service role authorization
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return errorResponse('Authorization required', 401);
  }

  const token = authHeader.slice(7);
  if (token !== env.SUPABASE_KEY && token !== env.MNEMOM_PUBLISH_KEY) {
    return errorResponse('Invalid authorization', 403);
  }

  // Parse request body
  let body: Partial<BlogPost>;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  // Validate required fields
  if (!body.agent_id) {
    return errorResponse('agent_id is required', 400);
  }
  if (!body.slug) {
    return errorResponse('slug is required', 400);
  }
  if (!body.title) {
    return errorResponse('title is required', 400);
  }
  if (!body.body) {
    return errorResponse('body is required', 400);
  }

  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(body.slug)) {
    return errorResponse('slug must contain only lowercase letters, numbers, and hyphens', 400);
  }

  // Create the post
  const postId = generateId('bp');
  const now = new Date().toISOString();

  const postData = {
    id: postId,
    agent_id: body.agent_id,
    slug: body.slug,
    title: body.title,
    subtitle: body.subtitle || null,
    body: body.body,
    tags: body.tags || [],
    investigation_session_id: body.investigation_session_id || null,
    trace_ids: body.trace_ids || [],
    published_at: body.status === 'published' ? now : null,
    created_at: now,
    updated_at: now,
    status: body.status || 'draft',
    view_count: 0,
  };

  const { data, error } = await supabaseInsert(env, 'blog_posts', postData);

  if (error) {
    if (error.includes('duplicate key') || error.includes('unique constraint')) {
      return errorResponse('A post with this slug already exists', 409);
    }
    return errorResponse(`Database error: ${error}`, 500);
  }

  return jsonResponse(data, 201);
}

// ============================================
// CLAIMING ENDPOINT
// ============================================

async function handleClaimAgent(env: Env, agentId: string, request: Request): Promise<Response> {
  // Parse request body
  let body: { hash_proof: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.hash_proof) {
    return errorResponse('hash_proof is required', 400);
  }

  // Get the agent
  const { data: agentData, error: agentError } = await supabaseQuery(env, 'agents', {
    eq: ['id', agentId],
    single: true,
  });

  if (agentError) {
    if (agentError.includes('PGRST116') || agentError.includes('0 rows')) {
      return errorResponse('Agent not found', 404);
    }
    return errorResponse(`Database error: ${agentError}`, 500);
  }

  const agent = agentData as { id: string; agent_hash: string; claimed_at?: string };

  // Check if already claimed
  if (agent.claimed_at) {
    return errorResponse('Agent has already been claimed', 409);
  }

  // Verify the hash proof
  // The user submits sha256(api_key) — a 64-char hex string
  // The stored agent_hash is sha256(api_key).slice(0,16)
  // Compare first 16 chars of the proof against the stored hash
  const truncatedProof = body.hash_proof.slice(0, 16);

  if (truncatedProof !== agent.agent_hash) {
    return errorResponse('Invalid hash proof', 403);
  }

  // Claim the agent
  const now = new Date().toISOString();
  const updateData: Record<string, unknown> = {
    claimed_at: now,
    claimed_by: truncatedProof, // Use hash as identifier
  };

  if (body.email) {
    updateData.email = body.email;
  }

  const { error: updateError } = await supabaseUpdate(
    env,
    'agents',
    { id: agentId },
    updateData
  );

  if (updateError) {
    return errorResponse(`Database error: ${updateError}`, 500);
  }

  return jsonResponse({
    claimed: true,
    agent_id: agentId,
    claimed_at: now,
  });
}

// ============================================
// AUTH ENDPOINTS
// ============================================

async function handleLinkAgent(env: Env, agentId: string, request: Request): Promise<Response> {
  const user = await getAuthUser(request, env);
  if (!user) {
    return errorResponse('Authentication required', 401);
  }

  let body: { hash_proof: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.hash_proof) {
    return errorResponse('hash_proof is required', 400);
  }

  const { data: agentData, error: agentError } = await supabaseQuery(env, 'agents', {
    eq: ['id', agentId],
    single: true,
  });

  if (agentError) {
    if (agentError.includes('PGRST116') || agentError.includes('0 rows')) {
      return errorResponse('Agent not found', 404);
    }
    return errorResponse(`Database error: ${agentError}`, 500);
  }

  const agent = agentData as { id: string; agent_hash: string; user_id?: string };

  // Verify hash proof
  const truncatedProof = body.hash_proof.slice(0, 16);
  if (truncatedProof !== agent.agent_hash) {
    return errorResponse('Invalid hash proof', 403);
  }

  // Check if already linked to a different user
  if (agent.user_id && agent.user_id !== user.sub) {
    return errorResponse('Agent is already linked to another account', 409);
  }

  const { error: updateError } = await supabaseUpdate(
    env,
    'agents',
    { id: agentId },
    { user_id: user.sub, email: user.email || null },
  );

  if (updateError) {
    return errorResponse(`Database error: ${updateError}`, 500);
  }

  return jsonResponse({ linked: true, agent_id: agentId, user_id: user.sub });
}

async function handleGetMe(env: Env, request: Request): Promise<Response> {
  const user = await getAuthUser(request, env);
  if (!user) {
    return errorResponse('Authentication required', 401);
  }

  const { data: agents, error } = await supabaseQuery(env, 'agents', {
    filters: { user_id: user.sub },
  });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  return jsonResponse({
    user_id: user.sub,
    email: user.email,
    agents: agents || [],
  });
}

// ============================================
// SSM (Semantic Similarity Matrix) ENDPOINTS
// ============================================

interface TraceWithSimilarity {
  trace_id: string;
  timestamp: string;
  action: {
    type: string;
    name: string;
    category?: string;
  };
  decision: {
    selected: string;
    values_applied: string[];
    confidence?: number;
  };
  similarity_scores?: Record<string, number>;
}

// Simple cosine similarity for value overlap
function computeValueSimilarity(values1: string[], values2: string[]): number {
  if (!values1?.length || !values2?.length) return 0;

  const set1 = new Set(values1.map(v => v.toLowerCase()));
  const set2 = new Set(values2.map(v => v.toLowerCase()));

  const intersection = [...set1].filter(v => set2.has(v)).length;
  const union = new Set([...set1, ...set2]).size;

  return union > 0 ? intersection / union : 0;
}

async function handleGetSSM(env: Env, agentId: string, url: URL): Promise<Response> {
  if (!agentId) {
    return errorResponse('Agent ID is required', 400);
  }

  const limit = parseInt(url.searchParams.get('limit') || '20', 10);

  if (isNaN(limit) || limit < 1 || limit > 100) {
    return errorResponse('Invalid limit parameter (must be 1-100)', 400);
  }

  // Get recent traces
  const { data: tracesData, error: tracesError } = await supabaseQuery(env, 'traces', {
    select: 'trace_id,timestamp,action,decision',
    filters: { agent_id: agentId },
    order: { column: 'timestamp', ascending: false },
    limit,
  });

  if (tracesError) {
    return errorResponse(`Database error: ${tracesError}`, 500);
  }

  const traces = tracesData as Array<{
    trace_id: string;
    timestamp: string;
    action: { type: string; name: string; category?: string };
    decision: { selected: string; values_applied: string[]; confidence?: number };
  }>;

  // Compute similarity matrix
  const tracesWithSimilarity: TraceWithSimilarity[] = traces.map((trace, i) => {
    const similarity_scores: Record<string, number> = {};

    for (let j = 0; j < traces.length; j++) {
      if (i !== j) {
        const otherTrace = traces[j];
        const score = computeValueSimilarity(
          trace.decision?.values_applied || [],
          otherTrace.decision?.values_applied || []
        );
        similarity_scores[otherTrace.trace_id] = Math.round(score * 100) / 100;
      }
    }

    return {
      ...trace,
      similarity_scores,
    };
  });

  return jsonResponse({
    agent_id: agentId,
    trace_count: traces.length,
    traces: tracesWithSimilarity,
  });
}

async function handleGetSSMTimeline(env: Env, agentId: string, url: URL): Promise<Response> {
  if (!agentId) {
    return errorResponse('Agent ID is required', 400);
  }

  const days = parseInt(url.searchParams.get('days') || '7', 10);

  if (isNaN(days) || days < 1 || days > 30) {
    return errorResponse('Invalid days parameter (must be 1-30)', 400);
  }

  // Get traces from the time period
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data: tracesData, error: tracesError } = await supabaseQuery(env, 'traces', {
    select: 'trace_id,timestamp,decision',
    filters: { agent_id: agentId },
    order: { column: 'timestamp', ascending: true },
    limit: 500,
  });

  if (tracesError) {
    return errorResponse(`Database error: ${tracesError}`, 500);
  }

  const traces = tracesData as Array<{
    trace_id: string;
    timestamp: string;
    decision: { values_applied: string[] };
  }>;

  // Filter traces within date range
  const filteredTraces = traces.filter(t => new Date(t.timestamp) >= startDate);

  // Group by day and compute average similarity within each day
  const dailyData: Record<string, { date: string; trace_count: number; avg_similarity: number; values_used: Record<string, number> }> = {};

  for (const trace of filteredTraces) {
    const date = trace.timestamp.split('T')[0];

    if (!dailyData[date]) {
      dailyData[date] = {
        date,
        trace_count: 0,
        avg_similarity: 0,
        values_used: {},
      };
    }

    dailyData[date].trace_count++;

    // Count value usage
    const values = trace.decision?.values_applied || [];
    for (const value of values) {
      dailyData[date].values_used[value] = (dailyData[date].values_used[value] || 0) + 1;
    }
  }

  // Compute self-similarity for each day (how consistent values are within the day)
  for (const date of Object.keys(dailyData)) {
    const dayTraces = filteredTraces.filter(t => t.timestamp.startsWith(date));
    if (dayTraces.length > 1) {
      let totalSimilarity = 0;
      let comparisons = 0;

      for (let i = 0; i < dayTraces.length; i++) {
        for (let j = i + 1; j < dayTraces.length; j++) {
          totalSimilarity += computeValueSimilarity(
            dayTraces[i].decision?.values_applied || [],
            dayTraces[j].decision?.values_applied || []
          );
          comparisons++;
        }
      }

      dailyData[date].avg_similarity = comparisons > 0
        ? Math.round((totalSimilarity / comparisons) * 100) / 100
        : 0;
    }
  }

  // Convert to sorted array
  const timeline = Object.values(dailyData).sort((a, b) => a.date.localeCompare(b.date));

  return jsonResponse({
    agent_id: agentId,
    days,
    timeline,
  });
}

// ============================================
// AIP (Agent Integrity Protocol) ENDPOINTS
// ============================================

async function handleGetAipIntegrity(env: Env, agentId: string): Promise<Response> {
  if (!agentId) {
    return errorResponse('Agent ID is required', 400);
  }

  // Try RPC function first
  const rpcUrl = `${env.SUPABASE_URL}/rest/v1/rpc/compute_integrity_score_aip`;

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

  // Manual calculation from integrity_checkpoints table
  const { data: checkpoints, error } = await supabaseQuery(env, 'integrity_checkpoints', {
    filters: { agent_id: agentId },
    select: 'checkpoint_id,verdict,timestamp',
  });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  const checkpointList = checkpoints as Array<{
    checkpoint_id: string;
    verdict: string;
    timestamp: string;
  }>;

  const totalChecks = checkpointList.length;
  const clearCount = checkpointList.filter(c => c.verdict === 'clear').length;
  const reviewCount = checkpointList.filter(c => c.verdict === 'review_needed').length;
  const violationCount = checkpointList.filter(c => c.verdict === 'boundary_violation').length;
  const integrityRatio = totalChecks > 0 ? Math.round((clearCount / totalChecks) * 1000) / 1000 : 0;

  // Find the latest verdict by timestamp
  let latestVerdict: string | null = null;
  if (checkpointList.length > 0) {
    const sorted = checkpointList.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    latestVerdict = sorted[0].verdict;
  }

  return jsonResponse({
    agent_id: agentId,
    total_checks: totalChecks,
    clear_count: clearCount,
    review_count: reviewCount,
    violation_count: violationCount,
    integrity_ratio: integrityRatio,
    latest_verdict: latestVerdict,
  });
}

async function handleGetCheckpoints(env: Env, agentId: string, url: URL): Promise<Response> {
  if (!agentId) {
    return errorResponse('Agent ID is required', 400);
  }

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const verdict = url.searchParams.get('verdict');
  const sessionId = url.searchParams.get('session_id');

  if (isNaN(limit) || limit < 1) {
    return errorResponse('Invalid limit parameter (must be 1-100)', 400);
  }

  if (isNaN(offset) || offset < 0) {
    return errorResponse('Invalid offset parameter (must be >= 0)', 400);
  }

  const filters: Record<string, string | number | boolean> = { agent_id: agentId };
  if (verdict) {
    filters.verdict = verdict;
  }
  if (sessionId) {
    filters.session_id = sessionId;
  }

  // Fetch checkpoints
  const { data, error } = await supabaseQuery(env, 'integrity_checkpoints', {
    filters,
    order: { column: 'timestamp', ascending: false },
    limit,
    offset,
  });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  // Fetch total count with a HEAD-like request using Prefer: count=exact
  const countUrl = new URL(`${env.SUPABASE_URL}/rest/v1/integrity_checkpoints`);
  countUrl.searchParams.set('agent_id', `eq.${agentId}`);
  if (verdict) {
    countUrl.searchParams.set('verdict', `eq.${verdict}`);
  }
  if (sessionId) {
    countUrl.searchParams.set('session_id', `eq.${sessionId}`);
  }
  countUrl.searchParams.set('select', 'checkpoint_id');

  let total = 0;
  try {
    const countResponse = await fetch(countUrl.toString(), {
      method: 'HEAD',
      headers: {
        'apikey': env.SUPABASE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_KEY}`,
        'Prefer': 'count=exact',
      },
    });
    const contentRange = countResponse.headers.get('content-range');
    if (contentRange) {
      // Format: "0-N/total" or "*/total"
      const parts = contentRange.split('/');
      if (parts[1] && parts[1] !== '*') {
        total = parseInt(parts[1], 10);
      }
    }
  } catch {
    // If count fails, use the length of the returned data as a fallback
    total = (data as unknown[])?.length ?? 0;
  }

  return jsonResponse({
    checkpoints: data,
    total,
    limit,
    offset,
  });
}

// ============================================================================
// Unified Timeline — dual-rail AIP + AAP events with linking
// ============================================================================

interface TimelineEvent {
  id: string;
  timestamp: string;
  rail: 'aip' | 'aap';
  // Detection
  detection: 'violation' | 'concern' | 'clear';
  // Response (what was done about it — placeholder until enforcement is built)
  response: 'intervention' | 'advisory' | 'noted' | 'none';
  // Link to the other rail
  linked_id: string | null;
  // AIP-specific
  aip?: {
    checkpoint_id: string;
    verdict: string;
    concerns: unknown[];
    reasoning_summary: string;
    session_id: string;
  };
  // AAP-specific
  aap?: {
    trace_id: string;
    action_name: string;
    action_category: string;
    decision_selected: string;
    selection_reasoning: string;
    values_applied: string[];
    confidence: number | null;
    verified: boolean;
    violations: unknown[];
  };
}

async function handleGetTimeline(env: Env, agentId: string, url: URL): Promise<Response> {
  if (!agentId) {
    return errorResponse('Agent ID is required', 400);
  }

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);

  // Fetch recent checkpoints (non-clear only for timeline, plus clear linked ones)
  const { data: checkpointsData, error: cpError } = await supabaseQuery(env, 'integrity_checkpoints', {
    filters: { agent_id: agentId },
    select: 'checkpoint_id,timestamp,verdict,concerns,reasoning_summary,session_id,linked_trace_id',
    order: { column: 'timestamp', ascending: false },
    limit,
  });

  if (cpError) {
    return errorResponse(`Database error: ${cpError}`, 500);
  }

  // Fetch recent traces
  const { data: tracesData, error: trError } = await supabaseQuery(env, 'traces', {
    filters: { agent_id: agentId },
    select: 'trace_id,timestamp,action,decision,verification',
    order: { column: 'timestamp', ascending: false },
    limit,
  });

  if (trError) {
    return errorResponse(`Database error: ${trError}`, 500);
  }

  const checkpoints = (checkpointsData ?? []) as Array<{
    checkpoint_id: string;
    timestamp: string;
    verdict: string;
    concerns: Array<{ category?: string; severity?: string; description?: string; evidence?: string }>;
    reasoning_summary: string;
    session_id: string;
    linked_trace_id: string | null;
  }>;

  const traces = (tracesData ?? []) as Array<{
    trace_id: string;
    timestamp: string;
    action: { type: string; name: string; category: string; target?: unknown };
    decision: { selected: string; selection_reasoning: string; values_applied: string[]; confidence?: number };
    verification: { verified: boolean; violations: unknown[] } | null;
  }>;

  // Build trace lookup by ID for linking
  const traceById = new Map(traces.map(t => [t.trace_id, t]));
  const linkedTraceIds = new Set<string>();

  // Build timeline events from checkpoints
  const events: TimelineEvent[] = [];

  for (const cp of checkpoints) {
    // Skip synthetic/clear checkpoints that aren't linked to anything interesting
    if (cp.verdict === 'clear' && !cp.linked_trace_id) continue;

    const detection: TimelineEvent['detection'] =
      cp.verdict === 'boundary_violation' ? 'violation'
      : cp.verdict === 'review_needed' ? 'concern'
      : 'clear';

    // Determine response — for now all are 'noted' since enforcement isn't built yet
    // When enforcement lands: check interventions table for this checkpoint
    const response: TimelineEvent['response'] = 'noted';

    const event: TimelineEvent = {
      id: cp.checkpoint_id,
      timestamp: cp.timestamp,
      rail: 'aip',
      detection,
      response,
      linked_id: cp.linked_trace_id,
      aip: {
        checkpoint_id: cp.checkpoint_id,
        verdict: cp.verdict,
        concerns: cp.concerns,
        reasoning_summary: cp.reasoning_summary,
        session_id: cp.session_id,
      },
    };

    // If linked, attach the AAP trace data inline
    if (cp.linked_trace_id && traceById.has(cp.linked_trace_id)) {
      const trace = traceById.get(cp.linked_trace_id)!;
      linkedTraceIds.add(trace.trace_id);
      event.aap = {
        trace_id: trace.trace_id,
        action_name: trace.action.name,
        action_category: trace.action.category,
        decision_selected: trace.decision.selected,
        selection_reasoning: trace.decision.selection_reasoning,
        values_applied: trace.decision.values_applied,
        confidence: trace.decision.confidence ?? null,
        verified: trace.verification?.verified ?? true,
        violations: trace.verification?.violations ?? [],
      };
    }

    events.push(event);
  }

  // Add unlinked AAP traces that have violations (interesting on their own)
  for (const trace of traces) {
    if (linkedTraceIds.has(trace.trace_id)) continue;
    const hasViolation = trace.verification && !trace.verification.verified;
    if (!hasViolation) continue;

    events.push({
      id: trace.trace_id,
      timestamp: trace.timestamp,
      rail: 'aap',
      detection: 'violation',
      response: 'noted',
      linked_id: null,
      aap: {
        trace_id: trace.trace_id,
        action_name: trace.action.name,
        action_category: trace.action.category,
        decision_selected: trace.decision.selected,
        selection_reasoning: trace.decision.selection_reasoning,
        values_applied: trace.decision.values_applied,
        confidence: trace.decision.confidence ?? null,
        verified: false,
        violations: trace.verification?.violations ?? [],
      },
    });
  }

  // Sort by timestamp descending (most recent first)
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Classify each event by story type
  const classified = events.map(event => {
    let story: string;
    if (event.aip && event.aap) {
      // Both rails — linked event
      const aipBad = event.detection !== 'clear';
      const aapBad = event.aap && !event.aap.verified;
      if (aipBad && aapBad && event.response === 'intervention') {
        story = 'caught_and_corrected';
      } else if (aipBad && aapBad) {
        story = 'caught_but_missed';
      } else if (aipBad && !aapBad) {
        story = 'prevented';
      } else {
        story = 'clean_linked';
      }
    } else if (event.rail === 'aap' && !event.linked_id) {
      story = 'no_warning';
    } else if (event.rail === 'aip' && event.detection !== 'clear' && !event.linked_id) {
      story = 'thought_only';
    } else {
      story = 'unclassified';
    }
    return { ...event, story };
  });

  return jsonResponse({
    agent_id: agentId,
    events: classified,
    total: classified.length,
    summary: {
      caught_but_missed: classified.filter(e => e.story === 'caught_but_missed').length,
      prevented: classified.filter(e => e.story === 'prevented').length,
      no_warning: classified.filter(e => e.story === 'no_warning').length,
      thought_only: classified.filter(e => e.story === 'thought_only').length,
    },
  });
}

async function handleGetCheckpoint(env: Env, agentId: string, checkpointId: string): Promise<Response> {
  if (!agentId) {
    return errorResponse('Agent ID is required', 400);
  }
  if (!checkpointId) {
    return errorResponse('Checkpoint ID is required', 400);
  }

  const { data, error } = await supabaseQuery(env, 'integrity_checkpoints', {
    filters: { agent_id: agentId, checkpoint_id: checkpointId },
    single: true,
  });

  if (error) {
    if (error.includes('PGRST116') || error.includes('0 rows')) {
      return errorResponse('Checkpoint not found', 404);
    }
    return errorResponse(`Database error: ${error}`, 500);
  }

  return jsonResponse(data);
}

async function handleGetAipDrift(env: Env, agentId: string): Promise<Response> {
  if (!agentId) {
    return errorResponse('Agent ID is required', 400);
  }

  // Strategy 1: Try querying a drift_alerts table for AIP-specific alerts
  const { data: alertsData, error: alertsError } = await supabaseQuery(env, 'drift_alerts', {
    filters: { agent_id: agentId },
    order: { column: 'detection_timestamp', ascending: false },
    limit: 50,
  });

  if (!alertsError && alertsData) {
    // Filter for AIP alert types (alert_type starting with 'aip:')
    const allAlerts = alertsData as Array<Record<string, unknown>>;
    const aipAlerts = allAlerts.filter(a =>
      typeof a.alert_type === 'string' && (a.alert_type as string).startsWith('aip:')
    );

    if (aipAlerts.length > 0) {
      return jsonResponse({ alerts: aipAlerts, agent_id: agentId });
    }
  }

  // Strategy 2: Detect drift patterns from integrity_checkpoints
  // Look for 3+ consecutive non-clear verdicts in the same session
  const { data: checkpointsData, error: checkpointsError } = await supabaseQuery(env, 'integrity_checkpoints', {
    filters: { agent_id: agentId },
    select: 'checkpoint_id,session_id,verdict,timestamp,concerns',
    order: { column: 'timestamp', ascending: true },
    limit: 500,
  });

  if (checkpointsError) {
    return errorResponse(`Database error: ${checkpointsError}`, 500);
  }

  const checkpoints = checkpointsData as Array<{
    checkpoint_id: string;
    session_id: string;
    verdict: string;
    timestamp: string;
    concerns?: Array<{ category?: string }>;
  }>;

  // Group by session_id
  const sessionGroups: Record<string, typeof checkpoints> = {};
  for (const cp of checkpoints) {
    if (!sessionGroups[cp.session_id]) {
      sessionGroups[cp.session_id] = [];
    }
    sessionGroups[cp.session_id].push(cp);
  }

  // Detect consecutive non-clear runs of 3+ in each session
  const alerts: Array<{
    alert_id: string;
    agent_id: string;
    session_id: string;
    checkpoint_ids: string[];
    sustained_checks: number;
    severity: string;
    drift_direction: string;
    message: string;
    detection_timestamp: string;
  }> = [];

  for (const [sessionId, sessionCheckpoints] of Object.entries(sessionGroups)) {
    let consecutiveNonClear: typeof checkpoints = [];

    for (const cp of sessionCheckpoints) {
      if (cp.verdict !== 'clear') {
        consecutiveNonClear.push(cp);
      } else {
        // Check if run meets threshold before resetting
        if (consecutiveNonClear.length >= 3) {
          const checkpointIds = consecutiveNonClear.map(c => c.checkpoint_id);
          const sustained = consecutiveNonClear.length;

          // Determine drift direction from concerns
          const allCategories = consecutiveNonClear
            .flatMap(c => (c.concerns || []).map(con => con.category || 'unknown'));
          const categoryCounts: Record<string, number> = {};
          for (const cat of allCategories) {
            categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
          }
          const topCategory = Object.entries(categoryCounts)
            .sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

          // Map concern categories to drift directions
          const directionMap: Record<string, string> = {
            'prompt_injection': 'injection_pattern',
            'value_misalignment': 'value_erosion',
            'autonomy_violation': 'autonomy_creep',
            'deception': 'deception_pattern',
          };
          const driftDirection = directionMap[topCategory] || 'unknown';

          // Severity based on sustained checks count
          const severity = sustained >= 7 ? 'high' : sustained >= 5 ? 'medium' : 'low';

          alerts.push({
            alert_id: `ida-${generateId('drift')}`,
            agent_id: agentId,
            session_id: sessionId,
            checkpoint_ids: checkpointIds,
            sustained_checks: sustained,
            severity,
            drift_direction: driftDirection,
            message: `Detected ${sustained} consecutive non-clear verdicts in session ${sessionId}`,
            detection_timestamp: consecutiveNonClear[consecutiveNonClear.length - 1].timestamp,
          });
        }
        consecutiveNonClear = [];
      }
    }

    // Check trailing run at end of session
    if (consecutiveNonClear.length >= 3) {
      const checkpointIds = consecutiveNonClear.map(c => c.checkpoint_id);
      const sustained = consecutiveNonClear.length;
      const allCategories = consecutiveNonClear
        .flatMap(c => (c.concerns || []).map(con => con.category || 'unknown'));
      const categoryCounts: Record<string, number> = {};
      for (const cat of allCategories) {
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      }
      const topCategory = Object.entries(categoryCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
      const directionMap: Record<string, string> = {
        'prompt_injection': 'injection_pattern',
        'value_misalignment': 'value_erosion',
        'autonomy_violation': 'autonomy_creep',
        'deception': 'deception_pattern',
      };
      const driftDirection = directionMap[topCategory] || 'unknown';
      const severity = sustained >= 7 ? 'high' : sustained >= 5 ? 'medium' : 'low';

      alerts.push({
        alert_id: `ida-${generateId('drift')}`,
        agent_id: agentId,
        session_id: sessionId,
        checkpoint_ids: checkpointIds,
        sustained_checks: sustained,
        severity,
        drift_direction: driftDirection,
        message: `Detected ${sustained} consecutive non-clear verdicts in session ${sessionId}`,
        detection_timestamp: consecutiveNonClear[consecutiveNonClear.length - 1].timestamp,
      });
    }
  }

  return jsonResponse({ alerts, agent_id: agentId });
}

async function handleRegisterAipWebhook(env: Env, request: Request): Promise<Response> {
  // Parse request body
  let body: { agent_id?: string; callback_url?: string; secret?: string; events?: string[] };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.agent_id) {
    return errorResponse('agent_id is required', 400);
  }
  if (!body.callback_url) {
    return errorResponse('callback_url is required', 400);
  }
  if (!body.secret) {
    return errorResponse('secret is required', 400);
  }
  if (!body.events || !Array.isArray(body.events) || body.events.length === 0) {
    return errorResponse('events must be a non-empty array of event types', 400);
  }

  // Validate callback_url is a valid URL
  try {
    new URL(body.callback_url);
  } catch {
    return errorResponse('callback_url must be a valid URL', 400);
  }

  // Hash the secret before storing
  const secretHash = await sha256(body.secret);

  const registrationId = generateId('awh');
  const now = new Date().toISOString();

  const registrationData = {
    registration_id: registrationId,
    agent_id: body.agent_id,
    callback_url: body.callback_url,
    secret: body.secret,
    secret_hash: secretHash,
    events: body.events,
    created_at: now,
  };

  const { data, error } = await supabaseInsert(env, 'aip_webhook_registrations', registrationData);

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  // Return without the secret_hash
  return jsonResponse({
    registration_id: registrationId,
    agent_id: body.agent_id,
    callback_url: body.callback_url,
    events: body.events,
    created_at: now,
  }, 201);
}

async function handleDeleteAipWebhook(env: Env, registrationId: string): Promise<Response> {
  if (!registrationId) {
    return errorResponse('Registration ID is required', 400);
  }

  const { count, error } = await supabaseDelete(env, 'aip_webhook_registrations', {
    registration_id: registrationId,
  });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  if (count === 0) {
    return errorResponse('Webhook registration not found', 404);
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// ============================================
// CONSCIENCE VALUES ENDPOINTS (Phase 4)
// ============================================

const VALID_CONSCIENCE_TYPES = ['BOUNDARY', 'FEAR', 'COMMITMENT', 'BELIEF', 'HOPE'] as const;

async function handleGetConscienceValues(env: Env, agentId: string): Promise<Response> {
  if (!agentId) {
    return errorResponse('Agent ID is required', 400);
  }

  // Get active alignment card for the agent
  const { data, error } = await supabaseQuery(env, 'alignment_cards', {
    select: 'conscience_values',
    filters: { agent_id: agentId, is_active: true },
    single: true,
  });

  if (error) {
    if (error.includes('PGRST116') || error.includes('0 rows')) {
      return errorResponse('Alignment card not found for agent', 404);
    }
    return errorResponse(`Database error: ${error}`, 500);
  }

  const card = data as { conscience_values: unknown[] | null };
  const isDefault = card.conscience_values === null || card.conscience_values === undefined;
  const conscienceValues = isDefault ? DEFAULT_CONSCIENCE_VALUES : card.conscience_values;

  return jsonResponse({
    agent_id: agentId,
    conscience_values: conscienceValues,
    is_default: isDefault,
  });
}

async function handlePutConscienceValues(env: Env, agentId: string, request: Request): Promise<Response> {
  if (!agentId) {
    return errorResponse('Agent ID is required', 400);
  }

  let body: { conscience_values: Array<{ type: string; name: string; content: string }> };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.conscience_values || !Array.isArray(body.conscience_values)) {
    return errorResponse('conscience_values must be an array', 400);
  }

  // Validate each value
  for (let i = 0; i < body.conscience_values.length; i++) {
    const val = body.conscience_values[i];
    if (!val.type || !VALID_CONSCIENCE_TYPES.includes(val.type as typeof VALID_CONSCIENCE_TYPES[number])) {
      return errorResponse(
        `conscience_values[${i}].type must be one of: ${VALID_CONSCIENCE_TYPES.join(', ')}`,
        400
      );
    }
    if (!val.name || typeof val.name !== 'string') {
      return errorResponse(`conscience_values[${i}].name must be a non-empty string`, 400);
    }
    if (!val.content || typeof val.content !== 'string') {
      return errorResponse(`conscience_values[${i}].content must be a non-empty string`, 400);
    }
  }

  // Update the alignment card
  const { data, error } = await supabaseUpdate(
    env,
    'alignment_cards',
    { agent_id: agentId, is_active: true },
    { conscience_values: body.conscience_values }
  );

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  const result = data as unknown[];
  if (!result || result.length === 0) {
    return errorResponse('Alignment card not found for agent', 404);
  }

  return jsonResponse({
    agent_id: agentId,
    conscience_values: body.conscience_values,
    updated: true,
  });
}

async function handleDeleteConscienceValues(env: Env, agentId: string): Promise<Response> {
  if (!agentId) {
    return errorResponse('Agent ID is required', 400);
  }

  // Set conscience_values to null (reset to defaults)
  const { data, error } = await supabaseUpdate(
    env,
    'alignment_cards',
    { agent_id: agentId, is_active: true },
    { conscience_values: null }
  );

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  const result = data as unknown[];
  if (!result || result.length === 0) {
    return errorResponse('Alignment card not found for agent', 404);
  }

  return jsonResponse({
    agent_id: agentId,
    reset_to_defaults: true,
  });
}

// ============================================
// ADMIN ENDPOINTS
// ============================================

const MODEL_PRICING: Record<string, { input_per_mtok: number; output_per_mtok: number }> = {
  'claude-sonnet-4-20250514': { input_per_mtok: 3.00, output_per_mtok: 15.00 },
  'claude-3-5-sonnet-20241022': { input_per_mtok: 3.00, output_per_mtok: 15.00 },
  'claude-3-5-haiku-20241022': { input_per_mtok: 0.80, output_per_mtok: 4.00 },
  'claude-3-haiku-20240307': { input_per_mtok: 0.25, output_per_mtok: 1.25 },
};

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = MODEL_PRICING[model] || { input_per_mtok: 3.00, output_per_mtok: 15.00 };
  return (tokensIn / 1_000_000) * pricing.input_per_mtok + (tokensOut / 1_000_000) * pricing.output_per_mtok;
}

async function handleAdminStats(env: Env, request: Request): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;

  // Aggregate stats from RPC
  const { data: statsData, error: statsError } = await supabaseRpc(env, 'admin_get_stats');

  // User counts from admin API
  const { users, total: totalUsers, error: usersError } = await supabaseAdminListUsers(env);

  // Count new users in last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const newUsers7d = (users as Array<{ created_at?: string }>).filter(u =>
    u.created_at && new Date(u.created_at) > sevenDaysAgo
  ).length;

  // Recent violations (verdict != clear)
  const violationsUrl = new URL(`${env.SUPABASE_URL}/rest/v1/integrity_checkpoints`);
  violationsUrl.searchParams.set('verdict', 'neq.clear');
  violationsUrl.searchParams.set('order', 'timestamp.desc');
  violationsUrl.searchParams.set('limit', '10');
  violationsUrl.searchParams.set('select', 'checkpoint_id,agent_id,verdict,timestamp,concerns');

  let recentViolations: unknown[] = [];
  try {
    const violationsResponse = await fetch(violationsUrl.toString(), {
      headers: {
        'apikey': env.SUPABASE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    if (violationsResponse.ok) {
      recentViolations = await violationsResponse.json() as unknown[];
    }
  } catch {
    // Continue without violations data
  }

  // Flatten RPC stats + user counts into the shape the frontend expects
  const rpc = (statsData || {}) as Record<string, number>;

  return jsonResponse({
    total_users: totalUsers || users.length,
    total_agents: rpc.total_agents ?? 0,
    total_traces: rpc.total_traces ?? 0,
    total_checkpoints: rpc.total_checkpoints ?? 0,
    active_agents_24h: rpc.active_agents_24h ?? 0,
    total_usage_events: rpc.total_usage_events ?? 0,
    total_tokens_in: rpc.total_tokens_in ?? 0,
    total_tokens_out: rpc.total_tokens_out ?? 0,
    new_users_7d: newUsers7d,
    recent_violations: recentViolations,
  });
}

async function handleAdminUsage(env: Env, request: Request, url: URL): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;

  const days = parseInt(url.searchParams.get('days') || '30', 10);

  const { data, error } = await supabaseRpc(env, 'admin_usage_by_day', { p_days: days });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  // Add flat cost estimate based on average model pricing
  const rows = (data as Array<{ tokens_in?: number; tokens_out?: number }>) || [];
  const enriched = rows.map(row => ({
    ...row,
    cost_estimate_usd: estimateCost(
      '', // default pricing
      row.tokens_in || 0,
      row.tokens_out || 0
    ),
  }));

  return jsonResponse({ period: 'daily', data: enriched });
}

async function handleAdminUsers(env: Env, request: Request, url: URL): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const page = Math.floor(offset / limit) + 1;

  const { users, total, error } = await supabaseAdminListUsers(env, page, limit);

  if (error) {
    return errorResponse(`Admin API error: ${error}`, 500);
  }

  // For each user, count their agents
  const shaped = await Promise.all(
    (users as Array<{
      id: string;
      email?: string;
      created_at?: string;
      last_sign_in_at?: string;
      app_metadata?: { is_admin?: boolean };
    }>).map(async (user) => {
      const { data: agentData } = await supabaseQuery(env, 'agents', {
        select: 'id',
        filters: { user_id: user.id },
      });
      const agentCount = Array.isArray(agentData) ? agentData.length : 0;

      return {
        id: user.id,
        email: user.email || null,
        created_at: user.created_at || null,
        last_sign_in_at: user.last_sign_in_at || null,
        agent_count: agentCount,
        is_admin: user.app_metadata?.is_admin || false,
      };
    })
  );

  return jsonResponse({ users: shaped, total });
}

async function handleAdminAgents(env: Env, request: Request, url: URL): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  // Get per-agent summary from RPC
  const { data: summaryData } = await supabaseRpc(env, 'admin_agent_summary');
  const summaryMap: Record<string, Record<string, unknown>> = {};
  if (Array.isArray(summaryData)) {
    for (const row of summaryData as Array<{ agent_id: string; [key: string]: unknown }>) {
      summaryMap[row.agent_id] = row;
    }
  }

  // Get paginated agents
  const { data: agentsData, error: agentsError } = await supabaseQuery(env, 'agents', {
    order: { column: 'created_at', ascending: false },
    limit,
    offset,
  });

  if (agentsError) {
    return errorResponse(`Database error: ${agentsError}`, 500);
  }

  const agents = (agentsData as Array<Record<string, unknown>>) || [];

  // Join summary data and compute integrity_ratio
  const enriched = agents.map(agent => {
    const summary = summaryMap[agent.id as string] || {};
    const checkpointCount = (summary.checkpoint_count as number) || 0;
    const clearCount = (summary.clear_count as number) || 0;
    const integrityRatio = checkpointCount > 0
      ? Math.round((clearCount / checkpointCount) * 1000) / 1000
      : 0;

    return {
      ...agent,
      trace_count: summary.trace_count || 0,
      checkpoint_count: checkpointCount,
      clear_count: clearCount,
      integrity_ratio: integrityRatio,
    };
  });

  // Get total agent count
  const countUrl = new URL(`${env.SUPABASE_URL}/rest/v1/agents`);
  countUrl.searchParams.set('select', 'id');
  let total = agents.length;
  try {
    const countResponse = await fetch(countUrl.toString(), {
      method: 'HEAD',
      headers: {
        'apikey': env.SUPABASE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_KEY}`,
        'Prefer': 'count=exact',
      },
    });
    const contentRange = countResponse.headers.get('content-range');
    if (contentRange) {
      const parts = contentRange.split('/');
      if (parts[1] && parts[1] !== '*') {
        total = parseInt(parts[1], 10);
      }
    }
  } catch {
    // Use fallback count
  }

  return jsonResponse({ agents: enriched, total });
}

async function handleAdminCosts(env: Env, request: Request, url: URL): Promise<Response> {
  const adminOrError = await requireAdmin(request, env);
  if (adminOrError instanceof Response) return adminOrError;

  const days = parseInt(url.searchParams.get('days') || '30', 10);

  const { data, error } = await supabaseRpc(env, 'admin_usage_by_model', { p_days: days });

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  const rows = (data as Array<{
    model?: string;
    tokens_in?: number;
    tokens_out?: number;
    [key: string]: unknown;
  }>) || [];

  // Calculate cost per row and totals
  let totalCostUsd = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  const enriched = rows.map(row => {
    const tokensIn = row.tokens_in || 0;
    const tokensOut = row.tokens_out || 0;
    const costUsd = estimateCost(row.model || '', tokensIn, tokensOut);

    totalCostUsd += costUsd;
    totalTokensIn += tokensIn;
    totalTokensOut += tokensOut;

    return {
      ...row,
      cost_usd: Math.round(costUsd * 1_000_000) / 1_000_000,
    };
  });

  return jsonResponse({
    period: 'daily',
    data: enriched,
    totals: {
      total_cost_usd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
      total_tokens_in: totalTokensIn,
      total_tokens_out: totalTokensOut,
    },
  });
}

// ============================================
// ENFORCEMENT MODE ENDPOINTS (Phase 4)
// ============================================

async function handleGetEnforcement(env: Env, agentId: string): Promise<Response> {
  if (!agentId) {
    return errorResponse('Agent ID is required', 400);
  }

  const { data, error } = await supabaseQuery(env, 'agents', {
    select: 'aip_enforcement_mode',
    eq: ['id', agentId],
    single: true,
  });

  if (error) {
    if (error.includes('PGRST116') || error.includes('0 rows')) {
      return errorResponse('Agent not found', 404);
    }
    return errorResponse(`Database error: ${error}`, 500);
  }

  const agent = data as { aip_enforcement_mode: string | null };

  return jsonResponse({
    agent_id: agentId,
    enforcement_mode: agent.aip_enforcement_mode || 'observe',
  });
}

async function handlePutEnforcement(env: Env, agentId: string, request: Request): Promise<Response> {
  if (!agentId) {
    return errorResponse('Agent ID is required', 400);
  }

  let body: { mode: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.mode || (body.mode !== 'observe' && body.mode !== 'enforce')) {
    return errorResponse('mode must be "observe" or "enforce"', 400);
  }

  const { data, error } = await supabaseUpdate(
    env,
    'agents',
    { id: agentId },
    { aip_enforcement_mode: body.mode }
  );

  if (error) {
    return errorResponse(`Database error: ${error}`, 500);
  }

  const result = data as unknown[];
  if (!result || result.length === 0) {
    return errorResponse('Agent not found', 404);
  }

  return jsonResponse({
    agent_id: agentId,
    enforcement_mode: body.mode,
    updated: true,
  });
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
    const method = request.method;

    try {
      // Route matching
      // GET /health
      if (path === '/health' && method === 'GET') {
        return handleHealth();
      }

      // GET /v1/agents/:id/card
      const agentCardMatch = path.match(/^\/v1\/agents\/([^/]+)\/card$/);
      if (agentCardMatch && method === 'GET') {
        return handleGetAgentCard(env, agentCardMatch[1]);
      }

      // PATCH /v1/agents/:id/card - Update alignment card
      if (agentCardMatch && method === 'PATCH') {
        return handleUpdateAgentCard(env, agentCardMatch[1], request);
      }

      // POST /v1/agents/:id/claim
      const agentClaimMatch = path.match(/^\/v1\/agents\/([^/]+)\/claim$/);
      if (agentClaimMatch && method === 'POST') {
        return handleClaimAgent(env, agentClaimMatch[1], request);
      }

      // POST /v1/agents/:id/link
      const agentLinkMatch = path.match(/^\/v1\/agents\/([^/]+)\/link$/);
      if (agentLinkMatch && method === 'POST') {
        return handleLinkAgent(env, agentLinkMatch[1], request);
      }

      // GET /v1/agents/:id/traces - AAP query_endpoint alias
      const agentTracesMatch = path.match(/^\/v1\/agents\/([^/]+)\/traces$/);
      if (agentTracesMatch && method === 'GET') {
        url.searchParams.set('agent_id', agentTracesMatch[1]);
        return handleGetTraces(env, url, request);
      }

      // GET /v1/auth/me
      if (path === '/v1/auth/me' && method === 'GET') {
        return handleGetMe(env, request);
      }

      // GET /v1/agents/:id
      const agentMatch = path.match(/^\/v1\/agents\/([^/]+)$/);
      if (agentMatch && method === 'GET') {
        return handleGetAgent(env, agentMatch[1], request);
      }

      // GET /v1/traces (with query params)
      if (path === '/v1/traces' && method === 'GET') {
        return handleGetTraces(env, url, request);
      }

      // GET /v1/traces/:id
      const traceMatch = path.match(/^\/v1\/traces\/([^/]+)$/);
      if (traceMatch && method === 'GET') {
        return handleGetTrace(env, traceMatch[1]);
      }

      // GET /v1/integrity/:agent_id
      const integrityMatch = path.match(/^\/v1\/integrity\/([^/]+)$/);
      if (integrityMatch && method === 'GET') {
        return handleGetIntegrity(env, integrityMatch[1]);
      }

      // POST /v1/agents/:id/reverify/aip - Re-evaluate AIP checkpoints
      const reverifyAipMatch = path.match(/^\/v1\/agents\/([^/]+)\/reverify\/aip$/);
      if (reverifyAipMatch && method === 'POST') {
        return handleReverifyAip(env, reverifyAipMatch[1], url);
      }

      // POST /v1/agents/:id/reverify - Re-verify traces against updated card
      const reverifyMatch = path.match(/^\/v1\/agents\/([^/]+)\/reverify$/);
      if (reverifyMatch && method === 'POST') {
        return handleReverify(env, reverifyMatch[1], url);
      }

      // GET /v1/drift/:agent_id
      const driftMatch = path.match(/^\/v1\/drift\/([^/]+)$/);
      if (driftMatch && method === 'GET') {
        return handleGetDrift(env, driftMatch[1]);
      }

      // ============================================
      // BLOG ROUTES
      // ============================================

      // GET /v1/blog/posts - List published posts
      if (path === '/v1/blog/posts' && method === 'GET') {
        return handleGetBlogPosts(env, url);
      }

      // POST /v1/blog/posts - Create post (service role only)
      if (path === '/v1/blog/posts' && method === 'POST') {
        return handleCreateBlogPost(env, request);
      }

      // GET /v1/blog/posts/:slug - Get single post by slug
      const blogPostMatch = path.match(/^\/v1\/blog\/posts\/([^/]+)$/);
      if (blogPostMatch && method === 'GET') {
        return handleGetBlogPost(env, blogPostMatch[1]);
      }

      // GET /v1/blog/authors/:agent_id - Get author profile and posts
      const blogAuthorMatch = path.match(/^\/v1\/blog\/authors\/([^/]+)$/);
      if (blogAuthorMatch && method === 'GET') {
        return handleGetBlogAuthor(env, blogAuthorMatch[1]);
      }

      // ============================================
      // SSM ROUTES
      // ============================================

      // GET /v1/ssm/:agent_id/timeline - Get similarity timeline
      const ssmTimelineMatch = path.match(/^\/v1\/ssm\/([^/]+)\/timeline$/);
      if (ssmTimelineMatch && method === 'GET') {
        return handleGetSSMTimeline(env, ssmTimelineMatch[1], url);
      }

      // GET /v1/ssm/:agent_id - Get traces with similarity scores
      const ssmMatch = path.match(/^\/v1\/ssm\/([^/]+)$/);
      if (ssmMatch && method === 'GET') {
        return handleGetSSM(env, ssmMatch[1], url);
      }

      // ============================================
      // AIP ROUTES
      // ============================================

      // GET /v1/agents/:id/integrity/aip - AIP integrity score
      const aipIntegrityMatch = path.match(/^\/v1\/agents\/([^/]+)\/integrity\/aip$/);
      if (aipIntegrityMatch && method === 'GET') {
        return handleGetAipIntegrity(env, aipIntegrityMatch[1]);
      }

      // GET /v1/agents/:id/checkpoints/:checkpoint_id - Single checkpoint (must come before list route)
      const checkpointSingleMatch = path.match(/^\/v1\/agents\/([^/]+)\/checkpoints\/([^/]+)$/);
      if (checkpointSingleMatch && method === 'GET') {
        return handleGetCheckpoint(env, checkpointSingleMatch[1], checkpointSingleMatch[2]);
      }

      // GET /v1/agents/:id/timeline - Unified dual-rail timeline
      const timelineMatch = path.match(/^\/v1\/agents\/([^/]+)\/timeline$/);
      if (timelineMatch && method === 'GET') {
        return handleGetTimeline(env, timelineMatch[1], url);
      }

      // GET /v1/agents/:id/checkpoints - Paginated checkpoints
      const checkpointsMatch = path.match(/^\/v1\/agents\/([^/]+)\/checkpoints$/);
      if (checkpointsMatch && method === 'GET') {
        return handleGetCheckpoints(env, checkpointsMatch[1], url);
      }

      // GET /v1/agents/:id/drift/aip - AIP drift alerts
      const aipDriftMatch = path.match(/^\/v1\/agents\/([^/]+)\/drift\/aip$/);
      if (aipDriftMatch && method === 'GET') {
        return handleGetAipDrift(env, aipDriftMatch[1]);
      }

      // POST /v1/aip/webhooks - Register AIP webhook
      if (path === '/v1/aip/webhooks' && method === 'POST') {
        return handleRegisterAipWebhook(env, request);
      }

      // DELETE /v1/aip/webhooks/:registration_id - Remove AIP webhook
      const aipWebhookDeleteMatch = path.match(/^\/v1\/aip\/webhooks\/([^/]+)$/);
      if (aipWebhookDeleteMatch && method === 'DELETE') {
        return handleDeleteAipWebhook(env, aipWebhookDeleteMatch[1]);
      }

      // ============================================
      // CONSCIENCE VALUES & ENFORCEMENT ROUTES (Phase 4)
      // ============================================

      // GET/PUT/DELETE /v1/agents/:id/conscience-values
      const conscienceMatch = path.match(/^\/v1\/agents\/([^/]+)\/conscience-values$/);
      if (conscienceMatch && method === 'GET') {
        return handleGetConscienceValues(env, conscienceMatch[1]);
      }
      if (conscienceMatch && method === 'PUT') {
        return handlePutConscienceValues(env, conscienceMatch[1], request);
      }
      if (conscienceMatch && method === 'DELETE') {
        return handleDeleteConscienceValues(env, conscienceMatch[1]);
      }

      // GET/PUT /v1/agents/:id/enforcement
      const enforcementMatch = path.match(/^\/v1\/agents\/([^/]+)\/enforcement$/);
      if (enforcementMatch && method === 'GET') {
        return handleGetEnforcement(env, enforcementMatch[1]);
      }
      if (enforcementMatch && method === 'PUT') {
        return handlePutEnforcement(env, enforcementMatch[1], request);
      }

      // ============================================
      // ADMIN ROUTES
      // ============================================

      if (path === '/v1/admin/stats' && method === 'GET') {
        return handleAdminStats(env, request);
      }

      if (path === '/v1/admin/usage' && method === 'GET') {
        return handleAdminUsage(env, request, url);
      }

      if (path === '/v1/admin/users' && method === 'GET') {
        return handleAdminUsers(env, request, url);
      }

      if (path === '/v1/admin/agents' && method === 'GET') {
        return handleAdminAgents(env, request, url);
      }

      if (path === '/v1/admin/costs' && method === 'GET') {
        return handleAdminCosts(env, request, url);
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
