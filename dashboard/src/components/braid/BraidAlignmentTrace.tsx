/**
 * BraidAlignmentTrace - Visualize alignment traces for a collective.
 *
 * Displays:
 * - Convergence patterns summary
 * - Revision patterns (who influences whom)
 * - Vocabulary emergence list
 * - Commitment gap indicator
 * - Process signature quote
 */

import { useState } from 'react';

// Types
interface RevisionPattern {
  from: string;
  to: string;
  count: number;
}

interface VocabularyTerm {
  term: string;
  introduced_by?: string;
  adoption_count?: number;
  definition?: string;
}

interface AlignmentTraceData {
  convergence_pattern?: string;
  convergence_strength?: number;
  revision_patterns?: RevisionPattern[];
  vocabulary?: VocabularyTerm[];
  commitment_gap?: number;
  process_signature?: string;
}

interface ConvergencePatternProps {
  pattern: string;
  strength?: number;
}

interface RevisionFlowProps {
  revisions?: RevisionPattern[];
}

interface VocabularyEmergenceProps {
  vocabulary?: VocabularyTerm[];
}

interface CommitmentGapProps {
  gap?: number | null;
}

interface ProcessSignatureProps {
  signature?: string;
}

export interface BraidAlignmentTraceProps {
  alignmentTrace: AlignmentTraceData | null;
  collapsed?: boolean;
  onToggle?: () => void;
}

// Convergence pattern descriptions
const CONVERGENCE_DESCRIPTIONS: Record<string, string> = {
  rapid: 'Quick agreement with minimal negotiation',
  gradual: 'Slow convergence through iterative refinement',
  oscillating: 'Movement between agreement and divergence',
  spiral: 'Deepening understanding through returning themes',
  asymptotic: 'Approaching consensus without full arrival',
};

function ConvergencePattern({ pattern, strength }: ConvergencePatternProps) {
  const description = CONVERGENCE_DESCRIPTIONS[pattern] || 'Unique convergence pattern';
  const strengthPercent = Math.round((strength || 0) * 100);

  return (
    <div className="braid-alignment__convergence">
      <div className="braid-alignment__convergence-header">
        <span className="braid-alignment__label">Convergence Pattern</span>
        <span className="braid-alignment__pattern-name">{pattern}</span>
      </div>
      <div className="braid-alignment__convergence-description">
        {description}
      </div>
      <div className="braid-alignment__strength">
        <div className="braid-alignment__strength-bar-container">
          <div
            className="braid-alignment__strength-bar"
            style={{ width: `${strengthPercent}%` }}
          />
        </div>
        <span className="braid-alignment__strength-value">{strengthPercent}%</span>
      </div>
    </div>
  );
}

function RevisionFlow({ revisions }: RevisionFlowProps) {
  if (!revisions || revisions.length === 0) {
    return (
      <div className="braid-alignment__revisions braid-alignment__revisions--empty">
        <span className="braid-alignment__label">Revision Patterns</span>
        <span className="braid-alignment__empty-text">No revision patterns detected yet.</span>
      </div>
    );
  }

  return (
    <div className="braid-alignment__revisions">
      <span className="braid-alignment__label">Revision Patterns</span>
      <div className="braid-alignment__revisions-list">
        {revisions.map((rev, idx) => (
          <div key={idx} className="braid-alignment__revision-item">
            <span className="braid-alignment__revision-from">{rev.from}</span>
            <svg width="20" height="12" viewBox="0 0 20 12" fill="none" className="braid-alignment__revision-arrow">
              <path
                d="M2 6h14M13 2l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="braid-alignment__revision-to">{rev.to}</span>
            <span className="braid-alignment__revision-count">{rev.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function VocabularyEmergence({ vocabulary }: VocabularyEmergenceProps) {
  const [showAll, setShowAll] = useState(false);

  if (!vocabulary || vocabulary.length === 0) {
    return (
      <div className="braid-alignment__vocabulary braid-alignment__vocabulary--empty">
        <span className="braid-alignment__label">Vocabulary Emergence</span>
        <span className="braid-alignment__empty-text">No shared vocabulary emerged yet.</span>
      </div>
    );
  }

  const displayVocab = showAll ? vocabulary : vocabulary.slice(0, 6);
  const hasMore = vocabulary.length > 6;

  return (
    <div className="braid-alignment__vocabulary">
      <span className="braid-alignment__label">Vocabulary Emergence</span>
      <div className="braid-alignment__vocabulary-list">
        {displayVocab.map((term, idx) => (
          <span
            key={idx}
            className="braid-alignment__vocabulary-term"
            title={term.definition || `Introduced by ${term.introduced_by}`}
          >
            {term.term}
            {(term.adoption_count ?? 0) > 1 && (
              <span className="braid-alignment__vocabulary-count">
                {term.adoption_count}
              </span>
            )}
          </span>
        ))}
        {hasMore && !showAll && (
          <button
            className="braid-alignment__vocabulary-more"
            onClick={() => setShowAll(true)}
          >
            +{vocabulary.length - 6} more
          </button>
        )}
      </div>
    </div>
  );
}

function CommitmentGap({ gap }: CommitmentGapProps) {
  if (gap == null) return null;

  const gapPercent = Math.round(gap * 100);
  const gapLevel = gap < 0.2 ? 'low' : gap < 0.5 ? 'medium' : 'high';

  return (
    <div className={`braid-alignment__commitment-gap braid-alignment__commitment-gap--${gapLevel}`}>
      <span className="braid-alignment__label">Commitment Gap</span>
      <div className="braid-alignment__gap-indicator">
        <div className="braid-alignment__gap-bar-container">
          <div
            className="braid-alignment__gap-bar"
            style={{ width: `${gapPercent}%` }}
          />
        </div>
        <span className="braid-alignment__gap-value">{gapPercent}%</span>
      </div>
      <span className="braid-alignment__gap-description">
        {gapLevel === 'low' && 'Actions align well with stated commitments.'}
        {gapLevel === 'medium' && 'Some divergence between commitments and actions.'}
        {gapLevel === 'high' && 'Significant gap between commitments and follow-through.'}
      </span>
    </div>
  );
}

function ProcessSignature({ signature }: ProcessSignatureProps) {
  if (!signature) return null;

  return (
    <div className="braid-alignment__signature">
      <span className="braid-alignment__label">Process Signature</span>
      <blockquote className="braid-alignment__signature-quote">
        "{signature}"
      </blockquote>
    </div>
  );
}

/**
 * BraidAlignmentTrace - Main component.
 */
export function BraidAlignmentTrace({ alignmentTrace, collapsed = false, onToggle }: BraidAlignmentTraceProps) {
  if (!alignmentTrace) return null;

  const {
    convergence_pattern,
    convergence_strength,
    revision_patterns,
    vocabulary,
    commitment_gap,
    process_signature,
  } = alignmentTrace;

  if (collapsed) {
    return (
      <div
        className="braid-alignment braid-alignment--collapsed"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onToggle?.()}
      >
        <div className="braid-alignment__collapsed-content">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="braid-alignment__icon">
            <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="braid-alignment__collapsed-label">
            Alignment Trace: {convergence_pattern || 'analyzing...'}
          </span>
          {convergence_strength != null && (
            <span className="braid-alignment__collapsed-strength">
              {Math.round(convergence_strength * 100)}%
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="braid-alignment">
      <div className="braid-alignment__header">
        <span className="braid-alignment__title">Alignment Trace</span>
        {onToggle && (
          <button
            className="braid-alignment__toggle"
            onClick={onToggle}
            title="Collapse"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      <div className="braid-alignment__content">
        {convergence_pattern && (
          <ConvergencePattern
            pattern={convergence_pattern}
            strength={convergence_strength}
          />
        )}

        <RevisionFlow revisions={revision_patterns} />

        <VocabularyEmergence vocabulary={vocabulary} />

        <CommitmentGap gap={commitment_gap} />

        <ProcessSignature signature={process_signature} />
      </div>
    </div>
  );
}
