// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/contract', () => ({
  getAdmin: vi.fn(),
  getVasp: vi.fn(),
  isVaspActive: vi.fn(),
}))
vi.mock('@/lib/config', () => ({ isContractConfigured: true }))

import * as api from '@/lib/contract'
import { fetchRole } from '@/lib/hooks'

const WALLET = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7'
const ADMIN = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H'

const mocked = vi.mocked(api)

describe('fetchRole', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocked.getAdmin.mockResolvedValue(ADMIN)
  })

  it('returns viewer when there is no address', async () => {
    expect(await fetchRole(undefined)).toBe('viewer')
    expect(mocked.getAdmin).not.toHaveBeenCalled()
  })

  it('returns admin for the admin address', async () => {
    expect(await fetchRole(ADMIN)).toBe('admin')
  })

  it('returns viewer for an unregistered address', async () => {
    mocked.getVasp.mockResolvedValue(null)
    expect(await fetchRole(WALLET)).toBe('viewer')
    expect(mocked.isVaspActive).not.toHaveBeenCalled()
  })

  it('returns vasp for a registered, active VASP', async () => {
    mocked.getVasp.mockResolvedValue({} as never)
    mocked.isVaspActive.mockResolvedValue(true)
    expect(await fetchRole(WALLET)).toBe('vasp')
  })

  it('returns inactive-vasp for a registered VASP that is suspended, revoked or expired', async () => {
    mocked.getVasp.mockResolvedValue({} as never)
    mocked.isVaspActive.mockResolvedValue(false)
    expect(await fetchRole(WALLET)).toBe('inactive-vasp')
  })
})
