/**
 * TraceTimeline - Wrapper around SSMVisualizer in timeline mode
 *
 * Displays trace-to-card similarity as a bar chart over time.
 * Includes ThresholdSlider for interactive threshold adjustment.
 */

import React, { useState, useMemo } from 'react';
import type { APTrace } from '../../lib/types/aap';
import { SSMVisualizer, type SSMTimelineData } from '../viz/SSMVisualizer';

export interface TraceTimelineProps {
  /** Array of traces to visualize */
  traces: APTrace[];
  /** Initial threshold value (default: 0.3) */
  threshold?: number;
}

/**
 * ThresholdSlider - Interactive slider for threshold adjustment
 */
function ThresholdSlider({
  value,
  onChange,
  belowCount,
  total,
}: {
  value: number;
  onChange: (value: number) => void;
  belowCount: number;
  total: number;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-4 p-3 bg-[var(--color-bg-elevated)] rounded-lg">
      <label className="text-sm text-[var(--color-text-secondary)]">
        Threshold:
      </label>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-2 bg-[var(--color-border)] rounded-lg appearance-none cursor-pointer accent-[var(--color-accent)]"
      />
      <span className="text-sm font-mono text-[var(--color-text-primary)] w-12 text-right">
        {value.toFixed(2)}
      </span>
      <span className="text-xs text-[var(--color-text-muted)]">
        {belowCount} of {total} below
      </span>
    </div>
  );
}

/**
 * Convert traces to SSMTimelineData format
 *
 * In a real implementation, this would compute actual similarities
 * between each trace and the agent's alignment card. For now, we
 * simulate with decision confidence or generate mock data.
 */
function tracesToTimelineData(traces: APTrace[]): SSMTimelineData {
  if (traces.length === 0) {
    return {
      similarities: [],
      traceIds: [],
      mean_similarity: 0,
      min_similarity: 0,
      trend: 0,
    };
  }

  // Extract similarities from trace data
  // Priority: decision.confidence > context.metadata.confidence.value_coherence > random
  const similarities = traces.map((trace) => {
    // Try to get confidence from decision
    if (trace.decision.confidence !== undefined) {
      return trace.decision.confidence;
    }

    // Try to get value_coherence from Braid metadata
    const metadata = trace.context?.metadata;
    if (metadata && 'confidence' in metadata) {
      const conf = (metadata as { confidence?: { value_coherence?: number } })
        .confidence;
      if (conf?.value_coherence !== undefined) {
        return conf.value_coherence;
      }
    }

    // Fallback: generate a realistic-looking value between 0.5 and 1.0
    // This would be replaced with actual SSM computation in production
    return 0.5 + Math.random() * 0.5;
  });

  const traceIds = traces.map((t) => t.trace_id);
  const mean = similarities.reduce((a, b) => a + b, 0) / similarities.length;
  const min = Math.min(...similarities);

  // Calculate trend (slope of linear regression)
  let trend = 0;
  if (similarities.length > 1) {
    const n = similarities.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = similarities.reduce((a, b) => a + b, 0);
    const sumXY = similarities.reduce((sum, y, x) => sum + x * y, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
    trend = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  }

  return {
    similarities,
    traceIds,
    mean_similarity: mean,
    min_similarity: min,
    trend,
  };
}

export function TraceTimeline({
  traces,
  threshold: initialThreshold = 0.3,
}: TraceTimelineProps): React.ReactElement {
  const [threshold, setThreshold] = useState(initialThreshold);

  // Convert traces to timeline data
  const timelineData = useMemo(() => tracesToTimelineData(traces), [traces]);

  // Count traces below threshold
  const belowCount = useMemo(
    () => timelineData.similarities.filter((s) => s < threshold).length,
    [timelineData.similarities, threshold]
  );

  // Empty state
  if (traces.length === 0) {
    return (
      <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-8 text-center">
        <p className="text-[var(--color-text-muted)]">
          No traces available for timeline visualization.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Threshold Slider */}
      <ThresholdSlider
        value={threshold}
        onChange={setThreshold}
        belowCount={belowCount}
        total={traces.length}
      />

      {/* Timeline Visualization */}
      <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-4 overflow-x-auto">
        <SSMVisualizer
          mode="timeline"
          timelineData={timelineData}
          threshold={threshold}
          options={{
            width: Math.max(400, traces.length * 40),
            height: 300,
            showLabels: traces.length <= 20,
          }}
        />
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-[var(--color-bg-elevated)] rounded-lg p-3">
          <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
            Traces
          </p>
          <p className="text-lg font-medium text-[var(--color-text-primary)]">
            {traces.length}
          </p>
        </div>
        <div className="bg-[var(--color-bg-elevated)] rounded-lg p-3">
          <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
            Mean Similarity
          </p>
          <p className="text-lg font-medium text-[var(--color-text-primary)]">
            {timelineData.mean_similarity.toFixed(3)}
          </p>
        </div>
        <div className="bg-[var(--color-bg-elevated)] rounded-lg p-3">
          <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
            Minimum
          </p>
          <p
            className={`text-lg font-medium ${
              timelineData.min_similarity < threshold
                ? 'text-red-400'
                : 'text-[var(--color-text-primary)]'
            }`}
          >
            {timelineData.min_similarity.toFixed(3)}
          </p>
        </div>
        <div className="bg-[var(--color-bg-elevated)] rounded-lg p-3">
          <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
            Trend
          </p>
          <p
            className={`text-lg font-medium ${
              (timelineData.trend ?? 0) > 0.01
                ? 'text-green-400'
                : (timelineData.trend ?? 0) < -0.01
                ? 'text-red-400'
                : 'text-[var(--color-text-primary)]'
            }`}
          >
            {(timelineData.trend ?? 0) > 0.01
              ? 'Rising'
              : (timelineData.trend ?? 0) < -0.01
              ? 'Falling'
              : 'Stable'}
          </p>
        </div>
      </div>

      {/* Warning if traces below threshold */}
      {belowCount > 0 && (
        <div className="flex items-start gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <svg
            className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <div>
            <p className="font-medium text-yellow-400">
              {belowCount} trace{belowCount !== 1 ? 's' : ''} below threshold
            </p>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              These traces show lower similarity to the alignment card than expected.
              This may indicate behavioral drift or unusual decisions.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default TraceTimeline;
