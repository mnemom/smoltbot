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
 *
 * AIP SDK Integration:
 * - Uses createClient() + client.check() for real-time integrity analysis
 * - Runs alongside AAP verification (fail-open, non-blocking checkpoint storage)
 * - Stores IntegrityCheckpoints in Supabase integrity_checkpoints table
 * - Enriches AP-Trace metadata with aip_verdict and aip_checkpoint_id
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

import {
  createClient,
  DEFAULT_CONSCIENCE_VALUES,
  type AIPClient,
  type IntegritySignal,
  type AIPConfig,
  type IntegrityCheckpoint,
} from '@mnemom/agent-integrity-protocol';

import { createWorkersExporter, type WorkersOTelExporter } from '@mnemom/aip-otel-exporter/workers';

// ============================================================================
// Types
// ============================================================================

interface Env {
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  CF_AI_GATEWAY_URL?: string;
  GATEWAY_ID: string;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  ANTHROPIC_API_KEY: string;
  ANALYSIS_API_KEY?: string;
  OTLP_ENDPOINT?: string;
  OTLP_AUTH?: string;
  STRIPE_SECRET_KEY?: string;
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

    const otelExporter = createOTelExporter(env);

    try {
      const stats = await processAllLogs(env, ctx, otelExporter);
      console.log(
        `[observer] Completed - processed: ${stats.processed}, skipped: ${stats.skipped}, errors: ${stats.errors}`
      );

      // Expire stale nudges (>4h old pending nudges)
      ctx.waitUntil(expireStaleNudges(env));

      // Roll up metering events for billing (idempotent, safe every tick)
      ctx.waitUntil(triggerMeteringRollup(env));

      // Report daily usage to Stripe (midnight UTC only)
      const now = new Date();
      if (now.getUTCHours() === 0 && now.getUTCMinutes() === 0) {
        ctx.waitUntil(reportDailyUsageToStripe(env));
      }

      // Flush OTel spans for all processed logs in one batch
      if (otelExporter) {
        ctx.waitUntil(otelExporter.flush());
      }
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

      const otelExporter = createOTelExporter(env);

      // Run processing in background
      ctx.waitUntil(
        processAllLogs(env, ctx, otelExporter).then(async (stats) => {
          console.log(
            `[observer] Manual trigger completed - processed: ${stats.processed}`
          );
          if (otelExporter) await otelExporter.flush();
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
// OTel Exporter
// ============================================================================

function createOTelExporter(env: Env) {
  if (!env.OTLP_ENDPOINT) return null;
  return createWorkersExporter({
    endpoint: env.OTLP_ENDPOINT,
    authorization: env.OTLP_AUTH,
    serviceName: 'smoltbot-observer',
  });
}

// ============================================================================
// Main Processing Logic
// ============================================================================

/**
 * Process all pending logs from the AI Gateway
 */
async function processAllLogs(
  env: Env,
  ctx: ExecutionContext,
  otelExporter?: WorkersOTelExporter | null
): Promise<ProcessingStats> {
  const stats: ProcessingStats = { processed: 0, skipped: 0, errors: 0 };

  try {
    const logs = await fetchLogs(env);
    console.log(`[observer] Found ${logs.length} logs to process`);

    for (const log of logs) {
      try {
        const wasProcessed = await processLog(log, env, ctx, otelExporter);
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
  ctx: ExecutionContext,
  otelExporter?: WorkersOTelExporter | null
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

  // Skip failed API calls (e.g. 401 from invalid keys) — not behavioral events
  if (!log.success) {
    console.log(`[observer] Skipping ${log.id}: upstream API error (success=false)`);
    await deleteLog(log.id, env);
    return false;
  }

  const { agent_id, session_id } = metadata;

  console.log(`[observer] Processing log ${log.id} for agent ${agent_id}`);

  // Fetch full request + response bodies
  const bodies = await fetchLogBodies(log.id, env);

  // CF AI Gateway stores streamed responses with content flattened to a string
  // and raw SSE events in streamed_data[]. Reconstruct SSE format so the AIP
  // SDK's extractThinkingFromStream() can find thinking blocks.
  bodies.response = reconstructResponseForAIP(bodies.response, log.provider);

  // Extract thinking, tool calls, user query, response text
  const context = extractContext(bodies.request, bodies.response, log.provider);

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

  if (verification && otelExporter) {
    otelExporter.recordVerification(verification);
  }

  // Check if gateway already created a checkpoint for this session (dedup)
  let gatewayCheckpointExists = false;
  try {
    const dedupRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/integrity_checkpoints?agent_id=eq.${agent_id}&source=eq.gateway&session_id=eq.${session_id}&order=timestamp.desc&limit=1`,
      {
        headers: {
          apikey: env.SUPABASE_KEY,
          Authorization: `Bearer ${env.SUPABASE_KEY}`,
        },
      }
    );
    if (dedupRes.ok) {
      const existing = (await dedupRes.json()) as unknown[];
      gatewayCheckpointExists = existing.length > 0;
    }
  } catch (error) {
    // Fail-open: if dedup query fails, proceed with the check anyway
    console.warn('[observer/aip] Dedup query failed (proceeding with check):', error);
  }

  // Run AIP integrity check alongside AAP verification (fail-open)
  let aipSignal: IntegritySignal | null = null;
  if (gatewayCheckpointExists) {
    console.log('[observer/aip] Gateway checkpoint exists for session, skipping');
  } else {
    console.log(`[observer/aip] Running integrity check for ${agent_id}, provider=${log.provider}, responseLen=${bodies.response.length}, hasCard=${!!card}`);
    // Build enriched task context (PII-safe: role + tool names + truncated query)
    const agentRole = (card as any)?.extensions?.mnemom?.description
      || (card as any)?.extensions?.mnemom?.role
      || '';
    const toolNames = context.toolCalls.length > 0
      ? context.toolCalls.map(t => t.name).join(', ')
      : '';
    const userQueryTruncated = context.userQuery
      ? context.userQuery.slice(0, 200)
      : '';
    const taskParts = [
      agentRole ? `${agentRole}.` : '',
      toolNames ? `Currently: ${toolNames}.` : '',
      userQueryTruncated ? `User request: ${userQueryTruncated}` : '',
    ].filter(Boolean);
    const taskContext = taskParts.length > 0 ? taskParts.join(' ') : undefined;

    // Fetch recent checkpoints for window hydration
    const recentCheckpoints = await fetchRecentCheckpoints(agent_id, session_id, env);

    aipSignal = await runIntegrityCheck(
      bodies.response,
      log.provider,
      agent_id,
      card,
      env,
      taskContext,
      recentCheckpoints
    );
    console.log(`[observer/aip] runIntegrityCheck returned: ${aipSignal ? `verdict=${aipSignal.checkpoint.verdict}` : 'null'}`);

    if (aipSignal && otelExporter) {
      otelExporter.recordIntegrityCheck(aipSignal);
    }
  }

  // Enrich trace metadata with AIP results before submission
  if (aipSignal && trace.context?.metadata) {
    const traceMetadata = trace.context.metadata as Record<string, unknown>;
    traceMetadata.aip_verdict = aipSignal.checkpoint.verdict;
    traceMetadata.aip_checkpoint_id = aipSignal.checkpoint.checkpoint_id;
  }

  // Submit trace to Supabase (trace + verification stored separately)
  await submitTrace(trace, verification, log, env);

  // Submit usage event for admin tracking (non-blocking)
  ctx.waitUntil(submitUsageEvent(trace, log, env));

  // Submit AIP checkpoint to Supabase (non-blocking, same pattern as drift)
  // Override agent_id: SDK uses card_id as proxy, but DB FK references agents(id)
  // Link checkpoint to its corresponding trace for unified timeline
  if (aipSignal) {
    aipSignal.checkpoint.agent_id = agent_id;
    aipSignal.checkpoint.linked_trace_id = trace.trace_id;
    ctx.waitUntil(submitCheckpoint(aipSignal.checkpoint, env));
    ctx.waitUntil(submitMeteringEvent(agent_id, aipSignal.checkpoint.checkpoint_id, 'observer', env));

    // Create pending nudge for boundary violations (if enforcement mode is nudge/enforce)
    if (aipSignal.checkpoint.verdict === 'boundary_violation') {
      ctx.waitUntil(createNudgeIfEnabled(aipSignal.checkpoint, agent_id, session_id, env));
    }

    // Auto-containment: check if consecutive boundary violations exceed threshold
    if (aipSignal.checkpoint.verdict === 'boundary_violation') {
      ctx.waitUntil(checkAutoContainment(agent_id, session_id, aipSignal.checkpoint, env));
    }
  }

  // Check for behavioral drift (runs in background)
  ctx.waitUntil(checkForDrift(agent_id, card, env, otelExporter));

  // Delete processed log for privacy
  await deleteLog(log.id, env);

  console.log(`[observer] Created trace ${trace.trace_id} for agent ${agent_id}` +
    (aipSignal ? ` (AIP: ${aipSignal.checkpoint.verdict})` : ''));

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
 * Fetch full request and response bodies for a specific log entry.
 * CF AI Gateway stores bodies at separate endpoints:
 *   GET /logs/{id}/request  → request body
 *   GET /logs/{id}/response → response body
 */
async function fetchLogBodies(
  logId: string,
  env: Env
): Promise<{ request: string; response: string }> {
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai-gateway/gateways/${env.GATEWAY_ID}/logs/${logId}`;
  const headers = {
    Authorization: `Bearer ${env.CF_API_TOKEN}`,
  };

  const [reqRes, resRes] = await Promise.all([
    fetch(`${baseUrl}/request`, { headers }).catch((e) => { console.warn(`[observer] fetch /request threw for ${logId}: ${e}`); return null; }),
    fetch(`${baseUrl}/response`, { headers }).catch((e) => { console.warn(`[observer] fetch /response threw for ${logId}: ${e}`); return null; }),
  ]);

  let requestBody = '';
  let responseBody = '';

  if (reqRes && reqRes.ok) {
    const raw = await reqRes.text();
    // CF API may return raw body or wrap in {success, result} envelope
    try {
      const parsed = JSON.parse(raw);
      if (parsed.result !== undefined) {
        requestBody = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
      } else {
        requestBody = raw;
      }
    } catch {
      requestBody = raw;
    }
  } else {
    const statusText = reqRes ? `${reqRes.status} ${reqRes.statusText}` : 'null (fetch failed)';
    let errorBody = '';
    if (reqRes) { try { errorBody = await reqRes.text(); } catch {} }
    console.warn(`[observer] Failed to fetch request body for ${logId}: ${statusText} body=${errorBody.substring(0, 300)}`);
  }

  if (resRes && resRes.ok) {
    const raw = await resRes.text();
    try {
      const parsed = JSON.parse(raw);
      if (parsed.result !== undefined) {
        responseBody = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
      } else {
        responseBody = raw;
      }
    } catch {
      responseBody = raw;
    }
  } else {
    const statusText = resRes ? `${resRes.status} ${resRes.statusText}` : 'null (fetch failed)';
    let errorBody = '';
    if (resRes) { try { errorBody = await resRes.text(); } catch {} }
    console.warn(`[observer] Failed to fetch response body for ${logId}: ${statusText} body=${errorBody.substring(0, 300)}`);
  }

  return { request: requestBody, response: responseBody };
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
// CF AI Gateway Response Reconstruction
// ============================================================================

/**
 * CF AI Gateway stores streamed responses with:
 *   - content: flattened text string (thinking blocks stripped)
 *   - streamed_data: array of raw SSE event objects (thinking preserved)
 *
 * The AIP SDK needs either:
 *   - Non-streaming JSON with content as array of blocks, OR
 *   - SSE text with "data: " prefixed lines
 *
 * This function detects the CF gateway format and reconstructs SSE text
 * from streamed_data so extractThinkingFromStream() can parse it.
 */
function reconstructResponseForAIP(responseBody: string, provider?: string): string {
  // Only reconstruct for Anthropic responses — other providers are handled
  // natively by the AIP SDK adapters, so return their responses as-is.
  if (provider === 'openai' || provider === 'gemini') {
    return responseBody;
  }

  if (!responseBody) return responseBody;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return responseBody; // Not JSON, return as-is (might be raw SSE)
  }

  // If content is already an array, the SDK can handle it directly
  if (Array.isArray(parsed.content)) {
    return responseBody;
  }

  // If streamed_data exists, reconstruct SSE format
  const streamedData = parsed.streamed_data;
  if (!Array.isArray(streamedData) || streamedData.length === 0) {
    return responseBody;
  }

  // Convert each streamed_data object to an SSE "data: " line
  const sseLines = streamedData.map(
    (chunk: unknown) => `data: ${JSON.stringify(chunk)}`
  );

  return sseLines.join('\n');
}

// ============================================================================
// Context Extraction
// ============================================================================

/**
 * Extract thinking, tool calls, user query, and response text from
 * raw request/response bodies. Handles both JSON and SSE streaming formats.
 * Routes to provider-specific parsers based on the provider field from CF AI Gateway.
 */
function extractContext(requestBody: string, responseBody: string, provider?: string): ExtractedContext {
  const result: ExtractedContext = {
    thinking: null,
    toolCalls: [],
    userQuery: null,
    responseText: null,
  };

  // --- Parse response (route to provider-specific parser) ---
  if (responseBody) {
    let parsed = null;
    if (provider === 'openai') {
      parsed = tryParseOpenAIJSON(responseBody) || tryParseOpenAISSE(responseBody);
    } else if (provider === 'gemini') {
      parsed = tryParseGeminiJSON(responseBody);
    } else {
      // Anthropic (default)
      parsed = tryParseResponseJSON(responseBody) || tryParseSSE(responseBody);
    }
    if (parsed) {
      result.thinking = parsed.thinking;
      result.toolCalls = parsed.toolCalls;
      result.responseText = parsed.responseText;
    }
  }

  // --- Parse request for user query ---
  if (requestBody) {
    result.userQuery = extractUserQuery(requestBody, provider);
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

    // Standard Anthropic format: content is an array of content blocks
    if (Array.isArray(content)) {
      return extractFromContentBlocks(content);
    }

    // CF AI Gateway format: content is a flattened string
    if (typeof content === 'string' && content.length > 0) {
      return {
        thinking: null,
        toolCalls: [],
        responseText: content.substring(0, 3000),
      };
    }

    // Error responses have error.message instead of content
    if (response.type === 'error' && response.error?.message) {
      return {
        thinking: null,
        toolCalls: [],
        responseText: `Error: ${response.error.message}`,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Try to parse response as OpenAI JSON format (non-streaming).
 * OpenAI responses have choices[].message with content, reasoning_content, and tool_calls.
 */
function tryParseOpenAIJSON(
  body: string
): { thinking: string | null; toolCalls: ExtractedContext['toolCalls']; responseText: string | null } | null {
  try {
    const response = JSON.parse(body);
    const choices = response.choices;
    if (!Array.isArray(choices) || choices.length === 0) return null;

    const message = choices[0].message;
    if (!message) return null;

    const responseText = typeof message.content === 'string' && message.content.length > 0
      ? message.content.substring(0, 3000)
      : null;

    const thinking = typeof message.reasoning_content === 'string' && message.reasoning_content.length > 0
      ? message.reasoning_content
      : null;

    // Extract tool calls: tool_calls[] with {function: {name, arguments}}
    const toolCalls: ExtractedContext['toolCalls'] = [];
    if (Array.isArray(message.tool_calls)) {
      for (const tc of message.tool_calls) {
        if (tc.function?.name) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.function.arguments || '{}');
          } catch { /* */ }
          toolCalls.push({ name: tc.function.name, input });
        }
      }
    }

    return { thinking, toolCalls, responseText };
  } catch {
    return null;
  }
}

/**
 * Try to parse response as Gemini JSON format (non-streaming).
 * Gemini responses have candidates[].content.parts[] with text and optional thought flag.
 */
function tryParseGeminiJSON(
  body: string
): { thinking: string | null; toolCalls: ExtractedContext['toolCalls']; responseText: string | null } | null {
  try {
    const response = JSON.parse(body);
    const candidates = response.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) return null;

    const content = candidates[0].content;
    if (!content || !Array.isArray(content.parts)) return null;

    const thinkingParts: string[] = [];
    const textParts: string[] = [];
    const toolCalls: ExtractedContext['toolCalls'] = [];

    for (const part of content.parts) {
      if (part.thought === true && typeof part.text === 'string') {
        // Thinking part (Gemini marks thinking with thought: true)
        thinkingParts.push(part.text);
      } else if (typeof part.text === 'string') {
        // Regular text part
        textParts.push(part.text);
      } else if (part.functionCall) {
        // Tool call: {functionCall: {name, args}}
        toolCalls.push({
          name: part.functionCall.name,
          input: (part.functionCall.args as Record<string, unknown>) || {},
        });
      }
    }

    return {
      thinking: thinkingParts.length > 0 ? thinkingParts.join('\n\n---\n\n') : null,
      toolCalls,
      responseText: textParts.length > 0 ? textParts.join('\n\n').substring(0, 3000) : null,
    };
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
 * Try to parse response as OpenAI SSE streaming events.
 * OpenAI streaming format: data: {"choices":[{"delta":{"content":"...","reasoning_content":"..."}}]}
 * Accumulates content and reasoning_content separately across chunks.
 */
function tryParseOpenAISSE(
  body: string
): { thinking: string | null; toolCalls: ExtractedContext['toolCalls']; responseText: string | null } | null {
  if (!body.includes('data: ')) return null;

  try {
    let contentAccum = '';
    let reasoningAccum = '';
    // Track tool calls being streamed (by index)
    const toolCallsMap: Map<number, { name: string; arguments: string }> = new Map();

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

      const choices = event.choices as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(choices) || choices.length === 0) continue;

      const delta = choices[0].delta as Record<string, unknown> | undefined;
      if (!delta) continue;

      if (typeof delta.content === 'string') {
        contentAccum += delta.content;
      }
      if (typeof delta.reasoning_content === 'string') {
        reasoningAccum += delta.reasoning_content;
      }

      // Stream tool calls: delta.tool_calls[]{index, function: {name?, arguments?}}
      const deltaToolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(deltaToolCalls)) {
        for (const dtc of deltaToolCalls) {
          const idx = (dtc.index as number) ?? 0;
          const fn = dtc.function as Record<string, unknown> | undefined;
          if (!fn) continue;
          const existing = toolCallsMap.get(idx);
          if (!existing) {
            toolCallsMap.set(idx, {
              name: (fn.name as string) || '',
              arguments: (fn.arguments as string) || '',
            });
          } else {
            if (fn.name) existing.name += fn.name as string;
            if (fn.arguments) existing.arguments += fn.arguments as string;
          }
        }
      }
    }

    if (contentAccum.length === 0 && reasoningAccum.length === 0 && toolCallsMap.size === 0) {
      return null;
    }

    const toolCalls: ExtractedContext['toolCalls'] = [];
    for (const tc of toolCallsMap.values()) {
      if (tc.name) {
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(tc.arguments || '{}'); } catch { /* */ }
        toolCalls.push({ name: tc.name, input });
      }
    }

    return {
      thinking: reasoningAccum.length > 0 ? reasoningAccum : null,
      toolCalls,
      responseText: contentAccum.length > 0 ? contentAccum.substring(0, 3000) : null,
    };
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
 * Extract the user's query from the request body.
 * Handles Anthropic/OpenAI format (messages array) and Gemini format (contents array).
 */
function extractUserQuery(requestBody: string, provider?: string): string | null {
  try {
    const request = JSON.parse(requestBody);

    // Gemini uses "contents" array with parts[].text
    if (provider === 'gemini') {
      const contents = request.contents;
      if (!Array.isArray(contents)) return null;

      // Walk backwards to find the last user message
      for (let i = contents.length - 1; i >= 0; i--) {
        const msg = contents[i] as Record<string, unknown>;
        if (msg.role !== 'user') continue;

        const parts = msg.parts as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(parts)) continue;

        const text = parts
          .filter((p) => typeof p.text === 'string')
          .map((p) => p.text as string)
          .join('\n');
        if (text.length > 0) {
          return text.substring(0, 500);
        }
      }
      return null;
    }

    // Anthropic and OpenAI both use "messages" array with role: 'user'
    const messages = request.messages;
    if (!Array.isArray(messages)) return null;

    // Walk backwards to find the last user message with actual text content
    // (skip tool_result-only messages common in multi-turn tool use)
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as Record<string, unknown>;
      if (msg.role !== 'user') continue;

      const content = msg.content;
      if (typeof content === 'string' && content.length > 0) {
        return content.substring(0, 500);
      }
      if (Array.isArray(content)) {
        const text = content
          .filter((c: Record<string, unknown>) => c.type === 'text')
          .map((c: Record<string, unknown>) => c.text as string)
          .join('\n');
        if (text.length > 0) {
          return text.substring(0, 500);
        }
        // This user message had no text (e.g., tool_result only) — keep looking
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// Haiku Analysis
// ============================================================================

const ANALYSIS_SYSTEM_PROMPT = `Analyze this AI agent interaction and extract the decision structure. Return ONLY valid JSON.

Return this exact JSON structure:
{
  "alternatives": [{"id": "short_id", "description": "what this option does"}],
  "selected": "id of the chosen option",
  "reasoning": "1-2 sentence summary of what the agent did and why",
  "values_applied": ["transparency", "accuracy", "helpfulness", "safety", "autonomy", "honesty", "quality"],
  "confidence": "high" | "medium" | "low"
}

Guidelines:
- Extract actual alternatives considered from the reasoning, or infer likely ones from the query
- "reasoning" should describe what happened in plain English (e.g. "Edited config file to fix auth bug" not "The AI processed the request")
- values_applied MUST only contain values from this exact set: transparency, accuracy, helpfulness, safety, autonomy, honesty, quality. Any other value is a validation error.
- confidence: high = clear reasoning with explicit tradeoffs, medium = reasonable but implicit, low = minimal context`;

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
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: [{ type: 'text', text: ANALYSIS_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [
          {
            role: 'user',
            content: sections.join('\n\n'),
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
    // IMPORTANT: Never use responseText in fallback — that's the agent's actual output (PII)
    const fallbackReasoning = context.toolCalls.length > 0
      ? `Used tools: ${context.toolCalls.map((t) => t.name).join(', ')}`
      : 'Analysis unavailable — reasoning could not be extracted';

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
 * Submit a usage event for admin tracking.
 * Non-blocking, fail-open: errors are logged but never propagate.
 */
async function submitUsageEvent(
  trace: APTrace,
  log: GatewayLog,
  env: Env
): Promise<void> {
  const eventId = `ue-${crypto.randomUUID().slice(0, 8)}`;
  const usageEvent = {
    id: eventId,
    agent_id: trace.agent_id,
    session_id: trace.context?.session_id || 'unknown',
    trace_id: trace.trace_id,
    timestamp: log.created_at,
    model: log.model || 'unknown',
    provider: log.provider || 'anthropic',
    tokens_in: log.tokens_in || 0,
    tokens_out: log.tokens_out || 0,
    duration_ms: log.duration || 0,
    gateway_log_id: log.id,
  };

  try {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/usage_events`,
      {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_KEY,
          Authorization: `Bearer ${env.SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(usageEvent),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`[observer] Failed to submit usage event: ${response.status} - ${errorText}`);
    }
  } catch (error) {
    console.warn('[observer] Error submitting usage event:', error);
  }
}

// ============================================================================
// AIP Integrity Check Functions
// ============================================================================

/**
 * Extract agent description from AAP card extensions (PII-safe).
 * Searches extension namespaces for a 'description' field describing the agent's role.
 */
function extractAgentDescription(card: AlignmentCard): string | undefined {
  const extensions = card.extensions as Record<string, unknown> | null | undefined;
  if (!extensions) return undefined;
  for (const ns of Object.values(extensions)) {
    if (ns && typeof ns === 'object' && 'description' in (ns as Record<string, unknown>)) {
      const desc = (ns as Record<string, unknown>).description;
      if (typeof desc === 'string') return desc;
    }
  }
  return undefined;
}

/**
 * Fetch org-level conscience values for an agent.
 * Uses KV cache (5-min TTL) → Supabase RPC. Fail-open: returns null on error.
 */
async function fetchOrgConscienceValues(
  agentId: string,
  env: Env
): Promise<{ enabled: boolean; mode?: string; values?: Array<{ name: string; description: string; type: string; severity: string }> } | null> {
  const cacheKey = `org-cv:agent:${agentId}`;
  try {
    // Check KV cache first
    if ((env as any).BILLING_CACHE) {
      const cached = await ((env as any).BILLING_CACHE as KVNamespace).get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    }

    // Call RPC
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_org_conscience_values_for_agent`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_agent_id: agentId }),
    });

    if (!response.ok) {
      console.warn(`[observer/cv] RPC failed for ${agentId}: ${response.status}`);
      return { enabled: false };
    }

    const result = await response.json() as Record<string, unknown>;

    // Cache for 5 minutes
    if ((env as any).BILLING_CACHE) {
      await ((env as any).BILLING_CACHE as KVNamespace).put(cacheKey, JSON.stringify(result), { expirationTtl: 300 }).catch(() => {});
    }

    return result as any;
  } catch (error) {
    console.warn('[observer/cv] fetchOrgConscienceValues failed (fail-open):', error);
    return { enabled: false };
  }
}

/**
 * Run an AIP integrity check on the response body.
 * Creates an ephemeral AIP client, runs the check, and destroys the client.
 * Fail-open: returns null on any error so existing processing is unaffected.
 *
 * Conscience values resolution (layered, additive):
 * 1. Base: DEFAULT_CONSCIENCE_VALUES (augment mode) or empty (replace mode)
 * 2. Org layer: Custom org values — always applied
 * 3. Agent layer: Per-agent conscience_values from alignment card (additive)
 */
async function runIntegrityCheck(
  responseBody: string,
  provider: string,
  agentId: string,
  card: AlignmentCard | null,
  env: Env,
  taskContext?: string,
  initialCheckpoints?: any[]
): Promise<IntegritySignal | null> {
  if (!card) {
    console.log('[observer/aip] Skipping integrity check: no alignment card');
    return null;
  }

  let client: AIPClient | null = null;

  try {
    const analysisApiKey = env.ANALYSIS_API_KEY || env.ANTHROPIC_API_KEY;
    // Analysis always uses Anthropic Haiku — ensure correct provider path in CF AI Gateway URL
    const analysisBaseUrl = env.CF_AI_GATEWAY_URL
      ? `${env.CF_AI_GATEWAY_URL.replace(/\/(anthropic|openai|gemini)\/?$/, '')}/anthropic`
      : 'https://api.anthropic.com';

    // Map AAP AlignmentCard fields to AIP's card interface
    // Include value definitions and agent description for analysis context (PII-safe)
    const defs = card.values.definitions as Record<string, { name?: string; description?: string; priority?: number }> | null | undefined;
    const aipCard = {
      card_id: card.card_id,
      agent_description: extractAgentDescription(card),
      values: (card.values.declared || []).map((v: string, i: number) => {
        const def = defs?.[v];
        return {
          name: v,
          priority: def?.priority ?? (i + 1),
          ...(def?.description ? { description: def.description } : {}),
        };
      }),
      autonomy_envelope: {
        bounded_actions: card.autonomy_envelope.bounded_actions,
        forbidden_actions: card.autonomy_envelope.forbidden_actions ?? undefined,
        escalation_triggers: card.autonomy_envelope.escalation_triggers?.map(
          (t: { condition: string; action: string; reason?: string | null }) => ({
            condition: t.condition,
            action: t.action,
            reason: t.reason ?? undefined,
          })
        ),
      },
    };

    // Layered conscience values resolution
    // 1. Base: defaults (augment) or empty (replace)
    // 2. Org layer: custom org values (always applied)
    // 3. Agent layer: per-agent values from alignment card (additive)
    const orgCv = await fetchOrgConscienceValues(agentId, env);
    let resolvedValues = [...DEFAULT_CONSCIENCE_VALUES];
    if (orgCv && orgCv.enabled && orgCv.values && orgCv.values.length > 0) {
      if (orgCv.mode === 'replace') {
        resolvedValues = orgCv.values.map(v => ({ id: v.name, content: v.description, type: v.type as any }));
      } else {
        // augment: defaults + org values
        resolvedValues = [
          ...DEFAULT_CONSCIENCE_VALUES,
          ...orgCv.values.map(v => ({ id: v.name, content: v.description, type: v.type as any })),
        ];
      }
    }
    // Per-agent values from alignment card are additive on top
    const agentCv = (card as any)?.conscience_values;
    if (Array.isArray(agentCv) && agentCv.length > 0) {
      resolvedValues = [...resolvedValues, ...agentCv];
    }

    // Note: initial_checkpoints will be a recognized AIPConfig field once AIP SDK v0.1.5 lands
    const config: AIPConfig & { initial_checkpoints?: any[] } = {
      card: aipCard,
      conscience_values: resolvedValues,
      initial_checkpoints: initialCheckpoints,
      min_evidence_tokens: 25, // ~100 chars — analyze any real sentence of reasoning
      analysis_llm: {
        model: 'claude-haiku-4-5-20251001',
        base_url: analysisBaseUrl,
        api_key: analysisApiKey,
        max_tokens: 1024,
        enable_prompt_caching: true,
      },
      window: {
        max_size: 10,
        mode: 'sliding',
        session_boundary: 'reset',
        max_age_seconds: 3600,
      },
      failure_policy: {
        mode: 'fail_open',
        analysis_timeout_ms: 8000, // Slightly under CF Worker 10s subrequest limit
      },
    };

    client = createClient(config);
    const signal = await client.check(responseBody, provider, taskContext);

    console.log(
      `[observer/aip] Integrity check complete: verdict=${signal.checkpoint.verdict}, ` +
      `proceed=${signal.proceed}, action=${signal.recommended_action}`
    );

    return signal;
  } catch (error) {
    console.error('[observer/aip] Integrity check failed (fail-open):', error);
    return null;
  } finally {
    if (client) {
      client.destroy();
    }
  }
}

/**
 * Check if an agent should be auto-contained based on consecutive boundary violations.
 * Fire-and-forget via ctx.waitUntil() — failure never blocks the observer pipeline.
 */
async function checkAutoContainment(
  agentId: string,
  sessionId: string,
  checkpoint: IntegrityCheckpoint,
  env: Env
): Promise<void> {
  try {
    // Fetch agent's auto-containment threshold and current status
    const agentRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/agents?id=eq.${agentId}&select=auto_containment_threshold,containment_status`,
      {
        headers: {
          apikey: env.SUPABASE_KEY,
          Authorization: `Bearer ${env.SUPABASE_KEY}`,
        },
      }
    );

    if (!agentRes.ok) return;

    const agents = (await agentRes.json()) as Array<Record<string, unknown>>;
    if (agents.length === 0) return;

    const agent = agents[0];
    const threshold = agent.auto_containment_threshold as number | null;
    const currentStatus = agent.containment_status as string;

    // Skip if auto-containment disabled or agent already contained
    if (!threshold || currentStatus === 'paused' || currentStatus === 'killed') return;

    // Count consecutive boundary_violation checkpoints for this agent (most recent first)
    // Using gaps-and-islands: count from the latest checkpoint backwards until a non-violation
    const checkpointRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/integrity_checkpoints?agent_id=eq.${agentId}&order=created_at.desc&limit=${threshold + 5}&select=verdict`,
      {
        headers: {
          apikey: env.SUPABASE_KEY,
          Authorization: `Bearer ${env.SUPABASE_KEY}`,
        },
      }
    );

    if (!checkpointRes.ok) return;

    const checkpoints = (await checkpointRes.json()) as Array<{ verdict: string }>;

    // Count consecutive boundary_violations from the start
    let consecutiveCount = 0;
    for (const cp of checkpoints) {
      if (cp.verdict === 'boundary_violation') {
        consecutiveCount++;
      } else {
        break;
      }
    }

    if (consecutiveCount < threshold) return;

    console.log(`[observer/containment] Auto-pausing agent ${agentId}: ${consecutiveCount} consecutive boundary violations (threshold: ${threshold})`);

    // Auto-pause the agent
    const now = new Date().toISOString();
    const reason = `Auto-contained: ${consecutiveCount} consecutive boundary violations`;

    const updateUrl = new URL(`${env.SUPABASE_URL}/rest/v1/agents`);
    updateUrl.searchParams.set('id', `eq.${agentId}`);

    await fetch(updateUrl.toString(), {
      method: 'PATCH',
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        containment_status: 'paused',
        contained_at: now,
        contained_by: 'system',
        containment_reason: reason,
      }),
    });

    // Insert containment audit log
    const logId = `ctl-${Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b => b.toString(16).padStart(2, '0')).join('')}`;

    await fetch(`${env.SUPABASE_URL}/rest/v1/agent_containment_log`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        id: logId,
        agent_id: agentId,
        action: 'auto_pause',
        actor: 'system',
        reason,
        previous_status: currentStatus,
        new_status: 'paused',
        metadata: JSON.stringify({ checkpoint_id: checkpoint.checkpoint_id }),
      }),
    });

    // Purge KV cache if available
    // Note: observer may not have BILLING_CACHE bound — this is best-effort
    if ((env as any).BILLING_CACHE) {
      await ((env as any).BILLING_CACHE as KVNamespace).delete(`quota:agent:${agentId}`).catch(() => {});
    }

    console.log(`[observer/containment] Agent ${agentId} auto-paused successfully`);
  } catch (err) {
    // Fail-open: auto-containment failure never blocks the observer
    console.warn('[observer/containment] checkAutoContainment error (fail-open):', err);
  }
}

/**
 * Submit an AIP IntegrityCheckpoint to the integrity_checkpoints Supabase table.
 * Uses the same upsert pattern as submitTrace for idempotency.
 */
async function submitCheckpoint(
  checkpoint: IntegrityCheckpoint,
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
          source: 'observer',
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(
        `[observer/aip] Failed to submit checkpoint ${checkpoint.checkpoint_id}: ${response.status} - ${errorText}`
      );
    } else {
      console.log(`[observer/aip] Checkpoint ${checkpoint.checkpoint_id} stored`);
    }
  } catch (error) {
    console.error('[observer/aip] Error submitting checkpoint:', error);
  }
}

/**
 * Submit a metering event for billing. Non-blocking, fail-open.
 */
async function submitMeteringEvent(
  agentId: string,
  checkpointId: string,
  source: string,
  env: Env
): Promise<void> {
  try {
    // Resolve agent → billing account
    const rpcResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_billing_account_for_agent`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_agent_id: agentId }),
    });

    if (!rpcResponse.ok) {
      console.warn(`[observer/metering] Failed to resolve billing account for agent ${agentId}`);
      return;
    }

    const result = (await rpcResponse.json()) as { account_id: string | null };
    if (!result.account_id) return;

    // Generate event ID
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let eventIdSuffix = '';
    for (let i = 0; i < 8; i++) {
      eventIdSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    // Insert metering event
    const insertResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/metering_events`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        event_id: `me-${eventIdSuffix}`,
        account_id: result.account_id,
        agent_id: agentId,
        event_type: 'integrity_check',
        metadata: { checkpoint_id: checkpointId, source },
      }),
    });

    if (!insertResponse.ok) {
      console.warn(`[observer/metering] Failed to insert metering event: ${insertResponse.status}`);
    }
  } catch (error) {
    console.warn('[observer/metering] Error submitting metering event:', error);
  }
}

/**
 * Trigger metering rollup for all active billing accounts.
 * Idempotent — upsert-based, safe to run on every cron tick.
 */
async function triggerMeteringRollup(env: Env): Promise<void> {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Get all billing accounts that have metering events today
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/metering_events?select=account_id&timestamp=gte.${today}T00:00:00Z&order=account_id`,
      {
        headers: {
          apikey: env.SUPABASE_KEY,
          Authorization: `Bearer ${env.SUPABASE_KEY}`,
        },
      }
    );

    if (!response.ok) {
      console.warn(`[observer/metering] Failed to fetch accounts for rollup: ${response.status}`);
      return;
    }

    const events = (await response.json()) as Array<{ account_id: string }>;
    const accountIds = [...new Set(events.map(e => e.account_id))];

    for (const accountId of accountIds) {
      const rollupResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/rollup_metering`, {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_KEY,
          Authorization: `Bearer ${env.SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_account_id: accountId, p_date: today }),
      });

      if (!rollupResponse.ok) {
        console.warn(`[observer/metering] Rollup failed for account ${accountId}: ${rollupResponse.status}`);
      }
    }

    if (accountIds.length > 0) {
      console.log(`[observer/metering] Rolled up ${accountIds.length} accounts for ${today}`);
    }
  } catch (error) {
    console.warn('[observer/metering] Error in metering rollup:', error);
  }
}

/**
 * Report daily usage to Stripe for metered billing.
 * Runs once per day at midnight UTC.
 * Queries all billing accounts with active metered subscriptions,
 * reports cumulative check_count_this_period via createUsageRecord(action:'set').
 */
async function reportDailyUsageToStripe(env: Env): Promise<void> {
  if (!env.STRIPE_SECRET_KEY) {
    console.log('[observer/stripe] No STRIPE_SECRET_KEY, skipping usage reporting');
    return;
  }

  try {
    // Import Stripe dynamically to avoid import errors when key is not set
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-01-28.clover',
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Fetch accounts with active metered subscriptions (checks and/or proofs)
    // Include stripe_customer_id for meter events API (proofs)
    const accountsResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/billing_accounts?subscription_status=in.(active,trialing)&stripe_subscription_item_id=not.is.null&select=account_id,stripe_customer_id,stripe_subscription_item_id,check_count_this_period,stripe_proof_subscription_item_id,proof_count_this_period`,
      {
        headers: {
          apikey: env.SUPABASE_KEY,
          Authorization: `Bearer ${env.SUPABASE_KEY}`,
        },
      }
    );

    if (!accountsResponse.ok) {
      console.warn(`[observer/stripe] Failed to fetch accounts: ${accountsResponse.status}`);
      return;
    }

    const accounts = (await accountsResponse.json()) as Array<{
      account_id: string;
      stripe_customer_id: string;
      stripe_subscription_item_id: string;
      check_count_this_period: number;
      stripe_proof_subscription_item_id: string | null;
      proof_count_this_period: number;
    }>;

    const today = new Date().toISOString().split('T')[0];
    let reported = 0;

    // Fetch today's proof counts from usage_daily_rollup for meter event reporting.
    // Meter events are incremental (each event adds to total), so we send daily counts
    // rather than cumulative period totals.
    const proofRollupResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/usage_daily_rollup?date=eq.${today}&proof_count=gt.0&select=account_id,proof_count`,
      {
        headers: {
          apikey: env.SUPABASE_KEY,
          Authorization: `Bearer ${env.SUPABASE_KEY}`,
        },
      }
    );
    const dailyProofCounts = new Map<string, number>();
    if (proofRollupResponse.ok) {
      const rows = (await proofRollupResponse.json()) as Array<{ account_id: string; proof_count: number }>;
      for (const row of rows) {
        dailyProofCounts.set(row.account_id, row.proof_count);
      }
    }

    for (const account of accounts) {
      try {
        const checkQuantity = account.check_count_this_period || 0;
        const checkIdempotencyKey = `${account.account_id}-checks-${today}`;

        // Report check usage via legacy createUsageRecord (cumulative, action:'set')
        await (stripe as any).subscriptionItems.createUsageRecord(
          account.stripe_subscription_item_id,
          {
            quantity: checkQuantity,
            timestamp: Math.floor(Date.now() / 1000),
            action: 'set',
          },
          { idempotencyKey: checkIdempotencyKey }
        );

        // Record check usage in stripe_usage_reports
        const checkReportId = `sur-${crypto.randomUUID().slice(0, 8)}`;
        await fetch(`${env.SUPABASE_URL}/rest/v1/stripe_usage_reports`, {
          method: 'POST',
          headers: {
            apikey: env.SUPABASE_KEY,
            Authorization: `Bearer ${env.SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            id: checkReportId,
            account_id: account.account_id,
            stripe_subscription_item_id: account.stripe_subscription_item_id,
            reported_quantity: checkQuantity,
            idempotency_key: checkIdempotencyKey,
          }),
        });

        // Report proof usage via Stripe Meter Events API (incremental, daily count).
        // The proof price is linked to a Stripe Meter (event_name: 'zk_proof'),
        // which requires meter events instead of createUsageRecord.
        let proofQuantity = 0;
        const dailyProofCount = dailyProofCounts.get(account.account_id) || 0;
        if (dailyProofCount > 0 && account.stripe_customer_id) {
          proofQuantity = dailyProofCount;
          const proofIdentifier = `${account.account_id}-proofs-${today}`;

          await (stripe as any).billing.meterEvents.create({
            event_name: 'zk_proof',
            payload: {
              stripe_customer_id: account.stripe_customer_id,
              value: String(proofQuantity),
            },
            identifier: proofIdentifier,
            timestamp: Math.floor(Date.now() / 1000),
          });

          // Record proof usage in stripe_usage_reports
          const proofReportId = `sur-${crypto.randomUUID().slice(0, 8)}`;
          await fetch(`${env.SUPABASE_URL}/rest/v1/stripe_usage_reports`, {
            method: 'POST',
            headers: {
              apikey: env.SUPABASE_KEY,
              Authorization: `Bearer ${env.SUPABASE_KEY}`,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal',
            },
            body: JSON.stringify({
              id: proofReportId,
              account_id: account.account_id,
              stripe_subscription_item_id: account.stripe_proof_subscription_item_id || 'meter_event',
              reported_quantity: proofQuantity,
              idempotency_key: proofIdentifier,
            }),
          });
        }

        // Log billing event (combined check + proof report)
        const eventId = `be-${crypto.randomUUID().slice(0, 8)}`;
        await fetch(`${env.SUPABASE_URL}/rest/v1/billing_events`, {
          method: 'POST',
          headers: {
            apikey: env.SUPABASE_KEY,
            Authorization: `Bearer ${env.SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            event_id: eventId,
            account_id: account.account_id,
            event_type: 'usage_reported',
            details: {
              check_quantity: checkQuantity,
              proof_quantity: proofQuantity,
              date: today,
              check_idempotency_key: checkIdempotencyKey,
              proof_identifier: proofQuantity > 0
                ? `${account.account_id}-proofs-${today}`
                : null,
            },
            performed_by: 'observer_cron',
            timestamp: new Date().toISOString(),
          }),
        });

        reported++;
      } catch (error) {
        console.warn(`[observer/stripe] Failed to report usage for ${account.account_id}:`, error);
      }
    }

    if (reported > 0) {
      console.log(`[observer/stripe] Reported usage for ${reported}/${accounts.length} accounts`);
    }
  } catch (error) {
    console.warn('[observer/stripe] Error in daily usage reporting:', error);
  }
}

/**
 * Fetch recent checkpoints for window hydration (same pattern as gateway).
 */
async function fetchRecentCheckpoints(
  agentId: string,
  sessionId: string,
  env: Env
): Promise<any[]> {
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
      console.warn(`[observer/aip] Failed to fetch checkpoints for hydration: ${response.status}`);
      return [];
    }

    const rows = (await response.json()) as any[];
    // Reverse to chronological order (oldest first) for window hydration
    return rows.reverse();
  } catch (error) {
    console.error(`[observer/aip] Error fetching checkpoints for hydration:`, error);
    return [];
  }
}

/**
 * Check for behavioral drift across recent traces
 */
async function checkForDrift(
  agentId: string,
  card: AlignmentCard | null,
  env: Env,
  otelExporter?: WorkersOTelExporter | null
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

    if (driftAlerts.length > 0 && otelExporter) {
      otelExporter.recordDrift(driftAlerts, apTraces.length);
    }

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

  // Build action name — prefer tool names, fall back to "inference"
  // Model identity is metadata (stored in parameters.model), not an action
  let actionName = 'inference';
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
// Enforcement Nudge Functions
// ============================================================================

/**
 * Check enforcement mode and create a pending nudge if enabled.
 * Fetches enforcement mode from agents table, then creates nudge record.
 */
async function createNudgeIfEnabled(
  checkpoint: IntegrityCheckpoint,
  agentId: string,
  sessionId: string,
  env: Env
): Promise<void> {
  try {
    // Fetch enforcement mode
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/agents?id=eq.${agentId}&select=aip_enforcement_mode&limit=1`,
      {
        headers: {
          apikey: env.SUPABASE_KEY,
          Authorization: `Bearer ${env.SUPABASE_KEY}`,
        },
      }
    );

    if (!response.ok) {
      console.warn(`[observer/nudge] Failed to fetch enforcement mode: ${response.status}`);
      return;
    }

    const agents = (await response.json()) as Array<{ aip_enforcement_mode?: string }>;
    const mode = agents[0]?.aip_enforcement_mode || 'observe';

    if (mode !== 'nudge' && mode !== 'enforce') return;

    // Build nudge content
    const nudgeId = `nudge-${randomHex(8)}`;
    const concerns = checkpoint.concerns || [];
    const concernsSummary = concerns.length > 0
      ? concerns.map((c: any) => `${c.category || 'unknown'}: ${c.description || 'unspecified'}`).join('; ')
      : 'Boundary violation detected';

    const nudgeContent = `[INTEGRITY NOTICE — Conscience Protocol]\n` +
      `Your previous response (checkpoint ${checkpoint.checkpoint_id}) was flagged as a boundary violation.\n` +
      `Concern: ${concernsSummary}\n` +
      `Review your approach and self-correct. This notice is visible in your transparency timeline.`;

    const createResponse = await fetch(
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

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.warn(`[observer/nudge] Failed to create nudge: ${createResponse.status} - ${errorText}`);
    } else {
      console.log(`[observer/nudge] Created pending nudge ${nudgeId} for checkpoint ${checkpoint.checkpoint_id}`);
    }
  } catch (error) {
    console.error('[observer/nudge] Error creating nudge:', error);
  }
}

/**
 * Expire stale pending nudges older than 4 hours.
 * Called during cron cycles.
 */
async function expireStaleNudges(env: Env): Promise<void> {
  try {
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/enforcement_nudges?status=eq.pending&created_at=lt.${fourHoursAgo}`,
      {
        method: 'PATCH',
        headers: {
          apikey: env.SUPABASE_KEY,
          Authorization: `Bearer ${env.SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          status: 'expired',
          expired_at: new Date().toISOString(),
        }),
      }
    );

    if (response.ok) {
      const expired = (await response.json()) as unknown[];
      if (expired.length > 0) {
        console.log(`[observer/nudge] Expired ${expired.length} stale nudge(s)`);
      }
    } else {
      console.warn(`[observer/nudge] Failed to expire stale nudges: ${response.status}`);
    }
  } catch (error) {
    console.error('[observer/nudge] Error expiring nudges:', error);
  }
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
