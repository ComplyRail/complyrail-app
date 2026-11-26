/** `inactive-vasp`: registered, but suspended, revoked or expired. Has no VASP actions. */
export type Role = 'admin' | 'vasp' | 'inactive-vasp' | 'viewer'

export interface Permission {
  canRegisterVasp: boolean
  canUpdateVaspStatus: boolean
  canSetThreshold: boolean
  canSubmitPayment: boolean
  canSubmitAttestation: boolean
  canReleasePayment: boolean
  canRejectPayment: boolean
  canExportAuditLog: boolean
}

export const rolePermissions: Record<Role, Permission> = {
  admin: {
    canRegisterVasp: true,
    canUpdateVaspStatus: true,
    canSetThreshold: false,
    canSubmitPayment: true,
    canSubmitAttestation: true,
    canReleasePayment: true,
    canRejectPayment: true,
    canExportAuditLog: true,
  },
  vasp: {
    canRegisterVasp: false,
    canUpdateVaspStatus: false,
    canSetThreshold: false,
    canSubmitPayment: true,
    canSubmitAttestation: true,
    canReleasePayment: true,
    canRejectPayment: true,
    canExportAuditLog: true,
  },
  'inactive-vasp': {
    canRegisterVasp: false,
    canUpdateVaspStatus: false,
    canSetThreshold: false,
    canSubmitPayment: false,
    canSubmitAttestation: false,
    canReleasePayment: false,
    canRejectPayment: false,
    canExportAuditLog: true,
  },
  viewer: {
    canRegisterVasp: false,
    canUpdateVaspStatus: false,
    canSetThreshold: false,
    canSubmitPayment: false,
    canSubmitAttestation: false,
    canReleasePayment: false,
    canRejectPayment: false,
    canExportAuditLog: true,
  },
}

export function getPermissions(role?: Role): Permission {
  return role ? rolePermissions[role] : rolePermissions.viewer
}

export function can(role: Role | undefined, action: keyof Permission): boolean {
  if (!role) return false
  const permissions = getPermissions(role)
  return permissions[action]
}
