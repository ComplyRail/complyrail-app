import { sha256Hex } from './contract'

/**
 * Canonical JSON for IVMS101 payloads.
 *
 * The on-chain attestation is sha256 over this string, so both VASPs must
 * produce byte-identical output for the same logical payload:
 *   - object keys are sorted lexicographically at every depth,
 *   - arrays keep their order (order is meaningful in IVMS101),
 *   - no insignificant whitespace.
 * Key order and whitespace in the pasted JSON therefore never change the hash.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

export type PayloadCheck =
  | { status: 'match'; computedHash: string }
  | { status: 'mismatch'; computedHash: string }
  | { status: 'invalid'; error: string }

/**
 * Checks a payload pasted by the beneficiary against the attestation hash
 * stored on-chain. Malformed JSON is reported as `invalid`, not as a mismatch.
 */
export async function verifyIvmsPayload(pastedJson: string, onChainHash: string): Promise<PayloadCheck> {
  let parsed: unknown
  try {
    parsed = JSON.parse(pastedJson)
  } catch {
    return { status: 'invalid', error: 'Not valid JSON' }
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { status: 'invalid', error: 'Payload must be a JSON object' }
  }
  const computedHash = await sha256Hex(canonicalJson(parsed))
  const matches = computedHash === onChainHash.trim().toLowerCase()
  return matches ? { status: 'match', computedHash } : { status: 'mismatch', computedHash }
}
