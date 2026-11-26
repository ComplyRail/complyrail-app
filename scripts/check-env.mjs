import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/
const PUBLIC_ENV_NAMES = [
  'NEXT_PUBLIC_CONTRACT_ID',
  'NEXT_PUBLIC_RPC_URL',
  'NEXT_PUBLIC_NETWORK_PASSPHRASE',
]

function isValidRpcUrl(url) {
  if (typeof url !== 'string' || url.trim() === '' || url !== url.trim()) return false
  try {
    const parsed = new URL(url)
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname.length > 0
  } catch {
    return false
  }
}

function isValidNetworkPassphrase(passphrase) {
  return (
    typeof passphrase === 'string' &&
    passphrase.trim().length > 0 &&
    passphrase === passphrase.trim() &&
    !/[\x00-\x1F\x7F]/.test(passphrase)
  )
}

function exampleKeys(root) {
  const example = readFileSync(path.join(root, '.env.example'), 'utf8')
  const keys = new Set()
  for (const line of example.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)
    if (match) keys.add(match[1])
  }
  return keys
}

export function checkEnv(env, deployment, root) {
  const errors = []
  let documented
  try {
    documented = exampleKeys(root)
  } catch {
    errors.push('.env.example is missing; copy the template before building')
    documented = new Set()
  }
  for (const name of PUBLIC_ENV_NAMES) {
    if (!documented.has(name)) errors.push(`.env.example does not document ${name}`)
  }

  const configuredContractId = (env.NEXT_PUBLIC_CONTRACT_ID || deployment.contractId || '').trim()
  if (!configuredContractId) {
    errors.push(
      'NEXT_PUBLIC_CONTRACT_ID is required: set it or add a contractId to contracts/deployments/testnet.json',
    )
  } else if (!CONTRACT_ID_RE.test(configuredContractId)) {
    errors.push(
      `NEXT_PUBLIC_CONTRACT_ID must be a 56-character Stellar contract address starting with "C" (got "${configuredContractId}")`,
    )
  }

  if (env.NEXT_PUBLIC_RPC_URL !== undefined && !isValidRpcUrl(env.NEXT_PUBLIC_RPC_URL)) {
    errors.push(`NEXT_PUBLIC_RPC_URL must be a valid http:// or https:// URL (got "${env.NEXT_PUBLIC_RPC_URL}")`)
  }

  if (env.NEXT_PUBLIC_NETWORK_PASSPHRASE !== undefined && !isValidNetworkPassphrase(env.NEXT_PUBLIC_NETWORK_PASSPHRASE)) {
    errors.push(
      `NEXT_PUBLIC_NETWORK_PASSPHRASE must be a non-empty single-line string without leading or trailing whitespace (got "${env.NEXT_PUBLIC_NETWORK_PASSPHRASE}")`,
    )
  }

  return errors
}

function readDeployment(root) {
  try {
    return JSON.parse(readFileSync(path.join(root, 'contracts', 'deployments', 'testnet.json'), 'utf8'))
  } catch {
    return {}
  }
}

function main() {
  const scriptPath = fileURLToPath(import.meta.url)
  const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
  if (invokedPath !== scriptPath) return

  const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(path.dirname(scriptPath), '..')
  const errors = checkEnv(process.env, readDeployment(root), root)
  if (errors.length > 0) {
    for (const error of errors) console.error(`[ComplyRail env] ${error}`)
    process.exitCode = 1
    return
  }
  console.log('[ComplyRail env] Required variables are configured.')
}

main()
