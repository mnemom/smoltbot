/**
 * Hybrid Analysis API Types
 * Phase 7: Enterprise self-hosted billing
 */

import type { IntegrityCheckpoint, RecommendedAction } from '@mnemom/agent-integrity-protocol';

export interface AnalyzeRequest {
  thinking_block: string;
  thinking_metadata: {
    provider: string;
    model: string;
  };
  agent_id: string;
  session_id: string;
  card: {
    card_id: string;
    values: Array<{ name: string; priority: number; description?: string }>;
    autonomy_envelope?: {
      bounded_actions?: string[];
      forbidden_actions?: string[];
      escalation_triggers?: Array<{ condition: string; action: string; reason?: string }>;
    };
    [key: string]: unknown;
  };
  conscience_values?: Array<{ type: string; content: string; id?: string }>;
  task_context?: string;
  window_context?: Array<{
    checkpoint_id: string;
    verdict: string;
    reasoning_summary: string;
  }>;
  idempotency_key?: string;
  store_checkpoint?: boolean;
}

export interface AnalyzeResponse {
  checkpoint: IntegrityCheckpoint;
  proceed: boolean;
  recommended_action: RecommendedAction;
  window_summary?: {
    size: number;
    verdicts: { clear: number; review_needed: number; boundary_violation: number };
  };
  metering: {
    event_id: string;
    account_id: string;
    billed: boolean;
  };
}

export interface AnalyzeBatchRequest {
  items: AnalyzeRequest[];
}

export interface AnalyzeBatchResponse {
  results: Array<AnalyzeResponse | { error: string; index: number }>;
  metering: {
    total_events: number;
    account_id: string;
  };
}
