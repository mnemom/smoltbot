#!/usr/bin/env node

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import { CONFIG_DIR, CONFIG_FILE, getAgentUrl, type StoredConfig } from '../src/config.js';

/**
 * CLI version
 */
const VERSION = '0.1.0';

/**
 * Print usage information
 */
function printUsage(): void {
  console.log(`
smoltbot - AAP trace collection CLI

Usage:
  smoltbot init          Initialize smoltbot with a new agent ID
  smoltbot status        Show current configuration status
  smoltbot reset         Reset configuration (generates new agent ID)
  smoltbot version       Show version information
  smoltbot help          Show this help message

Environment Variables:
  SMOLTBOT_API_URL       Supabase project URL (e.g., https://xyz.supabase.co)
  SMOLTBOT_API_KEY       Supabase service_role key (for write access)
  SMOLTBOT_ENABLED       Enable/disable trace collection (default: true)
  SMOLTBOT_BATCH_SIZE    Number of traces to batch (default: 1)
  SMOLTBOT_TIMEOUT       API timeout in milliseconds (default: 5000)
`);
}

/**
 * Initialize smoltbot configuration
 */
function init(force: boolean = false): void {
  if (existsSync(CONFIG_FILE) && !force) {
    console.error('Error: smoltbot is already initialized.');
    console.error('Use "smoltbot status" to view current configuration.');
    console.error('Use "smoltbot reset" to generate a new agent ID.');
    process.exit(1);
  }

  // Create config directory if it doesn't exist
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const agentId = uuidv4();
  const config: StoredConfig = {
    agentId,
    createdAt: new Date().toISOString(),
    version: VERSION,
  };

  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

  console.log('');
  console.log('smoltbot initialized successfully!');
  console.log('');
  console.log(`Agent ID: ${agentId}`);
  console.log(`Config:   ${CONFIG_FILE}`);
  console.log('');
  console.log('View your agent dashboard at:');
  console.log(`  ${getAgentUrl(agentId)}`);
  console.log('');
  console.log('To start collecting traces, set your Supabase credentials:');
  console.log('  export SMOLTBOT_API_URL=https://your-project.supabase.co');
  console.log('  export SMOLTBOT_API_KEY=your-service-role-key');
  console.log('');
}

/**
 * Show current status
 */
function status(): void {
  if (!existsSync(CONFIG_FILE)) {
    console.log('smoltbot is not initialized.');
    console.log('Run "smoltbot init" to get started.');
    process.exit(1);
  }

  try {
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(content) as StoredConfig;

    console.log('');
    console.log('smoltbot Status');
    console.log('---------------');
    console.log(`Agent ID:    ${config.agentId}`);
    console.log(`Created:     ${config.createdAt}`);
    console.log(`Version:     ${config.version}`);
    console.log(`Config:      ${CONFIG_FILE}`);
    console.log('');
    console.log('Environment:');
    console.log(`  SMOLTBOT_API_URL:    ${process.env.SMOLTBOT_API_URL || '(not set)'}`);
    console.log(`  SMOLTBOT_API_KEY:    ${process.env.SMOLTBOT_API_KEY ? '(set)' : '(not set)'}`);
    console.log(`  SMOLTBOT_ENABLED:    ${process.env.SMOLTBOT_ENABLED || 'true (default)'}`);
    console.log(`  SMOLTBOT_BATCH_SIZE: ${process.env.SMOLTBOT_BATCH_SIZE || '1 (default)'}`);
    console.log(`  SMOLTBOT_TIMEOUT:    ${process.env.SMOLTBOT_TIMEOUT || '5000 (default)'}`);
    console.log('');
    console.log('Dashboard:');
    console.log(`  ${getAgentUrl(config.agentId)}`);
    console.log('');
  } catch (error) {
    console.error('Error reading configuration:', error);
    process.exit(1);
  }
}

/**
 * Reset configuration
 */
function reset(): void {
  if (!existsSync(CONFIG_FILE)) {
    console.log('smoltbot is not initialized. Running init instead...');
    init();
    return;
  }

  console.log('Warning: This will generate a new agent ID.');
  console.log('Your previous agent data will remain but will no longer be linked.');
  console.log('');

  init(true);
}

/**
 * Show version
 */
function version(): void {
  console.log(`smoltbot v${VERSION}`);
}

/**
 * Main CLI entry point
 */
function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'init':
      init();
      break;
    case 'status':
      status();
      break;
    case 'reset':
      reset();
      break;
    case 'version':
    case '-v':
    case '--version':
      version();
      break;
    case 'help':
    case '-h':
    case '--help':
    case undefined:
      printUsage();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main();
