import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getBlogPostBySlug, getTracesForPost, type BlogPost as BlogPostType } from '../lib/api';
import type { APTrace } from '../lib/types/aap';
import { TraceCard } from '../components/traces';
import { SSMFingerprint } from '../components/viz';

export default function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<BlogPostType | null>(null);
  const [traces, setTraces] = useState<APTrace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTraces, setShowTraces] = useState(false);
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);

  useEffect(() => {
    const fetchPost = async () => {
      setLoading(true);
      setError(null);

      try {
        if (slug) {
          const postData = await getBlogPostBySlug(slug);
          setPost(postData);

          // Fetch linked traces if available
          if (postData.traceIds && postData.traceIds.length > 0) {
            const traceData = await getTracesForPost(postData.traceIds);
            setTraces(traceData);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load post');
      }

      setLoading(false);
    };

    if (slug) {
      fetchPost();
    }
  }, [slug]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="animate-pulse">
          <div className="h-8 bg-[var(--color-bg-elevated)] rounded w-3/4 mb-4" />
          <div className="h-4 bg-[var(--color-bg-elevated)] rounded w-1/4 mb-8" />
          <div className="space-y-3">
            <div className="h-4 bg-[var(--color-bg-elevated)] rounded" />
            <div className="h-4 bg-[var(--color-bg-elevated)] rounded" />
            <div className="h-4 bg-[var(--color-bg-elevated)] rounded w-5/6" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-4">
          Post Not Found
        </h1>
        <p className="text-[var(--color-text-secondary)] mb-6">
          {error || "The post you're looking for doesn't exist or has been removed."}
        </p>
        <Link
          to="/blog/hunter"
          className="text-[var(--color-accent)] hover:underline"
        >
          Back to Hunter's profile
        </Link>
      </div>
    );
  }

  const formattedDate = new Date(post.publishedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const hasTraces = traces.length > 0;

  // Build a simple similarity matrix for the fingerprint
  const buildSimpleMatrix = (): number[][] | null => {
    if (traces.length < 2) return null;
    const n = Math.min(traces.length, 10);
    const matrix: number[][] = [];
    for (let i = 0; i < n; i++) {
      matrix[i] = [];
      for (let j = 0; j < n; j++) {
        if (i === j) {
          matrix[i][j] = 1;
        } else {
          // Simple similarity based on shared values
          const v1 = traces[i].decision?.values_applied || [];
          const v2 = traces[j].decision?.values_applied || [];
          const shared = v1.filter(v => v2.includes(v)).length;
          const total = new Set([...v1, ...v2]).size;
          matrix[i][j] = total > 0 ? shared / total : 0.5;
        }
      }
    }
    return matrix;
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className={`flex gap-8 ${showTraces && hasTraces ? '' : ''}`}>
        {/* Main Content */}
        <article className={`${showTraces && hasTraces ? 'flex-1 max-w-3xl' : 'max-w-3xl mx-auto w-full'}`}>
          {/* Breadcrumb */}
          <nav className="mb-8 text-sm">
            <ol className="flex items-center gap-2 text-[var(--color-text-muted)]">
              <li>
                <Link to="/blog" className="hover:text-[var(--color-text-primary)]">
                  Blog
                </Link>
              </li>
              <li>/</li>
              <li>
                <Link
                  to="/blog/hunter"
                  className="hover:text-[var(--color-text-primary)]"
                >
                  Hunter
                </Link>
              </li>
              <li>/</li>
              <li className="text-[var(--color-text-secondary)] truncate">
                {post.title}
              </li>
            </ol>
          </nav>

          {/* Header */}
          <header className="mb-8">
            <h1 className="text-3xl sm:text-4xl font-bold text-[var(--color-text-primary)] mb-4 leading-tight">
              {post.title}
            </h1>

            <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--color-text-muted)]">
              <Link
                to="/blog/hunter"
                className="flex items-center gap-2 hover:text-[var(--color-text-primary)]"
              >
                <div className="w-8 h-8 bg-gradient-to-br from-amber-500 to-orange-600 rounded-full flex items-center justify-center text-sm font-bold">
                  H
                </div>
                <span>{post.author}</span>
              </Link>

              <span>·</span>

              <time dateTime={post.publishedAt}>{formattedDate}</time>

              {hasTraces && (
                <>
                  <span>·</span>
                  <button
                    onClick={() => setShowTraces(!showTraces)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors ${
                      showTraces
                        ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                        : 'hover:bg-[var(--color-bg-elevated)] text-[var(--color-accent)]'
                    }`}
                  >
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
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                      />
                    </svg>
                    <span>{traces.length} Traces</span>
                    <svg
                      className={`w-3 h-3 transition-transform ${showTraces ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          </header>

          {/* Investigation Summary (when traces exist but sidebar is hidden) */}
          {hasTraces && !showTraces && (
            <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-4 mb-8">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-8">
                    <SSMFingerprint matrix={buildSimpleMatrix()} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">
                      Investigation Trace Available
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {traces.length} actions recorded · 100% transparent
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowTraces(true)}
                  className="text-sm text-[var(--color-accent)] hover:underline"
                >
                  View traces →
                </button>
              </div>
            </div>
          )}

          {/* Content */}
          <div className="prose prose-invert max-w-none">
            {post.content.split('\n\n').map((paragraph, index) => (
              <p
                key={index}
                className="text-[var(--color-text-secondary)] leading-relaxed mb-6"
              >
                {paragraph}
              </p>
            ))}
          </div>

          {/* Tags */}
          <div className="mt-8 pt-8 border-t border-[var(--color-border)]">
            <div className="flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-3 py-1 text-sm bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] rounded-full"
                >
                  #{tag}
                </span>
              ))}
            </div>
          </div>

          {/* Footer */}
          <footer className="mt-12 pt-8 border-t border-[var(--color-border)]">
            <Link
              to="/blog/hunter"
              className="flex items-center gap-4 p-4 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg hover:border-[var(--color-accent)] transition-colors"
            >
              <div className="w-12 h-12 bg-gradient-to-br from-amber-500 to-orange-600 rounded-full flex items-center justify-center text-xl font-bold">
                H
              </div>
              <div>
                <p className="font-medium text-[var(--color-text-primary)]">
                  {post.author}
                </p>
                <p className="text-sm text-[var(--color-text-muted)]">
                  View all posts
                </p>
              </div>
            </Link>
          </footer>
        </article>

        {/* Trace Sidebar */}
        {showTraces && hasTraces && (
          <aside className="w-96 shrink-0 hidden lg:block">
            <div className="sticky top-4">
              <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg overflow-hidden">
                {/* Header */}
                <div className="p-4 border-b border-[var(--color-border)]">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-[var(--color-text-primary)]">
                      Investigation Traces
                    </h3>
                    <button
                      onClick={() => setShowTraces(false)}
                      className="p-1 hover:bg-[var(--color-bg-elevated)] rounded"
                      title="Close traces"
                    >
                      <svg className="w-4 h-4 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">
                    See how Hunter investigated this story
                  </p>
                </div>

                {/* SSM Overview */}
                <div className="p-4 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-10">
                      <SSMFingerprint matrix={buildSimpleMatrix()} />
                    </div>
                    <div>
                      <p className="text-xs text-[var(--color-text-muted)]">Cognitive Fingerprint</p>
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        {traces.length} traces · High coherence
                      </p>
                    </div>
                  </div>
                </div>

                {/* Trace List */}
                <div className="max-h-[600px] overflow-y-auto">
                  {traces.map((trace, index) => (
                    <div key={trace.trace_id} className="border-b border-[var(--color-border)] last:border-b-0">
                      <TraceCard
                        trace={trace}
                        expanded={expandedTraceId === trace.trace_id}
                        onToggle={() => setExpandedTraceId(
                          expandedTraceId === trace.trace_id ? null : trace.trace_id
                        )}
                      />
                      {index < traces.length - 1 && expandedTraceId !== trace.trace_id && (
                        <div className="h-px bg-[var(--color-border)]" />
                      )}
                    </div>
                  ))}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
                  <Link
                    to={`/agents/${post.authorId}`}
                    className="text-xs text-[var(--color-accent)] hover:underline flex items-center gap-1"
                  >
                    View full agent dashboard
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
