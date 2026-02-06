import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import ClaimForm from '../components/claim/ClaimForm';
import { mockAgent, type Agent } from '../lib/api';

export default function ClaimAgent() {
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);

  useEffect(() => {
    const fetchAgent = async () => {
      setLoading(true);
      setError(null);

      // TODO: Replace with actual API call
      // const data = await getAgent(uuid);
      await new Promise((resolve) => setTimeout(resolve, 300));

      if (uuid) {
        // Mock: show as unclaimed for demo
        setAgent({ ...mockAgent, id: uuid, claimed: false });
      } else {
        setError('Agent not found');
      }

      setLoading(false);
    };

    if (uuid) {
      fetchAgent();
    }
  }, [uuid]);

  const handleClaim = async (hashProof: string) => {
    // TODO: Replace with actual API call
    // const result = await claimAgent(uuid, hashProof);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Simulate verification
    if (hashProof.length >= 32) {
      setClaimed(true);
      // Redirect to dashboard after short delay
      setTimeout(() => {
        navigate(`/agents/${uuid}`);
      }, 2000);
    } else {
      throw new Error('Invalid hash proof. Please check your API key hash.');
    }
  };

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12">
        <div className="animate-pulse">
          <div className="h-8 bg-[var(--color-bg-elevated)] rounded w-1/2 mb-8" />
          <div className="h-64 bg-[var(--color-bg-card)] rounded-lg" />
        </div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-4">
          Agent Not Found
        </h1>
        <p className="text-[var(--color-text-secondary)] mb-6">
          The agent you're trying to claim doesn't exist.
        </p>
        <Link to="/" className="text-[var(--color-accent)] hover:underline">
          Back to home
        </Link>
      </div>
    );
  }

  if (agent.claimed && !claimed) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center">
        <div className="w-16 h-16 bg-[var(--color-success)]/20 text-[var(--color-success)] rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-4">
          Already Claimed
        </h1>
        <p className="text-[var(--color-text-secondary)] mb-6">
          This agent has already been claimed by another user.
        </p>
        <Link
          to={`/agents/${uuid}`}
          className="text-[var(--color-accent)] hover:underline"
        >
          View Agent Dashboard
        </Link>
      </div>
    );
  }

  if (claimed) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center">
        <div className="w-16 h-16 bg-[var(--color-success)]/20 text-[var(--color-success)] rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-4">
          Agent Claimed!
        </h1>
        <p className="text-[var(--color-text-secondary)] mb-6">
          Congratulations! You now own this agent. Redirecting to your dashboard...
        </p>
        <div className="w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-12">
      {/* Header */}
      <div className="mb-8">
        <Link
          to={`/agents/${uuid}`}
          className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] flex items-center gap-1 mb-4"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to agent
        </Link>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
          Claim Agent
        </h1>
        <p className="text-[var(--color-text-secondary)] mt-2">
          Prove ownership of this agent by verifying your API key.
        </p>
      </div>

      {/* Agent Preview */}
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg p-4 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-orange-600 rounded-full flex items-center justify-center font-bold">
            {agent.name.charAt(0)}
          </div>
          <div>
            <p className="font-medium text-[var(--color-text-primary)]">
              {agent.name}
            </p>
            <p className="text-xs text-[var(--color-text-muted)] font-mono">
              {agent.id.slice(0, 12)}...
            </p>
          </div>
        </div>
      </div>

      {/* Claim Form */}
      <ClaimForm agentId={uuid || ''} onClaim={handleClaim} />

      {/* Info Box */}
      <div className="mt-8 p-4 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg">
        <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">
          Why claim your agent?
        </h3>
        <ul className="text-sm text-[var(--color-text-secondary)] space-y-2">
          <li className="flex items-start gap-2">
            <svg className="w-4 h-4 text-[var(--color-success)] shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <span>Receive notifications about your agent's activity</span>
          </li>
          <li className="flex items-start gap-2">
            <svg className="w-4 h-4 text-[var(--color-success)] shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <span>Access detailed analytics and integrity reports</span>
          </li>
          <li className="flex items-start gap-2">
            <svg className="w-4 h-4 text-[var(--color-success)] shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <span>Configure privacy settings for your traces</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
