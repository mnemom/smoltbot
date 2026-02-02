import { v4 as uuidv4 } from 'uuid';

/**
 * Storage for pending traces, keyed by trace ID
 */
const pendingTraces = new Map<string, PendingTrace>();

/**
 * AAP (Agent Activity Protocol) trace record
 */
export interface AAPTrace {
  /** Unique trace identifier */
  id: string;
  /** Agent identifier */
  agent_id: string;
  /** ISO 8601 timestamp when the action started */
  timestamp: string;
  /** Name of the tool being called */
  tool_name: string;
  /** Type of action: allow (success), deny (blocked by conscience), error (failed) */
  action_type: 'allow' | 'deny' | 'error';
  /** Parameters passed to the tool */
  params: Record<string, unknown>;
  /** Result returned by the tool (null for before_tool_call) */
  result: unknown;
  /** Duration of the tool call in milliseconds (null for before_tool_call) */
  duration_ms: number | null;
  /** Additional metadata */
  metadata?: TraceMetadata;
}

/**
 * Optional metadata attached to traces
 */
export interface TraceMetadata {
  /** Session identifier for grouping related traces */
  session_id?: string;
  /** Parent trace ID for nested calls */
  parent_trace_id?: string;
  /** Tool version if available */
  tool_version?: string;
  /** Error message if action_type is 'tool_error' */
  error_message?: string;
  /** Error stack trace */
  error_stack?: string;
  /** Custom tags */
  tags?: string[];
}

/**
 * Pending trace context for tracking in-flight tool calls
 */
export interface PendingTrace {
  id: string;
  agent_id: string;
  tool_name: string;
  params: Record<string, unknown>;
  start_time: number;
  timestamp: string;
  metadata?: TraceMetadata;
}

/**
 * Create a pending trace for a tool call that's about to execute
 */
export function createPendingTrace(
  agentId: string,
  toolName: string,
  params: Record<string, unknown>,
  metadata?: TraceMetadata
): PendingTrace {
  return {
    id: uuidv4(),
    agent_id: agentId,
    tool_name: toolName,
    params: sanitizeParams(params),
    start_time: performance.now(),
    timestamp: new Date().toISOString(),
    metadata,
  };
}

/**
 * Finalize a pending trace with the result
 */
export function finalizePendingTrace(
  pending: PendingTrace,
  result: unknown,
  isError: boolean = false
): AAPTrace {
  const duration_ms = Math.round(performance.now() - pending.start_time);

  return {
    id: pending.id,
    agent_id: pending.agent_id,
    timestamp: pending.timestamp,
    tool_name: pending.tool_name,
    action_type: isError ? 'error' : 'allow',
    params: pending.params,
    result: sanitizeResult(result),
    duration_ms,
    metadata: pending.metadata,
  };
}

/**
 * Store a pending trace for later retrieval
 */
export function storePendingTrace(pending: PendingTrace): void {
  pendingTraces.set(pending.id, pending);
}

/**
 * Retrieve a pending trace by ID
 */
export function getPendingTrace(id: string): PendingTrace | undefined {
  return pendingTraces.get(id);
}

/**
 * Remove a pending trace by ID
 */
export function removePendingTrace(id: string): boolean {
  return pendingTraces.delete(id);
}

/**
 * Get count of pending traces
 */
export function getPendingTraceCount(): number {
  return pendingTraces.size;
}

/**
 * Clear all pending traces (for cleanup)
 */
export function clearPendingTraces(): void {
  if (pendingTraces.size > 0) {
    console.warn(`[smoltbot] Clearing ${pendingTraces.size} pending trace(s) that never completed`);
  }
  pendingTraces.clear();
}

/**
 * Sanitize parameters to remove sensitive data and ensure serializability
 */
function sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['password', 'secret', 'token', 'api_key', 'apiKey', 'authorization'];
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      try {
        // Test serializability and limit size
        const serialized = JSON.stringify(value);
        if (serialized.length > 10000) {
          sanitized[key] = '[TRUNCATED: object too large]';
        } else {
          sanitized[key] = value;
        }
      } catch {
        sanitized[key] = '[UNSERIALIZABLE]';
      }
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Sanitize result to ensure serializability and limit size
 */
function sanitizeResult(result: unknown): unknown {
  if (result === undefined) {
    return null;
  }

  try {
    const serialized = JSON.stringify(result);
    if (serialized.length > 50000) {
      return {
        _truncated: true,
        _original_size: serialized.length,
        _preview: serialized.slice(0, 1000) + '...',
      };
    }
    return result;
  } catch {
    return {
      _error: 'Result could not be serialized',
      _type: typeof result,
    };
  }
}
