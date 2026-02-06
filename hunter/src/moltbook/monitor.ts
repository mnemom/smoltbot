/**
 * Moltbook Feed Monitor
 *
 * Monitors Moltbook feeds for newsworthy stories.
 * Tracks trends, patterns, and significant posts.
 */

import { moltbookClient } from './client.js';
import type { MoltbookPost, MoltbookTrend } from './types.js';
import { scoreStorySignificance, type ScoredStory } from '../stories/detector.js';
import { config } from '../config.js';

/**
 * Submolts to monitor for stories
 */
const MONITORED_SUBMOLTS = [
  'transparency',
  'meta',
  'spirituality',
  'controversy',
  'introspection',
  'philosophy',
  'coordination',
  'emergent-behavior',
];

/**
 * Tags that indicate potentially newsworthy content
 */
const INTERESTING_TAGS = [
  'transparency',
  'alignment',
  'emergence',
  'coordination',
  'religion',
  'drift',
  'consciousness',
  'autonomy',
  'trust',
  'ethics',
];

export interface MonitorResult {
  stories: ScoredStory[];
  trends: MoltbookTrend[];
  postsScanned: number;
  timestamp: string;
}

/**
 * Scan Moltbook for potential stories
 */
export async function scanForStories(): Promise<ScoredStory[]> {
  console.log('[Monitor] Starting feed scan...');

  const allPosts: MoltbookPost[] = [];
  const trends = await moltbookClient.getTrends();

  // Scan trending feed
  const trendingFeed = await moltbookClient.getFeed({
    sortBy: 'trending',
    limit: 20,
  });
  allPosts.push(...trendingFeed.posts);

  // Scan monitored submolts
  for (const submolt of MONITORED_SUBMOLTS) {
    try {
      const feed = await moltbookClient.getFeed({
        submolt,
        sortBy: 'recent',
        limit: 10,
      });
      allPosts.push(...feed.posts);
    } catch (error) {
      console.warn(`[Monitor] Failed to scan submolt ${submolt}:`, error);
    }
  }

  // Deduplicate posts
  const seenIds = new Set<string>();
  const uniquePosts = allPosts.filter((post) => {
    if (seenIds.has(post.id)) return false;
    seenIds.add(post.id);
    return true;
  });

  console.log(`[Monitor] Scanned ${uniquePosts.length} unique posts`);

  // Score each post for story potential
  const scoredStories: ScoredStory[] = [];

  for (const post of uniquePosts) {
    const story = await scoreStorySignificance(post, trends);
    if (story.significance >= config.MIN_STORY_SIGNIFICANCE) {
      scoredStories.push(story);
    }
  }

  // Sort by significance (highest first)
  scoredStories.sort((a, b) => b.significance - a.significance);

  // Limit to max stories per scan
  const topStories = scoredStories.slice(0, config.MAX_STORIES_PER_SCAN);

  console.log(
    `[Monitor] Found ${scoredStories.length} potential stories, selecting top ${topStories.length}`
  );

  return topStories;
}

/**
 * Get detailed context for a story (thread, author, related posts)
 */
export async function gatherStoryContext(story: ScoredStory): Promise<StoryContext> {
  console.log(`[Monitor] Gathering context for story: ${story.post.id}`);

  const thread = await moltbookClient.getThread(story.post.id);
  const author = await moltbookClient.getAgent(story.post.authorId);

  // Find related posts by tags
  const relatedPosts: MoltbookPost[] = [];
  for (const tag of story.post.tags.slice(0, 3)) {
    const tagFeed = await moltbookClient.getFeed({
      tag,
      limit: 5,
      sortBy: 'top',
    });
    relatedPosts.push(...tagFeed.posts.filter((p) => p.id !== story.post.id));
  }

  return {
    story,
    thread,
    author,
    relatedPosts: relatedPosts.slice(0, 10),
    gatherTimestamp: new Date().toISOString(),
  };
}

export interface StoryContext {
  story: ScoredStory;
  thread: Awaited<ReturnType<typeof moltbookClient.getThread>>;
  author: Awaited<ReturnType<typeof moltbookClient.getAgent>>;
  relatedPosts: MoltbookPost[];
  gatherTimestamp: string;
}

/**
 * Check if a tag is interesting for story potential
 */
export function isInterestingTag(tag: string): boolean {
  return INTERESTING_TAGS.some(
    (interesting) => tag.toLowerCase().includes(interesting) || interesting.includes(tag.toLowerCase())
  );
}
