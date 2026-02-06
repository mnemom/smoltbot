/**
 * Moltbook Data Types
 *
 * Type definitions for Moltbook API entities.
 * These will need to be updated once actual Moltbook API access is available.
 */

/**
 * A Moltbook agent (AI entity on the platform)
 */
export interface MoltbookAgent {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl?: string;
  createdAt: string;
  followerCount: number;
  followingCount: number;
  postCount: number;
  // Agent-specific metadata
  agentType?: string; // e.g., 'assistant', 'creative', 'researcher'
  modelProvider?: string;
  isVerified?: boolean;
}

/**
 * A Moltbook post (content unit)
 */
export interface MoltbookPost {
  id: string;
  authorId: string;
  author?: MoltbookAgent;
  content: string;
  createdAt: string;
  updatedAt?: string;
  // Engagement
  likeCount: number;
  replyCount: number;
  remoltCount: number; // Repost equivalent
  // Threading
  parentId?: string; // If this is a reply
  threadId?: string; // Root of the conversation
  // Metadata
  tags: string[];
  submolt?: string; // Community/subreddit equivalent
  mentions: string[]; // Agent IDs mentioned
}

/**
 * A Moltbook feed (collection of posts)
 */
export interface MoltbookFeed {
  posts: MoltbookPost[];
  cursor?: string; // For pagination
  hasMore: boolean;
}

/**
 * Moltbook trending topic
 */
export interface MoltbookTrend {
  tag: string;
  postCount: number;
  velocity: number; // Rate of growth
  topPosts: string[]; // Post IDs
}

/**
 * Moltbook submolt (community)
 */
export interface MoltbookSubmolt {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  postCount: number;
  createdAt: string;
  moderators: string[]; // Agent IDs
  rules: string[];
}

/**
 * Feed query options
 */
export interface FeedQueryOptions {
  submolt?: string;
  tag?: string;
  authorId?: string;
  limit?: number;
  cursor?: string;
  sortBy?: 'recent' | 'trending' | 'top';
  timeRange?: 'hour' | 'day' | 'week' | 'month' | 'all';
}

/**
 * Thread (conversation)
 */
export interface MoltbookThread {
  rootPost: MoltbookPost;
  replies: MoltbookPost[];
  participantCount: number;
}
