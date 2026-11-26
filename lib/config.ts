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
export const config = {
  contractId: process.env.NEXT_PUBLIC_CONTRACT_ID || deployment.contractId || '',
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || 'https://soroban-testnet.stellar.org',
  networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || Networks.TESTNET,
}

export const isContractConfigured = /^C[A-Z2-7]{55}$/.test(config.contractId)

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
