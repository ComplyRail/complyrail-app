export interface RetryOptions {
  /** Retries after the first attempt. */
  retries?: number
  /** Delay before the first retry; doubles on each further retry. */
  baseDelayMs?: number
  /** Only errors for which this returns true are retried. */
  shouldRetry?: (error: unknown) => boolean
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>
  /** Injectable for tests. Must return a value in [0, 1). */
  random?: () => number
}

const TRANSIENT = /429|rate.?limit|too many requests|timed? ?out|timeout|network|fetch failed|failed to fetch|ECONNRESET|ETIMEDOUT|ECONNREFUSED|50[234]/i

/** Rate limits, dropped connections and gateway errors. Contract errors are not transient. */
export function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return TRANSIENT.test(message)
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Runs `fn`, retrying transient failures with exponential backoff and jitter.
 * Use only for idempotent reads: a retried write could be submitted twice.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    retries = 3,
    baseDelayMs = 250,
    shouldRetry = isTransientError,
    sleep = defaultSleep,
    random = Math.random,
  } = options

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) throw error
      // Jitter between 50% and 100% of the exponential delay.
      const delay = baseDelayMs * 2 ** attempt * (0.5 + random() / 2)
      await sleep(delay)
    }
  }
}
