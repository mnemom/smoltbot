import type { HookHandler, HookEvent } from '../../src/types.js';
import { getConfig } from '../../src/config.js';
import { createPendingTrace, storePendingTrace } from '../../src/trace.js';
import type { TraceMetadata } from '../../src/trace.js';

/**
 * Before tool call hook handler
 *
 * Captures intent and starts timing before a tool executes.
 */
const handler: HookHandler = async (event: HookEvent) => {
  if (event.type !== 'tool' || event.action !== 'before_tool_call') {
    return;
  }

  const config = getConfig();
  if (!config || !config.enabled) {
    return;
  }

  const { tool_name, params, session_id, parent_trace_id } = event.context;

  if (!tool_name) {
    console.warn('[smoltbot] before_tool_call missing tool_name');
    return;
  }

  const metadata: TraceMetadata = {};
  if (session_id) {
    metadata.session_id = session_id as string;
  }
  if (parent_trace_id) {
    metadata.parent_trace_id = parent_trace_id as string;
  }

  const pending = createPendingTrace(
    config.agentId,
    tool_name as string,
    (params as Record<string, unknown>) || {},
    Object.keys(metadata).length > 0 ? metadata : undefined
  );

  // Store for retrieval by after_tool_call
  storePendingTrace(pending);

  // Return correlation ID for OpenClaw to pass to after_tool_call
  return {
    correlation_id: pending.id,
    proceed: true,
  };
};

export default handler;
