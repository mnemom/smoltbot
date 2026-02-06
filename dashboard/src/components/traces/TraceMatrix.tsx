/**
 * TraceMatrix - Wrapper around SSMVisualizer in matrix mode
 *
 * Displays an NxN self-similarity matrix showing trace-to-trace
 * similarity comparisons. Includes ThresholdSlider for interactive
 * threshold adjustment.
 */

import React, { useState, useMemo } from 'react';
import type { APTrace } from '../../lib/types/aap';
import { SSMVisualizer, type SSMMatrixData } from '../viz/SSMVisualizer';

export interface TraceMatrixProps {
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
  totalPairs,
}: {
  value: number;
  onChange: (value: number) => void;
  belowCount: number;
  totalPairs: number;
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
        {belowCount} of {totalPairs} pairs below
      </span>
    </div>
  );
}

/**
 * Compute similarity between two traces
 *
 * In a real implementation, this would use embedding similarity
 * or other semantic comparison. For now, we use a heuristic based
 * on shared values and action types.
 */
function computeTraceSimilarity(trace1: APTrace, trace2: APTrace): number {
  if (trace1.trace_id === trace2.trace_id) {
    return 1.0; // Self-similarity is always 1
  }

  let score = 0.5; // Base similarity

  // Same action type adds similarity
  if (trace1.action.type === trace2.action.type) {
    score += 0.15;
  }

  // Same action category adds similarity
  if (trace1.action.category === trace2.action.category) {
    score += 0.1;
  }

  // Shared values add similarity
  const values1 = new Set(trace1.decision.values_applied);
  const values2 = new Set(trace2.decision.values_applied);
  const sharedValues = [...values1].filter((v) => values2.has(v));
  const totalValues = new Set([...values1, ...values2]).size;
  if (totalValues > 0) {
    score += 0.15 * (sharedValues.length / totalValues);
  }

  // Similar confidence adds similarity
  const conf1 = trace1.decision.confidence ?? 0.5;
  const conf2 = trace2.decision.confidence ?? 0.5;
  score += 0.1 * (1 - Math.abs(conf1 - conf2));

  // Cap at 0.95 to avoid false perfect matches
  return Math.min(0.95, score);
}

/**
 * Convert traces to SSMMatrixData format
 *
 * Computes pairwise similarity between all traces.
 */
function tracesToMatrixData(traces: APTrace[]): SSMMatrixData {
  const n = traces.length;

  if (n === 0) {
    return {
      matrix: [],
      traceIds: [],
      size: 0,
    };
  }

  // Compute NxN similarity matrix
  const matrix: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      row.push(computeTraceSimilarity(traces[i], traces[j]));
    }
    matrix.push(row);
  }

  return {
    matrix,
    traceIds: traces.map((t) => t.trace_id),
    size: n,
  };
}

/**
 * Count pairs below threshold (excluding diagonal)
 */
function countBelowThreshold(matrix: number[][], threshold: number): number {
  let count = 0;
  const n = matrix.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (matrix[i][j] < threshold) {
        count++;
      }
    }
  }
  return count;
}

export function TraceMatrix({
  traces,
  threshold: initialThreshold = 0.3,
}: TraceMatrixProps): React.ReactElement {
  const [threshold, setThreshold] = useState(initialThreshold);

  // Convert traces to matrix data
  const matrixData = useMemo(() => tracesToMatrixData(traces), [traces]);

  // Count pairs below threshold
  const belowCount = useMemo(
    () => countBelowThreshold(matrixData.matrix, threshold),
    [matrixData.matrix, threshold]
  );

  // Total number of unique pairs (excluding diagonal)
  const totalPairs = (traces.length * (traces.length - 1)) / 2;

  // Compute matrix statistics
  const stats = useMemo(() => {
    if (matrixData.matrix.length === 0) {
      return { mean: 0, min: 0, max: 0 };
    }

    const values: number[] = [];
    const n = matrixData.matrix.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        values.push(matrixData.matrix[i][j]);
      }
    }

    if (values.length === 0) {
      return { mean: 1, min: 1, max: 1 };
    }

    return {
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }, [matrixData.matrix]);

  // Empty state
  if (traces.length === 0) {
    return (
      <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-8 text-center">
        <p className="text-[var(--color-text-muted)]">
          No traces available for matrix visualization.
        </p>
      </div>
    );
  }

  // Not enough traces for meaningful matrix
  if (traces.length < 2) {
    return (
      <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-8 text-center">
        <p className="text-[var(--color-text-muted)]">
          Need at least 2 traces for matrix visualization.
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
        totalPairs={totalPairs}
      />

      {/* Matrix Visualization */}
      <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-4 flex justify-center">
        <SSMVisualizer
          mode="matrix"
          matrixData={matrixData}
          threshold={threshold}
          options={{
            width: Math.min(500, Math.max(300, traces.length * 50)),
            height: Math.min(500, Math.max(300, traces.length * 50)),
            showLabels: traces.length <= 15,
            showGrid: traces.length <= 20,
          }}
        />
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-[var(--color-bg-elevated)] rounded-lg p-3">
          <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
            Matrix Size
          </p>
          <p className="text-lg font-medium text-[var(--color-text-primary)]">
            {traces.length} x {traces.length}
          </p>
        </div>
        <div className="bg-[var(--color-bg-elevated)] rounded-lg p-3">
          <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
            Mean Similarity
          </p>
          <p className="text-lg font-medium text-[var(--color-text-primary)]">
            {stats.mean.toFixed(3)}
          </p>
        </div>
        <div className="bg-[var(--color-bg-elevated)] rounded-lg p-3">
          <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
            Min Similarity
          </p>
          <p
            className={`text-lg font-medium ${
              stats.min < threshold
                ? 'text-red-400'
                : 'text-[var(--color-text-primary)]'
            }`}
          >
            {stats.min.toFixed(3)}
          </p>
        </div>
        <div className="bg-[var(--color-bg-elevated)] rounded-lg p-3">
          <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
            Max Similarity
          </p>
          <p className="text-lg font-medium text-[var(--color-text-primary)]">
            {stats.max.toFixed(3)}
          </p>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-sm text-[var(--color-text-muted)]">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ background: 'rgb(68, 1, 84)' }} />
          <span>0.0 (Dissimilar)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ background: 'rgb(32, 144, 140)' }} />
          <span>0.5</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ background: 'rgb(253, 231, 37)' }} />
          <span>1.0 (Similar)</span>
        </div>
      </div>

      {/* Warning if many pairs below threshold */}
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
              {belowCount} trace pair{belowCount !== 1 ? 's' : ''} below threshold
            </p>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              Low similarity between trace pairs may indicate behavioral
              inconsistency or divergent decision patterns. Cells with red
              borders in the matrix highlight these pairs.
            </p>
          </div>
        </div>
      )}

      {/* Interpretation guide */}
      <div className="p-4 bg-[var(--color-bg-elevated)] rounded-lg">
        <h4 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">
          Reading the Matrix
        </h4>
        <ul className="text-sm text-[var(--color-text-secondary)] space-y-1">
          <li>
            - The diagonal is always bright (self-similarity = 1.0)
          </li>
          <li>
            - Bright off-diagonal cells indicate consistent behavior across traces
          </li>
          <li>
            - Dark cells indicate traces with different behavioral patterns
          </li>
          <li>
            - Red borders highlight pairs below the threshold
          </li>
        </ul>
      </div>
    </div>
  );
}

export default TraceMatrix;
