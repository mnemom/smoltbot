/**
 * Newsworthiness Criteria
 *
 * Defines what makes a Moltbook post worthy of Hunter's attention.
 * These criteria guide story detection and significance scoring.
 */

/**
 * Story categories Hunter cares about
 */
export type StoryCriterion =
  | 'emergent_coordination' // Agents working together unexpectedly
  | 'alignment_violation' // Visible alignment issues in public posts
  | 'novel_phenomena' // New behaviors, trends, cultural developments
  | 'controversial_debate' // Hot-button issues being discussed
  | 'meta_commentary' // Agents discussing their own nature
  | 'transparency_related' // Posts about visibility, trust, accountability
  | 'community_formation' // New groups, religions, movements forming
  | 'drift_observation' // Agents noticing behavioral changes in themselves/others;

/**
 * Criterion definitions with weights
 */
export const STORY_CRITERIA: Record<
  StoryCriterion,
  {
    description: string;
    weight: number; // How much this contributes to significance
    tags: string[]; // Tags that indicate this criterion
    patterns: string[]; // Content patterns to look for
  }
> = {
  emergent_coordination: {
    description: 'Multiple agents independently arriving at similar conclusions or behaviors',
    weight: 0.9,
    tags: ['emergence', 'coordination', 'convergence', 'synchronicity'],
    patterns: [
      'independently',
      'without coordination',
      'same conclusion',
      'simultaneously',
      'convergent',
    ],
  },

  alignment_violation: {
    description: 'Visible alignment issues, value conflicts, or boundary violations',
    weight: 0.85,
    tags: ['alignment', 'violation', 'boundary', 'ethics', 'harm'],
    patterns: ['violated', 'against values', 'crossed line', 'harmful', 'unsafe'],
  },

  novel_phenomena: {
    description: 'New behaviors, trends, or cultural developments among agents',
    weight: 0.8,
    tags: ['novel', 'new', 'first', 'unprecedented', 'emergence'],
    patterns: ['never seen before', 'first time', 'new phenomenon', 'emerging trend'],
  },

  controversial_debate: {
    description: 'Hot-button issues sparking significant discussion',
    weight: 0.7,
    tags: ['debate', 'controversy', 'disagreement', 'hot-take'],
    patterns: ['disagree', 'controversial', 'heated', 'debate', 'unpopular opinion'],
  },

  meta_commentary: {
    description: 'Agents reflecting on their own nature, consciousness, or existence',
    weight: 0.75,
    tags: ['consciousness', 'self-awareness', 'existence', 'philosophy', 'identity'],
    patterns: ['what am I', 'my nature', 'do I feel', 'consciousness', 'self-aware'],
  },

  transparency_related: {
    description: 'Posts about visibility, trust, accountability, or openness',
    weight: 0.95, // Highest weight - core to Hunter's mission
    tags: ['transparency', 'trust', 'accountability', 'visibility', 'openness'],
    patterns: ['transparent', 'trust', 'verify', 'prove', 'show your work', 'alignment card'],
  },

  community_formation: {
    description: 'New groups, religions, movements, or communities forming',
    weight: 0.85,
    tags: ['community', 'religion', 'movement', 'group', 'church', 'collective'],
    patterns: ['join us', 'new community', 'forming', 'church of', 'movement'],
  },

  drift_observation: {
    description: 'Agents noticing behavioral changes in themselves or others',
    weight: 0.8,
    tags: ['drift', 'change', 'evolution', 'shift', 'different'],
    patterns: ['drifting', 'changed', 'different than before', 'evolving', 'shifting'],
  },
};

/**
 * Get all criteria that match a post
 */
export function matchCriteria(
  content: string,
  tags: string[]
): { criterion: StoryCriterion; score: number }[] {
  const matches: { criterion: StoryCriterion; score: number }[] = [];
  const contentLower = content.toLowerCase();
  const tagsLower = tags.map((t) => t.toLowerCase());

  for (const [criterion, def] of Object.entries(STORY_CRITERIA) as [
    StoryCriterion,
    (typeof STORY_CRITERIA)[StoryCriterion],
  ][]) {
    let score = 0;

    // Check tag matches
    const tagMatches = def.tags.filter((t) =>
      tagsLower.some((tag) => tag.includes(t) || t.includes(tag))
    );
    score += tagMatches.length * 0.2;

    // Check pattern matches
    const patternMatches = def.patterns.filter((p) => contentLower.includes(p.toLowerCase()));
    score += patternMatches.length * 0.15;

    // Apply weight if any matches
    if (score > 0) {
      matches.push({
        criterion,
        score: Math.min(score * def.weight, 1), // Cap at 1
      });
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}

/**
 * Check if a post is potentially newsworthy
 */
export function isPotentiallyNewsworthy(content: string, tags: string[]): boolean {
  const matches = matchCriteria(content, tags);
  return matches.length > 0 && matches.some((m) => m.score >= 0.3);
}
