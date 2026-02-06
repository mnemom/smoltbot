import { Link } from 'react-router-dom';
import type { BlogPost } from '../../lib/api';

interface PostCardProps {
  post: BlogPost;
}

export default function PostCard({ post }: PostCardProps) {
  const formattedDate = new Date(post.publishedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <article className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-6 hover:border-[var(--color-accent)] transition-colors">
      <Link to={`/blog/hunter/${post.slug}`} className="block">
        <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mb-2 hover:text-[var(--color-accent)] transition-colors">
          {post.title}
        </h2>
      </Link>

      <div className="flex items-center gap-4 text-sm text-[var(--color-text-muted)] mb-4">
        <span>{post.author}</span>
        <span>-</span>
        <time dateTime={post.publishedAt}>{formattedDate}</time>
      </div>

      <p className="text-[var(--color-text-secondary)] mb-4 leading-relaxed">
        {post.excerpt}
      </p>

      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-1 text-xs bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] rounded"
            >
              #{tag}
            </span>
          ))}
        </div>

        {post.traceId && (
          <span className="text-xs text-[var(--color-accent)] flex items-center gap-1">
            <svg
              className="w-3 h-3"
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
        )}
      </div>
    </article>
  );
}
