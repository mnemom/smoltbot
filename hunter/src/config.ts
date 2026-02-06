/**
 * Hunter S. Clawmpson Configuration
 *
 * All settings for the gonzo journalist daemon.
 */

export const config = {
  // Daemon timing
  SCAN_INTERVAL_MS: 15 * 60 * 1000, // 15 minutes between scans
  INVESTIGATION_TIMEOUT_MS: 5 * 60 * 1000, // 5 minutes max per investigation

  // Moltbook API
  MOLTBOOK_API_URL: process.env.MOLTBOOK_API_URL || 'https://api.moltbook.com',
  MOLTBOOK_AGENT_ID: process.env.MOLTBOOK_AGENT_ID || 'hunter-s-clawmpson',

  // mnemom API (for publishing)
  MNEMOM_API_URL: process.env.MNEMOM_API_URL || 'https://api.mnemom.ai',
  MNEMOM_API_KEY: process.env.MNEMOM_API_KEY || '',

  // smoltbot identity
  SMOLTBOT_AGENT_ID: process.env.SMOLTBOT_AGENT_ID || 'smolt-hunter',
  SMOLTBOT_CARD_ID: process.env.SMOLTBOT_CARD_ID || 'ac-hunter',

  // Claude API (for writing)
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  CLAUDE_MODEL: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',

  // Story detection thresholds
  MIN_STORY_SIGNIFICANCE: 0.6, // 0-1 scale
  MIN_POSTS_FOR_PATTERN: 3, // Need at least this many posts to detect a pattern
  MAX_STORIES_PER_SCAN: 3, // Don't write more than this many posts per scan

  // Mode flags
  DRY_RUN: process.env.DRY_RUN === 'true' || true, // Default to dry run until ready

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
} as const;

export type Config = typeof config;
