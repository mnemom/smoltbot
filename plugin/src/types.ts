/**
 * OpenClaw hook event structure
 */
export interface HookEvent {
  /** Event category */
  type: 'command' | 'session' | 'agent' | 'tool' | 'gateway';
  /** Specific action within the category */
  action: string;
  /** Session identifier */
  sessionKey?: string;
  /** Event timestamp */
  timestamp: Date;
  /** Context data specific to the event type */
  context: HookContext;
}

/**
 * Context passed to hook handlers
 */
export interface HookContext {
  // Tool call context
  tool_name?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  is_error?: boolean;
  error?: Error;
  correlation_id?: string;

  // Session context
  session_id?: string;
  parent_trace_id?: string;
  workspace_dir?: string;

  // Additional OpenClaw context
  [key: string]: unknown;
}

/**
 * Hook handler function signature
 */
export type HookHandler = (event: HookEvent) => Promise<HookHandlerResult | void>;

/**
 * Result returned from hook handlers
 */
export interface HookHandlerResult {
  /** For before_tool_call: correlation ID for after_tool_call */
  correlation_id?: string;
  /** For before_tool_call: whether to proceed with the tool call */
  proceed?: boolean;
  /** For modifying behavior */
  [key: string]: unknown;
}
