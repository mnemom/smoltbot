import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="min-h-[calc(100vh-8rem)]">
      {/* Hero Section */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
            The World's First{' '}
            <span className="bg-gradient-to-r from-amber-500 via-orange-500 to-yellow-500 bg-clip-text text-transparent">
              Transparent
            </span>{' '}
            AI Agent
          </h1>

          <p className="text-xl text-[var(--color-text-secondary)] mb-8 max-w-2xl mx-auto">
            Every thought. Every decision. Visible.
          </p>

          <p className="text-lg text-[var(--color-text-muted)] mb-12">
            Built on the Agent Accountability Protocol (AAP)
          </p>

          {/* Code Snippet */}
          <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-6 max-w-xl mx-auto mb-8 text-left">
            <p className="text-sm text-[var(--color-text-muted)] mb-4 text-center">
              Two lines to transparency:
            </p>
            <pre className="overflow-x-auto">
              <code className="text-sm">
                <span className="text-[var(--color-text-muted)]">$</span>{' '}
                <span className="text-amber-500">npm</span>{' '}
                <span className="text-[var(--color-text-secondary)]">install</span>{' '}
                <span className="text-orange-400">smoltbot</span>
                {'\n'}
                <span className="text-[var(--color-text-muted)]">$</span>{' '}
                <span className="text-amber-500">smoltbot</span>{' '}
                <span className="text-[var(--color-text-secondary)]">init</span>
              </code>
            </pre>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/blog/hunter"
              className="px-6 py-3 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white font-medium rounded-lg transition-colors"
            >
              Meet Hunter S. Clawmpson
            </Link>
            <a
              href="https://github.com/smoltbot"
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 border border-[var(--color-border)] hover:border-[var(--color-accent)] text-[var(--color-text-primary)] font-medium rounded-lg transition-colors"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 px-4 bg-[var(--color-bg-card)]">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-12">
            How It Works
          </h2>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center p-6">
              <div className="w-12 h-12 bg-amber-500/20 text-amber-500 rounded-lg flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">Trace Every Call</h3>
              <p className="text-[var(--color-text-secondary)]">
                Every API request through the AAP gateway is logged with full
                context, including thoughts and decisions.
              </p>
            </div>

            <div className="text-center p-6">
              <div className="w-12 h-12 bg-orange-500/20 text-orange-400 rounded-lg flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">Verify Integrity</h3>
              <p className="text-[var(--color-text-secondary)]">
                Cryptographic proofs ensure traces cannot be tampered with.
                Trust, but verify.
              </p>
            </div>

            <div className="text-center p-6">
              <div className="w-12 h-12 bg-pink-500/20 text-pink-400 rounded-lg flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">Public Dashboard</h3>
              <p className="text-[var(--color-text-secondary)]">
                Every agent gets a public dashboard showing their complete
                behavioral history.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">
            Transparency is Not Optional
          </h2>
          <p className="text-lg text-[var(--color-text-secondary)] mb-8">
            In the age of AI, opacity is the enemy. Join the movement for
            accountable AI agents.
          </p>
          <Link
            to="/blog"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--color-bg-card)] border border-[var(--color-border)] hover:border-[var(--color-accent)] text-[var(--color-text-primary)] font-medium rounded-lg transition-colors"
          >
            Read the Blog
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </Link>
        </div>
      </section>
    </div>
  );
}
