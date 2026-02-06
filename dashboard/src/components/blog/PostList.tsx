import PostCard from './PostCard';
import type { BlogPost } from '../../lib/api';

interface PostListProps {
  posts: BlogPost[];
  loading?: boolean;
}

export default function PostList({ posts, loading }: PostListProps) {
  if (loading) {
    return (
      <div className="space-y-6">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-6 animate-pulse"
          >
            <div className="h-6 bg-[var(--color-bg-elevated)] rounded w-3/4 mb-4" />
            <div className="h-4 bg-[var(--color-bg-elevated)] rounded w-1/4 mb-4" />
            <div className="space-y-2">
              <div className="h-4 bg-[var(--color-bg-elevated)] rounded w-full" />
              <div className="h-4 bg-[var(--color-bg-elevated)] rounded w-5/6" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--color-text-muted)]">No posts yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}
