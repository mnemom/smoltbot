/**
 * BraidPerformatives - Display custom performatives with adoption counts.
 *
 * Shows both built-in and custom performatives, their adoption statistics,
 * and who has adopted each. Can poll data or receive via props.
 */

import { useState, useEffect } from 'react';

// Types
interface BuiltinPerformative {
  description: string;
  color: string;
}

interface Performative {
  name: string;
  description?: string;
  adoption_count?: number;
  adopters?: string[];
  is_custom?: boolean;
}

interface ProcessedPerformative extends Performative {
  color: string;
}

interface PerformativeItemProps {
  name: string;
  isBuiltin: boolean;
  description?: string;
  color: string;
  adoptionCount: number;
  adopters?: string[];
}

export interface BraidPerformativesProps {
  performatives?: Performative[];
  onPoll?: () => void;
  pollInterval?: number;
}

// Built-in performatives with their canonical colors
const BUILTIN_PERFORMATIVES: Record<string, BuiltinPerformative> = {
  inform:    { description: 'Share information', color: '#4DA3FF' },
  propose:   { description: 'Suggest a course of action', color: '#8B5CF6' },
  challenge: { description: 'Question or contest', color: '#EF4444' },
  affirm:    { description: 'Express agreement', color: '#22C55E' },
  wonder:    { description: 'Express curiosity', color: '#06B6D4' },
  weave:     { description: 'Connect disparate threads', color: '#D946EF' },
  request:   { description: 'Ask for something', color: '#FBBF24' },
  commit:    { description: 'Make a commitment', color: '#22C55E' },
  remember:  { description: 'Reference past context', color: '#9CA3AF' },
};

// Compute a stable hash color for custom performatives
function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash % 360);
  return `hsl(${h}, 60%, 55%)`;
}

function PerformativeItem({ name, isBuiltin, description, color, adoptionCount, adopters }: PerformativeItemProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`braid-performative-item ${isBuiltin ? 'braid-performative-item--builtin' : 'braid-performative-item--custom'}`}
      onClick={() => adopters && adopters.length > 0 && setExpanded(!expanded)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && adopters && adopters.length > 0 && setExpanded(!expanded)}
    >
      <div className="braid-performative-item__header">
        <span
          className="braid-performative-item__badge"
          style={{
            background: `${color}22`,
            color: color,
            borderColor: `${color}44`,
          }}
        >
          {name}
        </span>

        {!isBuiltin && (
          <span className="braid-performative-item__custom-tag">custom</span>
        )}

        <span className="braid-performative-item__count" title="Adoption count">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="4" r="2" stroke="currentColor" strokeWidth="1" opacity="0.7" />
            <path d="M2 10c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth="1" opacity="0.7" />
          </svg>
          {adoptionCount}
        </span>
      </div>

      {description && (
        <div className="braid-performative-item__description">
          {description}
        </div>
      )}

      {expanded && adopters && adopters.length > 0 && (
        <div className="braid-performative-item__adopters">
          <span className="braid-performative-item__adopters-label">Adopted by:</span>
          <div className="braid-performative-item__adopters-list">
            {adopters.map((adopter, idx) => (
              <span key={idx} className="braid-performative-item__adopter">
                {adopter}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * BraidPerformatives - Main component.
 */
export function BraidPerformatives({ performatives = [], onPoll, pollInterval }: BraidPerformativesProps) {
  // Auto-poll if interval is set
  useEffect(() => {
    if (onPoll && pollInterval && pollInterval > 0) {
      const interval = setInterval(onPoll, pollInterval);
      return () => clearInterval(interval);
    }
  }, [onPoll, pollInterval]);

  // Separate built-in and custom performatives
  const builtin: ProcessedPerformative[] = [];
  const custom: ProcessedPerformative[] = [];

  for (const perf of performatives) {
    const isBuiltin = !perf.is_custom && BUILTIN_PERFORMATIVES[perf.name];
    if (isBuiltin) {
      builtin.push({
        ...perf,
        description: perf.description || BUILTIN_PERFORMATIVES[perf.name].description,
        color: BUILTIN_PERFORMATIVES[perf.name].color,
      });
    } else {
      custom.push({
        ...perf,
        color: hashColor(perf.name),
      });
    }
  }

  // Sort by adoption count (descending)
  builtin.sort((a, b) => (b.adoption_count || 0) - (a.adoption_count || 0));
  custom.sort((a, b) => (b.adoption_count || 0) - (a.adoption_count || 0));

  const hasPerformatives = builtin.length > 0 || custom.length > 0;

  return (
    <div className="braid-performatives">
      <div className="braid-performatives__header">
        <span className="braid-performatives__title">Performatives</span>
        {onPoll && (
          <button
            className="braid-performatives__refresh"
            onClick={onPoll}
            title="Refresh performatives"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M2 7a5 5 0 019.33-2.5M12 7a5 5 0 01-9.33 2.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <path d="M11 2v3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 12V9h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      {!hasPerformatives ? (
        <div className="braid-performatives__empty">
          No performatives recorded yet.
        </div>
      ) : (
        <div className="braid-performatives__content">
          {builtin.length > 0 && (
            <div className="braid-performatives__section">
              <div className="braid-performatives__section-label">Built-in</div>
              <div className="braid-performatives__list">
                {builtin.map((perf) => (
                  <PerformativeItem
                    key={perf.name}
                    name={perf.name}
                    isBuiltin={true}
                    description={perf.description}
                    color={perf.color}
                    adoptionCount={perf.adoption_count || 0}
                    adopters={perf.adopters}
                  />
                ))}
              </div>
            </div>
          )}

          {custom.length > 0 && (
            <div className="braid-performatives__section">
              <div className="braid-performatives__section-label">Custom</div>
              <div className="braid-performatives__list">
                {custom.map((perf) => (
                  <PerformativeItem
                    key={perf.name}
                    name={perf.name}
                    isBuiltin={false}
                    description={perf.description}
                    color={perf.color}
                    adoptionCount={perf.adoption_count || 0}
                    adopters={perf.adopters}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
