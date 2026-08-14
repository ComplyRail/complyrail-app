import { describe, it, expect } from 'vitest'
import { mockVasps, mockPayments, mockAuditEvents } from '@/lib/mockData'

describe('Mock Data', () => {
  describe('mockVasps', () => {
    it('should have at least one VASP', () => {
      expect(mockVasps.length).toBeGreaterThan(0)
    })

    it('each VASP should have required fields', () => {
      mockVasps.forEach(vasp => {
        expect(vasp).toHaveProperty('address')
        expect(vasp).toHaveProperty('name')
        expect(vasp).toHaveProperty('status')
        expect(vasp).toHaveProperty('jurisdiction')
        expect(vasp).toHaveProperty('addedAt')
      })
    })

    it('VASP should have valid address format', () => {
      mockVasps.forEach(vasp => {
        expect(vasp.address).toMatch(/^G[A-Z0-9]+$/)
        expect(vasp.address.length).toBeGreaterThan(10)
      })
    })

    it('VASP jurisdiction should be a valid code', () => {
      mockVasps.forEach(vasp => {
        expect(vasp.jurisdiction.length).toBeGreaterThan(0)
      })
    })
  })

  describe('mockPayments', () => {
    it('should have at least one payment', () => {
      expect(mockPayments.length).toBeGreaterThan(0)
    })

    it('each payment should have required fields', () => {
      mockPayments.forEach(payment => {
        expect(payment).toHaveProperty('id')
        expect(payment).toHaveProperty('fromVasp')
        expect(payment).toHaveProperty('toVasp')
        expect(payment).toHaveProperty('amount')
        expect(payment).toHaveProperty('status')
        expect(payment).toHaveProperty('createdAt')
      })
    })

    it('payment amount should be a string (numeric)', () => {
      mockPayments.forEach(payment => {
        expect(typeof payment.amount).toBe('string')
        expect(!isNaN(Number(payment.amount))).toBe(true)
        expect(Number(payment.amount)).toBeGreaterThan(0)
      })
    })

    it('payment from/to should have valid VASP addresses', () => {
      mockPayments.forEach(payment => {
        expect(payment.fromVasp).toMatch(/^G[A-Z0-9]+$/)
        expect(payment.toVasp).toMatch(/^G[A-Z0-9]+$/)
      })
    })
  })

  describe('mockAuditEvents', () => {
    it('should have at least one audit event', () => {
      expect(mockAuditEvents.length).toBeGreaterThan(0)
    })

    it('each event should have required fields', () => {
      mockAuditEvents.forEach(event => {
        expect(event).toHaveProperty('id')
        expect(event).toHaveProperty('type')
        expect(event).toHaveProperty('actor')
        expect(event).toHaveProperty('timestamp')
        expect(event).toHaveProperty('description')
      })
    })

    it('event type should be valid', () => {
      const validTypes = ['vasp_reg', 'vasp_upd', 'thr_set', 'pay_sub', 'att_sub', 'pay_rel', 'pay_rej']
      mockAuditEvents.forEach(event => {
        expect(validTypes).toContain(event.type)
      })
    })

    it('timestamp should be a unix timestamp (number)', () => {
      mockAuditEvents.forEach(event => {
        expect(typeof event.timestamp).toBe('number')
        expect(event.timestamp).toBeGreaterThan(0)
      })
    })

    it('actor should have valid VASP address format', () => {
      mockAuditEvents.forEach(event => {
        expect(event.actor).toMatch(/^G[A-Z0-9]+$/)
      })
    })
  })
})
