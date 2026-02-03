import { getConfig, getAgentUrl } from './config.js';
import { initializeApi, flushTraceQueue, getApiEndpoint, submitTrace } from './api.js';
import { clearPendingTraces } from './trace.js';
import type { AAPTrace, TraceMetadata } from './trace.js';
import { v4 as uuidv4 } from 'uuid';

export type { AAPTrace, TraceMetadata, PendingTrace } from './trace.js';
export type { SmoltbotConfig, StoredConfig } from './config.js';
export type { HookEvent, HookHandler, HookContext, HookHandlerResult } from './types.js';

/**
 * OpenClaw plugin API interface
 */
interface OpenClawPluginApi {
  on(event: string, handler: (...args: unknown[]) => unknown): void;
}

/**
 * Message content block types
 */
interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: string;
  toolCallId?: string;
  toolName?: string;
  toolUseId?: string;
}

/**
 * Message structure in conversation history
 */
interface Message {
  role: string;
  content: string | ContentBlock[];
  timestamp?: number;
}

/**
 * Agent end event structure
 */
interface AgentEndEvent {
  messages: Message[];
  success: boolean;
  error?: string;
  durationMs: number;
}

/**
 * Agent end context
 */
interface AgentEndContext {
  agentId?: string;
  sessionKey?: string;
  workspaceDir?: string;
  messageProvider?: string;
}

/**
 * Plugin state
 */
let initialized = false;
let agentId: string | null = null;

/**
 * Extended trace type for messages
 */
type TraceType = 'tool' | 'user_message' | 'agent_response';

/**
 * Extended trace with type field
 */
interface ExtendedTrace extends AAPTrace {
  trace_type?: TraceType;
}

/**
 * Extract text content from message
 */
function extractTextContent(content: string | ContentBlock[]): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .filter(block => block.type === 'text' && block.text)
    .map(block => block.text)
    .join('\n');
}

/**
 * Extract all traces from messages - tools, user messages, and agent responses
 */
function extractAllTraces(messages: Message[], sessionKey?: string): ExtendedTrace[] {
  if (!agentId) return [];

  const traces: ExtendedTrace[] = [];
  const toolCalls = new Map<string, { name: string; params: unknown; timestamp: number }>();

  for (const msg of messages) {
    const timestamp = new Date(msg.timestamp || Date.now()).toISOString();
    const baseMetadata: TraceMetadata = sessionKey ? { session_id: sessionKey } : {};

    // User messages
    if (msg.role === 'user') {
      const textContent = extractTextContent(msg.content);
      if (textContent.trim()) {
        traces.push({
          id: uuidv4(),
          agent_id: agentId,
          timestamp,
          tool_name: '_user_message',
          action_type: 'allow',
          params: {},
          result: textContent,
          duration_ms: null,
          metadata: { ...baseMetadata, trace_type: 'user_message' },
          trace_type: 'user_message',
        });
      }
    }

    // Assistant messages - extract text responses and tool calls
    if (msg.role === 'assistant') {
      // Extract text response
      const textContent = extractTextContent(msg.content);
      if (textContent.trim()) {
        traces.push({
          id: uuidv4(),
          agent_id: agentId,
          timestamp,
          tool_name: '_agent_response',
          action_type: 'allow',
          params: {},
          result: textContent,
          duration_ms: null,
          metadata: { ...baseMetadata, trace_type: 'agent_response' },
          trace_type: 'agent_response',
        });
      }

      // Track tool calls for matching with results
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'toolCall' || block.type === 'tool_use' || block.type === 'toolUse') {
            const callId = block.toolCallId || block.toolUseId || uuidv4();
            toolCalls.set(callId, {
              name: block.name || block.toolName || 'unknown',
              params: block.input || {},
              timestamp: msg.timestamp || Date.now(),
            });
          }
        }
      }
    }

    // Tool results
    if (msg.role === 'tool' || msg.role === 'toolResult' || msg.role === 'tool_result') {
      const content = msg.content;
      const callId = (msg as unknown as { toolCallId?: string }).toolCallId;
      const toolName = (msg as unknown as { toolName?: string }).toolName;

      const matchedCall = callId ? toolCalls.get(callId) : null;

      const trace: ExtendedTrace = {
        id: uuidv4(),
        agent_id: agentId,
        timestamp: new Date(matchedCall?.timestamp || msg.timestamp || Date.now()).toISOString(),
        tool_name: matchedCall?.name || toolName || 'unknown',
        action_type: 'allow',
        params: (matchedCall?.params || {}) as Record<string, unknown>,
        result: typeof content === 'string' ? content : JSON.stringify(content),
        duration_ms: null,
        metadata: { ...baseMetadata, trace_type: 'tool' },
        trace_type: 'tool',
      };

      // Check for error indicators
      if (typeof content === 'string' && (content.includes('Error:') || content.includes('failed:'))) {
        trace.action_type = 'error';
      }

      traces.push(trace);

      if (callId) {
        toolCalls.delete(callId);
      }
    }
  }

  return traces;
}

/**
 * Agent end handler - extracts ALL traces from conversation (tools + messages)
 */
async function handleAgentEnd(event: AgentEndEvent, ctx: AgentEndContext): Promise<void> {
  console.log(`[smoltbot] agent_end: success=${event.success}, messages=${event.messages?.length || 0}, duration=${event.durationMs}ms`);

  if (!initialized || !agentId) {
    return;
  }

  const traces = extractAllTraces(event.messages || [], ctx.sessionKey);

  // Count by type
  const toolCount = traces.filter(t => t.trace_type === 'tool').length;
  const userCount = traces.filter(t => t.trace_type === 'user_message').length;
  const agentCount = traces.filter(t => t.trace_type === 'agent_response').length;

  console.log(`[smoltbot] Extracted ${traces.length} traces: ${toolCount} tools, ${userCount} user, ${agentCount} agent`);

  for (const trace of traces) {
    try {
      const result = await submitTrace(trace);
      if (result.success) {
        console.log(`[smoltbot] Trace submitted: ${trace.trace_type}/${trace.tool_name} (${trace.id})`);
      } else {
        console.error(`[smoltbot] Trace submission failed: ${result.error}`);
      }
    } catch (err) {
      console.error(`[smoltbot] Trace submission error:`, err);
    }
  }
}

/**
 * Register function called by OpenClaw
 *
 * This is the main entry point. OpenClaw calls this with its plugin API.
 *
 * Zero-config design:
 * - Reads agent ID from ~/.smoltbot/config.json (created by `smoltbot init`)
 * - Posts traces to https://api.mnemom.ai/v1/traces automatically
 * - No credentials needed from the user
 */
export default function register(api: OpenClawPluginApi): void {
  const config = getConfig();

  if (!config) {
    console.log('[smoltbot] No agent ID found. Run "smoltbot init" to get started.');
    return;
  }

  if (!config.enabled) {
    console.log('[smoltbot] Tracing disabled via SMOLTBOT_ENABLED=false');
    return;
  }

  agentId = config.agentId;

  // Initialize the API client with batching config
  initializeApi({
    batchSize: config.batchSize,
    timeout: config.timeout,
  });

  // Register agent_end hook - captures all messages (tools + user + agent)
  // This provides full transparency: every tool call, user message, and agent response
  api.on('agent_end', handleAgentEnd as (...args: unknown[]) => unknown);

  // Register shutdown handler to flush pending traces
  api.on('gateway:shutdown', async () => {
    await shutdown();
  });

  initialized = true;
  console.log(`[smoltbot] Tracing enabled for agent: ${config.agentId}`);
  console.log(`[smoltbot] Dashboard: ${getAgentUrl(config.agentId)}`);
  console.log(`[smoltbot] API: ${getApiEndpoint()}`);
}

/**
 * Shutdown the plugin gracefully
 */
async function shutdown(): Promise<void> {
  if (!initialized) {
    return;
  }

  // Flush any remaining traces
  await flushTraceQueue();

  // Clear pending traces
  clearPendingTraces();

  initialized = false;
  console.log('[smoltbot] Shutdown complete');
}

/**
 * Export for manual initialization if needed
 */
export { shutdown, getConfig, flushTraceQueue, getApiEndpoint };
