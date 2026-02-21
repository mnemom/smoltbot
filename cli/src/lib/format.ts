import chalk from "chalk";

export type BadgeColor = "green" | "red" | "yellow" | "blue" | "cyan" | "magenta" | "white";

export const fmt = {
  /**
   * Bold header with "═" double-line border
   */
  header(title: string): string {
    const line = "═".repeat(60);
    return `\n${chalk.bold(line)}\n  ${chalk.bold(title)}\n${chalk.bold(line)}`;
  },

  /**
   * Dim section divider with "─" line
   */
  section(title: string): string {
    const line = "─".repeat(50);
    return `\n${chalk.dim(line)}\n${title}\n${chalk.dim(line)}`;
  },

  /**
   * Green check mark with message
   */
  success(msg: string): string {
    return `${chalk.green("✓")} ${msg}`;
  },

  /**
   * Red cross with message
   */
  error(msg: string): string {
    return `${chalk.red("✗")} ${msg}`;
  },

  /**
   * Yellow warning with message
   */
  warn(msg: string): string {
    return `${chalk.yellow("⚠")} ${msg}`;
  },

  /**
   * Dim label with value
   */
  label(key: string, val: string): string {
    return `${chalk.dim(key)} ${val}`;
  },

  /**
   * Syntax-highlighted JSON output
   */
  json(obj: unknown): string {
    const raw = JSON.stringify(obj, null, 2);
    return raw
      .replace(/"([^"]+)":/g, (_match, key: string) => `${chalk.cyan(`"${key}"`)}:`)
      .replace(/: "([^"]*)"/g, (_match, val: string) => `: ${chalk.green(`"${val}"`)}`)
      .replace(/: (\d+)/g, (_match, num: string) => `: ${chalk.yellow(num)}`)
      .replace(/: (true|false)/g, (_match, bool: string) => `: ${chalk.magenta(bool)}`)
      .replace(/: (null)/g, (_match, n: string) => `: ${chalk.dim(n)}`);
  },

  /**
   * Colored inline badge
   */
  badge(text: string, color: BadgeColor = "blue"): string {
    const colorFn = chalk[color] || chalk.blue;
    return colorFn(`[${text}]`);
  },
};
