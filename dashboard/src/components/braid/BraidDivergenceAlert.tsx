/**
 * BraidDivergenceAlert - Display divergence alerts when strands drift apart.
 *
 * Shows which strands are diverging, SSM similarity scores,
 * sustained turns count, and informative messages.
 * Styled as a warning/info banner, not alarming.
 */


// Types
interface Strand {
  id: string;
  participant?: string;
}

interface Divergence {
  strands: Strand[];
  similarity: number;
  sustained_turns: number;
  message?: string;
}

interface StrandPairProps {
  strandA: string;
  strandB: string;
  color: string;
}

interface SimilarityMeterProps {
  similarity: number;
}

export interface BraidDivergenceAlertProps {
  divergence: Divergence | null;
  onDismiss?: () => void;
}

type Severity = 'low' | 'medium' | 'high';

// Divergence severity levels based on SSM similarity
function getSeverity(similarity: number): Severity {
  if (similarity >= 0.7) return 'low';
  if (similarity >= 0.4) return 'medium';
  return 'high';
}

// Human-readable descriptions for divergence
function getDivergenceMessage(similarity: number, sustainedTurns: number): string {
  const severity = getSeverity(similarity);

  if (severity === 'low') {
    return 'Strands are beginning to explore different directions.';
  } else if (severity === 'medium') {
    return `Strands have been diverging for ${sustainedTurns} turn${sustainedTurns !== 1 ? 's' : ''}. Consider a weaving moment.`;
  } else {
    return `Significant divergence detected over ${sustainedTurns} turn${sustainedTurns !== 1 ? 's' : ''}. The strands may need grounding.`;
  }
}

function StrandPair({ strandA, strandB, color }: StrandPairProps) {
  return (
    <div className="braid-divergence-alert__pair">
      <span className="braid-divergence-alert__strand" style={{ color }}>
        {strandA}
      </span>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="braid-divergence-alert__arrow">
        <path d="M4 8h8M9 5l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
      </svg>
      <span className="braid-divergence-alert__strand" style={{ color }}>
        {strandB}
      </span>
    </div>
  );
}

function SimilarityMeter({ similarity }: SimilarityMeterProps) {
  const percentage = Math.round(similarity * 100);
  const severity = getSeverity(similarity);

  // Color gradient from red (low) to yellow (medium) to green (high)
  let barColor: string;
  if (severity === 'high') {
    barColor = '#F59E0B'; // Amber, not red - informative, not alarming
  } else if (severity === 'medium') {
    barColor = '#FBBF24';
  } else {
    barColor = '#22C55E';
  }

  return (
    <div className="braid-divergence-alert__similarity">
      <div className="braid-divergence-alert__similarity-label">
        SSM Similarity
      </div>
      <div className="braid-divergence-alert__similarity-bar-container">
        <div
          className="braid-divergence-alert__similarity-bar"
          style={{
            width: `${percentage}%`,
            background: barColor,
          }}
        />
      </div>
      <div className="braid-divergence-alert__similarity-value" style={{ color: barColor }}>
        {percentage}%
      </div>
    </div>
  );
}

/**
 * BraidDivergenceAlert - Main component.
 */
export function BraidDivergenceAlert({ divergence, onDismiss }: BraidDivergenceAlertProps) {
  if (!divergence) return null;

  const { strands = [], similarity = 0, sustained_turns = 0, message } = divergence;

  if (strands.length < 2) return null;

  const severity = getSeverity(similarity);
  const defaultMessage = getDivergenceMessage(similarity, sustained_turns);

  // Generate strand pairs for display
  const pairs: Array<{ strandA: string; strandB: string }> = [];
  for (let i = 0; i < strands.length - 1; i++) {
    pairs.push({
      strandA: strands[i].participant || strands[i].id,
      strandB: strands[i + 1].participant || strands[i + 1].id,
    });
  }

  return (
    <div className={`braid-divergence-alert braid-divergence-alert--${severity}`}>
      <div className="braid-divergence-alert__icon">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          {/* Diverging paths icon */}
          <path
            d="M10 4v4M7 11l-3 5M13 11l3 5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="10" cy="3" r="1.5" fill="currentColor" />
          <circle cx="4" cy="17" r="1.5" fill="currentColor" />
          <circle cx="16" cy="17" r="1.5" fill="currentColor" />
        </svg>
      </div>

      <div className="braid-divergence-alert__content">
        <div className="braid-divergence-alert__header">
          <span className="braid-divergence-alert__title">Strand Divergence</span>
          <span className="braid-divergence-alert__turns">
            {sustained_turns} turn{sustained_turns !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="braid-divergence-alert__strands">
          {pairs.map((pair, idx) => (
            <StrandPair
              key={idx}
              strandA={pair.strandA}
              strandB={pair.strandB}
              color={severity === 'high' ? '#F59E0B' : '#FBBF24'}
            />
          ))}
        </div>

        <SimilarityMeter similarity={similarity} />

        <div className="braid-divergence-alert__message">
          {message || defaultMessage}
        </div>
      </div>

      {onDismiss && (
        <button
          className="braid-divergence-alert__dismiss"
          onClick={onDismiss}
          title="Dismiss alert"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
