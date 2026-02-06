/**
 * BraidRuptures - Display commemorated ruptures.
 *
 * Shows rupture events in the conversation:
 * - List of rupture events
 * - Who marked it, when, description
 * - Link to original message
 */

import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';

// Types
type RuptureType = 'deliberate' | 'format_violation' | 'emotional_rupture' | 'protocol_break' | 'unknown';

interface RuptureStyle {
  color: string;
  icon: ReactNode;
  label: string;
}

interface Rupture {
  id?: string;
  type: RuptureType;
  marked_by: string;
  timestamp: string;
  description?: string;
  context?: string;
  message_id?: string;
}

interface RuptureCardProps {
  rupture: Rupture;
  onNavigate?: (messageId: string) => void;
}

export interface BraidRupturesProps {
  ruptures?: Rupture[];
  onNavigate?: (messageId: string) => void;
}

// Format relative time
function formatRelativeTime(timestamp: string | undefined): string {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

// Rupture type icons and colors
const RUPTURE_STYLES: Record<RuptureType, RuptureStyle> = {
  deliberate: {
    color: '#F59E0B',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 1L1 15h14L8 1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M8 6v4M8 12v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    label: 'Deliberate Break',
  },
  format_violation: {
    color: '#8B5CF6',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
        <path d="M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    label: 'Format Violation',
  },
  emotional_rupture: {
    color: '#EF4444',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 14c3.5-3 5.5-5.5 5.5-7.5C13.5 4 11.5 2 8 2S2.5 4 2.5 6.5C2.5 8.5 4.5 11 8 14z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    label: 'Emotional Rupture',
  },
  protocol_break: {
    color: '#3B82F6',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M2 8h4M10 8h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 6v-4M8 14v-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    label: 'Protocol Break',
  },
  unknown: {
    color: '#9CA3AF',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 6c0-1.1.9-2 2-2s2 .9 2 2c0 .7-.4 1.3-1 1.7-.3.2-.5.4-.7.6-.2.3-.3.5-.3.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="12" r="0.75" fill="currentColor" />
      </svg>
    ),
    label: 'Rupture',
  },
};

function getRuptureStyle(type: RuptureType | string | undefined): RuptureStyle {
  return RUPTURE_STYLES[type as RuptureType] || RUPTURE_STYLES.unknown;
}

function RuptureCard({ rupture, onNavigate }: RuptureCardProps) {
  const [expanded, setExpanded] = useState(false);
  const style = getRuptureStyle(rupture.type);

  return (
    <div
      className={`braid-rupture ${expanded ? 'braid-rupture--expanded' : ''}`}
      style={{ '--rupture-color': style.color } as CSSProperties}
    >
      <div
        className="braid-rupture__header"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded(!expanded)}
      >
        <span className="braid-rupture__icon" style={{ color: style.color }}>
          {style.icon}
        </span>
        <span className="braid-rupture__type">{style.label}</span>
        <span className="braid-rupture__time">
          {formatRelativeTime(rupture.timestamp)}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className={`braid-rupture__expand-icon ${expanded ? 'braid-rupture__expand-icon--expanded' : ''}`}
        >
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {expanded && (
        <div className="braid-rupture__content">
          {rupture.marked_by && (
            <div className="braid-rupture__meta">
              <span className="braid-rupture__meta-label">Marked by:</span>
              <span className="braid-rupture__meta-value">{rupture.marked_by}</span>
            </div>
          )}

          {rupture.description && (
            <div className="braid-rupture__description">
              {rupture.description}
            </div>
          )}

          {rupture.context && (
            <div className="braid-rupture__context">
              <span className="braid-rupture__context-label">Context:</span>
              <blockquote className="braid-rupture__context-quote">
                {rupture.context}
              </blockquote>
            </div>
          )}

          {rupture.message_id && onNavigate && (
            <button
              className="braid-rupture__navigate"
              onClick={() => onNavigate(rupture.message_id!)}
              title="Jump to original message"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              View message
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * BraidRuptures - Main component.
 */
export function BraidRuptures({ ruptures = [], onNavigate }: BraidRupturesProps) {
  const hasRuptures = ruptures.length > 0;

  // Group by type for summary
  const typeCounts: Record<string, number> = {};
  for (const r of ruptures) {
    const type = r.type || 'unknown';
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  }

  return (
    <div className="braid-ruptures">
      <div className="braid-ruptures__header">
        <div className="braid-ruptures__header-left">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="braid-ruptures__icon">
            <path d="M9 1v6M9 11v6M1 9h6M11 9h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M3 3l4 4M11 11l4 4M15 3l-4 4M3 15l4-4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
          </svg>
          <span className="braid-ruptures__title">Commemorated Ruptures</span>
        </div>
        {hasRuptures && (
          <div className="braid-ruptures__summary">
            {Object.entries(typeCounts).map(([type, count]) => {
              const style = getRuptureStyle(type);
              return (
                <span
                  key={type}
                  className="braid-ruptures__type-count"
                  style={{ color: style.color }}
                  title={style.label}
                >
                  {count}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {!hasRuptures ? (
        <div className="braid-ruptures__empty">
          <span className="braid-ruptures__empty-text">
            No ruptures commemorated.
          </span>
          <span className="braid-ruptures__empty-hint">
            Ruptures mark moments of deliberate breaking from format or protocol.
          </span>
        </div>
      ) : (
        <div className="braid-ruptures__list">
          {ruptures.map((rupture, idx) => (
            <RuptureCard
              key={rupture.id || idx}
              rupture={rupture}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
