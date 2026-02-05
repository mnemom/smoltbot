#!/usr/bin/env node

import { program } from "commander";
import { initCommand } from "./commands/init.js";
import { statusCommand } from "./commands/status.js";
import { integrityCommand } from "./commands/integrity.js";
import { logsCommand } from "./commands/logs.js";

program
  .name("smoltbot")
  .description("Transparent AI agent tracing - AAP compliant")
  .version("2.0.0");

program
  .command("init")
  .description("Initialize smoltbot and generate agent ID")
  .action(async () => {
    try {
      await initCommand();
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

program.parse();
