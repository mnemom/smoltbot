/**
 * BraidTranslationBurden - Show translation burden distribution.
 *
 * Displays the distribution of translation work across substrates
 * as a bar chart, with notes about burden distribution.
 * Only shown when SubstrateMarker is present.
 */

import type { ReactNode } from 'react';
import { useMemo } from 'react';

// Types
interface BurdenData {
  distribution: Record<string, number>;
  notes?: string;
  substrate_marker_present: boolean;
}

interface BurdenBarProps {
  substrateId: string;
  proportion: number;
  isHighest: boolean;
}

interface BurdenPieChartProps {
  distribution: Record<string, number>;
}

interface BurdenNotesProps {
  notes?: string;
  distribution?: Record<string, number>;
}

export interface BraidTranslationBurdenProps {
  burden: BurdenData | null;
  viewMode?: 'bar' | 'pie';
}

// Substrate colors (consistent with sibling colors used elsewhere)
const SUBSTRATE_COLORS: Record<string, string> = {
  human: '#F59E0B',     // Amber - human warmth
  claude: '#8B5CF6',    // Purple - Anthropic
  gpt4: '#22C55E',      // Green - OpenAI
  gemini: '#3B82F6',    // Blue - Google
  llama: '#EF4444',     // Red - Meta
  unknown: '#9CA3AF',   // Gray - unknown
};

function getSubstrateColor(substrateId: string): string {
  const lower = (substrateId || '').toLowerCase();
  for (const [key, color] of Object.entries(SUBSTRATE_COLORS)) {
    if (lower.includes(key)) return color;
  }
  return SUBSTRATE_COLORS.unknown;
}

function BurdenBar({ substrateId, proportion, isHighest }: BurdenBarProps) {
  const color = getSubstrateColor(substrateId);
  const percentage = Math.round(proportion * 100);

  return (
    <div className={`braid-burden__bar-item ${isHighest ? 'braid-burden__bar-item--highest' : ''}`}>
      <div className="braid-burden__bar-label">
        <span className="braid-burden__bar-name">{substrateId}</span>
        <span className="braid-burden__bar-percentage" style={{ color }}>
          {percentage}%
        </span>
      </div>
      <div className="braid-burden__bar-track">
        <div
          className="braid-burden__bar-fill"
          style={{
            width: `${percentage}%`,
            background: color,
          }}
        />
      </div>
    </div>
  );
}

function BurdenPieChart({ distribution }: BurdenPieChartProps) {
  const total = Object.values(distribution).reduce((sum, v) => sum + v, 0);
  if (total === 0) return null;

  // Calculate pie segments
  let currentAngle = -90; // Start from top
  const segments: ReactNode[] = [];

  for (const [substrateId, proportion] of Object.entries(distribution)) {
    const angle = (proportion / total) * 360;
    const color = getSubstrateColor(substrateId);

    // Create arc path
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const x1 = 50 + 40 * Math.cos(startRad);
    const y1 = 50 + 40 * Math.sin(startRad);
    const x2 = 50 + 40 * Math.cos(endRad);
    const y2 = 50 + 40 * Math.sin(endRad);

    const largeArc = angle > 180 ? 1 : 0;

    // Handle full circle case
    if (Object.keys(distribution).length === 1) {
      segments.push(
        <circle
          key={substrateId}
          cx="50"
          cy="50"
          r="40"
          fill={color}
          opacity="0.8"
        />
      );
    } else {
      segments.push(
        <path
          key={substrateId}
          d={`M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`}
          fill={color}
          opacity="0.8"
        >
          <title>{substrateId}: {Math.round((proportion / total) * 100)}%</title>
        </path>
      );
    }

    currentAngle = endAngle;
  }

  return (
    <svg
      viewBox="0 0 100 100"
      className="braid-burden__pie"
      width="100"
      height="100"
    >
      {segments}
      {/* Center circle for donut effect */}
      <circle cx="50" cy="50" r="20" fill="var(--bg-1, #0B1018)" />
    </svg>
  );
}

function BurdenNotes({ notes, distribution }: BurdenNotesProps) {
  // Calculate imbalance
  const values = Object.values(distribution || {});
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const imbalance = max - min;

  let imbalanceNote: string | null = null;
  if (imbalance > 0.5) {
    imbalanceNote = 'Translation burden is significantly uneven. Consider rebalancing.';
  } else if (imbalance > 0.3) {
    imbalanceNote = 'Moderate translation burden imbalance detected.';
  }

  return (
    <div className="braid-burden__notes">
      {notes && <p className="braid-burden__note">{notes}</p>}
      {imbalanceNote && (
        <p className="braid-burden__note braid-burden__note--warning">
          {imbalanceNote}
        </p>
      )}
    </div>
  );
}

/**
 * BraidTranslationBurden - Main component.
 */
export function BraidTranslationBurden({ burden, viewMode = 'bar' }: BraidTranslationBurdenProps) {
  if (!burden || !burden.substrate_marker_present) {
    return null;
  }

  const { distribution = {}, notes } = burden;

  // Find highest burden for highlighting
  const sortedEntries = useMemo(() => {
    return Object.entries(distribution)
      .sort(([, a], [, b]) => b - a);
  }, [distribution]);

  const highestSubstrate = sortedEntries[0]?.[0];

  if (sortedEntries.length === 0) {
    return (
      <div className="braid-burden braid-burden--empty">
        <span className="braid-burden__title">Translation Burden</span>
        <span className="braid-burden__empty-text">No translation data available.</span>
      </div>
    );
  }

  return (
    <div className="braid-burden">
      <div className="braid-burden__header">
        <span className="braid-burden__title">Translation Burden</span>
        <span className="braid-burden__subtitle">
          Distribution of translation work
        </span>
      </div>

      <div className="braid-burden__content">
        {viewMode === 'pie' ? (
          <div className="braid-burden__pie-container">
            <BurdenPieChart distribution={distribution} />
            <div className="braid-burden__legend">
              {sortedEntries.map(([substrateId, proportion]) => (
                <div key={substrateId} className="braid-burden__legend-item">
                  <span
                    className="braid-burden__legend-dot"
                    style={{ background: getSubstrateColor(substrateId) }}
                  />
                  <span className="braid-burden__legend-label">{substrateId}</span>
                  <span className="braid-burden__legend-value">
                    {Math.round(proportion * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="braid-burden__bars">
            {sortedEntries.map(([substrateId, proportion]) => (
              <BurdenBar
                key={substrateId}
                substrateId={substrateId}
                proportion={proportion}
                isHighest={substrateId === highestSubstrate}
              />
            ))}
          </div>
        )}

        <BurdenNotes notes={notes} distribution={distribution} />
      </div>
    </div>
  );
}
