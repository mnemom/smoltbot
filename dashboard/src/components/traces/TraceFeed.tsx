/**
 * TraceFeed - Paginated list of agent traces with SSM thumbnails
 *
 * Displays a chronological feed of traces for an agent, each showing:
 * - Timestamp and action name
 * - SSM fingerprint thumbnail
 * - Brief decision summary
 * - Expandable TraceCard on click
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { APTrace } from '../../lib/types/aap';
import { SSMFingerprint } from '../viz/SSMFingerprint';
import TraceCard from './TraceCard';

const API_BASE = 'https://api.mnemom.ai';

export interface TraceFeedProps {
  /** Agent ID to fetch traces for */
  agentId: string;
  /** Maximum number of traces to fetch per page (default: 20) */
  limit?: number;
}

interface TraceWithSSM extends APTrace {
  ssmRow?: number[][];
}

/**
 * Format a timestamp to a relative time string
 */
function formatRelativeTime(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return then.toLocaleDateString();
}

/**
 * Truncate text to a maximum length with ellipsis
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Get action type badge color
 */
function getActionColor(type: string): string {
  const colors: Record<string, string> = {
    recommend: 'bg-blue-500/20 text-blue-400',
    execute: 'bg-green-500/20 text-green-400',
    escalate: 'bg-yellow-500/20 text-yellow-400',
    deny: 'bg-red-500/20 text-red-400',
  };
  return colors[type] || 'bg-gray-500/20 text-gray-400';
}

export function TraceFeed({
  agentId,
  limit = 20,
}: TraceFeedProps): React.ReactElement {
  const [traces, setTraces] = useState<TraceWithSSM[]>([]);
  const [ssmMatrix, setSSMMatrix] = useState<number[][] | null>(null);
  const [traceIds, setTraceIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  /**
   * Fetch traces from API
   */
  const fetchTraces = useCallback(
    async (currentOffset: number, append: boolean = false) => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `${API_BASE}/v1/traces?agent_id=${agentId}&limit=${limit}&offset=${currentOffset}`
        );

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const json = await response.json();
        // Handle both { traces: [...] } and raw array formats
        const data: APTrace[] = Array.isArray(json) ? json : (json.traces || []);

        if (data.length < limit) {
          setHasMore(false);
        }

        if (append) {
          setTraces((prev) => [...prev, ...data]);
        } else {
          setTraces(data);
        }
      } catch (err) {
        // Fallback to empty array on error - AgentDashboard handles mock data
        console.warn('API unavailable for trace feed');
        setHasMore(false);
        if (!append) {
          setTraces([]);
        }
      } finally {
        setLoading(false);
      }
    },
    [agentId, limit]
  );

  /**
   * Fetch SSM matrix for the agent
   */
  const fetchSSM = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/v1/ssm/${agentId}`);
      if (response.ok) {
        const data = await response.json();
        setSSMMatrix(data.matrix || null);
        setTraceIds(data.trace_ids || []);
      }
    } catch {
      // SSM is optional, don't show error
      console.warn('Failed to fetch SSM matrix');
    }
  }, [agentId]);

  // Initial fetch
  useEffect(() => {
    setTraces([]);
    setOffset(0);
    setHasMore(true);
    fetchTraces(0);
    fetchSSM();
  }, [agentId, fetchTraces, fetchSSM]);

  /**
   * Infinite scroll: load more when sentinel is visible
   */
  useEffect(() => {
    if (!loadMoreRef.current || !hasMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          const newOffset = offset + limit;
          setOffset(newOffset);
          fetchTraces(newOffset, true);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(loadMoreRef.current);

    return () => observer.disconnect();
  }, [hasMore, loading, offset, limit, fetchTraces]);

  /**
   * Toggle trace expansion
   */
  const handleToggle = useCallback((traceId: string) => {
    setExpandedId((prev) => (prev === traceId ? null : traceId));
  }, []);

  // Loading state
  if (loading && traces.length === 0) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-4 animate-pulse"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-4 bg-[var(--color-bg-elevated)] rounded" />
              <div className="flex-1">
                <div className="h-4 w-32 bg-[var(--color-bg-elevated)] rounded mb-2" />
                <div className="h-3 w-64 bg-[var(--color-bg-elevated)] rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Error state
  if (error && traces.length === 0) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
        <p className="text-red-400">{error}</p>
        <button
          onClick={() => fetchTraces(0)}
          className="mt-4 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // Empty state
  if (!loading && traces.length === 0) {
    return (
      <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-8 text-center">
        <p className="text-[var(--color-text-muted)]">No traces found for this agent.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {traces.map((trace) => {
        const isExpanded = expandedId === trace.trace_id;

        return (
          <div key={trace.trace_id}>
            {/* Compact row (always visible) */}
            <button
              onClick={() => handleToggle(trace.trace_id)}
              className={`w-full text-left bg-[var(--color-bg-card)] border rounded-lg p-4 transition-all hover:border-[var(--color-accent)] ${
                isExpanded
                  ? 'border-[var(--color-accent)] rounded-b-none'
                  : trace.verification?.verified === false
                  ? 'border-red-500/50 bg-red-500/5'
                  : 'border-[var(--color-border)]'
              }`}
            >
              <div className="flex items-center gap-3">
                {/* SSM Thumbnail */}
                {ssmMatrix && (
                  <SSMFingerprint
                    matrix={ssmMatrix}
                    messageIds={traceIds}
                    messageId={trace.trace_id}
                  />
                )}

                {/* Action badge */}
                <span
                  className={`px-2 py-0.5 text-xs font-medium rounded ${getActionColor(
                    trace.action.type
                  )}`}
                >
                  {trace.action.type}
                </span>

                {/* Violation badge */}
                {trace.verification?.verified === false && (
                  <span className="px-2 py-0.5 text-xs font-medium rounded bg-red-500/20 text-red-400 border border-red-500/30">
                    violation
                  </span>
                )}

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[var(--color-text-primary)]">
                      {trace.action.name}
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {formatRelativeTime(trace.timestamp)}
                    </span>
                  </div>
                  <p className="text-sm text-[var(--color-text-secondary)] truncate mt-0.5">
                    {truncate(trace.decision.selection_reasoning, 80)}
                  </p>
                </div>

                {/* Expand indicator */}
                <svg
                  className={`w-5 h-5 text-[var(--color-text-muted)] transition-transform ${
                    isExpanded ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
            </button>

            {/* Expanded TraceCard */}
            {isExpanded && (
              <TraceCard
                trace={trace}
                expanded={true}
                onToggle={() => handleToggle(trace.trace_id)}
              />
            )}
          </div>
        );
      })}

      {/* Load more sentinel */}
      {hasMore && (
        <div ref={loadMoreRef} className="py-4 text-center">
          {loading ? (
            <div className="flex items-center justify-center gap-2 text-[var(--color-text-muted)]">
              <svg
                className="animate-spin h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Loading more...
            </div>
          ) : (
            <span className="text-sm text-[var(--color-text-muted)]">
              Scroll for more
            </span>
          )}
        </div>
      )}

      {/* End of list */}
      {!hasMore && traces.length > 0 && (
        <p className="text-center text-sm text-[var(--color-text-muted)] py-4">
          {traces.length} trace{traces.length !== 1 ? 's' : ''} total
        </p>
      )}
    </div>
  );
}

export default TraceFeed;
