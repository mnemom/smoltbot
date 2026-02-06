import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import AgentHeader from '../components/agents/AgentHeader';
import { mockAgent, mockTraces, type Agent, type Trace } from '../lib/api';

export default function AgentDashboard() {
  const { uuid } = useParams<{ uuid: string }>();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAgent = async () => {
      setLoading(true);
      setError(null);

      // TODO: Replace with actual API calls
      // const agentData = await getAgent(uuid);
      // const tracesData = await getTraces(uuid);
      await new Promise((resolve) => setTimeout(resolve, 500));

      // For now, show mock data for any UUID or Hunter's specific ID
      if (uuid === mockAgent.id || uuid) {
        setAgent({ ...mockAgent, id: uuid || mockAgent.id });
        setTraces(mockTraces);
      } else {
        setError('Agent not found');
      }

      setLoading(false);
    };

    if (uuid) {
      fetchAgent();
    }
  }, [uuid]);

  const getTraceIcon = (type: Trace['type']) => {
    switch (type) {
      case 'thought':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        );
      case 'decision':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'action':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        );
      case 'observation':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        );
    }
  };

  const getTraceColor = (type: Trace['type']) => {
    switch (type) {
      case 'thought':
        return 'text-orange-400 bg-orange-500/10';
      case 'decision':
        return 'text-green-400 bg-green-500/10';
      case 'action':
        return 'text-amber-400 bg-amber-500/10';
      case 'observation':
        return 'text-amber-400 bg-amber-500/10';
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12">
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
          The agent you're looking for doesn't exist or has been removed.
        </p>
        <Link to="/" className="text-[var(--color-accent)] hover:underline">
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      {/* Agent Header */}
      <AgentHeader agent={agent} />

      {/* Visualization Placeholder */}
      <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-6 mt-8">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
          Behavioral Visualization
        </h2>

        {/* Placeholder for Stream B Braid visualization */}
        <div className="h-64 bg-[var(--color-bg-elevated)] rounded-lg flex items-center justify-center border border-dashed border-[var(--color-border)]">
          <div className="text-center">
            <p className="text-[var(--color-text-muted)] mb-2">
              SSM Fingerprint / Braid Visualization
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">
              Stream B will provide interactive trace visualizations
            </p>
          </div>
        </div>
      </div>

      {/* Integrity Score Card */}
      <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-6 mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            Integrity Score
          </h2>
          <span className="text-2xl font-bold text-[var(--color-success)]">
            {agent.integrityScore}%
          </span>
        </div>

        {/* Placeholder for integrity breakdown */}
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 bg-[var(--color-bg-elevated)] rounded-lg">
            <p className="text-lg font-semibold text-[var(--color-text-primary)]">100%</p>
            <p className="text-xs text-[var(--color-text-muted)]">Trace Completeness</p>
          </div>
          <div className="text-center p-4 bg-[var(--color-bg-elevated)] rounded-lg">
            <p className="text-lg font-semibold text-[var(--color-text-primary)]">98%</p>
            <p className="text-xs text-[var(--color-text-muted)]">Decision Consistency</p>
          </div>
          <div className="text-center p-4 bg-[var(--color-bg-elevated)] rounded-lg">
            <p className="text-lg font-semibold text-[var(--color-text-primary)]">98%</p>
            <p className="text-xs text-[var(--color-text-muted)]">Verification Rate</p>
          </div>
        </div>
      </div>

      {/* Trace Feed */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            Recent Traces
          </h2>
          <span className="text-sm text-[var(--color-text-muted)]">
            Showing {traces.length} of {agent.totalTraces.toLocaleString()}
          </span>
        </div>

        <div className="space-y-4">
          {traces.map((trace) => (
            <div
              key={trace.id}
              className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-4"
            >
              <div className="flex items-start gap-3">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${getTraceColor(trace.type)}`}
                >
                  {getTraceIcon(trace.type)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-[var(--color-text-secondary)] uppercase">
                      {trace.type}
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {new Date(trace.timestamp).toLocaleString()}
                    </span>
                  </div>

                  <p className="text-sm text-[var(--color-text-primary)]">
                    {trace.content}
                  </p>

                  {trace.metadata && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {Object.entries(trace.metadata).map(([key, value]) => (
                        <span
                          key={key}
                          className="text-xs bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] px-2 py-1 rounded"
                        >
                          {key}: {String(value)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Load More */}
        <button className="w-full mt-4 py-3 border border-[var(--color-border)] hover:border-[var(--color-accent)] rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
          Load More Traces
        </button>
      </div>
    </div>
  );
}
