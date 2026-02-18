/**
 * Structured JSON Logger
 *
 * Provides leveled structured logging with JSON output suitable for
 * log aggregators (ELK, Loki, CloudWatch, etc.).
 *
 * Format:
 *   {"timestamp":"2025-01-15T12:00:00.000Z","level":"info","service":"smoltbot-gateway","message":"..."}
 *
 * Features:
 *   - Configurable LOG_LEVEL (debug/info/warn/error) via env
 *   - Intercepts console.log/warn/error to route through structured output
 *   - Adds trace_id from AsyncLocalStorage when available
 *   - Service name configurable for multi-role deployments
 */

// ---------------------------------------------------------------------------
// Log levels
// ---------------------------------------------------------------------------

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentLevel: LogLevel = 'info';
let serviceName = 'smoltbot-gateway';

// Store original console methods before patching
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

// ---------------------------------------------------------------------------
// Core write function
// ---------------------------------------------------------------------------

function writeLog(level: LogLevel, args: unknown[]): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;

  const message = args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');

  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    service: serviceName,
    message,
  };

  // Use the original console methods to avoid recursion
  const writer = level === 'error' ? originalConsole.error : originalConsole.log;
  writer(JSON.stringify(entry));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const logger = {
  debug(...args: unknown[]): void {
    writeLog('debug', args);
  },
  info(...args: unknown[]): void {
    writeLog('info', args);
  },
  warn(...args: unknown[]): void {
    writeLog('warn', args);
  },
  error(...args: unknown[]): void {
    writeLog('error', args);
  },
};

/**
 * Initialize the structured logger.
 * Call once at startup before any logging occurs.
 *
 * @param opts.level - Minimum log level (default: process.env.LOG_LEVEL or 'info')
 * @param opts.service - Service name for log entries (default: 'smoltbot-gateway')
 */
export function initLogger(opts?: { level?: string; service?: string }): void {
  const rawLevel = opts?.level ?? process.env.LOG_LEVEL ?? 'info';
  if (rawLevel in LOG_LEVELS) {
    currentLevel = rawLevel as LogLevel;
  } else {
    originalConsole.warn(
      `[logger] Unknown LOG_LEVEL "${rawLevel}", defaulting to "info"`,
    );
    currentLevel = 'info';
  }

  if (opts?.service) {
    serviceName = opts.service;
  }

  // Intercept console methods to route through structured logging
  console.log = (...args: unknown[]) => writeLog('info', args);
  console.info = (...args: unknown[]) => writeLog('info', args);
  console.warn = (...args: unknown[]) => writeLog('warn', args);
  console.error = (...args: unknown[]) => writeLog('error', args);
  console.debug = (...args: unknown[]) => writeLog('debug', args);
}

/**
 * Restore the original console methods (useful for tests).
 */
export function restoreConsole(): void {
  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.debug = originalConsole.debug;
}
