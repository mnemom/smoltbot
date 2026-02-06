/**
 * BraidGrounding - Grounding protocol exchange UI.
 *
 * Displays grounding exchanges between participants:
 * - List of grounding exchanges (term, my_meaning, your_meaning, aligned)
 * - Visual indicator for aligned vs not-aligned
 * - Translation notes display
 */

import { useState } from 'react';

// Types
interface GroundingExchangeData {
  term: string;
  my_meaning?: string;
  your_meaning?: string;
  aligned: boolean | null;
  translation_notes?: string;
  participants?: string[];
  timestamp?: string;
}

interface AlignmentIndicatorProps {
  aligned: boolean | null;
}

interface GroundingExchangeProps {
  exchange: GroundingExchangeData;
  expanded: boolean;
  onToggle: () => void;
}

export interface BraidGroundingProps {
  exchanges?: GroundingExchangeData[];
  onRequestGrounding?: () => void;
}

function AlignmentIndicator({ aligned }: AlignmentIndicatorProps) {
  if (aligned == null) {
    return (
      <span className="braid-grounding__status braid-grounding__status--pending" title="Alignment pending">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
          <path d="M7 5v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
          <circle cx="7" cy="9.5" r="0.75" fill="currentColor" opacity="0.5" />
        </svg>
      </span>
    );
  }

  if (aligned) {
    return (
      <span className="braid-grounding__status braid-grounding__status--aligned" title="Meanings aligned">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="5" stroke="#22C55E" strokeWidth="1.5" />
          <path d="M5 7l1.5 1.5L9 5.5" stroke="#22C55E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  return (
    <span className="braid-grounding__status braid-grounding__status--misaligned" title="Meanings differ">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="5" stroke="#F59E0B" strokeWidth="1.5" />
        <path d="M5 5l4 4M9 5l-4 4" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function GroundingExchange({ exchange, expanded, onToggle }: GroundingExchangeProps) {
  const { term, my_meaning, your_meaning, aligned, translation_notes, participants } = exchange;

  return (
    <div
      className={`braid-grounding__exchange ${aligned ? 'braid-grounding__exchange--aligned' : 'braid-grounding__exchange--misaligned'} ${expanded ? 'braid-grounding__exchange--expanded' : ''}`}
    >
      <div
        className="braid-grounding__exchange-header"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onToggle()}
      >
        <AlignmentIndicator aligned={aligned} />
        <span className="braid-grounding__term">{term}</span>
        {participants && participants.length > 0 && (
          <span className="braid-grounding__participants">
            {participants.join(' + ')}
          </span>
        )}
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className={`braid-grounding__expand-icon ${expanded ? 'braid-grounding__expand-icon--expanded' : ''}`}
        >
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {expanded && (
        <div className="braid-grounding__exchange-content">
          <div className="braid-grounding__meanings">
            <div className="braid-grounding__meaning">
              <span className="braid-grounding__meaning-label">My understanding:</span>
              <span className="braid-grounding__meaning-text">{my_meaning || 'Not specified'}</span>
            </div>
            <div className="braid-grounding__meaning">
              <span className="braid-grounding__meaning-label">Your understanding:</span>
              <span className="braid-grounding__meaning-text">{your_meaning || 'Not specified'}</span>
            </div>
          </div>

          {translation_notes && (
            <div className="braid-grounding__notes">
              <span className="braid-grounding__notes-label">Translation notes:</span>
              <span className="braid-grounding__notes-text">{translation_notes}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * BraidGrounding - Main component.
 */
export function BraidGrounding({ exchanges = [], onRequestGrounding }: BraidGroundingProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  // Calculate alignment stats
  const aligned = exchanges.filter(e => e.aligned === true).length;
  const misaligned = exchanges.filter(e => e.aligned === false).length;
  const pending = exchanges.filter(e => e.aligned == null).length;

  const hasExchanges = exchanges.length > 0;

  return (
    <div className="braid-grounding">
      <div className="braid-grounding__header">
        <div className="braid-grounding__header-left">
          <span className="braid-grounding__title">Grounding Protocol</span>
          {hasExchanges && (
            <div className="braid-grounding__stats">
              <span className="braid-grounding__stat braid-grounding__stat--aligned" title="Aligned">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <circle cx="5" cy="5" r="4" fill="#22C55E" opacity="0.3" />
                </svg>
                {aligned}
              </span>
              <span className="braid-grounding__stat braid-grounding__stat--misaligned" title="Misaligned">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <circle cx="5" cy="5" r="4" fill="#F59E0B" opacity="0.3" />
                </svg>
                {misaligned}
              </span>
              {pending > 0 && (
                <span className="braid-grounding__stat braid-grounding__stat--pending" title="Pending">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <circle cx="5" cy="5" r="4" fill="#9CA3AF" opacity="0.3" />
                  </svg>
                  {pending}
                </span>
              )}
            </div>
          )}
        </div>
        {onRequestGrounding && (
          <button
            className="braid-grounding__request-btn"
            onClick={onRequestGrounding}
            title="Request grounding exchange"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Ground
          </button>
        )}
      </div>

      {!hasExchanges ? (
        <div className="braid-grounding__empty">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="braid-grounding__empty-icon">
            <path
              d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"
              fill="currentColor"
              opacity="0.3"
            />
            <path
              d="M12 7c-1.1 0-2 .9-2 2h2v2h-2c0 1.1.9 2 2 2s2-.9 2-2h-2V9h2c0-1.1-.9-2-2-2zm0 8c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"
              fill="currentColor"
              opacity="0.3"
            />
          </svg>
          <span className="braid-grounding__empty-text">
            No grounding exchanges yet.
          </span>
          <span className="braid-grounding__empty-hint">
            Request grounding when terms need clarification.
          </span>
        </div>
      ) : (
        <div className="braid-grounding__list">
          {exchanges.map((exchange, idx) => (
            <GroundingExchange
              key={`${exchange.term}-${idx}`}
              exchange={exchange}
              expanded={expandedIdx === idx}
              onToggle={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
