// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { AUDIT_MAX_PAGES, AUDIT_PAGE_SIZE, fetchAllContractEvents } from '@/lib/contract'

type Req = { startLedger?: number; cursor?: string; limit: number; filters: unknown }

/** Fake RPC that serves `pages` in order and records every request. Each page returns a cursor. */
function fakeServer(pages: number[]) {
  const requests: Req[] = []
  let call = 0
  const getEvents = vi.fn(async (req: Req) => {
    requests.push(req)
    const size = pages[call] ?? 0
    const tag = `p${call}`
    call++
    return {
      events: Array.from({ length: size }, (_, i) => ({ id: `${tag}-${i}` })),
      cursor: `${tag}-cursor`,
    }
  })
  return { server: { getEvents } as never, getEvents, requests }
}

describe('fetchAllContractEvents', () => {
  it('follows the cursor across two pages and stops on a short page', async () => {
    const { server, requests } = fakeServer([AUDIT_PAGE_SIZE, 3])
    const out = await fetchAllContractEvents(server, 'CONTRACT', 500)

    expect(out.events).toHaveLength(AUDIT_PAGE_SIZE + 3)
    expect(out.truncated).toBe(false)
    expect(requests).toHaveLength(2)
    expect(requests[0].startLedger).toBe(500)
    expect(requests[1].startLedger).toBeUndefined()
    expect(requests[1].cursor).toBe('p0-cursor')
  })

  it('reports truncation when every allowed page is full', async () => {
    const { server, getEvents } = fakeServer(Array(AUDIT_MAX_PAGES).fill(AUDIT_PAGE_SIZE))
    const out = await fetchAllContractEvents(server, 'CONTRACT', 1)

    expect(out.truncated).toBe(true)
    expect(out.events).toHaveLength(AUDIT_MAX_PAGES * AUDIT_PAGE_SIZE)
    expect(getEvents).toHaveBeenCalledTimes(AUDIT_MAX_PAGES)
  })
})
