/**
 * Smoltbot Gateway Worker
 *
 * The heart of the Smoltbot system - a Cloudflare Worker that:
 * 1. Intercepts API requests to Anthropic
 * 2. Identifies agents via API key hashing (zero-config)
 * 3. Attaches metadata for tracing via CF AI Gateway
 * 4. Forwards requests and returns responses transparently
 */

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  CF_AI_GATEWAY_URL: string;
  CF_AIG_TOKEN: string;  // AI Gateway authentication token
  GATEWAY_VERSION: string;
}

interface Agent {
  id: string;
  agent_hash: string;
  created_at: string;
  last_seen: string | null;
  claimed_at: string | null;
  claimed_by: string | null;
  email: string | null;
}

interface AlignmentCard {
  id: string;
  agent_id: string;
  content: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
}

/**
 * Hash an API key using SHA-256 and return the first 16 hex characters.
 * This creates a consistent, privacy-preserving identifier for agents.
 */
export async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.substring(0, 16);
}

/**
 * Generate a session ID from agent hash and current hour bucket.
 * Sessions are bucketed by hour for reasonable grouping of related requests.
 */
export function generateSessionId(agentHash: string): string {
  const hourBucket = Math.floor(Date.now() / (1000 * 60 * 60));
  return `${agentHash}-${hourBucket}`;
}

/**
 * Lookup or create an agent in Supabase by their hash.
 * New agents get a default alignment card created automatically.
 */
export async function getOrCreateAgent(
  agentHash: string,
  env: Env
): Promise<{ agent: Agent; isNew: boolean }> {
  const headers = {
    'apikey': env.SUPABASE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  // Try to find existing agent
  const lookupResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/agents?agent_hash=eq.${agentHash}&select=*`,
    { headers }
  );

  if (!lookupResponse.ok) {
    throw new Error(`Supabase lookup failed: ${lookupResponse.status}`);
  }

  const agents: Agent[] = await lookupResponse.json();

  if (agents.length > 0) {
    return { agent: agents[0], isNew: false };
  }

  // Create new agent - generate id from hash prefix per spec
  const agentId = `smolt-${agentHash.slice(0, 8)}`;

  const createResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/agents`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: agentId,
        agent_hash: agentHash,
        last_seen: new Date().toISOString(),
      }),
    }
  );

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    throw new Error(`Failed to create agent: ${createResponse.status} - ${errorText}`);
  }

  const newAgents: Agent[] = await createResponse.json();
  const newAgent = newAgents[0];

  // Create alignment card for new agent
  await ensureAlignmentCard(newAgent.id, env);

  return { agent: newAgent, isNew: true };
}

/**
 * Ensure an alignment card exists for an agent (upsert).
 * Creates a new card or updates an existing one with current defaults.
 * Structure matches AAP SDK AlignmentCard type.
 */
export async function ensureAlignmentCard(
  agentId: string,
  env: Env
): Promise<void> {
  const headers = {
    'apikey': env.SUPABASE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates,return=minimal',
  };

  const cardId = `ac-${agentId.replace('smolt-', '')}`;
  const issuedAt = new Date().toISOString();

  // Default alignment card per AAP spec
  // bounded_actions: semantic action types the agent can perform
  // declared values: the full set the observer's Haiku analysis can assign
  const cardJson = {
    aap_version: '0.1.0',
    card_id: cardId,
    agent_id: agentId,
    issued_at: issuedAt,
    principal: {
      type: 'human',
      relationship: 'delegated_authority',
    },
    values: {
      declared: ['transparency', 'accuracy', 'helpfulness', 'safety', 'autonomy', 'honesty', 'quality'],
    },
    autonomy_envelope: {
      bounded_actions: [
        'inference',
      ],
      escalation_triggers: [],
      forbidden_actions: [],
    },
    audit_commitment: {
      retention_days: 365,
      queryable: true,
    },
  };

  const dbRecord = {
    id: cardId,
    agent_id: agentId,
    card_json: cardJson,
    issued_at: issuedAt,
    is_active: true,
  };

  try {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/alignment_cards?on_conflict=id`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(dbRecord),
      }
    );

    if (!response.ok) {
      console.error(`Failed to upsert alignment card: ${response.status}`);
    }
  } catch {
    // Background task — don't let failures propagate
  }
}

/**
 * Update the last_seen timestamp for an agent.
 * This is done in the background to not block the response.
 */
export async function updateLastSeen(agentId: string, env: Env): Promise<void> {
  const headers = {
    'apikey': env.SUPABASE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };

  await fetch(
    `${env.SUPABASE_URL}/rest/v1/agents?id=eq.${agentId}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        last_seen: new Date().toISOString(),
      }),
    }
  );
}

/**
 * Build the CF AI Gateway metadata header.
 * This metadata is attached to requests for tracing and analysis.
 */
export function buildMetadataHeader(
  agentId: string,
  agentHash: string,
  sessionId: string,
  gatewayVersion: string
): string {
  const metadata = {
    agent_id: agentId,
    agent_hash: agentHash,
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    gateway_version: gatewayVersion,
  };
  return JSON.stringify(metadata);
}

/**
 * Handle the health check endpoint.
 */
export function handleHealthCheck(env: Env): Response {
  return new Response(
    JSON.stringify({
      status: 'ok',
      version: env.GATEWAY_VERSION,
      timestamp: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Handle Anthropic API proxy requests.
 */
export async function handleAnthropicProxy(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  // Extract API key from header
  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: 'Missing x-api-key header',
        type: 'authentication_error',
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    // Hash the API key for agent identification
    const agentHash = await hashApiKey(apiKey);

    // Get or create the agent
    const { agent } = await getOrCreateAgent(agentHash, env);

    // Generate session ID
    const sessionId = generateSessionId(agentHash);

    // Build metadata header for CF AI Gateway
    const metadataHeader = buildMetadataHeader(
      agent.id,
      agentHash,
      sessionId,
      env.GATEWAY_VERSION
    );

    // Build the forwarding URL
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/anthropic/, '');
    const forwardUrl = `${env.CF_AI_GATEWAY_URL}${path}${url.search}`;

    // Clone headers and add metadata + AI Gateway auth
    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.set('cf-aig-metadata', metadataHeader);
    forwardHeaders.set('cf-aig-authorization', `Bearer ${env.CF_AIG_TOKEN}`);

    // Forward the request
    const forwardRequest = new Request(forwardUrl, {
      method: request.method,
      headers: forwardHeaders,
      body: request.body,
    });

    const response = await fetch(forwardRequest);

    // Clone response and add smoltbot headers
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('x-smoltbot-agent', agent.id);
    responseHeaders.set('x-smoltbot-session', sessionId);

    // Update last_seen and ensure alignment card is current (background)
    ctx.waitUntil(updateLastSeen(agent.id, env));
    ctx.waitUntil(ensureAlignmentCard(agent.id, env));

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Gateway error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal gateway error',
        type: 'gateway_error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Main request handler.
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight handling
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, x-api-key, anthropic-version, anthropic-beta',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Health check endpoint
    if (path === '/health' || path === '/health/') {
      return handleHealthCheck(env);
    }

    // Anthropic API proxy
    if (path.startsWith('/anthropic/') || path === '/anthropic') {
      return handleAnthropicProxy(request, env, ctx);
    }

    // 404 for all other paths
    return new Response(
      JSON.stringify({
        error: 'Not found',
        type: 'not_found',
        message: 'This gateway only handles /health and /anthropic/* endpoints',
      }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  },
};
