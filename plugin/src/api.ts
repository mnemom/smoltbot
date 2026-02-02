import type { AAPTrace } from './trace.js';
import type { SmoltbotConfig } from './config.js';

/**
 * API response for trace submission
 */
export interface TraceResponse {
  success: boolean;
  trace_id?: string;
  error?: string;
}

/**
 * Batch API response
 */
export interface BatchTraceResponse {
  success: boolean;
  accepted: number;
  rejected: number;
  errors?: Array<{ trace_id: string; error: string }>;
}

/**
 * Queue for batching traces
 */
let traceQueue: AAPTrace[] = [];
let flushTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Current configuration reference
 */
let currentConfig: SmoltbotConfig | null = null;

/**
 * Initialize the API client with configuration
 */
export function initializeApi(config: SmoltbotConfig): void {
  currentConfig = config;
}

/**
 * Submit a single trace to the API
 */
export async function submitTrace(
  trace: AAPTrace,
  config: SmoltbotConfig
): Promise<TraceResponse> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    // Supabase REST API format
    const response = await fetch(`${config.apiUrl}/rest/v1/traces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': config.apiKey,
        'Authorization': `Bearer ${config.apiKey}`,
        'Prefer': 'return=minimal',
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
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorBody}`,
      };
    }

    // Supabase returns empty body with Prefer: return=minimal
    return {
      success: true,
      trace_id: trace.id,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Don't log abort errors (timeout) as they're expected in some cases
    if (errorMessage !== 'This operation was aborted') {
      console.error('[smoltbot] Failed to submit trace:', errorMessage);
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Submit a batch of traces to the API
 */
export async function submitTraceBatch(
  traces: AAPTrace[],
  config: SmoltbotConfig
): Promise<BatchTraceResponse> {
  if (traces.length === 0) {
    return { success: true, accepted: 0, rejected: 0 };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    // Supabase REST API supports batch insert with array body
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

    const response = await fetch(`${config.apiUrl}/rest/v1/traces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': config.apiKey,
        'Authorization': `Bearer ${config.apiKey}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(rows),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      return {
        success: false,
        accepted: 0,
        rejected: traces.length,
        errors: [{ trace_id: 'batch', error: `HTTP ${response.status}: ${errorBody}` }],
      };
    }

    // Supabase returns empty body with Prefer: return=minimal
    return {
      success: true,
      accepted: traces.length,
      rejected: 0,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[smoltbot] Failed to submit trace batch:', errorMessage);

    return {
      success: false,
      accepted: 0,
      rejected: traces.length,
      errors: [{ trace_id: 'batch', error: errorMessage }],
    };
  }
}

/**
 * Queue a trace for batched submission
 */
export function queueTrace(trace: AAPTrace): void {
  if (!currentConfig) {
    console.warn('[smoltbot] API not initialized, trace dropped');
    return;
  }

  traceQueue.push(trace);

  // If we've hit the batch size, flush immediately
  if (traceQueue.length >= currentConfig.batchSize) {
    void flushTraceQueue();
  } else {
    // Otherwise, set a timeout to flush after a short delay
    if (!flushTimeout) {
      flushTimeout = setTimeout(() => {
        void flushTraceQueue();
      }, 1000);
    }
  }
}

/**
 * Flush the trace queue
 */
export async function flushTraceQueue(): Promise<void> {
  if (flushTimeout) {
    clearTimeout(flushTimeout);
    flushTimeout = null;
  }

  if (traceQueue.length === 0 || !currentConfig) {
    return;
  }

  const traces = traceQueue;
  traceQueue = [];

  if (traces.length === 1) {
    await submitTrace(traces[0], currentConfig);
  } else {
    await submitTraceBatch(traces, currentConfig);
  }
}

/**
 * Get the number of pending traces in the queue
 */
export function getPendingTraceCount(): number {
  return traceQueue.length;
}
