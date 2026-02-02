import type { HookHandler, HookEvent } from '../../src/types.js';
import { getConfig } from '../../src/config.js';
import {
  createPendingTrace,
  getPendingTrace,
  removePendingTrace,
  finalizePendingTrace,
} from '../../src/trace.js';
import { queueTrace } from '../../src/api.js';

/**
 * After tool call hook handler
 *
 * Captures result, calculates duration, and submits trace.
 */
const handler: HookHandler = async (event: HookEvent) => {
  if (event.type !== 'tool' || event.action !== 'after_tool_call') {
    return;
  }

  const config = getConfig();
  if (!config || !config.enabled) {
    return;
  }

  const {
    tool_name,
    params,
    result,
    is_error,
    error,
    correlation_id,
  } = event.context;

  if (!tool_name) {
    console.warn('[smoltbot] after_tool_call missing tool_name');
    return;
  }

  const correlationId = correlation_id as string | undefined;
  let pending = correlationId ? getPendingTrace(correlationId) : null;

  if (!pending) {
    // No matching before_tool_call, create standalone trace
    console.warn('[smoltbot] No pending trace for correlation_id, creating standalone');
    pending = createPendingTrace(config.agentId, tool_name as string, (params as Record<string, unknown>) || {});
  } else {
    removePendingTrace(correlationId!);
  }

  // Add error details to metadata if this was an error
  if (is_error && error) {
    pending.metadata = pending.metadata || {};
    pending.metadata.error_message = error.message;
    pending.metadata.error_stack = error.stack;
  }

  const trace = finalizePendingTrace(
    pending,
    is_error ? error?.message : result,
    is_error
  );

  queueTrace(trace);
};

export default handler;
