import { describe, it, expect } from 'vitest'
import { getPermissions, can, rolePermissions } from '@/lib/rbac'

describe('RBAC', () => {
  describe('rolePermissions', () => {
    it('should have admin, vasp, and viewer roles', () => {
      expect(rolePermissions).toHaveProperty('admin')
      expect(rolePermissions).toHaveProperty('vasp')
      expect(rolePermissions).toHaveProperty('viewer')
    })

    it('admin should have all permissions', () => {
      const adminPerms = rolePermissions.admin
      expect(adminPerms.canRegisterVasp).toBe(true)
      expect(adminPerms.canUpdateVaspStatus).toBe(true)
      expect(adminPerms.canReleasePayment).toBe(true)
      expect(adminPerms.canExportAuditLog).toBe(true)
    })

    it('vasp role should have limited permissions', () => {
      const vaspPerms = rolePermissions.vasp
      expect(vaspPerms.canRegisterVasp).toBe(false)
      expect(vaspPerms.canSubmitPayment).toBe(true)
      expect(vaspPerms.canReleasePayment).toBe(false)
    })

    it('viewer role should be read-only', () => {
      const viewerPerms = rolePermissions.viewer
      expect(viewerPerms.canRegisterVasp).toBe(false)
      expect(viewerPerms.canSubmitPayment).toBe(false)
      expect(viewerPerms.canExportAuditLog).toBe(true)
    })
  })

  describe('getPermissions', () => {
    it('should return admin permissions for admin role', () => {
      const perms = getPermissions('admin')
      expect(perms.canRegisterVasp).toBe(true)
    })

    it('should return viewer permissions for undefined role', () => {
      const perms = getPermissions(undefined)
      expect(perms.canRegisterVasp).toBe(false)
    })
  })

  describe('can', () => {
    it('admin can register VASP', () => {
      expect(can('admin', 'canRegisterVasp')).toBe(true)
    })

    it('vasp cannot register VASP', () => {
      expect(can('vasp', 'canRegisterVasp')).toBe(false)
    })

    it('vasp can submit payment', () => {
      expect(can('vasp', 'canSubmitPayment')).toBe(true)
    })

    it('undefined role cannot register VASP', () => {
      expect(can(undefined, 'canRegisterVasp')).toBe(false)
    })

    it('all roles can export audit log', () => {
      expect(can('admin', 'canExportAuditLog')).toBe(true)
      expect(can('vasp', 'canExportAuditLog')).toBe(true)
      expect(can('viewer', 'canExportAuditLog')).toBe(true)
    })
  })
})
