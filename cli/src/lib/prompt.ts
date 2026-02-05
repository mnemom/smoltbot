import * as readline from "node:readline";

/**
 * Ask a yes/no question with a default answer
 * @param question The question to ask
 * @param defaultYes If true, default is Yes (Y/n), otherwise default is No (y/N)
 * @returns Promise<boolean> - true for yes, false for no
 */
export async function askYesNo(
  question: string,
  defaultYes: boolean = true
): Promise<boolean> {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} ${suffix} `, (answer) => {
      rl.close();

      const normalized = answer.trim().toLowerCase();

      if (normalized === "") {
        // Use default
        resolve(defaultYes);
      } else if (normalized === "y" || normalized === "yes") {
        resolve(true);
      } else if (normalized === "n" || normalized === "no") {
        resolve(false);
      } else {
        // Invalid input, use default
        resolve(defaultYes);
      }
    });
  });
}

/**
 * Check if running in non-interactive mode (no TTY)
 */
export function isInteractive(): boolean {
  return process.stdin.isTTY === true;
}
