// Seed the deployed testnet contract with a realistic demo flow.
//
//   TESTNET_ADMIN_SECRET=S... node scripts/seed-testnet.mjs
//
// Creates two fresh Friendbot-funded demo VASPs, registers them, sets XLM
// thresholds, and runs four payments covering every path: instant settlement,
// attest + release, rejection with refund, and one left awaiting release.
// Testnet only. The admin secret is read from the environment and never printed.

import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, appendFileSync } from 'node:fs'
import { Asset, Keypair, Networks, contract } from '@stellar/stellar-sdk'

const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org'
const PASSPHRASE = Networks.TESTNET
const XLM = 10_000_000n // 7 decimals

const deployment = JSON.parse(readFileSync(new URL('../contracts/deployments/testnet.json', import.meta.url)))
const contractId = deployment.contractId
if (!/^C[A-Z2-7]{55}$/.test(contractId || '')) throw new Error('No contract ID in contracts/deployments/testnet.json')

const secret = process.env.TESTNET_ADMIN_SECRET
if (!secret) throw new Error('Set TESTNET_ADMIN_SECRET (the admin secret key, S...)')
const admin = Keypair.fromSecret(secret.trim())
if (deployment.admin && admin.publicKey() !== deployment.admin) {
  throw new Error(`TESTNET_ADMIN_SECRET belongs to ${admin.publicKey()}, but the contract admin is ${deployment.admin}`)
}

const xlmSac = Asset.native().contractId(PASSPHRASE)
const explorer = 'https://stellar.expert/explorer/testnet'
const log = []
const say = (line) => {
  console.log(line)
  log.push(line)
}

async function fund(pk) {
  const res = await fetch(`https://friendbot.stellar.org?addr=${pk}`)
  // 400 = already funded; that's fine.
  if (!res.ok && res.status !== 400) throw new Error(`Friendbot failed for ${pk}: ${res.status}`)
}

const clients = new Map()
async function as(kp) {
  if (!clients.has(kp.publicKey())) {
    clients.set(
      kp.publicKey(),
      await contract.Client.from({
        contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: PASSPHRASE,
        publicKey: kp.publicKey(),
        ...contract.basicNodeSigner(kp, PASSPHRASE),
      }),
    )
  }
  return clients.get(kp.publicKey())
}

const unwrap = (v) => (v && typeof v.unwrap === 'function' ? v.unwrap() : v)

async function call(kp, method, args, label) {
  const client = await as(kp)
  const tx = await client[method](args)
  unwrap(tx.result) // surface contract errors from simulation
  const sent = await tx.signAndSend()
  const hash = sent.sendTransactionResponse?.hash ?? sent.getTransactionResponse?.txHash ?? ''
  say(`✓ ${label}${hash ? ` — ${explorer}/tx/${hash}` : ''}`)
  return unwrap(sent.result)
}

const ivmsHash = (paymentId, originator, beneficiary, amount) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        ivms101Version: '2023',
        paymentId: String(paymentId),
        originator: { originatorPersons: [{ naturalPerson: { name: { nameIdentifier: [{ primaryIdentifier: originator }] } } }] },
        beneficiary: { beneficiaryPersons: [{ naturalPerson: { name: { nameIdentifier: [{ primaryIdentifier: beneficiary }] } } }] },
        transfer: { amount, asset: 'XLM' },
      }),
    )
    .digest()

async function main() {
  say(`Seeding ComplyRail contract ${contractId}`)
  const vaspA = Keypair.random()
  const vaspB = Keypair.random()
  const beneficiary = Keypair.random()

  await Promise.all([admin, vaspA, vaspB, beneficiary].map((k) => fund(k.publicKey())))
  say(`✓ Funded demo accounts with Friendbot`)

  await call(admin, 'register_vasp', {
    address: vaspA.publicKey(), name: 'Demo VASP A (Lagos)', jurisdiction: 'NG',
    public_key: randomBytes(32), expires_at: undefined,
  }, `Registered Demo VASP A (NG) ${vaspA.publicKey()}`)
  await call(admin, 'register_vasp', {
    address: vaspB.publicKey(), name: 'Demo VASP B (London)', jurisdiction: 'GB',
    public_key: randomBytes(32), expires_at: undefined,
  }, `Registered Demo VASP B (GB) ${vaspB.publicKey()}`)

  await call(admin, 'set_threshold', { asset: xlmSac, jurisdiction: 'NG', amount: 50n * XLM }, 'Threshold XLM / NG = 50')
  await call(admin, 'set_threshold', { asset: xlmSac, jurisdiction: '*', amount: 100n * XLM }, 'Threshold XLM / * (fallback) = 100')

  const pay = (from, to, amount, label) =>
    call(from, 'submit_payment', {
      from_vasp: from.publicKey(), to_vasp: to.publicKey(), beneficiary: beneficiary.publicKey(), asset: xlmSac, amount,
    }, label)

  // 1. Below threshold -> settles instantly.
  const p1 = await pay(vaspA, vaspB, 20n * XLM, 'Payment A→B 20 XLM (below NG threshold, settles instantly)')

  // 2. Above threshold -> attest -> release.
  const p2 = await pay(vaspA, vaspB, 75n * XLM, 'Payment A→B 75 XLM (held for Travel Rule)')
  await call(vaspA, 'submit_attestation', {
    payment_id: p2, attestation_hash: ivmsHash(p2, 'Adaeze Okafor', 'James Carter', '75'), ivms_version: 'IVMS101.2023',
  }, `Attestation for payment #${p2}`)
  await call(vaspB, 'release_payment', { payment_id: p2, caller: vaspB.publicKey() }, `Released payment #${p2}`)

  // 3. Above threshold -> rejected -> refunded.
  const p3 = await pay(vaspA, vaspB, 60n * XLM, 'Payment A→B 60 XLM (held for Travel Rule)')
  await call(vaspB, 'reject_payment', {
    payment_id: p3, caller: vaspB.publicKey(), reason: 'Beneficiary name mismatch (demo)',
  }, `Rejected payment #${p3} (refunded to VASP A)`)

  // 4. GB origin uses the "*" fallback (100) -> attested, left awaiting release.
  const p4 = await pay(vaspB, vaspA, 150n * XLM, 'Payment B→A 150 XLM (held via * fallback rule)')
  await call(vaspB, 'submit_attestation', {
    payment_id: p4, attestation_hash: ivmsHash(p4, 'James Carter', 'Adaeze Okafor', '150'), ivms_version: 'IVMS101.2023',
  }, `Attestation for payment #${p4} (awaiting release by VASP A)`)

  say(`Done. Payments: #${p1} released, #${p2} attested+released, #${p3} rejected, #${p4} pending release.`)
  say(`Contract: ${explorer}/contract/${contractId}`)

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Testnet demo data\n\n${log.map((l) => `- ${l}`).join('\n')}\n`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
