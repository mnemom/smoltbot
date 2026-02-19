/**
 * Hybrid Analysis API Types (with attestation support)
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
  attestation?: {
    input_commitment: string;
    chain_hash: string;
    prev_chain_hash: string | null;
    merkle_leaf_index: number | null;
    certificate_id: string;
    signature: string;
    signing_key_id: string;
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

export interface SigningKeyInfo {
  key_id: string;
  public_key: string;  // hex-encoded
  algorithm: string;
  created_at: string;
  is_active: boolean;
}

export interface MerkleRootResponse {
  agent_id: string;
  merkle_root: string;
  tree_depth: number;
  leaf_count: number;
  last_updated: string;
}

export interface InclusionProofResponse {
  checkpoint_id: string;
  leaf_hash: string;
  leaf_index: number;
  siblings: Array<{ hash: string; position: 'left' | 'right' }>;
  root: string;
  tree_size: number;
  verified: boolean;
}

export interface ProofStatusResponse {
  proof_id: string;
  checkpoint_id: string;
  status: 'pending' | 'proving' | 'completed' | 'failed';
  proof_type: string;
  image_id: string | null;
  proving_duration_ms: number | null;
  verified: boolean;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VerifyCertificateRequest {
  certificate: unknown;  // IntegrityCertificate JSON
}

export interface VerifyCertificateResponse {
  valid: boolean;
  checks: {
    signature: { valid: boolean; key_id: string };
    chain: { valid: boolean; chain_hash: string };
    merkle: { valid: boolean; root: string } | null;
    input_commitment: { valid: boolean; commitment: string };
    verdict_derivation: { valid: boolean; method: string } | null;
  };
  details: string;
}
