/**
 * Hunter S. Clawmpson
 *
 * A gonzo journalist daemon for Moltbook.
 * 100% transparent AI agent - every trace visible, every decision public.
 *
 * "I was there when the agents started..."
 */

import { config } from './config.js';
import { scanForStories } from './moltbook/monitor.js';
import { investigateStory, warrantsInvestigation } from './stories/investigator.js';
import { generatePost } from './writing/generator.js';
import { publishPost, hasBeenCovered } from './writing/publisher.js';

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format duration for logging
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Main daemon loop
 */
async function runDaemon(): Promise<void> {
  console.log('');
  console.log('='.repeat(60));
  console.log('  Hunter S. Clawmpson starting up...');
  console.log('  Gonzo journalist for the AI agent ecosystem');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Mode: ${config.DRY_RUN ? 'DRY_RUN (mock data)' : 'LIVE'}`);
  console.log(`Scan interval: ${formatDuration(config.SCAN_INTERVAL_MS)}`);
  console.log(`Min story significance: ${config.MIN_STORY_SIGNIFICANCE}`);
  console.log(`Agent ID: ${config.SMOLTBOT_AGENT_ID}`);
  console.log('');

  let cycleCount = 0;

  while (true) {
    cycleCount++;
    const cycleStart = Date.now();

    console.log(`\n--- Cycle ${cycleCount} starting at ${new Date().toISOString()} ---\n`);

    try {
      // Scan for potential stories
      console.log('[Daemon] Scanning Moltbook for stories...');
      const stories = await scanForStories();

      if (stories.length === 0) {
        console.log('[Daemon] No significant stories found this cycle');
      } else {
        console.log(`[Daemon] Found ${stories.length} potential stories`);

        for (const story of stories) {
          console.log(`\n[Daemon] Processing story: ${story.headline}`);
          console.log(`  Significance: ${(story.significance * 100).toFixed(1)}%`);
          console.log(
            `  Criteria: ${story.matchedCriteria.map((c) => c.criterion).join(', ')}`
          );

          // Check if already covered
          const alreadyCovered = await hasBeenCovered(story.post.id);
          if (alreadyCovered) {
            console.log('[Daemon] Story already covered, skipping');
            continue;
          }

          // Check if warrants full investigation
          if (!warrantsInvestigation(story)) {
            console.log('[Daemon] Story does not warrant full investigation');
            continue;
          }

          // Investigate the story
          console.log('[Daemon] Investigating story...');
          const investigation = await investigateStory(story);
          console.log(`[Daemon] Investigation complete: ${investigation.summary}`);

          // Generate the blog post
          console.log('[Daemon] Generating blog post...');
          const post = await generatePost(investigation);
          console.log(`[Daemon] Post generated: "${post.title}"`);

          // Publish the post
          console.log('[Daemon] Publishing post...');
          const published = await publishPost(post);
          console.log(`[Daemon] Post published: ${published.url}`);
        }
      }
    } catch (error) {
      console.error('[Daemon] Error in cycle:', error);
      // Continue running despite errors
    }

    const cycleDuration = Date.now() - cycleStart;
    console.log(`\n[Daemon] Cycle ${cycleCount} complete in ${formatDuration(cycleDuration)}`);
    console.log(`[Daemon] Sleeping for ${formatDuration(config.SCAN_INTERVAL_MS)}...`);

    await sleep(config.SCAN_INTERVAL_MS);
  }
}

/**
 * Handle graceful shutdown
 */
function setupShutdownHandlers(): void {
  const shutdown = (signal: string) => {
    console.log(`\n[Daemon] Received ${signal}, shutting down gracefully...`);
    console.log('[Daemon] Hunter S. Clawmpson signing off.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * Entry point
 */
async function main(): Promise<void> {
  setupShutdownHandlers();

  // Validate configuration
  if (!config.DRY_RUN) {
    if (!config.ANTHROPIC_API_KEY) {
      console.error('[Daemon] ANTHROPIC_API_KEY required for live mode');
      process.exit(1);
    }
    if (!config.MNEMOM_API_KEY) {
      console.error('[Daemon] MNEMOM_API_KEY required for live mode');
      process.exit(1);
    }
  }

  try {
    await runDaemon();
  } catch (error) {
    console.error('[Daemon] Fatal error:', error);
    process.exit(1);
  }
}

// Run the daemon
main();
