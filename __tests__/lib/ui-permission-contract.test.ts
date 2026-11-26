import { describe, it, expect } from 'vitest'
import { rolePermissions, type Permission, type Role } from '@/lib/rbac'

/**
 * Expected outcomes, derived from the contract authorisation tests in
 * contracts/complyrail/src/test.rs. Each row names the test it comes from.
 *
 * Only role and action pairs with a contract test are listed. Pairs without
 * one (for example vasp or viewer registering a VASP, or anyone exporting the
 * audit log, which is not a contract call) are left out on purpose.
 *
 * Release and reject are per payment in the contract: the beneficiary VASP may
 * release, the originating VASP may not. The role matrix can only express the
 * beneficiary case, so the vasp rows describe that case.
 */
interface ContractRow {
  role: Role
  action: keyof Permission
  allowed: boolean
  source: string
}

const CONTRACT_TABLE: ContractRow[] = [
  { role: 'admin', action: 'canRegisterVasp', allowed: true, source: 'register_and_get_vasp' },
  { role: 'admin', action: 'canSetThreshold', allowed: false, source: 'admin_cannot_set_threshold' },
  { role: 'admin', action: 'canUpdateVaspStatus', allowed: true, source: 'suspended_vasp_can_be_reactivated' },
  { role: 'admin', action: 'canReleasePayment', allowed: true, source: 'admin_can_release_and_outsider_cannot' },
  { role: 'admin', action: 'canRejectPayment', allowed: true, source: 'admin_reject_with_attestation_refunds_originator' },
  { role: 'vasp', action: 'canSubmitPayment', allowed: true, source: 'above_threshold_full_flow' },
  { role: 'vasp', action: 'canSubmitAttestation', allowed: true, source: 'above_threshold_full_flow' },
  { role: 'vasp', action: 'canReleasePayment', allowed: true, source: 'above_threshold_full_flow (beneficiary)' },
  { role: 'vasp', action: 'canRejectPayment', allowed: true, source: 'beneficiary_can_reject_queried_payment' },
  { role: 'inactive-vasp', action: 'canSubmitPayment', allowed: false, source: 'expired_vasp_is_inactive' },
  { role: 'inactive-vasp', action: 'canReleasePayment', allowed: false, source: 'release_fails_if_beneficiary_vasp_suspended_after_submit' },
  { role: 'viewer', action: 'canReleasePayment', allowed: false, source: 'admin_can_release_and_outsider_cannot (outsider)' },
]

describe('UI permission matrix matches contract authorisation', () => {
  it.each(CONTRACT_TABLE)('$role $action is $allowed (contract test: $source)', row => {
    expect(rolePermissions[row.role][row.action]).toBe(row.allowed)
  })
})
