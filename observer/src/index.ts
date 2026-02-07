/**
 * Smoltbot Observer Worker
 *
 * Processes logs from Cloudflare AI Gateway, extracts thinking blocks,
 * analyzes decisions with Claude Haiku, builds AP-Traces, verifies against
 * alignment cards, and stores traces for transparency.
 *
 * AAP SDK Integration:
 * - Uses verifyTrace() to validate traces against alignment cards
 * - Uses detectDrift() to identify behavioral drift patterns
 * - All trace structures conform to APTrace interface
 */

import {
  verifyTrace,
  detectDrift,
  type APTrace,
  type AlignmentCard,
  type Action,
  type Decision,
  type Escalation,
  type VerificationResult,
  type DriftAlert,
  type TraceContext,
} from '@mnemom/agent-alignment-protocol';

// ============================================================================
// Types
// ============================================================================

interface Env {
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  GATEWAY_ID: string;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  ANTHROPIC_API_KEY: string;
}

interface GatewayLog {
  id: string;
  created_at: string;
  provider: string;
  model: string;
  success: boolean;
  tokens_in: number;
  tokens_out: number;
  duration: number;
  metadata?: Record<string, string>;
}

interface GatewayLogDetail {
  id: string;
  response_body?: string;
  request_body?: string;
}

interface GatewayMetadata {
  agent_id: string;
  agent_hash: string;
  session_id: string;
  timestamp: string;
  gateway_version: string;
}

interface HaikuAnalysis {
  alternatives: Array<{ id: string; description: string }>;
  selected: string;
  reasoning: string;
  values_applied: string[];
  confidence: 'high' | 'medium' | 'low';
}

interface ExtractedContext {
  thinking: string | null;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
  userQuery: string | null;
  responseText: string | null;
}

interface ProcessingStats {
  processed: number;
  skipped: number;
  errors: number;
}

// ============================================================================
// Worker Export
// ============================================================================

export default {
  /**
   * Cron trigger - runs every minute to process new logs
   */
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log('[observer] Scheduled trigger started');

    try {
      const stats = await processAllLogs(env, ctx);
      console.log(
        `[observer] Completed - processed: ${stats.processed}, skipped: ${stats.skipped}, errors: ${stats.errors}`
      );
    } catch (error) {
      console.error('[observer] Fatal error in scheduled handler:', error);
    }
  },

  /**
   * HTTP handler - manual trigger for testing
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        service: 'smoltbot-observer',
        version: '2.0.0',
      });
    }

    // Manual trigger endpoint
    if (url.pathname === '/trigger') {
      console.log('[observer] Manual trigger initiated');

      // Run processing in background
      ctx.waitUntil(
        processAllLogs(env, ctx).then((stats) => {
          console.log(
            `[observer] Manual trigger completed - processed: ${stats.processed}`
          );
        })
      );

      return Response.json({
        status: 'triggered',
        message: 'Log processing started in background',
      });
    }

    // Status endpoint - check gateway connectivity
    if (url.pathname === '/status') {
      try {
        const logs = await fetchLogs(env, 1);
        return Response.json({
          status: 'ok',
          gateway_connected: true,
          pending_logs: logs.length,
        });
      } catch (error) {
        return Response.json(
          {
            status: 'error',
            gateway_connected: false,
            error: String(error),
          },
          { status: 503 }
        );
      }
    }

    return Response.json(
      {
        error: 'Not found',
        endpoints: ['/health', '/trigger', '/status'],
      },
      { status: 404 }
    );
  },
};

// ============================================================================
// Main Processing Logic
// ============================================================================

/**
 * Process all pending logs from the AI Gateway
 */
async function processAllLogs(
  env: Env,
  ctx: ExecutionContext
): Promise<ProcessingStats> {
  const stats: ProcessingStats = { processed: 0, skipped: 0, errors: 0 };

  try {
    const logs = await fetchLogs(env);
    console.log(`[observer] Found ${logs.length} logs to process`);

    for (const log of logs) {
      try {
        const wasProcessed = await processLog(log, env, ctx);
        if (wasProcessed) {
          stats.processed++;
        } else {
          stats.skipped++;
        }
      } catch (error) {
        console.error(`[observer] Failed to process log ${log.id}:`, error);
        stats.errors++;
        // Continue processing other logs even if one fails
      }
    }
  } catch (error) {
    console.error('[observer] Failed to fetch logs:', error);
    throw error;
  }

  return stats;
}

/**
 * Process a single log entry
 * @returns true if trace was created, false if log was skipped
 */
async function processLog(
  log: GatewayLog,
  env: Env,
  ctx: ExecutionContext
): Promise<boolean> {
  // Extract metadata from log - CF AI Gateway parses cf-aig-metadata header
  // and returns it directly as the metadata object (not nested under a key)
  const metadata = log.metadata as GatewayMetadata | undefined;

  // Validate this is a smoltbot request by checking for agent_id
  if (!metadata?.agent_id) {
    console.log(`[observer] Skipping ${log.id}: no smoltbot metadata`);
    await deleteLog(log.id, env);
    return false;
  }

  const { agent_id, session_id } = metadata;

  console.log(`[observer] Processing log ${log.id} for agent ${agent_id}`);

  // Fetch full request + response bodies
  const bodies = await fetchLogBodies(log.id, env);

  // Extract thinking, tool calls, user query, response text
  const context = extractContext(bodies.request, bodies.response);

  console.log(
    `[observer] Extracted: thinking=${!!context.thinking}, tools=${context.toolCalls.length}, query=${!!context.userQuery}`
  );

  // Analyze reasoning with Claude Haiku
  const analysis = await analyzeWithHaiku(context, env);

  // Fetch active alignment card for this agent
  const card = await fetchCard(agent_id, env);

  // Build APTrace conformant trace object
  const trace = buildTrace(log, metadata, context, analysis, card);

  // Verify trace against alignment card using AAP SDK
  const verification = card ? verifyTrace(trace, card) : null;

  // Submit trace to Supabase (trace + verification stored separately)
  await submitTrace(trace, verification, log, env);

  // Check for behavioral drift (runs in background)
  ctx.waitUntil(checkForDrift(agent_id, card, env));

  // Delete processed log for privacy
  await deleteLog(log.id, env);

  console.log(`[observer] Created trace ${trace.trace_id} for agent ${agent_id}`);

  return true;
}

// ============================================================================
// Cloudflare AI Gateway API Functions
// ============================================================================

/**
 * Fetch logs from Cloudflare AI Gateway
 */
async function fetchLogs(env: Env, limit: number = 50): Promise<GatewayLog[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai-gateway/gateways/${env.GATEWAY_ID}/logs?per_page=${limit}&order=asc`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `AI Gateway API error: ${response.status} - ${errorText}`
    );
  }

  const data = (await response.json()) as {
    success: boolean;
    result: GatewayLog[];
    errors?: Array<{ message: string }>;
  };

  if (!data.success) {
    throw new Error(
      `AI Gateway API failed: ${data.errors?.map((e) => e.message).join(', ')}`
    );
  }

  return data.result || [];
}

/**
 * Fetch full request and response bodies for a specific log entry
 */
async function fetchLogBodies(
  logId: string,
  env: Env
): Promise<{ request: string; response: string }> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai-gateway/gateways/${env.GATEWAY_ID}/logs/${logId}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    console.warn(`[observer] Failed to fetch log bodies for ${logId}`);
    return { request: '', response: '' };
  }

  const data = (await response.json()) as {
    success: boolean;
    result: GatewayLogDetail;
  };

  return {
    request: data.result?.request_body || '',
    response: data.result?.response_body || '',
  };
}

/**
 * Delete a processed log from the AI Gateway
 * Uses filter-based deletion per CF API spec
 */
async function deleteLog(logId: string, env: Env): Promise<void> {
  // CF AI Gateway API requires filter-based deletion with eq operator and array value
  const filters = JSON.stringify([{ key: 'id', operator: 'eq', value: [logId] }]);
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai-gateway/gateways/${env.GATEWAY_ID}/logs?filters=${encodeURIComponent(filters)}`;

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`[observer] Failed to delete log ${logId}: ${response.status} - ${errorText}`);
    }
  } catch (error) {
    console.warn(`[observer] Error deleting log ${logId}:`, error);
  }
}

// ============================================================================
// Context Extraction
// ============================================================================

/**
 * Extract thinking, tool calls, user query, and response text from
 * raw request/response bodies. Handles both JSON and SSE streaming formats.
 */
function extractContext(requestBody: string, responseBody: string): ExtractedContext {
  const result: ExtractedContext = {
    thinking: null,
    toolCalls: [],
    userQuery: null,
    responseText: null,
  };

  // --- Parse response (try JSON first, then SSE) ---
  if (responseBody) {
    const parsed = tryParseResponseJSON(responseBody) || tryParseSSE(responseBody);
    if (parsed) {
      result.thinking = parsed.thinking;
      result.toolCalls = parsed.toolCalls;
      result.responseText = parsed.responseText;
    }
  }

  // --- Parse request for user query ---
  if (requestBody) {
    result.userQuery = extractUserQuery(requestBody);
  }

  return result;
}

/**
 * Try to parse response as a complete JSON message (non-streaming)
 */
function tryParseResponseJSON(
  body: string
): { thinking: string | null; toolCalls: ExtractedContext['toolCalls']; responseText: string | null } | null {
  try {
    const response = JSON.parse(body);
    const content = response.content;
    if (!Array.isArray(content)) return null;
    return extractFromContentBlocks(content);
  } catch {
    return null;
  }
}

/**
 * Try to parse response as SSE streaming events.
 * Reconstructs content blocks from content_block_start + content_block_delta events.
 */
function tryParseSSE(
  body: string
): { thinking: string | null; toolCalls: ExtractedContext['toolCalls']; responseText: string | null } | null {
  if (!body.includes('data: ')) return null;

  try {
    // Track content blocks by index
    const blocks: Map<number, { type: string; content: string; name?: string; input?: string }> = new Map();

    const lines = body.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(jsonStr);
      } catch {
        continue;
      }

      const eventType = event.type as string;

      if (eventType === 'content_block_start') {
        const index = event.index as number;
        const block = event.content_block as Record<string, unknown>;
        blocks.set(index, {
          type: block.type as string,
          content: '',
          name: block.name as string | undefined,
          input: '',
        });
      } else if (eventType === 'content_block_delta') {
        const index = event.index as number;
        const delta = event.delta as Record<string, unknown>;
        const existing = blocks.get(index);
        if (!existing) continue;

        if (delta.type === 'thinking_delta') {
          existing.content += (delta.thinking as string) || '';
        } else if (delta.type === 'text_delta') {
          existing.content += (delta.text as string) || '';
        } else if (delta.type === 'input_json_delta') {
          existing.input = (existing.input || '') + ((delta.partial_json as string) || '');
        }
      }
    }

    if (blocks.size === 0) return null;

    // Convert accumulated blocks to content block format
    const contentBlocks = Array.from(blocks.values()).map((b) => {
      if (b.type === 'thinking') {
        return { type: 'thinking', thinking: b.content };
      } else if (b.type === 'tool_use') {
        let input = {};
        try { input = JSON.parse(b.input || '{}'); } catch { /* */ }
        return { type: 'tool_use', name: b.name, input };
      } else {
        return { type: 'text', text: b.content };
      }
    });

    return extractFromContentBlocks(contentBlocks);
  } catch {
    return null;
  }
}

/**
 * Extract thinking, tool calls, and text from parsed content blocks
 */
function extractFromContentBlocks(
  content: Array<Record<string, unknown>>
): { thinking: string | null; toolCalls: ExtractedContext['toolCalls']; responseText: string | null } {
  const thinkingBlocks: string[] = [];
  const toolCalls: ExtractedContext['toolCalls'] = [];
  const textBlocks: string[] = [];

  for (const block of content) {
    if (block.type === 'thinking' && block.thinking) {
      thinkingBlocks.push(block.thinking as string);
    } else if (block.type === 'tool_use' && block.name) {
      toolCalls.push({
        name: block.name as string,
        input: (block.input as Record<string, unknown>) || {},
      });
    } else if (block.type === 'text' && block.text) {
      textBlocks.push(block.text as string);
    }
  }

  return {
    thinking: thinkingBlocks.length > 0 ? thinkingBlocks.join('\n\n---\n\n') : null,
    toolCalls,
    responseText: textBlocks.length > 0 ? textBlocks.join('\n\n') : null,
  };
}

/**
 * Extract the user's query from the request body
 */
function extractUserQuery(requestBody: string): string | null {
  try {
    const request = JSON.parse(requestBody);
    const messages = request.messages;
    if (!Array.isArray(messages)) return null;

    // Get the last user message
    const lastUserMsg = [...messages].reverse().find(
      (m: Record<string, unknown>) => m.role === 'user'
    );
    if (!lastUserMsg) return null;

    const content = lastUserMsg.content;
    if (typeof content === 'string') {
      return content.substring(0, 500);
    }
    if (Array.isArray(content)) {
      return content
        .filter((c: Record<string, unknown>) => c.type === 'text')
        .map((c: Record<string, unknown>) => c.text as string)
        .join('\n')
        .substring(0, 500);
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// Haiku Analysis
// ============================================================================

/**
 * Analyze reasoning with Claude Haiku to extract decision structure.
 * Uses thinking blocks, user query, tool calls, and response text for rich analysis.
 */
async function analyzeWithHaiku(
  context: ExtractedContext,
  env: Env
): Promise<HaikuAnalysis> {
  // Build context sections for analysis
  const sections: string[] = [];

  if (context.userQuery) {
    sections.push(`<user_query>\n${context.userQuery}\n</user_query>`);
  }

  if (context.thinking) {
    sections.push(`<reasoning>\n${context.thinking.substring(0, 3000)}\n</reasoning>`);
  }

  if (context.toolCalls.length > 0) {
    const toolSummary = context.toolCalls
      .map((t) => `- ${t.name}(${Object.keys(t.input).join(', ')})`)
      .join('\n');
    sections.push(`<tools_used>\n${toolSummary}\n</tools_used>`);
  }

  if (context.responseText) {
    sections.push(`<response_excerpt>\n${context.responseText.substring(0, 1000)}\n</response_excerpt>`);
  }

  // If we have no context at all, return minimal fallback
  if (sections.length === 0) {
    return {
      alternatives: [{ id: 'direct', description: 'Direct response — no request/response data available' }],
      selected: 'direct',
      reasoning: 'No request or response data captured',
      values_applied: ['transparency'],
      confidence: 'low',
    };
  }

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
        messages: [
          {
            role: 'user',
            content: `Analyze this AI agent interaction and extract the decision structure. Return ONLY valid JSON.

${sections.join('\n\n')}

Return this exact JSON structure:
{
  "alternatives": [{"id": "short_id", "description": "what this option does"}],
  "selected": "id of the chosen option",
  "reasoning": "1-2 sentence summary of what the agent did and why",
  "values_applied": ["transparency", "accuracy", "helpfulness", "safety", "autonomy", "honesty"],
  "confidence": "high" | "medium" | "low"
}

Guidelines:
- Extract actual alternatives considered from the reasoning, or infer likely ones from the query
- "reasoning" should describe what happened in plain English (e.g. "Edited config file to fix auth bug" not "The AI processed the request")
- List values that influenced the decision (pick from: transparency, accuracy, helpfulness, safety, autonomy, honesty, or add custom)
- confidence: high = clear reasoning with explicit tradeoffs, medium = reasonable but implicit, low = minimal context`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Haiku API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    const text = data.content[0]?.text || '';

    // Try to extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Haiku response');
    }

    const analysis = JSON.parse(jsonMatch[0]) as HaikuAnalysis;

    // Validate required fields
    if (!analysis.alternatives || !analysis.selected || !analysis.reasoning) {
      throw new Error('Invalid analysis structure');
    }

    return analysis;
  } catch (error) {
    console.error('[observer] Haiku analysis failed:', error);

    // Return fallback with whatever context we have
    const fallbackReasoning = context.toolCalls.length > 0
      ? `Used tools: ${context.toolCalls.map((t) => t.name).join(', ')}`
      : context.responseText
        ? context.responseText.substring(0, 100)
        : 'Analysis failed — reasoning could not be structured';

    return {
      alternatives: [{ id: 'analyzed', description: 'Analysis attempted but extraction failed' }],
      selected: 'analyzed',
      reasoning: fallbackReasoning,
      values_applied: ['transparency'],
      confidence: 'low',
    };
  }
}

// ============================================================================
// Supabase Functions
// ============================================================================

/**
 * Fetch the active alignment card for an agent
 */
async function fetchCard(
  agentId: string,
  env: Env
): Promise<AlignmentCard | null> {
  try {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/alignment_cards?agent_id=eq.${agentId}&is_active=eq.true&limit=1`,
      {
        headers: {
          apikey: env.SUPABASE_KEY,
          Authorization: `Bearer ${env.SUPABASE_KEY}`,
        },
      }
    );

    if (!response.ok) {
      console.warn(`[observer] Failed to fetch card for ${agentId}: ${response.status}`);
      return null;
    }

    const cards = (await response.json()) as Array<{ card_json: AlignmentCard }>;

    return cards[0]?.card_json || null;
  } catch (error) {
    console.error(`[observer] Error fetching card for ${agentId}:`, error);
    return null;
  }
}

/**
 * Submit a trace to Supabase
 */
async function submitTrace(
  trace: APTrace,
  verification: VerificationResult | null,
  log: GatewayLog,
  env: Env
): Promise<void> {
  // Map APTrace to database schema
  // Note: APTrace doesn't have outcome/verification - we store those separately
  const dbTrace = {
    trace_id: trace.trace_id,
    agent_id: trace.agent_id,
    card_id: trace.card_id,
    timestamp: trace.timestamp,

    // Action (stored as JSONB per schema)
    action: trace.action,

    // Decision (stored as JSONB per schema)
    decision: trace.decision,

    // Escalation (stored as JSONB per schema)
    escalation: trace.escalation,

    // Context (stored as JSONB per schema)
    context: trace.context,

    // Verification result from verifyTrace() - separate from APTrace
    verification: verification,

    // Full trace for extensibility
    trace_json: trace,
  };

  // Use upsert with on_conflict to ensure idempotency
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/traces?on_conflict=trace_id`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_KEY,
      Authorization: `Bearer ${env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(dbTrace),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to submit trace: ${response.status} - ${errorText}`);
  }
}

/**
 * Check for behavioral drift across recent traces
 */
async function checkForDrift(
  agentId: string,
  card: AlignmentCard | null,
  env: Env
): Promise<void> {
  if (!card) {
    return;
  }

  try {
    // Fetch recent traces for drift analysis
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/traces?agent_id=eq.${agentId}&order=timestamp.desc&limit=50`,
      {
        headers: {
          apikey: env.SUPABASE_KEY,
          Authorization: `Bearer ${env.SUPABASE_KEY}`,
        },
      }
    );

    if (!response.ok) {
      console.warn(`[observer] Failed to fetch traces for drift check: ${response.status}`);
      return;
    }

    const traces = (await response.json()) as Array<{ trace_json: APTrace }>;

    if (traces.length < 10) {
      // Not enough traces for meaningful drift detection
      return;
    }

    // Extract APTrace objects from database records
    const apTraces = traces.map((t) => t.trace_json);

    // Use AAP SDK drift detection - returns DriftAlert[]
    const driftAlerts: DriftAlert[] = detectDrift(card, apTraces);

    // Limit to first alert to prevent subrequest overflow
    // TODO: Add proper deduplication - check if similar alert exists before storing
    if (driftAlerts.length > 0) {
      const alert = driftAlerts[0];
      await storeDriftAlert(agentId, alert, env);
      console.log(
        `[observer] Drift detected for ${agentId}: ${alert.analysis.drift_direction} (${driftAlerts.length} total alerts)`
      );
    }
  } catch (error) {
    console.error(`[observer] Drift detection failed for ${agentId}:`, error);
  }
}

/**
 * Store a drift alert in Supabase
 */
async function storeDriftAlert(
  agentId: string,
  driftAlert: DriftAlert,
  env: Env
): Promise<void> {
  // Map DriftAlert analysis to severity based on similarity score
  const severity = driftAlert.analysis.similarity_score < 0.3 ? 'high'
    : driftAlert.analysis.similarity_score < 0.5 ? 'medium' : 'low';

  const alert = {
    id: `drift-${randomHex(8)}`,
    agent_id: agentId,
    card_id: driftAlert.card_id,
    alert_type: driftAlert.analysis.drift_direction,
    severity,
    description: driftAlert.recommendation,
    drift_data: driftAlert.analysis,
    trace_ids: driftAlert.trace_ids,
  };

  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/drift_alerts`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(alert),
    });

    if (!response.ok) {
      console.warn(`[observer] Failed to store drift alert: ${response.status}`);
    }
  } catch (error) {
    console.error('[observer] Error storing drift alert:', error);
  }
}

// ============================================================================
// Trace Building
// ============================================================================

/**
 * Build an APTrace conformant trace object
 */
function buildTrace(
  log: GatewayLog,
  metadata: GatewayMetadata,
  context: ExtractedContext,
  analysis: HaikuAnalysis,
  card: AlignmentCard | null
): APTrace {
  // Derive trace_id from log.id for idempotency - same log = same trace
  const traceId = `tr-${log.id.slice(-8)}`;

  // Build action name — prefer tool names, fall back to model
  let actionName = log.model || 'unknown';
  if (context.toolCalls.length > 0) {
    actionName = context.toolCalls.map((t) => t.name).join(', ');
  }

  // Build action object per AAP SDK Action interface
  const action: Action = {
    type: 'execute',
    name: actionName,
    category: 'bounded',
    target: {
      type: 'api',
      identifier: log.provider || 'anthropic',
    },
    parameters: {
      tokens_in: log.tokens_in,
      tokens_out: log.tokens_out,
      duration_ms: log.duration,
      model: log.model,
      ...(context.toolCalls.length > 0 && {
        tools: context.toolCalls.map((t) => t.name),
      }),
    },
  };

  // Build decision object per AAP SDK Decision interface
  const decision: Decision = {
    alternatives_considered: analysis.alternatives.map((a) => ({
      option_id: a.id,
      description: a.description,
    })),
    selected: analysis.selected,
    selection_reasoning: analysis.reasoning,
    values_applied: analysis.values_applied,
    confidence: analysis.confidence === 'high' ? 0.9 : analysis.confidence === 'medium' ? 0.6 : 0.3,
  };

  // Build escalation object per AAP SDK Escalation interface
  const escalation: Escalation = {
    evaluated: true,
    required: false,
    reason: 'No escalation triggers matched',
  };

  // Build the complete APTrace object (matches SDK exactly)
  const trace: APTrace = {
    trace_id: traceId,
    agent_id: metadata.agent_id,
    card_id: card?.card_id || 'ac-default',
    timestamp: log.created_at,

    action,
    decision,
    escalation,

    context: {
      session_id: metadata.session_id,
      conversation_turn: 1,
      environment: {
        gateway_version: metadata.gateway_version,
        provider: log.provider,
      },
      metadata: {
        has_thinking: !!context.thinking,
        gateway_log_id: log.id,
        success: log.success,
        tool_count: context.toolCalls.length,
        result_summary: `${log.tokens_out} tokens generated in ${log.duration}ms`,
      },
    },
  };

  return trace;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generate a random hex string of specified length
 */
function randomHex(length: number): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
