import type { AAPTrace } from './trace.js';

/**
 * Smoltbot Trace API
 *
 * Architecture:
 * Plugin → POST https://api.mnemom.ai/v1/traces → [Proxy] → Database
 *
 * The proxy layer allows us to:
 * - Swap databases without client updates
 * - Add rate limiting, validation, analytics
 * - Scale independently of storage backend
 */

/**
 * API endpoint - stable contract that never changes for clients
 */
const API_ENDPOINT = 'https://smoltbot-api.mnemom.workers.dev/v1/traces';

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
 * Configuration for batching
 */
interface ApiConfig {
  batchSize: number;
  timeout: number;
}

let currentConfig: ApiConfig = {
  batchSize: 1,
  timeout: 5000,
};

/**
 * Initialize the API client with configuration
 */
export function initializeApi(config: { batchSize?: number; timeout?: number }): void {
  currentConfig = {
    batchSize: config.batchSize ?? 1,
    timeout: config.timeout ?? 5000,
  };
}

/**
 * Submit a single trace to the API
 */
export async function submitTrace(trace: AAPTrace): Promise<TraceResponse> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), currentConfig.timeout);

    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(trace),
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

    const result = await response.json().catch(() => ({})) as { trace_id?: string };
    return {
      success: true,
      trace_id: result.trace_id || trace.id,
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
export async function submitTraceBatch(traces: AAPTrace[]): Promise<BatchTraceResponse> {
  if (traces.length === 0) {
    return { success: true, accepted: 0, rejected: 0 };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), currentConfig.timeout);

    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ batch: traces }),
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

    const result = await response.json().catch(() => ({ accepted: traces.length })) as {
      accepted?: number;
      rejected?: number;
      errors?: Array<{ trace_id: string; error: string }>;
    };
    return {
      success: true,
      accepted: result.accepted ?? traces.length,
      rejected: result.rejected ?? 0,
      errors: result.errors,
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

  if (traceQueue.length === 0) {
    return;
  }

  const traces = traceQueue;
  traceQueue = [];

  if (traces.length === 1) {
    await submitTrace(traces[0]);
  } else {
    await submitTraceBatch(traces);
  }
}

/**
 * Get the number of pending traces in the queue
 */
export function getPendingTraceCount(): number {
  return traceQueue.length;
}

/**
 * Get the API endpoint (for debugging/logging)
 */
export function getApiEndpoint(): string {
  return API_ENDPOINT;
}
