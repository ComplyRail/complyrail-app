/** Contract error codes from contracts/complyrail/src/lib.rs, as user-facing text. */
export const CONTRACT_ERRORS: Record<number, string> = {
  2: 'Contract not initialised',
  3: 'This VASP is already registered',
  4: 'VASP not found',
  5: 'A VASP in this payment is not active (suspended, revoked or expired)',
  6: 'Amount must be greater than zero',
  7: 'Payment not found',
  8: 'This payment has already been resolved',
  9: 'An attestation is required before release',
  10: 'An attestation was already submitted',
  11: 'Only the beneficiary VASP or the admin can do this',
  12: 'This payment has not expired yet',
  13: 'Sender and receiver VASP must be different',
  14: 'Threshold must be zero or more',
}

/**
 * Stellar/Horizon/Soroban failure shapes, matched in order. The first match wins,
 * so more specific patterns must come before broader ones.
 */
const SHAPES: { pattern: RegExp; message: string }[] = [
  {
    pattern: /op_underfunded|insufficient balance|underfunded/i,
    message: 'Insufficient balance. Add funds to this wallet, then try again.',
  },
  {
    pattern: /op_no_trust|no trustline|trustline entry/i,
    message: 'This wallet has no trustline for this asset. Add the trustline in your wallet first (for example, add a USDC trustline).',
  },
  {
    pattern: /op_line_full/i,
    message: "The receiving account's trustline limit is full, so it cannot hold more of this asset.",
  },
  {
    pattern: /op_no_destination|destination account.*not (found|exist)/i,
    message: "The destination account doesn't exist yet. Fund it with Friendbot on testnet, then retry.",
  },
  {
    pattern: /tx_no_source_account|account not found|Account not found/i,
    message: 'This account is not funded on testnet yet. Fund it with Friendbot, then retry.',
  },
  {
    pattern: /tx_too_late|expired transaction|transaction expired/i,
    message: 'The transaction expired before it was submitted. Try again to create a fresh one.',
  },
  {
    pattern: /tx_bad_seq/i,
    message: 'Your wallet sequence number is out of date (another transaction was sent first). Try again.',
  },
  {
    pattern: /tx_insufficient_fee/i,
    message: 'The network fee was too low for current conditions. Try again.',
  },
  {
    pattern: /not authorized|require_auth|InvalidAction/i,
    message: 'Your wallet is not authorised for this action',
  },
  {
    pattern: /User declined|rejected/i,
    message: 'Request cancelled in wallet',
  },
]

export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  const m = msg.match(/Error\(Contract, #(\d+)\)/)
  if (m && CONTRACT_ERRORS[Number(m[1])]) return CONTRACT_ERRORS[Number(m[1])]
  for (const shape of SHAPES) {
    if (shape.pattern.test(msg)) return shape.message
  }
  return msg.length > 300 ? msg.slice(0, 300) + '…' : msg
}
