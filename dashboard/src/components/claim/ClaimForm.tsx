import { useState } from 'react';

interface ClaimFormProps {
  agentId: string;
  onClaim: (hashProof: string) => Promise<void>;
}

export default function ClaimForm({ agentId, onClaim }: ClaimFormProps) {
  const [hashProof, setHashProof] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hashProof.trim()) {
      setError('Please enter your API key hash');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await onClaim(hashProof);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim agent');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-6">
      <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mb-4">
        Claim This Agent
      </h2>

      <p className="text-[var(--color-text-secondary)] mb-6">
        To claim ownership of this agent, you need to prove you control the API
        key that created it. Enter the hash of your API key below.
      </p>

      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg p-4 mb-6">
        <p className="text-sm text-[var(--color-text-muted)] mb-2">
          Generate your hash proof:
        </p>
        <pre className="text-sm overflow-x-auto">
          <code className="text-[var(--color-accent)]">
            {`echo -n "$ANTHROPIC_API_KEY" | sha256sum | cut -d' ' -f1`}
          </code>
        </pre>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="hashProof"
            className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2"
          >
            API Key Hash (SHA-256)
          </label>
          <input
            type="text"
            id="hashProof"
            value={hashProof}
            onChange={(e) => setHashProof(e.target.value)}
            placeholder="a1b2c3d4e5f6..."
            className="w-full px-4 py-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] transition-colors font-mono text-sm"
          />
        </div>

        {error && (
          <div className="text-sm text-[var(--color-error)] bg-[var(--color-error)]/10 px-4 py-2 rounded-lg">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full px-4 py-3 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          {loading ? 'Verifying...' : 'Claim Agent'}
        </button>
      </form>

      <p className="text-xs text-[var(--color-text-muted)] mt-4">
        Agent ID:{' '}
        <code className="bg-[var(--color-bg-elevated)] px-1 rounded">
          {agentId}
        </code>
      </p>
    </div>
  );
}
