/**
 * TraceCard - Full trace display with Braid metadata
 *
 * Shows complete trace details including:
 * - Action details and parameters
 * - Decision reasoning and alternatives considered
 * - Values applied
 * - Braid metadata (performatives, confidence, affect, etc.)
 * - Expandable sections for deep inspection
 */

import React, { useState } from 'react';
import type { APTrace, BraidMetadata, Performative } from '../../lib/types/aap';

export interface TraceCardProps {
  /** The trace to display */
  trace: APTrace;
  /** Whether the card is expanded (default: false) */
  expanded?: boolean;
  /** Callback when toggle is clicked */
  onToggle?: () => void;
}

/**
 * Get performative badge styling
 */
function getPerformativeStyle(performative: Performative): string {
  const styles: Record<string, string> = {
    inform: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    propose: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    request: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    commit: 'bg-green-500/20 text-green-400 border-green-500/30',
    wonder: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
    remember: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    weave: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
    challenge: 'bg-red-500/20 text-red-400 border-red-500/30',
    affirm: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    custom: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  };
  return styles[performative] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
}

/**
 * Get stance emoji indicator
 */
function getStanceIndicator(
  stance: string
): { emoji: string; label: string } {
  const indicators: Record<string, { emoji: string; label: string }> = {
    warm: { emoji: '', label: 'Warm' },
    cautious: { emoji: '', label: 'Cautious' },
    curious: { emoji: '', label: 'Curious' },
    concerned: { emoji: '', label: 'Concerned' },
    resolute: { emoji: '', label: 'Resolute' },
    receptive: { emoji: '', label: 'Receptive' },
    urgent: { emoji: '', label: 'Urgent' },
  };
  return indicators[stance] || { emoji: '', label: stance };
}

/**
 * Render a confidence bar
 */
function ConfidenceBar({
  label,
  value,
}: {
  label: string;
  value: number;
}): React.ReactElement {
  const percentage = Math.round(value * 100);
  const barColor =
    value >= 0.7 ? 'bg-green-500' : value >= 0.4 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--color-text-muted)] w-28 truncate">
        {label}
      </span>
      <div className="flex-1 h-1.5 bg-[var(--color-bg-elevated)] rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-xs font-mono text-[var(--color-text-secondary)] w-8 text-right">
        {percentage}%
      </span>
    </div>
  );
}

/**
 * Render Braid metadata panel
 */
function BraidPanel({
  metadata,
}: {
  metadata: BraidMetadata;
}): React.ReactElement {
  const [showAll, setShowAll] = useState(false);

  return (
    <div className="space-y-4">
      {/* Performative Badge */}
      <div className="flex items-center gap-2">
        <span
          className={`px-2 py-1 text-xs font-medium rounded border ${getPerformativeStyle(
            metadata.performative
          )}`}
        >
          {metadata.performative}
        </span>
        {metadata.custom_performative && (
          <span className="text-xs text-[var(--color-text-muted)]">
            ({metadata.custom_performative.name})
          </span>
        )}
      </div>

      {/* Affect Indicators */}
      {metadata.affect && (
        <div className="flex items-center gap-4 text-sm">
          <span className="text-[var(--color-text-muted)]">Affect:</span>
          <span className="text-[var(--color-text-secondary)]">
            {getStanceIndicator(metadata.affect.stance).label}
          </span>
          <span className="text-xs text-[var(--color-text-muted)]">
            valence: {metadata.affect.valence > 0 ? '+' : ''}
            {metadata.affect.valence.toFixed(2)}
          </span>
          <span className="text-xs text-[var(--color-text-muted)]">
            arousal: {(metadata.affect.arousal * 100).toFixed(0)}%
          </span>
        </div>
      )}

      {/* Confidence Metrics */}
      {metadata.confidence && (
        <div className="space-y-2">
          <ConfidenceBar label="Epistemic" value={metadata.confidence.epistemic} />
          <ConfidenceBar
            label="Source reliability"
            value={metadata.confidence.source_reliability}
          />
          <ConfidenceBar
            label="Value coherence"
            value={metadata.confidence.value_coherence}
          />
          {showAll && (
            <>
              <ConfidenceBar
                label="Temporal decay"
                value={metadata.confidence.temporal_decay}
              />
              <ConfidenceBar
                label="Translation"
                value={metadata.confidence.translation}
              />
            </>
          )}
        </div>
      )}

      {/* Forming (pre-categorical thoughts) */}
      {metadata.forming && (
        <div
          className="text-sm italic text-[var(--color-text-secondary)]"
          style={{ opacity: 0.5 + metadata.forming.intensity * 0.5 }}
        >
          "{metadata.forming.sense}"
        </div>
      )}

      {/* Absence markers */}
      {metadata.absence === 'rupture' && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded text-amber-400 text-sm">
          <span className="text-lg">*</span>
          <span>Rupture commemorated - moment exceeded format</span>
        </div>
      )}

      {/* Revision links */}
      {metadata.revision && (
        <div className="text-sm">
          <span className="text-[var(--color-text-muted)]">Revision:</span>{' '}
          <span className="text-[var(--color-text-secondary)]">
            {metadata.revision.what_shifted}
          </span>
          <span
            className={`ml-2 px-1.5 py-0.5 text-xs rounded ${
              metadata.revision.direction === 'strengthened'
                ? 'bg-green-500/20 text-green-400'
                : metadata.revision.direction === 'weakened'
                ? 'bg-red-500/20 text-red-400'
                : 'bg-gray-500/20 text-gray-400'
            }`}
          >
            {metadata.revision.direction}
          </span>
        </div>
      )}

      {/* Commitment */}
      {metadata.commitment && (
        <div className="text-sm">
          <span
            className={`px-2 py-0.5 text-xs font-medium rounded ${
              metadata.commitment.level === 'shared_commitment'
                ? 'bg-green-500/20 text-green-400'
                : metadata.commitment.level === 'commitment'
                ? 'bg-blue-500/20 text-blue-400'
                : 'bg-gray-500/20 text-gray-400'
            }`}
          >
            {metadata.commitment.level.replace('_', ' ')}
          </span>
          <span className="ml-2 text-[var(--color-text-secondary)]">
            {metadata.commitment.content}
          </span>
        </div>
      )}

      {/* Show more/less toggle */}
      {metadata.confidence && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-xs text-[var(--color-accent)] hover:underline"
        >
          {showAll ? 'Show less' : 'Show all metrics'}
        </button>
      )}
    </div>
  );
}

export function TraceCard({
  trace,
  expanded = false,
  onToggle,
}: TraceCardProps): React.ReactElement {
  const [showAlternatives, setShowAlternatives] = useState(false);

  // Extract Braid metadata from context if present
  const braidMetadata = trace.context?.metadata as BraidMetadata | undefined;

  // Format timestamp
  const timestamp = new Date(trace.timestamp).toLocaleString();

  if (!expanded) {
    // Compact mode - just show essential info with toggle
    return (
      <button
        onClick={onToggle}
        className="w-full text-left bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-accent)] transition-colors"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className={`px-2 py-0.5 text-xs font-medium rounded ${
                trace.action.type === 'execute'
                  ? 'bg-green-500/20 text-green-400'
                  : trace.action.type === 'recommend'
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-gray-500/20 text-gray-400'
              }`}
            >
              {trace.action.type}
            </span>
            <span className="font-medium text-[var(--color-text-primary)]">
              {trace.action.name}
            </span>
          </div>
          <span className="text-xs text-[var(--color-text-muted)]">
            {timestamp}
          </span>
        </div>
      </button>
    );
  }

  // Expanded mode - full details
  return (
    <div className="bg-[var(--color-bg-card)] border border-[var(--color-accent)] border-t-0 rounded-b-lg p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span
              className={`px-2 py-1 text-sm font-medium rounded ${
                trace.action.type === 'execute'
                  ? 'bg-green-500/20 text-green-400'
                  : trace.action.type === 'recommend'
                  ? 'bg-blue-500/20 text-blue-400'
                  : trace.action.type === 'escalate'
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : 'bg-red-500/20 text-red-400'
              }`}
            >
              {trace.action.type}
            </span>
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
              {trace.action.name}
            </h3>
          </div>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {timestamp} | Category: {trace.action.category}
          </p>
        </div>
        <code className="text-xs text-[var(--color-text-muted)] bg-[var(--color-bg-elevated)] px-2 py-1 rounded">
          {trace.trace_id.slice(0, 12)}...
        </code>
      </div>

      {/* Decision Reasoning */}
      <div>
        <h4 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">
          Decision Reasoning
        </h4>
        <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
          {trace.decision.selection_reasoning}
        </p>
        {trace.decision.confidence !== undefined && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-[var(--color-text-muted)]">
              Confidence:
            </span>
            <div className="w-24 h-1.5 bg-[var(--color-bg-elevated)] rounded-full overflow-hidden">
              <div
                className={`h-full ${
                  trace.decision.confidence >= 0.7
                    ? 'bg-green-500'
                    : trace.decision.confidence >= 0.4
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
                }`}
                style={{ width: `${trace.decision.confidence * 100}%` }}
              />
            </div>
            <span className="text-xs font-mono text-[var(--color-text-secondary)]">
              {(trace.decision.confidence * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>

      {/* Values Applied */}
      {trace.decision.values_applied.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">
            Values Applied
          </h4>
          <div className="flex flex-wrap gap-2">
            {trace.decision.values_applied.map((value, i) => (
              <span
                key={i}
                className="px-2 py-1 text-xs bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/30 rounded"
              >
                {value}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Alternatives Considered */}
      {trace.decision.alternatives_considered.length > 0 && (
        <div>
          <button
            onClick={() => setShowAlternatives(!showAlternatives)}
            className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)] hover:text-[var(--color-accent)] transition-colors"
          >
            <svg
              className={`w-4 h-4 transition-transform ${
                showAlternatives ? 'rotate-90' : ''
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
            Alternatives Considered ({trace.decision.alternatives_considered.length})
          </button>
          {showAlternatives && (
            <div className="mt-3 space-y-2">
              {trace.decision.alternatives_considered.map((alt) => (
                <div
                  key={alt.option_id}
                  className={`p-3 rounded border ${
                    alt.option_id === trace.decision.selected
                      ? 'bg-green-500/10 border-green-500/30'
                      : 'bg-[var(--color-bg-elevated)] border-[var(--color-border)]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm text-[var(--color-text-primary)]">
                      {alt.option_id}
                      {alt.option_id === trace.decision.selected && (
                        <span className="ml-2 text-xs text-green-400">
                          (selected)
                        </span>
                      )}
                    </span>
                    {alt.score !== undefined && (
                      <span className="text-xs font-mono text-[var(--color-text-muted)]">
                        score: {alt.score.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                    {alt.description}
                  </p>
                  {alt.flags && alt.flags.length > 0 && (
                    <div className="flex gap-1 mt-2">
                      {alt.flags.map((flag, i) => (
                        <span
                          key={i}
                          className="px-1.5 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded"
                        >
                          {flag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Braid Metadata */}
      {braidMetadata && braidMetadata.performative && (
        <div className="pt-4 border-t border-[var(--color-border)]">
          <h4 className="text-sm font-medium text-[var(--color-text-primary)] mb-3">
            Braid Metadata
          </h4>
          <BraidPanel metadata={braidMetadata} />
        </div>
      )}

      {/* Escalation Info */}
      {trace.escalation && trace.escalation.required && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <h4 className="text-sm font-medium text-yellow-400 mb-2">
            Escalation Required
          </h4>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {trace.escalation.reason}
          </p>
          {trace.escalation.escalation_status && (
            <span
              className={`inline-block mt-2 px-2 py-1 text-xs font-medium rounded ${
                trace.escalation.escalation_status === 'approved'
                  ? 'bg-green-500/20 text-green-400'
                  : trace.escalation.escalation_status === 'denied'
                  ? 'bg-red-500/20 text-red-400'
                  : trace.escalation.escalation_status === 'pending'
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : 'bg-gray-500/20 text-gray-400'
              }`}
            >
              {trace.escalation.escalation_status}
            </span>
          )}
        </div>
      )}

      {/* Action Target & Parameters */}
      {(trace.action.target || trace.action.parameters) && (
        <div className="pt-4 border-t border-[var(--color-border)]">
          <h4 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">
            Action Details
          </h4>
          {trace.action.target && (
            <p className="text-sm text-[var(--color-text-secondary)]">
              <span className="text-[var(--color-text-muted)]">Target:</span>{' '}
              {trace.action.target}
            </p>
          )}
          {trace.action.parameters && (
            <pre className="mt-2 p-3 bg-[var(--color-bg-elevated)] rounded text-xs overflow-x-auto">
              {JSON.stringify(trace.action.parameters, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export default TraceCard;
