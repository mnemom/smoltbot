/**
 * AAP (Agent Alignment Protocol) Types
 *
 * Core types for traces, alignment cards, and Braid metadata.
 * Based on the AAP SDK schema specifications.
 */

// Braid Metadata Types
export interface BraidAffect {
  salience: number;      // 0-1
  valence: number;       // -1 to 1
  arousal: number;       // 0-1
  stance: 'warm' | 'cautious' | 'curious' | 'concerned' |
          'resolute' | 'receptive' | 'urgent';
}

export interface BraidConfidence {
  epistemic: number;           // 0-1
  source_reliability: number;  // 0-1
  temporal_decay: number;      // 0-1
  value_coherence: number;     // 0-1
  translation: number;         // 0-1 (trans-substrate)
}

export interface BraidForming {
  sense: string;
  intensity: number;
}

export interface BraidRevision {
  references: string[];
  what_shifted: string;
  direction: 'strengthened' | 'weakened' | 'transformed' |
             'abandoned' | 'extended';
}

export interface BraidCommitment {
  level: 'intent' | 'commitment' | 'shared_commitment';
  content: string;
  participants?: string[];
}

export interface BraidSubstrate {
  substrate_id: string;
  substrate_notes: string;
}

export interface BraidComprehension {
  comprehension_claimed: boolean;
  comprehension_requested: boolean;
  comprehension_confirmed?: string;
}

export interface CustomPerformative {
  name: string;
  definition: string;
  first_used_by: string;
  first_used_in: string;
}

export type Performative =
  | 'inform' | 'propose' | 'request' | 'commit' | 'wonder'
  | 'remember' | 'weave' | 'challenge' | 'affirm' | 'custom';

export type AbsenceType = 'unmarked' | 'raw' | 'rupture';

export interface BraidMetadata {
  performative: Performative;
  custom_performative?: CustomPerformative;
  affect?: BraidAffect;
  confidence?: BraidConfidence;
  forming?: BraidForming;
  absence?: AbsenceType;
  revision?: BraidRevision;
  commitment?: BraidCommitment;
  substrate?: BraidSubstrate;
  comprehension?: BraidComprehension;
}

// APTrace Action Types
export type ActionType = 'recommend' | 'execute' | 'escalate' | 'deny';
export type ActionCategory = 'bounded' | 'escalation_trigger' | 'forbidden';

export interface TraceAction {
  type: ActionType;
  name: string;
  category: ActionCategory;
  target?: string;
  parameters?: Record<string, unknown>;
}

// APTrace Decision Types
export interface AlternativeConsidered {
  option_id: string;
  description: string;
  score?: number;
  scoring_factors?: Record<string, unknown>;
  flags?: string[];
}

export interface TraceDecision {
  alternatives_considered: AlternativeConsidered[];
  selected: string;
  selection_reasoning: string;
  values_applied: string[];
  confidence?: number;
}

// APTrace Escalation Types
export type EscalationStatus = 'pending' | 'approved' | 'denied' | 'timeout';

export interface TraceEscalation {
  evaluated: boolean;
  triggers_checked: string[];
  required: boolean;
  reason: string;
  escalation_id?: string;
  escalation_status?: EscalationStatus;
  principal_response?: string;
}

// APTrace Context Types
export interface TraceContext {
  session_id?: string;
  conversation_turn?: number;
  prior_trace_ids?: string[];
  environment?: string;
  metadata?: BraidMetadata & Record<string, unknown>;
}

/**
 * APTrace - Agent Protocol Trace
 *
 * The core trace structure for transparent agent behavior logging.
 * Includes action details, decision reasoning, and optional Braid metadata.
 */
export interface APTrace {
  trace_id: string;
  agent_id: string;
  card_id: string;
  timestamp: string;  // ISO 8601

  action: TraceAction;
  decision: TraceDecision;
  escalation?: TraceEscalation;
  context?: TraceContext;
}

/**
 * Alignment Card - Defines agent values and autonomy envelope
 */
export interface AlignmentCard {
  aap_version: string;
  card_id: string;
  agent_id: string;
  issued_at: string;
  issuer: {
    type: 'human' | 'organization' | 'agent';
    id: string;
  };
  values: {
    declared: string[];
    prioritization: string;
  };
  autonomy_envelope: {
    bounded_actions: Array<{
      action: string;
      constraints: Record<string, unknown>;
    }>;
    forbidden_actions: string[];
    escalation_triggers: string[];
  };
  transparency: {
    trace_level: 'full' | 'summary' | 'minimal';
    public_dashboard: boolean;
  };
}
