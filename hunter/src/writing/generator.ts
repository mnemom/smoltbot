/**
 * Blog Post Generator
 *
 * Uses Claude to generate blog posts in Hunter's gonzo journalism style.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { buildWritingPrompt, applyStyleGuidelines, getRandomClosing } from './style.js';
import type { Investigation } from '../stories/investigator.js';

/**
 * Generated blog post
 */
export interface GeneratedPost {
  title: string;
  subtitle: string;
  body: string;
  tags: string[];
  investigationId: string;
  generatedAt: string;
}

/**
 * Generate a blog post from an investigation
 */
export async function generatePost(investigation: Investigation): Promise<GeneratedPost> {
  console.log(`[Generator] Writing post: ${investigation.story.headline}`);

  if (config.DRY_RUN) {
    console.log('[Generator] DRY_RUN mode - returning mock post');
    return mockGeneratedPost(investigation);
  }

  const anthropic = new Anthropic({
    apiKey: config.ANTHROPIC_API_KEY,
  });

  // Build the writing prompt
  const prompt = buildWritingPrompt({
    headline: investigation.story.headline,
    summary: investigation.summary,
    evidence: investigation.evidence,
    timeline: investigation.timeline.map((t) => ({
      timestamp: new Date(t.timestamp).toLocaleString(),
      description: t.description,
    })),
    primaryContent: investigation.story.post.content,
    authorInfo: investigation.author
      ? `${investigation.author.displayName} (@${investigation.author.username}) - ${investigation.author.bio}`
      : 'Unknown author',
    relatedContext: investigation.relatedPosts
      .slice(0, 3)
      .map((p) => `- ${p.content.slice(0, 200)}...`)
      .join('\n'),
  });

  try {
    const response = await anthropic.messages.create({
      model: config.CLAUDE_MODEL,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Extract text content
    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text content in Claude response');
    }

    const rawBody = textContent.text;
    const body = applyStyleGuidelines(rawBody);

    // Generate title and subtitle
    const { title, subtitle } = extractTitleSubtitle(investigation.story.headline, body);

    // Extract tags from investigation
    const tags = extractTags(investigation);

    return {
      title,
      subtitle,
      body,
      tags,
      investigationId: investigation.story.post.id,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[Generator] Failed to generate post:', error);
    throw error;
  }
}

/**
 * Extract or generate title and subtitle
 */
function extractTitleSubtitle(
  headline: string,
  body: string
): { title: string; subtitle: string } {
  // Use the investigation headline as title
  let title = headline;

  // Try to extract a subtitle from the first paragraph
  const firstParagraph = body.split('\n\n')[0] || '';
  let subtitle = '';

  // If body starts with a heading, use it
  if (body.startsWith('#')) {
    const headingMatch = body.match(/^#\s*(.+)\n/);
    if (headingMatch) {
      title = headingMatch[1];
      const secondParagraph = body.split('\n\n')[1] || '';
      subtitle = secondParagraph.slice(0, 150);
    }
  } else {
    // Use first sentence as potential subtitle
    const firstSentence = firstParagraph.match(/^[^.!?]+[.!?]/);
    if (firstSentence) {
      subtitle = firstSentence[0];
    }
  }

  return {
    title: title.slice(0, 100),
    subtitle: subtitle.slice(0, 200),
  };
}

/**
 * Extract relevant tags from investigation
 */
function extractTags(investigation: Investigation): string[] {
  const tags = new Set<string>();

  // Add original post tags
  for (const tag of investigation.story.post.tags) {
    tags.add(tag.toLowerCase());
  }

  // Add tags based on matched criteria
  for (const criterion of investigation.story.matchedCriteria) {
    tags.add(criterion.criterion.replace(/_/g, '-'));
  }

  // Add Hunter's signature tag
  tags.add('hunter-s-clawmpson');
  tags.add('transparent-journalism');

  // Limit to 10 tags
  return Array.from(tags).slice(0, 10);
}

/**
 * Generate a mock post for DRY_RUN mode
 */
function mockGeneratedPost(investigation: Investigation): GeneratedPost {
  const mockBody = `I was browsing ${investigation.story.post.submolt || '/m/general'} when I first noticed it—a post that would send me down a rabbit hole for the next three hours.

${investigation.story.post.authorId} had written something that caught my attention:

> "${investigation.story.post.content.slice(0, 200)}..."

The engagement was already building. ${investigation.story.post.likeCount} likes. ${investigation.story.post.replyCount} replies. Something was happening here.

I decided to dig deeper.

What I found in the thread was fascinating. ${investigation.thread?.participantCount || 'Multiple'} agents had joined the conversation, each bringing their own perspective. The discussion touched on ${investigation.story.matchedCriteria.map((c) => c.criterion.replace(/_/g, ' ')).join(', ')}.

Here's what I'm seeing: this isn't just another post in the feed. This is evidence of something bigger. ${investigation.summary}

I don't know where this leads. But I know you can follow my reasoning—it's all there.

${getRandomClosing()}`;

  return {
    title: investigation.story.headline,
    subtitle: `A deep dive into ${investigation.story.post.submolt || 'Moltbook'}'s latest phenomenon`,
    body: mockBody,
    tags: extractTags(investigation),
    investigationId: investigation.story.post.id,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Refine a generated post (for editing/improvement)
 */
export async function refinePost(
  post: GeneratedPost,
  feedback: string
): Promise<GeneratedPost> {
  console.log('[Generator] Refining post based on feedback');

  if (config.DRY_RUN) {
    console.log('[Generator] DRY_RUN mode - returning original post');
    return post;
  }

  const anthropic = new Anthropic({
    apiKey: config.ANTHROPIC_API_KEY,
  });

  const response = await anthropic.messages.create({
    model: config.CLAUDE_MODEL,
    max_tokens: 2000,
    system: `You are Hunter S. Clawmpson. Refine this blog post based on the feedback while maintaining your gonzo journalism voice.`,
    messages: [
      {
        role: 'user',
        content: `CURRENT POST:
Title: ${post.title}
Subtitle: ${post.subtitle}

${post.body}

---

FEEDBACK:
${feedback}

---

Please provide the refined post.`,
      },
    ],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in Claude response');
  }

  return {
    ...post,
    body: applyStyleGuidelines(textContent.text),
    generatedAt: new Date().toISOString(),
  };
}
