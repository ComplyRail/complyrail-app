// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { withRetry, isTransientError } from '@/lib/retry'

const noSleep = () => Promise.resolve()

describe('withRetry', () => {
  it('returns the value of a read that fails twice and then succeeds', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
      .mockResolvedValueOnce('ok')
    const sleep = vi.fn(noSleep)

    await expect(withRetry(fn, { sleep })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('gives up after three retries', async () => {
    const fn = vi.fn(() => Promise.reject(new Error('network error')))
    await expect(withRetry(fn, { sleep: noSleep })).rejects.toThrow('network error')
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('does not retry errors that are not transient', async () => {
    const fn = vi.fn(() => Promise.reject(new Error('Error(Contract, #4)')))
    await expect(withRetry(fn, { sleep: noSleep })).rejects.toThrow('Contract')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('backs off exponentially with jitter', async () => {
    const fn = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(1)
    const delays: number[] = []
    await withRetry(fn, {
      baseDelayMs: 100,
      random: () => 0,
      sleep: async ms => {
        delays.push(ms)
      },
    })
    // random() = 0 gives the lower bound: 50% of base * 2^attempt.
    expect(delays).toEqual([50, 100])
  })

  it('keeps delays within the jitter band', async () => {
    const fn = vi.fn<() => Promise<number>>().mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce(1)
    const sleep = vi.fn((_ms: number) => Promise.resolve())
    await withRetry(fn, { baseDelayMs: 200, random: () => 0.999, sleep })
    const delay = sleep.mock.calls[0][0]
    expect(delay).toBeGreaterThan(100)
    expect(delay).toBeLessThanOrEqual(200)
  })
})

describe('isTransientError', () => {
  it('matches rate limits, drops and gateway errors', () => {
    expect(isTransientError(new Error('429'))).toBe(true)
    expect(isTransientError(new Error('Rate limit exceeded'))).toBe(true)
    expect(isTransientError(new Error('Failed to fetch'))).toBe(true)
    expect(isTransientError(new Error('502 Bad Gateway'))).toBe(true)
  })

  it('does not match contract or validation errors', () => {
    expect(isTransientError(new Error('VaspNotActive'))).toBe(false)
  })
})
