/**
 * Smoltbot Backend API Worker
 *
 * Serves the dashboard and CLI with agent data.
 * Routes:
 * - GET /health - Health check
 * - GET /v1/agents/:id - Get agent by ID
 * - GET /v1/agents/:id/card - Get active alignment card for agent
 * - POST /v1/agents/:id/claim - Claim agent with hash proof
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
 */

import { detectDrift, type APTrace, type AlignmentCard } from '@mnemom/agent-alignment-protocol';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  SUPABASE_JWT_SECRET: string;
}

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
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
  if (agent.user_id) {
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
  if (agentId) {
    const { data: agentData } = await supabaseQuery(env, 'agents', {
      eq: ['id', agentId],
      select: 'id,user_id',
      single: true,
    });
    if (agentData) {
      const agent = agentData as { user_id?: string };
      if (agent.user_id) {
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
  if (token !== env.SUPABASE_KEY) {
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
