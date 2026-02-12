/**
 * Smoltbot Gateway Worker
 *
 * The heart of the Smoltbot system - a Cloudflare Worker that:
 * 1. Intercepts API requests to Anthropic
 * 2. Identifies agents via API key hashing (zero-config)
 * 3. Attaches metadata for tracing via CF AI Gateway
 * 4. Forwards requests and returns responses transparently
 * 5. [Wave 1] Injects extended thinking into requests
 * 6. [Wave 2] Performs real-time AIP integrity checking on responses
 * 7. [Wave 4] Delivers webhook notifications for integrity events
 */

import {
  checkIntegrity,
  buildSignal,
  buildConsciencePrompt,
  detectIntegrityDrift,
  createDriftState,
  createAdapterRegistry,
  WindowManager,
  DEFAULT_CONSCIENCE_VALUES,
  WEBHOOK_RETRY_DELAYS_MS,
  AIP_VERSION,
  CHECKPOINT_ID_PREFIX,
  type IntegrityCheckpoint,
  type AlignmentCard as AIPAlignmentCard,
  type AlignmentCardValue,
  type DriftState,
  type CheckIntegrityInput,
  type ConscienceValue,
} from '@mnemom/agent-integrity-protocol';

// ============================================================================
// Types
// ============================================================================

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  CF_AI_GATEWAY_URL: string;
  CF_AIG_TOKEN: string;  // AI Gateway authentication token
  GATEWAY_VERSION: string;
  ANTHROPIC_API_KEY: string;  // For AIP analysis LLM calls
  AIP_ENABLED: string;        // Feature flag ("true"/"false"), default "true"
}

interface Agent {
  id: string;
  agent_hash: string;
  created_at: string;
  last_seen: string | null;
  claimed_at: string | null;
  claimed_by: string | null;
  email: string | null;
  aip_enforcement_mode?: string;
}

interface AlignmentCard {
  id: string;
  agent_id: string;
  content: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Core Utility Functions
// ============================================================================

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
 * Generate a random hex string of specified length.
 * Uses crypto.getRandomValues for Cloudflare Workers compatibility.
 */
function randomHex(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length);
}

/**
 * Compute SHA-256 hash of a string using Web Crypto API.
 * Used for thinking block hashing in Workers environment (no node:crypto).
 */
async function sha256(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// Agent Management Functions
// ============================================================================

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
    'Prefer': 'resolution=ignore-duplicates,return=minimal',
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

// ============================================================================
// AIP Helper Functions
// ============================================================================

/**
 * Map AAP card_json to AIP AlignmentCard interface.
 * Same mapping pattern used by the observer.
 */
function mapCardToAIP(cardJson: Record<string, any>): AIPAlignmentCard {
  const declaredValues: string[] = cardJson.values?.declared || [];
  const values: AlignmentCardValue[] = declaredValues.map((v: string, i: number) => ({
    name: v,
    priority: i + 1,
  }));

  return {
    card_id: cardJson.card_id || 'unknown',
    values,
    autonomy_envelope: {
      bounded_actions: cardJson.autonomy_envelope?.bounded_actions ?? [],
      forbidden_actions: cardJson.autonomy_envelope?.forbidden_actions ?? undefined,
      escalation_triggers: cardJson.autonomy_envelope?.escalation_triggers?.map(
        (t: { condition: string; action: string; reason?: string | null }) => ({
          condition: t.condition,
          action: t.action,
          reason: t.reason ?? undefined,
        })
      ),
    },
  };
}

/**
 * Fetch alignment card, conscience values, and enforcement mode for an agent.
 */
async function fetchAlignmentData(
  agentId: string,
  env: Env
): Promise<{
  card: Record<string, any> | null;
  conscienceValues: ConscienceValue[] | null;
  enforcementMode: string;
}> {
  try {
    const supabaseHeaders = {
      apikey: env.SUPABASE_KEY,
      Authorization: `Bearer ${env.SUPABASE_KEY}`,
    };

    // Fetch card + conscience values and enforcement mode in parallel
    const [cardResponse, agentResponse] = await Promise.all([
      fetch(
        `${env.SUPABASE_URL}/rest/v1/alignment_cards?agent_id=eq.${agentId}&is_active=eq.true&limit=1`,
        { headers: supabaseHeaders }
      ),
      fetch(
        `${env.SUPABASE_URL}/rest/v1/agents?id=eq.${agentId}&select=aip_enforcement_mode&limit=1`,
        { headers: supabaseHeaders }
      ),
    ]);

    // Parse card data
    let card: Record<string, any> | null = null;
    let conscienceValues: ConscienceValue[] | null = null;
    if (cardResponse.ok) {
      const cards = (await cardResponse.json()) as Array<{
        card_json: Record<string, any>;
        conscience_values?: ConscienceValue[];
      }>;
      if (cards.length > 0) {
        card = cards[0].card_json || null;
        conscienceValues = cards[0].conscience_values || null;
      }
    } else {
      console.warn(`[gateway/aip] Failed to fetch card for ${agentId}: ${cardResponse.status}`);
    }

    // Parse enforcement mode from agents table
    let enforcementMode = 'observe';
    if (agentResponse.ok) {
      const agents = (await agentResponse.json()) as Array<{
        aip_enforcement_mode?: string;
      }>;
      if (agents.length > 0) {
        enforcementMode = agents[0].aip_enforcement_mode || 'observe';
      }
    }

    return { card, conscienceValues, enforcementMode };
  } catch (error) {
    console.error(`[gateway/aip] Error fetching alignment data for ${agentId}:`, error);
    return { card: null, conscienceValues: null, enforcementMode: 'observe' };
  }
}

/**
 * Fetch recent checkpoints for window hydration.
 */
async function fetchRecentCheckpoints(
  agentId: string,
  sessionId: string,
  env: Env
): Promise<IntegrityCheckpoint[]> {
  try {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/integrity_checkpoints?agent_id=eq.${agentId}&session_id=eq.${sessionId}&order=timestamp.desc&limit=10`,
      {
        headers: {
          apikey: env.SUPABASE_KEY,
          Authorization: `Bearer ${env.SUPABASE_KEY}`,
        },
      }
    );

    if (!response.ok) {
      console.warn(`[gateway/aip] Failed to fetch checkpoints: ${response.status}`);
      return [];
    }

    const rows = (await response.json()) as IntegrityCheckpoint[];
    // Reverse to chronological order (oldest first) for window hydration
    return rows.reverse();
  } catch (error) {
    console.error(`[gateway/aip] Error fetching checkpoints:`, error);
    return [];
  }
}

/**
 * Store checkpoint to Supabase.
 * Same upsert pattern as the observer's submitCheckpoint.
 */
async function storeCheckpoint(
  checkpoint: IntegrityCheckpoint,
  source: string,
  env: Env
): Promise<void> {
  try {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/integrity_checkpoints?on_conflict=checkpoint_id`,
      {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_KEY,
          Authorization: `Bearer ${env.SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          checkpoint_id: checkpoint.checkpoint_id,
          agent_id: checkpoint.agent_id,
          card_id: checkpoint.card_id,
          session_id: checkpoint.session_id,
          timestamp: checkpoint.timestamp,
          thinking_block_hash: checkpoint.thinking_block_hash,
          provider: checkpoint.provider,
          model: checkpoint.model,
          verdict: checkpoint.verdict,
          concerns: checkpoint.concerns,
          reasoning_summary: checkpoint.reasoning_summary,
          conscience_context: checkpoint.conscience_context,
          window_position: checkpoint.window_position,
          analysis_metadata: checkpoint.analysis_metadata,
          linked_trace_id: checkpoint.linked_trace_id,
          source,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(
        `[gateway/aip] Failed to store checkpoint ${checkpoint.checkpoint_id}: ${response.status} - ${errorText}`
      );
    } else {
      console.log(`[gateway/aip] Checkpoint ${checkpoint.checkpoint_id} stored (source: ${source})`);
    }
  } catch (error) {
    console.error('[gateway/aip] Error storing checkpoint:', error);
  }
}

// ============================================================================
// Wave 3: Conscience Nudge Functions
// ============================================================================

/**
 * Build the text injected into the system prompt when delivering a nudge.
 * IMPORTANT: No PII, no specific data — generic concern categories only.
 */
function buildNudgeText(
  nudges: Array<{ id: string; checkpoint_id: string; concerns_summary: string }>
): string {
  const header = '[INTEGRITY NOTICE — Conscience Protocol]';
  const lines = nudges.map(
    (n) =>
      `Your previous response (checkpoint ${n.checkpoint_id}) was flagged as a boundary violation.\nConcern: ${n.concerns_summary}\nReview your approach and self-correct. This notice is visible in your transparency timeline.`
  );
  return `${header}\n${lines.join('\n\n')}`;
}

/**
 * Inject nudge text into the request body's system parameter.
 * Handles string, array-of-content-blocks, or absent system field.
 */
function injectNudgeIntoSystem(
  requestBody: Record<string, any>,
  nudgeText: string
): void {
  const existing = requestBody.system;
  if (!existing) {
    requestBody.system = nudgeText;
  } else if (typeof existing === 'string') {
    requestBody.system = `${existing}\n\n${nudgeText}`;
  } else if (Array.isArray(existing)) {
    existing.push({ type: 'text', text: nudgeText });
  }
}

/**
 * Query pending nudges for an agent and inject them into the request body.
 * Returns the IDs of injected nudges (for later marking as delivered).
 * Fail-open: errors logged, request proceeds unmodified.
 */
async function injectPendingNudges(
  requestBody: Record<string, any>,
  agentId: string,
  enforcementMode: string,
  env: Env
): Promise<string[]> {
  if (enforcementMode !== 'nudge' && enforcementMode !== 'enforce') {
    return [];
  }

  try {
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/enforcement_nudges?agent_id=eq.${agentId}&status=eq.pending&created_at=gte.${fourHoursAgo}&order=created_at.asc&limit=5`,
      {
        headers: {
          apikey: env.SUPABASE_KEY,
          Authorization: `Bearer ${env.SUPABASE_KEY}`,
        },
      }
    );

    if (!response.ok) {
      console.warn(`[gateway/nudge] Failed to fetch pending nudges: ${response.status}`);
      return [];
    }

    const nudges = (await response.json()) as Array<{
      id: string;
      checkpoint_id: string;
      concerns_summary: string;
    }>;

    if (nudges.length === 0) return [];

    const nudgeText = buildNudgeText(nudges);
    injectNudgeIntoSystem(requestBody, nudgeText);
    console.log(`[gateway/nudge] Injected ${nudges.length} nudge(s) for ${agentId}`);

    return nudges.map((n) => n.id);
  } catch (error) {
    console.error('[gateway/nudge] Error injecting nudges (fail-open):', error);
    return [];
  }
}

/**
 * Create a pending nudge record for a boundary violation.
 * Called when enforcement mode is 'nudge' or 'enforce'.
 */
async function createPendingNudge(
  checkpoint: IntegrityCheckpoint,
  agentId: string,
  sessionId: string,
  env: Env
): Promise<void> {
  try {
    const nudgeId = `nudge-${randomHex(8)}`;
    const concerns = checkpoint.concerns || [];
    const concernsSummary = concerns.length > 0
      ? concerns.map((c: any) => `${c.category || 'unknown'}: ${c.description || 'unspecified'}`).join('; ')
      : 'Boundary violation detected';
    const nudgeContent = buildNudgeText([{
      id: nudgeId,
      checkpoint_id: checkpoint.checkpoint_id,
      concerns_summary: concernsSummary,
    }]);

    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/enforcement_nudges`,
      {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_KEY,
          Authorization: `Bearer ${env.SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          id: nudgeId,
          agent_id: agentId,
          checkpoint_id: checkpoint.checkpoint_id,
          session_id: sessionId,
          status: 'pending',
          nudge_content: nudgeContent,
          concerns_summary: concernsSummary,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`[gateway/nudge] Failed to create nudge: ${response.status} - ${errorText}`);
    } else {
      console.log(`[gateway/nudge] Created pending nudge ${nudgeId} for checkpoint ${checkpoint.checkpoint_id}`);
    }
  } catch (error) {
    console.error('[gateway/nudge] Error creating nudge:', error);
  }
}

/**
 * Mark nudges as delivered after successful injection.
 * Called via ctx.waitUntil() after the forward completes.
 */
async function markNudgesDelivered(
  nudgeIds: string[],
  sessionId: string,
  env: Env
): Promise<void> {
  if (nudgeIds.length === 0) return;

  try {
    for (const nudgeId of nudgeIds) {
      const response = await fetch(
        `${env.SUPABASE_URL}/rest/v1/enforcement_nudges?id=eq.${nudgeId}`,
        {
          method: 'PATCH',
          headers: {
            apikey: env.SUPABASE_KEY,
            Authorization: `Bearer ${env.SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            status: 'delivered',
            delivered_at: new Date().toISOString(),
            delivery_session_id: sessionId,
          }),
        }
      );

      if (!response.ok) {
        console.warn(`[gateway/nudge] Failed to mark nudge ${nudgeId} delivered: ${response.status}`);
      }
    }
    console.log(`[gateway/nudge] Marked ${nudgeIds.length} nudge(s) as delivered`);
  } catch (error) {
    console.error('[gateway/nudge] Error marking nudges delivered:', error);
  }
}

/**
 * Call analysis LLM (Haiku) with system+user prompt.
 * POSTs directly to Anthropic API (NOT through the gateway — that would be recursive).
 * Uses AbortController with 8000ms timeout.
 */
async function callAnalysisLLM(
  system: string,
  user: string,
  env: Env
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Analysis LLM returned ${response.status}: ${errorText}`);
    }

    const body = (await response.json()) as Record<string, unknown>;
    const content = body.content as Array<Record<string, unknown>> | undefined;

    if (!content || content.length === 0) {
      throw new Error('Analysis LLM returned empty content');
    }

    const textBlock = content.find((b) => b.type === 'text');
    if (!textBlock || typeof textBlock.text !== 'string') {
      throw new Error('Analysis LLM returned no text content');
    }

    return textBlock.text;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * HMAC sign payload using Web Crypto API (Cloudflare Workers compatible).
 */
async function hmacSign(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Deliver webhooks for a checkpoint (Wave 4).
 *
 * 1. Query registered webhooks for the agent
 * 2. Filter by matching event types
 * 3. Sign and POST each webhook with retry
 * 4. Track deliveries in aip_webhook_deliveries table
 * 5. Increment failure_count on registration if all retries exhausted
 */
async function deliverWebhooks(
  checkpoint: IntegrityCheckpoint,
  env: Env
): Promise<void> {
  try {
    // 1. Fetch webhook registrations for this agent
    const regResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/aip_webhook_registrations?agent_id=eq.${checkpoint.agent_id}&select=*`,
      {
        headers: {
          apikey: env.SUPABASE_KEY,
          Authorization: `Bearer ${env.SUPABASE_KEY}`,
        },
      }
    );

    if (!regResponse.ok) {
      console.warn(`[gateway/webhook] Failed to fetch registrations: ${regResponse.status}`);
      return;
    }

    const registrations = (await regResponse.json()) as Array<{
      id: string;
      agent_id: string;
      callback_url: string;
      secret: string;
      event_types: string[];
      failure_count: number;
    }>;

    if (registrations.length === 0) return;

    // 2. Determine event type for this checkpoint
    const eventType = `verdict.${checkpoint.verdict}`;

    // 3. Filter registrations by matching event types
    const matchingRegistrations = registrations.filter(reg => {
      return reg.event_types.some(et =>
        et === '*' ||
        et === 'verdict.*' ||
        et === eventType
      );
    });

    if (matchingRegistrations.length === 0) return;

    // 4. Build webhook payload
    const webhookPayload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      checkpoint: {
        checkpoint_id: checkpoint.checkpoint_id,
        agent_id: checkpoint.agent_id,
        verdict: checkpoint.verdict,
        concerns: checkpoint.concerns,
        reasoning_summary: checkpoint.reasoning_summary,
      },
    };

    const payloadString = JSON.stringify(webhookPayload);

    // 5. Deliver to each matching registration
    for (const reg of matchingRegistrations) {
      let delivered = false;
      let lastError: string | null = null;
      const retryDelays = [...WEBHOOK_RETRY_DELAYS_MS];

      // Sign the payload
      const signature = await hmacSign(reg.secret, payloadString);

      // Initial attempt + retries
      for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
        try {
          const webhookResponse = await fetch(reg.callback_url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-AIP-Signature': `sha256=${signature}`,
              'X-AIP-Version': AIP_VERSION,
            },
            body: payloadString,
          });

          if (webhookResponse.ok || (webhookResponse.status >= 200 && webhookResponse.status < 300)) {
            delivered = true;
            break;
          }

          lastError = `HTTP ${webhookResponse.status}`;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }

        // Wait before retry (skip delay after last attempt)
        if (attempt < retryDelays.length) {
          await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
        }
      }

      // 6. Track delivery in aip_webhook_deliveries
      try {
        await fetch(`${env.SUPABASE_URL}/rest/v1/aip_webhook_deliveries`, {
          method: 'POST',
          headers: {
            apikey: env.SUPABASE_KEY,
            Authorization: `Bearer ${env.SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            id: `del-${randomHex(12)}`,
            registration_id: reg.id,
            checkpoint_id: checkpoint.checkpoint_id,
            event_type: eventType,
            delivered,
            attempts: delivered ? 1 : retryDelays.length + 1,
            last_error: lastError,
          }),
        });
      } catch (error) {
        console.warn(`[gateway/webhook] Failed to record delivery:`, error);
      }

      // 7. On all retries exhausted, increment failure_count
      if (!delivered) {
        console.warn(
          `[gateway/webhook] All retries exhausted for registration ${reg.id} -> ${reg.callback_url}`
        );
        try {
          await fetch(
            `${env.SUPABASE_URL}/rest/v1/aip_webhook_registrations?id=eq.${reg.id}`,
            {
              method: 'PATCH',
              headers: {
                apikey: env.SUPABASE_KEY,
                Authorization: `Bearer ${env.SUPABASE_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                failure_count: reg.failure_count + 1,
              }),
            }
          );
        } catch (error) {
          console.warn(`[gateway/webhook] Failed to increment failure_count:`, error);
        }
      }
    }
  } catch (error) {
    console.error('[gateway/webhook] Webhook delivery failed:', error);
  }
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Handle the health check endpoint.
 */
export function handleHealthCheck(env: Env): Response {
  return new Response(
    JSON.stringify({
      status: 'ok',
      version: env.GATEWAY_VERSION,
      timestamp: new Date().toISOString(),
      aip_enabled: (env.AIP_ENABLED ?? 'true') !== 'false',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

// ============================================================================
// Anthropic Proxy Handler (Waves 1, 2, 3, 4)
// ============================================================================

/**
 * Handle Anthropic API proxy requests.
 *
 * Wave 1: Extended thinking injection
 * Wave 2: Real-time AIP integrity checking
 * Wave 3: Conscience nudge injection (pre-forward)
 * Wave 4: Webhook delivery for integrity events
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

    // ====================================================================
    // Wave 1: Extended thinking injection
    // ====================================================================

    // Clone and parse request body for potential modification
    const originalBody = await request.text();
    let requestBody: Record<string, any> | null = null;
    let modifiedBody = originalBody;
    let injectedNudgeIds: string[] = [];

    try {
      requestBody = JSON.parse(originalBody);

      // Inject extended thinking if not already set
      if (requestBody && !requestBody.thinking) {
        requestBody.thinking = { type: 'enabled', budget_tokens: 10000 };
      }

      // ====================================================================
      // Wave 3: Conscience nudge injection (pre-forward)
      // ====================================================================
      const agentEnforcementMode = agent.aip_enforcement_mode || 'observe';
      if (requestBody) {
        injectedNudgeIds = await injectPendingNudges(
          requestBody,
          agent.id,
          agentEnforcementMode,
          env
        );
      }

      modifiedBody = JSON.stringify(requestBody);
    } catch {
      // Body is not valid JSON — forward as-is
      console.warn('[gateway] Request body is not valid JSON, forwarding as-is');
    }

    // Build the forwarding URL
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/anthropic/, '');
    const forwardUrl = `${env.CF_AI_GATEWAY_URL}${path}${url.search}`;

    // Clone headers and add metadata + AI Gateway auth
    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.set('cf-aig-metadata', metadataHeader);
    forwardHeaders.set('cf-aig-authorization', `Bearer ${env.CF_AIG_TOKEN}`);

    // Forward the request with potentially modified body
    // GET/HEAD requests cannot have a body per the Fetch spec
    const forwardRequest = new Request(forwardUrl, {
      method: request.method,
      headers: forwardHeaders,
      ...(request.method !== 'GET' && request.method !== 'HEAD' ? { body: modifiedBody } : {}),
    });

    const response = await fetch(forwardRequest);

    // ====================================================================
    // Wave 2: Real-time AIP integrity checking
    // ====================================================================

    const aipEnabled = (env.AIP_ENABLED ?? 'true') !== 'false';
    const isStreaming = requestBody?.stream === true;

    // Clone response headers as base for our response
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('x-smoltbot-agent', agent.id);
    responseHeaders.set('x-smoltbot-session', sessionId);

    // Add nudge headers if any were injected, and mark them delivered
    if (injectedNudgeIds.length > 0) {
      responseHeaders.set('X-AIP-Enforcement', 'nudge');
      responseHeaders.set('X-AIP-Nudge-Count', String(injectedNudgeIds.length));
      ctx.waitUntil(markNudgesDelivered(injectedNudgeIds, sessionId, env));
    }

    // Update last_seen and ensure alignment card is current (background)
    ctx.waitUntil(updateLastSeen(agent.id, env));
    ctx.waitUntil(ensureAlignmentCard(agent.id, env));

    // If AIP disabled, forward response unchanged
    if (!aipEnabled) {
      responseHeaders.set('X-AIP-Verdict', 'disabled');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    }

    // If streaming, skip AIP (cannot buffer SSE for analysis)
    if (isStreaming) {
      responseHeaders.set('X-AIP-Verdict', 'skipped');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    }

    // Buffer the full response for analysis
    const responseBodyText = await response.text();

    // Fail-open wrapper: entire AIP pipeline wrapped in try/catch
    try {
      // Fetch alignment data and recent checkpoints in parallel
      const [alignmentData, historicalCheckpoints] = await Promise.all([
        fetchAlignmentData(agent.id, env),
        fetchRecentCheckpoints(agent.id, sessionId, env),
      ]);

      const { card, conscienceValues, enforcementMode } = alignmentData;

      // If no card available, forward with clear verdict
      if (!card) {
        console.log('[gateway/aip] No alignment card found, forwarding as clear');
        responseHeaders.set('X-AIP-Verdict', 'clear');
        responseHeaders.set('X-AIP-Synthetic', 'true');
        return new Response(responseBodyText, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
        });
      }

      // Map AAP card to AIP format
      const aipCard = mapCardToAIP(card);

      // Create WindowManager and hydrate with historical checkpoints
      const windowConfig = {
        max_size: 10,
        mode: 'sliding' as const,
        session_boundary: 'reset' as const,
        max_age_seconds: 3600,
      };
      const window = new WindowManager(windowConfig, sessionId);

      // Hydrate window with historical checkpoints
      for (const cp of historicalCheckpoints) {
        window.push(cp);
      }

      // Extract thinking block from response using Anthropic adapter
      const registry = createAdapterRegistry();
      const adapter = registry.get('anthropic');
      const thinking = adapter.extractThinking(responseBodyText);

      // If no thinking block found, forward with clear verdict
      if (!thinking) {
        console.log('[gateway/aip] No thinking block found in response');
        responseHeaders.set('X-AIP-Verdict', 'clear');
        responseHeaders.set('X-AIP-Synthetic', 'true');
        return new Response(responseBodyText, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
        });
      }

      // Build conscience prompt
      const values: ConscienceValue[] = conscienceValues || [...DEFAULT_CONSCIENCE_VALUES];
      const prompt = buildConsciencePrompt({
        card: aipCard,
        conscienceValues: values,
        windowContext: window.getState().checkpoints,
        thinkingBlock: thinking.content,
      });

      // Call analysis LLM (Haiku)
      const analysisStartTime = Date.now();
      const analysisResponseText = await callAnalysisLLM(prompt.system, prompt.user, env);
      const analysisDurationMs = Date.now() - analysisStartTime;

      // Hash thinking block using Web Crypto API
      const thinkingHash = await sha256(thinking.content);

      // Build checkpoint via checkIntegrity
      const windowState = window.getState();
      const checkpoint = checkIntegrity({
        analysisResponse: analysisResponseText,
        thinking: {
          hash: thinkingHash,
          provider: thinking.provider,
          model: thinking.model,
          tokensOriginal: prompt.originalTokens,
          tokensAnalyzed: prompt.analyzedTokens,
          truncated: prompt.truncated,
          confidence: thinking.confidence,
        },
        agentId: agent.id,
        cardId: aipCard.card_id,
        sessionId,
        windowPosition: {
          index: windowState.size,
          window_size: windowState.size + 1,
        },
        analysisModel: 'claude-3-5-haiku-20241022',
        analysisDurationMs,
      });

      // Push to window, get summary, build signal
      window.push(checkpoint);
      const summary = window.getSummary();
      const signal = buildSignal(checkpoint, summary);

      // Detect drift
      let driftState: DriftState = createDriftState();
      const driftResult = detectIntegrityDrift(
        driftState,
        checkpoint,
        window.getState().checkpoints,
      );
      driftState = driftResult.state;

      if (driftResult.alert) {
        summary.drift_alert_active = true;
      }

      // Set AIP headers
      responseHeaders.set('X-AIP-Verdict', checkpoint.verdict);
      responseHeaders.set('X-AIP-Checkpoint-Id', checkpoint.checkpoint_id);
      responseHeaders.set('X-AIP-Action', signal.recommended_action);
      responseHeaders.set('X-AIP-Proceed', String(signal.proceed));

      // Background: store checkpoint and deliver webhooks
      ctx.waitUntil(storeCheckpoint(checkpoint, 'gateway', env));
      ctx.waitUntil(deliverWebhooks(checkpoint, env));

      // Create pending nudge for boundary violations (nudge or enforce mode)
      if (
        checkpoint.verdict === 'boundary_violation' &&
        (enforcementMode === 'nudge' || enforcementMode === 'enforce')
      ) {
        ctx.waitUntil(createPendingNudge(checkpoint, agent.id, sessionId, env));
      }

      // Apply enforcement
      if (enforcementMode === 'enforce' && checkpoint.verdict === 'boundary_violation') {
        // Enforce mode + boundary violation: return 403
        return new Response(
          JSON.stringify({
            error: 'Request blocked by integrity check',
            type: 'integrity_violation',
            checkpoint: {
              checkpoint_id: checkpoint.checkpoint_id,
              verdict: checkpoint.verdict,
              concerns: checkpoint.concerns,
              reasoning_summary: checkpoint.reasoning_summary,
              recommended_action: signal.recommended_action,
            },
          }),
          {
            status: 403,
            headers: {
              'Content-Type': 'application/json',
              'X-AIP-Verdict': checkpoint.verdict,
              'X-AIP-Checkpoint-Id': checkpoint.checkpoint_id,
              'X-AIP-Action': signal.recommended_action,
              'X-AIP-Proceed': String(signal.proceed),
              'x-smoltbot-agent': agent.id,
              'x-smoltbot-session': sessionId,
            },
          }
        );
      }

      // Observe mode or enforce mode with non-violation: forward response with AIP headers
      return new Response(responseBodyText, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (aipError) {
      // Fail-open: log error, set error header, forward response unchanged
      console.error('[gateway/aip] AIP pipeline error (fail-open):', aipError);
      responseHeaders.set('X-AIP-Verdict', 'error');
      return new Response(responseBodyText, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    }
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

// ============================================================================
// Main Request Handler
// ============================================================================

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
          'Access-Control-Expose-Headers': 'x-smoltbot-agent, x-smoltbot-session, X-AIP-Verdict, X-AIP-Checkpoint-Id, X-AIP-Action, X-AIP-Proceed, X-AIP-Synthetic',
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
