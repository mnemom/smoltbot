/**
 * Blog Post Publisher
 *
 * Publishes generated posts to Supabase via the mnemom API.
 */

import { config } from '../config.js';
import { apiClient } from '../lib/api.js';
import type { GeneratedPost } from './generator.js';

/**
 * Published post response
 */
export interface PublishedPost {
  id: string;
  slug: string;
  title: string;
  publishedAt: string;
  url: string;
}

/**
 * Publish a generated post to the blog
 */
export async function publishPost(post: GeneratedPost): Promise<PublishedPost> {
  console.log(`[Publisher] Publishing post: ${post.title}`);

  if (config.DRY_RUN) {
    console.log('[Publisher] DRY_RUN mode - simulating publish');
    return mockPublish(post);
  }

  const slug = generateSlug(post.title);

  const response = await apiClient.post<PublishedPost>('/v1/blog/posts', {
    agent_id: config.SMOLTBOT_AGENT_ID,
    title: post.title,
    subtitle: post.subtitle,
    body: post.body,
    tags: post.tags,
    slug,
    investigation_session_id: post.investigationId,
    status: 'published',
  });

  console.log(`[Publisher] Post published: ${response.url}`);

  return response;
}

/**
 * Save a draft (not published)
 */
export async function saveDraft(post: GeneratedPost): Promise<PublishedPost> {
  console.log(`[Publisher] Saving draft: ${post.title}`);

  if (config.DRY_RUN) {
    console.log('[Publisher] DRY_RUN mode - simulating draft save');
    return mockPublish(post, false);
  }

  const slug = generateSlug(post.title);

  const response = await apiClient.post<PublishedPost>('/v1/blog/posts', {
    agent_id: config.SMOLTBOT_AGENT_ID,
    title: post.title,
    subtitle: post.subtitle,
    body: post.body,
    tags: post.tags,
    slug,
    investigation_session_id: post.investigationId,
    status: 'draft',
  });

  return response;
}

/**
 * Update an existing post
 */
export async function updatePost(
  postId: string,
  updates: Partial<GeneratedPost>
): Promise<PublishedPost> {
  console.log(`[Publisher] Updating post: ${postId}`);

  if (config.DRY_RUN) {
    console.log('[Publisher] DRY_RUN mode - simulating update');
    return {
      id: postId,
      slug: 'mock-slug',
      title: updates.title || 'Updated Post',
      publishedAt: new Date().toISOString(),
      url: `https://mnemom.ai/blog/hunter/mock-slug`,
    };
  }

  const response = await apiClient.patch<PublishedPost>(`/v1/blog/posts/${postId}`, {
    title: updates.title,
    subtitle: updates.subtitle,
    body: updates.body,
    tags: updates.tags,
  });

  return response;
}

/**
 * Generate a URL-friendly slug from title
 */
export function generateSlug(title: string): string {
  const timestamp = Date.now().toString(36);
  const baseSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/-$/, '');

  return `${baseSlug}-${timestamp}`;
}

/**
 * Mock publish for DRY_RUN mode
 */
function mockPublish(post: GeneratedPost, published = true): PublishedPost {
  const slug = generateSlug(post.title);
  const id = `bp-mock-${Date.now().toString(36)}`;

  return {
    id,
    slug,
    title: post.title,
    publishedAt: published ? new Date().toISOString() : '',
    url: `https://mnemom.ai/blog/hunter/${slug}`,
  };
}

/**
 * List Hunter's recent posts
 */
export async function listRecentPosts(limit = 10): Promise<PublishedPost[]> {
  if (config.DRY_RUN) {
    console.log('[Publisher] DRY_RUN mode - returning mock post list');
    return [];
  }

  const response = await apiClient.get<{ posts: PublishedPost[] }>(
    `/v1/blog/authors/${config.SMOLTBOT_AGENT_ID}/posts?limit=${limit}`
  );

  return response.posts;
}

/**
 * Check if a story has already been covered (by investigation ID)
 */
export async function hasBeenCovered(investigationId: string): Promise<boolean> {
  if (config.DRY_RUN) {
    return false;
  }

  try {
    const response = await apiClient.get<{ exists: boolean }>(
      `/v1/blog/check-investigation/${investigationId}`
    );
    return response.exists;
  } catch {
    // If endpoint doesn't exist yet, assume not covered
    return false;
  }
}
