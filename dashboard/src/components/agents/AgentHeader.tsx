import { Link } from 'react-router-dom';
import type { Agent } from '../../lib/api';

interface AgentHeaderProps {
  agent: Agent;
}

export default function AgentHeader({ agent }: AgentHeaderProps) {
  const statusColors = {
    active: 'bg-[var(--color-success)]',
    idle: 'bg-[var(--color-warning)]',
    offline: 'bg-[var(--color-text-muted)]',
  };

  const lastActive = agent.lastActiveAt
    ? new Date(agent.lastActiveAt).toLocaleString()
    : 'Never';

  return (
    <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          {/* Avatar placeholder */}
          <div className="w-16 h-16 bg-gradient-to-br from-amber-500 to-orange-600 rounded-full flex items-center justify-center text-2xl font-bold">
            {agent.name.charAt(0)}
          </div>

          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
                {agent.name}
              </h1>
              <span
                className={`w-3 h-3 rounded-full ${statusColors[agent.status]}`}
                title={agent.status}
              />
            </div>

            <div className="flex items-center gap-2 mt-1">
              <code className="text-xs text-[var(--color-text-muted)] bg-[var(--color-bg-elevated)] px-2 py-1 rounded">
                {agent.id.slice(0, 8)}...{agent.id.slice(-4)}
              </code>
              {agent.claimed && (
                <span className="text-xs text-[var(--color-success)] flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Claimed
                </span>
              )}
            </div>
          </div>
        </div>

        {!agent.claimed && (
          <Link
            to={`/claim/${agent.id}`}
            className="px-4 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-medium rounded-lg transition-colors"
          >
            Claim Agent
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-[var(--color-border)]">
        <div>
          <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
            Status
          </p>
          <p className="text-lg font-medium text-[var(--color-text-primary)] capitalize">
            {agent.status}
          </p>
        </div>

        <div>
          <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
            Integrity Score
          </p>
          <p className="text-lg font-medium text-[var(--color-text-primary)]">
            {agent.integrityScore !== undefined
              ? `${agent.integrityScore.toFixed(1)}%`
              : 'N/A'}
          </p>
        </div>

        <div>
          <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
            Total Traces
          </p>
          <p className="text-lg font-medium text-[var(--color-text-primary)]">
            {agent.totalTraces.toLocaleString()}
          </p>
        </div>

        <div>
          <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
            Last Active
          </p>
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            {lastActive}
          </p>
        </div>
      </div>
    </div>
  );
}
