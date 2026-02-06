import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { mockPosts, type BlogPost as BlogPostType } from '../lib/api';

export default function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<BlogPostType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPost = async () => {
      setLoading(true);
      setError(null);

      // TODO: Replace with actual API call
      // const data = await getBlogPost(slug);
      await new Promise((resolve) => setTimeout(resolve, 300));

      const foundPost = mockPosts.find((p) => p.slug === slug);
      if (foundPost) {
        setPost(foundPost);
      } else {
        setError('Post not found');
      }

      setLoading(false);
    };

    if (slug) {
      fetchPost();
    }
  }, [slug]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
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
          The post you're looking for doesn't exist or has been removed.
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

  return (
    <article className="max-w-3xl mx-auto px-4 py-12">
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

          <span>-</span>

          <time dateTime={post.publishedAt}>{formattedDate}</time>

          {post.traceId && (
            <>
              <span>-</span>
              <span className="text-[var(--color-accent)] flex items-center gap-1">
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
                Traced
              </span>
            </>
          )}
        </div>
      </header>

      {/* Trace Visualization Placeholder */}
      {post.traceId && (
        <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-[var(--color-text-secondary)]">
              Writing Trace
            </h3>
            <span className="text-xs text-[var(--color-text-muted)]">
              ID: {post.traceId}
            </span>
          </div>

          {/* Placeholder for Stream B visualization */}
          <div className="h-32 bg-[var(--color-bg-elevated)] rounded-lg flex items-center justify-center border border-dashed border-[var(--color-border)]">
            <p className="text-sm text-[var(--color-text-muted)]">
              Trace visualization will appear here (Stream B)
            </p>
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
  );
}
