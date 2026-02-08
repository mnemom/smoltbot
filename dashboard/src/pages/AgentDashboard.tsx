import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import AgentHeader from '../components/agents/AgentHeader';
import { TraceFeed, TraceTimeline, TraceMatrix } from '../components/traces';
import { getAgent, getAgentTraces, getIntegrity, getDrift, type Agent, type IntegrityScore, type DriftResult } from '../lib/api';
import type { APTrace } from '../lib/types/aap';

type ViewMode = 'feed' | 'timeline' | 'matrix';

export default function AgentDashboard() {
  const { uuid } = useParams<{ uuid: string }>();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [traces, setTraces] = useState<APTrace[]>([]);
  const [integrity, setIntegrity] = useState<IntegrityScore | null>(null);
  const [drift, setDrift] = useState<DriftResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('feed');
  const [threshold] = useState(0.3);

  useEffect(() => {
    const fetchAgent = async () => {
      setLoading(true);
      setError(null);

      try {
        if (uuid) {
          const [agentData, traceData, integrityData, driftData] = await Promise.all([
            getAgent(uuid),
            getAgentTraces(uuid, 100),
            getIntegrity(uuid),
            getDrift(uuid),
          ]);
          setAgent(agentData);
          setTraces(traceData);
          setIntegrity(integrityData);
          setDrift(driftData);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load agent');
      }

      setLoading(false);
    };

    if (uuid) {
      fetchAgent();
    }
  }, [uuid]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12">
        <div className="animate-pulse">
          <div className="h-40 bg-[var(--color-bg-card)] rounded-lg mb-8" />
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-[var(--color-bg-card)] rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-4">
          Agent Not Found
        </h1>
        <p className="text-[var(--color-text-secondary)] mb-6">
          {error || "The agent you're looking for doesn't exist or has been removed."}
        </p>
        <Link to="/" className="text-[var(--color-accent)] hover:underline">
          Back to home
        </Link>
      </div>
    );
  }

  const hasDrift = drift && drift.drift.length > 0;

  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      {/* Agent Header */}
      <AgentHeader agent={agent} />

      {/* Drift Alerts */}
      {hasDrift && (
        <div className="mt-6 space-y-3">
          {drift.drift.map((alert, i) => {
            const severity = alert.analysis.similarity_score < 0.3 ? 'high'
              : alert.analysis.similarity_score < 0.5 ? 'medium' : 'low';
            const borderColor = severity === 'high' ? 'border-red-500/50'
              : severity === 'medium' ? 'border-amber-500/50' : 'border-yellow-500/50';
            const bgColor = severity === 'high' ? 'bg-red-500/10'
              : severity === 'medium' ? 'bg-amber-500/10' : 'bg-yellow-500/10';
            const textColor = severity === 'high' ? 'text-red-400'
              : severity === 'medium' ? 'text-amber-400' : 'text-yellow-400';

            return (
              <div key={i} className={`${bgColor} border ${borderColor} rounded-lg p-4`}>
                <div className="flex items-start gap-3">
                  <svg className={`w-5 h-5 ${textColor} mt-0.5 shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-sm font-medium ${textColor}`}>
                        Behavioral Drift Detected
                      </span>
                      <span className={`px-1.5 py-0.5 text-xs rounded ${bgColor} ${textColor} border ${borderColor}`}>
                        {severity}
                      </span>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        Direction: {alert.analysis.drift_direction}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      {alert.recommendation}
                    </p>
                    <div className="mt-2 flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
                      <span>Similarity: {(alert.analysis.similarity_score * 100).toFixed(0)}%</span>
                      <span>{alert.trace_ids.length} traces involved</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Integrity Score Card */}
      <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-6 mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            Integrity Score
          </h2>
          <span className={`text-2xl font-bold ${
            integrity && integrity.violations > 0
              ? 'text-amber-400'
              : 'text-[var(--color-success)]'
          }`}>
            {integrity ? `${Math.round(integrity.score * 100)}%` : '\u2014'}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 bg-[var(--color-bg-elevated)] rounded-lg">
            <p className="text-lg font-semibold text-[var(--color-text-primary)]">
              {integrity?.totalTraces || traces.length}
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">Total Traces</p>
          </div>
          <div className="text-center p-4 bg-[var(--color-bg-elevated)] rounded-lg">
            <p className="text-lg font-semibold text-[var(--color-text-primary)]">
              {integrity?.verifiedTraces || traces.length}
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">Verified</p>
          </div>
          <div className={`text-center p-4 rounded-lg ${
            integrity && integrity.violations > 0
              ? 'bg-red-500/10 border border-red-500/30'
              : 'bg-[var(--color-bg-elevated)]'
          }`}>
            <p className={`text-lg font-semibold ${
              integrity && integrity.violations > 0
                ? 'text-red-400'
                : 'text-[var(--color-text-primary)]'
            }`}>
              {integrity?.violations ?? 0}
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">Violations</p>
          </div>
        </div>
      </div>

      {/* Visualization Section */}
      <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg mt-8 overflow-hidden">
        {/* View Mode Tabs */}
        <div className="flex border-b border-[var(--color-border)]">
          {[
            { id: 'feed', label: 'Trace Feed' },
            { id: 'timeline', label: 'Timeline' },
            { id: 'matrix', label: 'Matrix' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setViewMode(tab.id as ViewMode)}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                viewMode === tab.id
                  ? 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] border-b-2 border-[var(--color-accent)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]/50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* View Content */}
        <div className="p-6">
          {viewMode === 'feed' && (
            <TraceFeed agentId={uuid || ''} limit={20} />
          )}

          {viewMode === 'timeline' && (
            <TraceTimeline traces={traces} threshold={threshold} />
          )}

          {viewMode === 'matrix' && (
            <TraceMatrix traces={traces} threshold={threshold} />
          )}
        </div>
      </div>

      {/* Claim CTA (if not claimed) */}
      {!agent.claimed && (
        <div className="mt-8 p-6 bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/30 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                Is this your agent?
              </h3>
              <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                Claim ownership to customize your alignment card and settings.
              </p>
            </div>
            <Link
              to={`/claim/${uuid}`}
              className="px-4 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white font-medium rounded-lg transition-colors"
            >
              Claim Agent
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
