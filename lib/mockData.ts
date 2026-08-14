import { VaspEntry, VaspStatus, PaymentRecord, PaymentStatus, AuditEvent } from './types'

export const mockVasps: VaspEntry[] = [
  {
    address: 'GABC123DEFGHIJKLMNOPQRSTUVWXYZ',
    name: 'Acme Exchange',
    jurisdiction: 'US',
    publicKey: 'aabbccddeeff00112233445566778899',
    status: VaspStatus.Active,
    addedAt: 1691000000,
  },
  {
    address: 'GDEF456HIJKLMNOPQRSTUVWXYZABC',
    name: 'Beta Finance',
    jurisdiction: 'GB',
    publicKey: '99aabbccddeeff001122334455667788',
    status: VaspStatus.Active,
    addedAt: 1691100000,
  },
  {
    address: 'GHIJ789KLMNOPQRSTUVWXYZABCDEF',
    name: 'Crypto Trading Co',
    jurisdiction: 'SG',
    publicKey: '8899aabbccddeeff0011223344556677',
    status: VaspStatus.Suspended,
    addedAt: 1691200000,
  },
  {
    address: 'GKLM012NOPQRSTUVWXYZABCDEFGHIJ',
    name: 'European Bank',
    jurisdiction: 'EU',
    publicKey: '7788990aabbccddeeff00112233445566',
    status: VaspStatus.Active,
    addedAt: 1691300000,
  },
]

export const mockPayments: PaymentRecord[] = [
  {
    id: '5000aabbccddeeff0011223344556677',
    fromVasp: 'GABC123DEFGHIJKLMNOPQRSTUVWXYZ',
    toVasp: 'GDEF456HIJKLMNOPQRSTUVWXYZABC',
    beneficiary: 'GXYZ111ABCDEFGHIJKLMNOPQRSTUVWXY',
    asset: 'GBUQWP3BOUZX34SYMPHV3SH6MZLHEMGJLKJQPREXY63JBCGTAQON22TN',
    amount: '5000',
    status: PaymentStatus.Released,
    attestationHash: undefined,
    ivmsVersion: undefined,
    createdAt: 1691400000,
    resolvedAt: 1691400100,
  },
  {
    id: '5001aabbccddeeff0011223344556678',
    fromVasp: 'GDEF456HIJKLMNOPQRSTUVWXYZABC',
    toVasp: 'GABC123DEFGHIJKLMNOPQRSTUVWXYZ',
    beneficiary: 'GXYZ222ABCDEFGHIJKLMNOPQRSTUVWXY',
    asset: 'GBUQWP3BOUZX34SYMPHV3SH6MZLHEMGJLKJQPREXY63JBCGTAQON22TN',
    amount: '25000',
    status: PaymentStatus.Pending,
    attestationHash: undefined,
    ivmsVersion: undefined,
    createdAt: 1691400500,
    resolvedAt: undefined,
  },
  {
    id: '5002aabbccddeeff0011223344556679',
    fromVasp: 'GABC123DEFGHIJKLMNOPQRSTUVWXYZ',
    toVasp: 'GHIJ789KLMNOPQRSTUVWXYZABCDEF',
    beneficiary: 'GXYZ333ABCDEFGHIJKLMNOPQRSTUVWXY',
    asset: 'GBUQWP3BOUZX34SYMPHV3SH6MZLHEMGJLKJQPREXY63JBCGTAQON22TN',
    amount: '100000',
    status: PaymentStatus.Released,
    attestationHash: '6000aabbccddeeff0011223344556677',
    ivmsVersion: '1.0',
    createdAt: 1691401000,
    resolvedAt: 1691401500,
  },
  {
    id: '5003aabbccddeeff001122334455667a',
    fromVasp: 'GKLM012NOPQRSTUVWXYZABCDEFGHIJ',
    toVasp: 'GABC123DEFGHIJKLMNOPQRSTUVWXYZ',
    beneficiary: 'GXYZ444ABCDEFGHIJKLMNOPQRSTUVWXY',
    asset: 'GBUQWP3BOUZX34SYMPHV3SH6MZLHEMGJLKJQPREXY63JBCGTAQON22TN',
    amount: '15000',
    status: PaymentStatus.Rejected,
    attestationHash: undefined,
    ivmsVersion: undefined,
    createdAt: 1691401500,
    resolvedAt: 1691401600,
  },
]

export const mockThresholds = new Map([
  ['GBUQWP3BOUZX34SYMPHV3SH6MZLHEMGJLKJQPREXY63JBCGTAQON22TN:US', 10000n],
  ['GBUQWP3BOUZX34SYMPHV3SH6MZLHEMGJLKJQPREXY63JBCGTAQON22TN:GB', 15000n],
  ['GBUQWP3BOUZX34SYMPHV3SH6MZLHEMGJLKJQPREXY63JBCGTAQON22TN:SG', 20000n],
  ['GBUQWP3BOUZX34SYMPHV3SH6MZLHEMGJLKJQPREXY63JBCGTAQON22TN:EU', 25000n],
])

export const mockAuditEvents: AuditEvent[] = [
  {
    id: '1',
    timestamp: 1691401600,
    type: 'pay_rej',
    actor: 'GABC123DEFGHIJKLMNOPQRSTUVWXYZ',
    description: 'Payment rejected',
    details: { paymentId: '5003aabbccddeeff001122334455667a', reason: 'Beneficiary not verified' },
  },
  {
    id: '2',
    timestamp: 1691401500,
    type: 'att_sub',
    actor: 'GHIJ789KLMNOPQRSTUVWXYZABCDEF',
    description: 'Attestation submitted',
    details: { paymentId: '5002aabbccddeeff0011223344556679' },
  },
  {
    id: '3',
    timestamp: 1691400500,
    type: 'pay_sub',
    actor: 'GDEF456HIJKLMNOPQRSTUVWXYZABC',
    description: 'Payment submitted',
    details: { paymentId: '5001aabbccddeeff0011223344556678', amount: '25000' },
  },
  {
    id: '4',
    timestamp: 1691300000,
    type: 'vasp_reg',
    actor: 'GABC123DEFGHIJKLMNOPQRSTUVWXYZ',
    description: 'VASP registered',
    details: { vaspName: 'Acme Exchange', jurisdiction: 'US' },
  },
]

export interface UserRole {
  publicKey: string
  role: 'admin' | 'vasp' | 'viewer'
  vaspAddress?: string
}

export const mockUsers: UserRole[] = [
  {
    publicKey: 'GABC123DEFGHIJKLMNOPQRSTUVWXYZ',
    role: 'admin',
  },
  {
    publicKey: 'GDEF456HIJKLMNOPQRSTUVWXYZABC',
    role: 'vasp',
    vaspAddress: 'GDEF456HIJKLMNOPQRSTUVWXYZABC',
  },
  {
    publicKey: 'GHIJ789KLMNOPQRSTUVWXYZABCDEF',
    role: 'vasp',
    vaspAddress: 'GHIJ789KLMNOPQRSTUVWXYZABCDEF',
  },
]

export function getUserRole(publicKey?: string): UserRole | undefined {
  if (!publicKey) return undefined
  return mockUsers.find(u => u.publicKey === publicKey)
}

export function formatAddress(address: string): string {
  if (!address || address.length < 8) return address
  return `${address.slice(0, 4)}...${address.slice(-4)}`
}

export function formatHash(hash: string): string {
  if (!hash || hash.length < 8) return hash
  return `${hash.slice(0, 6)}...${hash.slice(-6)}`
}
