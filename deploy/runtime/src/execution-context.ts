/**
 * Node.js ExecutionContext Adapter
 *
 * Replaces the Cloudflare Workers ExecutionContext with a Node.js-compatible
 * implementation. The gateway calls ctx.waitUntil() ~8 times per request
 * and the observer ~10 times per cron tick for fire-and-forget background work.
 *
 * All promises are collected and can be drained after the response is sent.
 */

export class NodeExecutionContext {
  private promises: Promise<unknown>[] = [];

  /**
   * Register a background promise. Errors are swallowed and logged,
   * matching Cloudflare Workers behavior where waitUntil failures
   * do not affect the response.
   */
  waitUntil(promise: Promise<unknown>): void {
    this.promises.push(
      promise.catch((err) => {
        console.error('[waitUntil] Background task failed:', err);
      }),
    );
  }

  /**
   * No-op in Node.js. On Cloudflare, this tells the runtime to forward
   * the response even if the worker throws after calling this.
   * In Node.js we handle errors at the HTTP server level.
   */
  passThroughOnException(): void {
    // no-op
  }

  /**
   * Await all collected promises with an optional timeout.
   * Call this after the HTTP response has been sent to ensure
   * background work completes before the process might exit.
   *
   * @param timeoutMs Maximum time to wait for all promises (default 30s)
   */
  async drain(timeoutMs = 30_000): Promise<void> {
    if (this.promises.length === 0) return;

    const pending = Promise.allSettled(this.promises);

    const timeout = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        console.warn(
          `[ExecutionContext] drain() timed out after ${timeoutMs}ms ` +
            `with ${this.promises.length} pending promise(s)`,
        );
        resolve();
      }, timeoutMs);
      // Allow the Node.js process to exit even if the timer is still pending
      if (typeof timer === 'object' && 'unref' in timer) {
        timer.unref();
      }
    });

    await Promise.race([pending, timeout]);
    this.promises = [];
  }
}
