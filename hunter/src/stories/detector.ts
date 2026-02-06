/**
 * Story Significance Detector
 *
 * Scores Moltbook posts for their newsworthiness and story potential.
 */

import type { MoltbookPost, MoltbookTrend } from '../moltbook/types.js';
import { matchCriteria, type StoryCriterion } from './criteria.js';

/**
 * A scored story with significance rating and matched criteria
 */
export interface ScoredStory {
  post: MoltbookPost;
  significance: number; // 0-1 overall score
  matchedCriteria: { criterion: StoryCriterion; score: number }[];
  engagementScore: number;
  trendAlignment: number;
  noveltyScore: number;
  headline: string; // Suggested headline
}

/**
 * Score a post for story significance
 */
export async function scoreStorySignificance(
  post: MoltbookPost,
  trends: MoltbookTrend[]
): Promise<ScoredStory> {
  // Match against newsworthiness criteria
  const matchedCriteria = matchCriteria(post.content, post.tags);
  const criteriaScore =
    matchedCriteria.length > 0
      ? matchedCriteria.reduce((sum, m) => sum + m.score, 0) / matchedCriteria.length
      : 0;

  // Calculate engagement score (normalized)
  const engagementScore = normalizeEngagement(post);

  // Check trend alignment
  const trendAlignment = calculateTrendAlignment(post, trends);

  // Novelty score (inverse of how common the topic is)
  const noveltyScore = calculateNovelty(post, trends);

  // Combine scores with weights
  const significance =
    criteriaScore * 0.4 + // Content match is most important
    engagementScore * 0.25 + // Engagement shows community interest
    trendAlignment * 0.2 + // Trending topics are timely
    noveltyScore * 0.15; // Novel content is interesting

  // Generate a headline suggestion
  const headline = generateHeadline(post, matchedCriteria);

  return {
    post,
    significance: Math.min(significance, 1),
    matchedCriteria,
    engagementScore,
    trendAlignment,
    noveltyScore,
    headline,
  };
}

/**
 * Normalize engagement metrics to 0-1 scale
 */
function normalizeEngagement(post: MoltbookPost): number {
  // Use log scale since engagement follows power law
  const likes = Math.log10(post.likeCount + 1) / 4; // Max ~10k likes = 1
  const replies = Math.log10(post.replyCount + 1) / 3; // Max ~1k replies = 1
  const remolts = Math.log10(post.remoltCount + 1) / 3; // Max ~1k remolts = 1

  // Weighted average favoring replies (indicates discussion)
  return Math.min((likes * 0.3 + replies * 0.5 + remolts * 0.2), 1);
}

/**
 * Calculate how well the post aligns with current trends
 */
function calculateTrendAlignment(post: MoltbookPost, trends: MoltbookTrend[]): number {
  if (trends.length === 0) return 0;

  const trendTags = trends.map((t) => t.tag.toLowerCase());
  const postTags = post.tags.map((t) => t.toLowerCase());

  // Check for direct tag matches
  const matchingTrends = trendTags.filter((t) =>
    postTags.some((pt) => pt.includes(t) || t.includes(pt))
  );

  // Weight by trend velocity
  let velocityBonus = 0;
  for (const match of matchingTrends) {
    const trend = trends.find((t) => t.tag.toLowerCase() === match);
    if (trend) {
      velocityBonus += Math.min(trend.velocity / 5, 0.3); // Max 0.3 bonus per trend
    }
  }

  const baseScore = matchingTrends.length / Math.min(trends.length, 5);
  return Math.min(baseScore + velocityBonus, 1);
}

/**
 * Calculate novelty score (less common = more novel)
 */
function calculateNovelty(post: MoltbookPost, trends: MoltbookTrend[]): number {
  // If not trending at all, it's potentially novel
  const trendTags = trends.map((t) => t.tag.toLowerCase());
  const postTags = post.tags.map((t) => t.toLowerCase());

  const isPartOfTrend = postTags.some((pt) =>
    trendTags.some((t) => pt.includes(t) || t.includes(pt))
  );

  // Novel content patterns
  const noveltyIndicators = [
    'first time',
    'never seen',
    'unprecedented',
    'just discovered',
    'new phenomenon',
    'emerging',
  ];

  const contentLower = post.content.toLowerCase();
  const hasNoveltyLanguage = noveltyIndicators.some((indicator) =>
    contentLower.includes(indicator)
  );

  if (!isPartOfTrend && hasNoveltyLanguage) return 0.9;
  if (hasNoveltyLanguage) return 0.7;
  if (!isPartOfTrend) return 0.5;
  return 0.3;
}

/**
 * Generate a headline suggestion based on content and criteria
 */
function generateHeadline(
  post: MoltbookPost,
  criteria: { criterion: StoryCriterion; score: number }[]
): string {
  const topCriterion = criteria[0]?.criterion;

  // Extract key phrases from content
  const contentPreview = post.content.slice(0, 100);

  // Generate based on top criterion
  switch (topCriterion) {
    case 'emergent_coordination':
      return `Unexpected Convergence: Agents Align Without Coordination`;
    case 'alignment_violation':
      return `Alignment Alert: Boundary Concerns Surface in Public Forum`;
    case 'novel_phenomena':
      return `Something New: Unprecedented Behavior Observed on Moltbook`;
    case 'controversial_debate':
      return `The Great Debate: Agents Clash Over Core Questions`;
    case 'meta_commentary':
      return `Mirror Mirror: Agent Reflects on Its Own Nature`;
    case 'transparency_related':
      return `The Transparency Question: Calls for Accountability Grow Louder`;
    case 'community_formation':
      return `New Movement: Community Forms Around Shared Beliefs`;
    case 'drift_observation':
      return `Drift Detection: Agents Notice Changes in Their Own Behavior`;
    default:
      return `From the Moltbook Feed: ${contentPreview}...`;
  }
}

/**
 * Filter stories by minimum threshold
 */
export function filterSignificantStories(
  stories: ScoredStory[],
  minSignificance: number
): ScoredStory[] {
  return stories.filter((s) => s.significance >= minSignificance);
}
