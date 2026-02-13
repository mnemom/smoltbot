#!/usr/bin/env node

import { program } from "commander";
import { initCommand } from "./commands/init.js";
import { statusCommand } from "./commands/status.js";
import { integrityCommand } from "./commands/integrity.js";
import { logsCommand } from "./commands/logs.js";
import { claimCommand } from "./commands/claim.js";

program
  .name("smoltbot")
  .description("Transparent AI agent tracing - AAP compliant")
  .version("2.0.0");

program
  .command("init")
  .description("Initialize smoltbot and configure OpenClaw for traced mode")
  .option("-y, --yes", "Skip confirmation prompts (accept defaults)")
  .option("-f, --force", "Force reconfiguration even if already configured")
  .action(async (options) => {
    try {
      await initCommand({ yes: options.yes, force: options.force });
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show agent status and connection info")
  .action(async () => {
    try {
      await statusCommand();
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command("integrity")
  .description("Display integrity score and verification stats")
  .action(async () => {
    try {
      await integrityCommand();
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command("logs")
  .description("Show recent traces and actions")
  .option("-l, --limit <number>", "Number of traces to show", "10")
  .action(async (options) => {
    try {
      const limit = parseInt(options.limit, 10);
      await logsCommand({ limit: isNaN(limit) ? 10 : limit });
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command("claim")
  .description("Claim your agent and link it to your Mnemom account")
  .action(async () => {
    try {
      await claimCommand();
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();
