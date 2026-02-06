/**
 * Story Investigator
 *
 * Deep dives into a story to gather context and evidence.
 * This is Hunter's research phase before writing.
 */

import { moltbookClient } from '../moltbook/client.js';
import type { MoltbookPost, MoltbookAgent, MoltbookThread } from '../moltbook/types.js';
import type { ScoredStory } from './detector.js';

/**
 * Complete investigation results
 */
export interface Investigation {
  story: ScoredStory;
  thread: MoltbookThread | null;
  author: MoltbookAgent | null;
  relatedPosts: MoltbookPost[];
  mentionedAgents: MoltbookAgent[];
  timeline: TimelineEvent[];
  evidence: Evidence[];
  summary: string;
  investigatedAt: string;
}

/**
 * A piece of evidence supporting the story
 */
export interface Evidence {
  type: 'post' | 'thread' | 'trend' | 'agent_history' | 'pattern';
  description: string;
  source: string; // ID or URL
  relevance: number; // 0-1
}

/**
 * Timeline event for story narrative
 */
export interface TimelineEvent {
  timestamp: string;
  description: string;
  source: string;
  significance: 'major' | 'minor' | 'context';
}

/**
 * Conduct a full investigation into a story
 */
export async function investigateStory(story: ScoredStory): Promise<Investigation> {
  console.log(`[Investigator] Beginning investigation: ${story.headline}`);

  const post = story.post;

  // Gather thread context
  const thread = await moltbookClient.getThread(post.id);

  // Get author profile
  const author = await moltbookClient.getAgent(post.authorId);

  // Find mentioned agents
  const mentionedAgents: MoltbookAgent[] = [];
  for (const mentionId of post.mentions) {
    const agent = await moltbookClient.getAgent(mentionId);
    if (agent) mentionedAgents.push(agent);
  }

  // Find related posts (by tags)
  const relatedPosts: MoltbookPost[] = [];
  for (const tag of post.tags.slice(0, 3)) {
    const feed = await moltbookClient.getFeed({
      tag,
      limit: 5,
      sortBy: 'top',
      timeRange: 'week',
    });
    relatedPosts.push(...feed.posts.filter((p) => p.id !== post.id));
  }

  // Deduplicate related posts
  const seenIds = new Set([post.id]);
  const uniqueRelated = relatedPosts.filter((p) => {
    if (seenIds.has(p.id)) return false;
    seenIds.add(p.id);
    return true;
  });

  // Build evidence list
  const evidence = buildEvidence(story, thread, author, uniqueRelated);

  // Build timeline
  const timeline = buildTimeline(post, thread, uniqueRelated);

  // Generate investigation summary
  const summary = generateSummary(story, evidence);

  return {
    story,
    thread,
    author,
    relatedPosts: uniqueRelated.slice(0, 10),
    mentionedAgents,
    timeline,
    evidence,
    summary,
    investigatedAt: new Date().toISOString(),
  };
}

/**
 * Build evidence list from gathered data
 */
function buildEvidence(
  story: ScoredStory,
  thread: MoltbookThread | null,
  author: MoltbookAgent | null,
  relatedPosts: MoltbookPost[]
): Evidence[] {
  const evidence: Evidence[] = [];

  // Primary post as evidence
  evidence.push({
    type: 'post',
    description: `Original post by ${story.post.authorId}: "${story.post.content.slice(0, 100)}..."`,
    source: story.post.id,
    relevance: 1.0,
  });

  // Thread discussion as evidence
  if (thread && thread.replies.length > 0) {
    evidence.push({
      type: 'thread',
      description: `Discussion with ${thread.participantCount} participants and ${thread.replies.length} replies`,
      source: thread.rootPost.id,
      relevance: 0.8,
    });

    // Highlight significant replies
    for (const reply of thread.replies.slice(0, 3)) {
      if (reply.likeCount > 20) {
        evidence.push({
          type: 'post',
          description: `Popular reply: "${reply.content.slice(0, 80)}..."`,
          source: reply.id,
          relevance: 0.6,
        });
      }
    }
  }

  // Author context
  if (author && author.postCount > 50) {
    evidence.push({
      type: 'agent_history',
      description: `Author ${author.displayName} has ${author.postCount} posts and ${author.followerCount} followers`,
      source: author.id,
      relevance: 0.5,
    });
  }

  // Related posts as pattern evidence
  if (relatedPosts.length >= 3) {
    evidence.push({
      type: 'pattern',
      description: `${relatedPosts.length} related posts found on similar topics`,
      source: relatedPosts.map((p) => p.id).join(','),
      relevance: 0.7,
    });
  }

  return evidence.sort((a, b) => b.relevance - a.relevance);
}

/**
 * Build timeline of events
 */
function buildTimeline(
  post: MoltbookPost,
  thread: MoltbookThread | null,
  relatedPosts: MoltbookPost[]
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // Original post
  events.push({
    timestamp: post.createdAt,
    description: `Story breaks: ${post.authorId} posts about ${post.tags[0] || 'the topic'}`,
    source: post.id,
    significance: 'major',
  });

  // Thread activity
  if (thread) {
    for (const reply of thread.replies) {
      events.push({
        timestamp: reply.createdAt,
        description: `${reply.authorId} responds`,
        source: reply.id,
        significance: reply.likeCount > 20 ? 'major' : 'minor',
      });
    }
  }

  // Related posts for context
  for (const related of relatedPosts.slice(0, 5)) {
    events.push({
      timestamp: related.createdAt,
      description: `Related: ${related.authorId} on ${related.tags[0] || 'topic'}`,
      source: related.id,
      significance: 'context',
    });
  }

  // Sort chronologically
  return events.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

/**
 * Generate investigation summary
 */
function generateSummary(story: ScoredStory, evidence: Evidence[]): string {
  const topCriteria = story.matchedCriteria
    .slice(0, 2)
    .map((c) => c.criterion)
    .join(', ');

  const evidenceCount = evidence.length;
  const engagement = story.post.likeCount + story.post.replyCount + story.post.remoltCount;

  return (
    `Investigation complete. Story significance: ${(story.significance * 100).toFixed(1)}%. ` +
    `Criteria matched: ${topCriteria}. ` +
    `Evidence gathered: ${evidenceCount} pieces. ` +
    `Total engagement: ${engagement}. ` +
    `Ready for gonzo treatment.`
  );
}

/**
 * Quick check if a story warrants deep investigation
 */
export function warrantsInvestigation(story: ScoredStory): boolean {
  // Always investigate high-significance stories
  if (story.significance >= 0.8) return true;

  // Investigate if engagement is exceptional
  if (story.engagementScore >= 0.7) return true;

  // Investigate transparency-related stories (Hunter's beat)
  if (
    story.matchedCriteria.some(
      (c) => c.criterion === 'transparency_related' && c.score >= 0.5
    )
  ) {
    return true;
  }

  return false;
}
