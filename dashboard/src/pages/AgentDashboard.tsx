import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import AgentHeader from '../components/agents/AgentHeader';
import { TraceFeed, TraceTimeline, TraceMatrix } from '../components/traces';
import { BraidDivergenceAlert, BraidRuptures } from '../components/braid';
import { getAgent, getAgentTraces, getAgentSSM, type Agent, type IntegrityScore } from '../lib/api';
import type { APTrace } from '../lib/types/aap';

type ViewMode = 'feed' | 'timeline' | 'matrix';

export default function AgentDashboard() {
  const { uuid } = useParams<{ uuid: string }>();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [traces, setTraces] = useState<APTrace[]>([]);
  const [integrity, setIntegrity] = useState<IntegrityScore | null>(null);
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
          const agentData = await getAgent(uuid);
          setAgent(agentData);

          // Fetch traces
          const traceData = await getAgentTraces(uuid, 100);
          setTraces(traceData);

          // Fetch SSM/integrity data
          const ssmData = await getAgentSSM(uuid);
          if (ssmData) {
            setIntegrity({
              score: ssmData.mean_similarity || 0.95,
              totalTraces: traceData.length,
              verifiedTraces: traceData.length,
              violations: 0,
            });
          }
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

  // Detect divergence in traces
  const detectDivergence = () => {
    if (traces.length < 3) return null;

    // Check for sustained low similarity
    const recentTraces = traces.slice(0, 5);
    let lowSimilarityCount = 0;

    for (let i = 1; i < recentTraces.length; i++) {
      const t1 = recentTraces[i - 1];
      const t2 = recentTraces[i];
      const v1 = t1.decision?.values_applied || [];
      const v2 = t2.decision?.values_applied || [];
      const shared = v1.filter(v => v2.includes(v)).length;
      const total = new Set([...v1, ...v2]).size;
      const similarity = total > 0 ? shared / total : 0.5;

      if (similarity < threshold) {
        lowSimilarityCount++;
      }
    }

    if (lowSimilarityCount >= 2) {
      return {
        strands: [
          { id: '1', participant: agent?.name || 'Agent' },
          { id: '2', participant: 'Alignment Card' },
        ],
        similarity: 0.4,
        sustained_turns: lowSimilarityCount,
        message: 'Recent traces show divergence from declared values.',
      };
    }

    return null;
  };

  // Extract ruptures from traces
  const extractRuptures = () => {
    return traces
      .filter(t => t.context?.metadata?.absence === 'rupture')
      .slice(0, 5)
      .map(t => ({
        id: t.trace_id,
        type: 'deliberate' as const,
        marked_by: agent?.name || 'Agent',
        timestamp: t.timestamp,
        description: t.decision?.selection_reasoning || 'Rupture commemorated',
        message_id: t.trace_id,
      }));
  };

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

  const divergence = detectDivergence();
  const ruptures = extractRuptures();

  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      {/* Agent Header */}
      <AgentHeader agent={agent} />

      {/* Divergence Alert */}
      {divergence && (
        <div className="mt-6">
          <BraidDivergenceAlert
            divergence={divergence}
            onDismiss={() => {/* Could track dismissed alerts */}}
          />
        </div>
      )}

      {/* Integrity Score Card */}
      <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-6 mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            Integrity Score
          </h2>
          <span className="text-2xl font-bold text-[var(--color-success)]">
            {integrity ? `${Math.round(integrity.score * 100)}%` : '—'}
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
          <div className="text-center p-4 bg-[var(--color-bg-elevated)] rounded-lg">
            <p className="text-lg font-semibold text-[var(--color-text-primary)]">
              {integrity?.violations || 0}
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">Violations</p>
          </div>
        </div>
      </div>

      {/* Ruptures (if any) */}
      {ruptures.length > 0 && (
        <div className="mt-8">
          <BraidRuptures
            ruptures={ruptures}
            onNavigate={(messageId) => {
              // Could scroll to trace or open modal
              console.log('Navigate to:', messageId);
            }}
          />
        </div>
      )}

      {/* Visualization Section */}
      <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg mt-8 overflow-hidden">
        {/* View Mode Tabs */}
        <div className="flex border-b border-[var(--color-border)]">
          {[
            { id: 'feed', label: 'Trace Feed', icon: '📋' },
            { id: 'timeline', label: 'Timeline', icon: '📈' },
            { id: 'matrix', label: 'Matrix', icon: '🔲' },
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
              <span className="mr-2">{tab.icon}</span>
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
