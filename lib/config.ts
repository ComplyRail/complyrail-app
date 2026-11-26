import { Asset, Networks, StrKey, contract, rpc } from '@stellar/stellar-sdk'
import deployment from '../contracts/deployments/testnet.json'
import assetRegistry from '../config/assets.json'

/**
 * Runtime configuration.
 *
 * The contract ID comes from NEXT_PUBLIC_CONTRACT_ID if set, otherwise from
 * contracts/deployments/testnet.json, which the "Deploy to testnet" GitHub
 * Action writes after each deployment.
 */
export const deployedContractId = deployment.contractId || ''

export const config = {
  contractId: process.env.NEXT_PUBLIC_CONTRACT_ID || deployedContractId,
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || 'https://soroban-testnet.stellar.org',
  networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || Networks.TESTNET,
}

const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/

export const isContractConfigured = CONTRACT_ID_RE.test(config.contractId)

export type ConfigIssueSeverity = 'error' | 'warning'

export type ConfigIssueCode =
  | 'contract_mismatch'
  | 'invalid_contract_id'
  | 'invalid_rpc_url'
  | 'invalid_network_passphrase'
  | 'unknown_network_passphrase'

export interface ConfigIssue {
  field: 'contractId' | 'rpcUrl' | 'networkPassphrase'
  severity: ConfigIssueSeverity
  code: ConfigIssueCode
  message: string
}

export interface ConfigValidationInput {
  contractId: string
  rpcUrl: string
  networkPassphrase: string
  /** Contract ID recorded in contracts/deployments/testnet.json (if any). */
  deployedContractId?: string
  /** Raw NEXT_PUBLIC_CONTRACT_ID override value (if set). */
  contractIdOverride?: string
}

export interface ConfigValidationResult {
  valid: boolean
  errors: ConfigIssue[]
  warnings: ConfigIssue[]
  /** True when NEXT_PUBLIC_CONTRACT_ID is set and differs from the deployment record. */
  contractMismatch: boolean
}

const KNOWN_NETWORK_PASSPHRASES = new Set<string>([
  Networks.TESTNET,
  Networks.PUBLIC,
  Networks.FUTURENET,
  Networks.STANDALONE,
])

/** Validate an RPC URL string: must be an http:// or https:// URL with a hostname. */
export function isValidRpcUrl(url: string): boolean {
  if (typeof url !== 'string' || url.trim() === '' || url !== url.trim()) return false
  try {
    const parsed = new URL(url)
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname.length > 0
  } catch {
    return false
  }
}

/** Validate a Stellar network passphrase format: non-empty single-line string without leading/trailing whitespace. */
export function isValidNetworkPassphrase(passphrase: string): boolean {
  if (typeof passphrase !== 'string') return false
  if (passphrase.trim().length === 0 || passphrase !== passphrase.trim()) return false
  return !/[\x00-\x1F\x7F]/.test(passphrase)
}

/**
 * Validate runtime configuration and detect when NEXT_PUBLIC_CONTRACT_ID
 * overrides the contract ID recorded in contracts/deployments/testnet.json.
 */
export function validateConfig(input: ConfigValidationInput): ConfigValidationResult {
  const errors: ConfigIssue[] = []
  const warnings: ConfigIssue[] = []

  const override = input.contractIdOverride?.trim() || ''
  const deployed = input.deployedContractId?.trim() || ''
  const contractMismatch = override.length > 0 && deployed.length > 0 && override !== deployed

  if (contractMismatch) {
    warnings.push({
      field: 'contractId',
      severity: 'warning',
      code: 'contract_mismatch',
      message: `NEXT_PUBLIC_CONTRACT_ID (${override}) differs from the deployment record (${deployed}). Verify you are connected to the intended contract.`,
    })
  }

  if (input.contractId && !CONTRACT_ID_RE.test(input.contractId)) {
    errors.push({
      field: 'contractId',
      severity: 'error',
      code: 'invalid_contract_id',
      message: `Invalid contract ID "${input.contractId}": expected a 56-character Stellar contract address starting with "C".`,
    })
  }

  if (!isValidRpcUrl(input.rpcUrl)) {
    errors.push({
      field: 'rpcUrl',
      severity: 'error',
      code: 'invalid_rpc_url',
      message: `Invalid RPC URL "${input.rpcUrl}": must be a valid http:// or https:// URL.`,
    })
  }

  if (!isValidNetworkPassphrase(input.networkPassphrase)) {
    errors.push({
      field: 'networkPassphrase',
      severity: 'error',
      code: 'invalid_network_passphrase',
      message: `Invalid network passphrase "${input.networkPassphrase}": must be a non-empty single-line string without leading or trailing whitespace.`,
    })
  } else if (!KNOWN_NETWORK_PASSPHRASES.has(input.networkPassphrase)) {
    warnings.push({
      field: 'networkPassphrase',
      severity: 'warning',
      code: 'unknown_network_passphrase',
      message: `Unrecognized network passphrase "${input.networkPassphrase}". Ensure it matches your target Stellar network.`,
    })
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    contractMismatch,
  }
}

export const configValidation: ConfigValidationResult = validateConfig({
  contractId: config.contractId,
  rpcUrl: config.rpcUrl,
  networkPassphrase: config.networkPassphrase,
  deployedContractId,
  contractIdOverride: process.env.NEXT_PUBLIC_CONTRACT_ID,
})

for (const err of configValidation.errors) {
  console.error(`[ComplyRail config] ${err.message}`)
}
for (const warn of configValidation.warnings) {
  console.warn(`[ComplyRail config] ${warn.message}`)
}

/** Block explorer base URL for each network passphrase we know how to link to. */
const EXPLORER_BASES: Record<string, string> = {
  [Networks.TESTNET]: 'https://stellar.expert/explorer/testnet',
  [Networks.PUBLIC]: 'https://stellar.expert/explorer/public',
}

/** Explorer base for a passphrase, or null when the network is unknown. */
export function explorerBaseFor(networkPassphrase: string): string | null {
  return Object.prototype.hasOwnProperty.call(EXPLORER_BASES, networkPassphrase)
    ? EXPLORER_BASES[networkPassphrase]
    : null
}

export const explorerBase = explorerBaseFor(config.networkPassphrase)

/** All Stellar assets use 7 decimal places. */
export const ASSET_DECIMALS = 7

export interface AssetOption {
  symbol: string
  /** Stellar Asset Contract (SAC) address used by the ComplyRail contract. */
  contractId: string
  /**
   * Whether the asset contract is reachable on-chain.
   * `true` after a successful `name()` query, `false` after a failed one,
   * `null` while the check is in progress or has not been run yet.
   */
  available: boolean | null
}

/** One entry in config/assets.json. Native (XLM) has no issuer. */
export interface AssetEntry {
  symbol: string
  native?: boolean
  issuer?: string
}

/**
 * Validate registry entries and map them to AssetOptions for a network.
 * Throws on the first invalid entry so a bad config fails the build.
 */
export function buildAssetOptions(entries: AssetEntry[], networkPassphrase: string): AssetOption[] {
  const seen = new Set<string>()
  return entries.map((e, i) => {
    const where = `config/assets.json entry ${i}`
    if (typeof e.symbol !== 'string' || !/^[A-Z0-9]{1,12}$/.test(e.symbol)) {
      throw new Error(`${where}: symbol must be 1-12 uppercase letters or digits, got "${e.symbol}"`)
    }
    if (seen.has(e.symbol)) throw new Error(`${where}: duplicate symbol ${e.symbol}`)
    seen.add(e.symbol)
    if (e.native) {
      if (e.issuer) throw new Error(`${where}: native asset must not have an issuer`)
      return { symbol: e.symbol, contractId: Asset.native().contractId(networkPassphrase), available: null }
    }
    if (!e.issuer || !StrKey.isValidEd25519PublicKey(e.issuer)) {
      throw new Error(`${where}: issuer must be a valid Stellar public key (G...)`)
    }
    return { symbol: e.symbol, contractId: new Asset(e.symbol, e.issuer).contractId(networkPassphrase), available: null }
  })
}

/** Assets offered in the UI, read from config/assets.json at build time. */
export const ASSETS: AssetOption[] = buildAssetOptions(assetRegistry as AssetEntry[], config.networkPassphrase)

export function assetSymbol(contractId: string): string {
  return ASSETS.find(a => a.contractId === contractId)?.symbol ?? contractId.slice(0, 6)
}

export { JURISDICTIONS } from './jurisdictions'

/** Mirrors the contract's `InvalidJurisdiction` rule: `"*"` is reserved for the threshold fallback. */
export function isRegistrableJurisdiction(jurisdiction: string): boolean {
  const j = jurisdiction.trim()
  return j !== '' && j !== '*'
}

/**
 * Probe each asset contract with a read-only `name()` call and mark the asset
 * `available` or unavailable in the `ASSETS` array. Call once at startup.
 * Never throws: a failed lookup sets `available = false` on that entry.
 */
export async function verifyAssetContracts(rpcUrl: string, networkPassphrase: string): Promise<void> {
  await Promise.all(
    ASSETS.map(async asset => {
      try {
        const c = (await contract.Client.from({
          contractId: asset.contractId,
          rpcUrl,
          networkPassphrase,
        })) as contract.Client & Record<string, (args?: unknown) => Promise<{ result: unknown }>>
        await c.name()
        asset.available = true
      } catch {
        asset.available = false
      }
    }),
  )
}
