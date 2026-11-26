// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const SCRIPT = path.join(ROOT, 'scripts', 'check-env.mjs')
const EXAMPLE = readFileSync(path.join(ROOT, '.env.example'), 'utf8')
const DEPLOYMENT_ID = JSON.parse(
  readFileSync(path.join(ROOT, 'contracts', 'deployments', 'testnet.json'), 'utf8'),
).contractId as string

const directories: string[] = []

function fixture(deploymentId = DEPLOYMENT_ID, example = EXAMPLE): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'complyrail-env-'))
  directories.push(dir)
  mkdirSync(path.join(dir, 'contracts', 'deployments'), { recursive: true })
  writeFileSync(path.join(dir, '.env.example'), example)
  writeFileSync(
    path.join(dir, 'contracts', 'deployments', 'testnet.json'),
    JSON.stringify({ contractId: deploymentId }),
  )
  return dir
}

function run(root: string, env: Record<string, string | undefined> = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, root], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', ...env },
  })
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  }
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [full] : []
  })
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true })
  }
})

describe('check-env build gate', () => {
  it('passes with the shipped deployment and no overrides', () => {
    const result = run(fixture())
    expect(result.status).toBe(0)
    expect(result.output).toMatch(/required variables are configured/i)
  })

  it('fails when the contract ID has neither an override nor a deployment record', () => {
    const result = run(fixture(''))
    expect(result.status).toBe(1)
    expect(result.output).toMatch(/NEXT_PUBLIC_CONTRACT_ID is required/)
  })

  it('accepts a valid contract ID override when the deployment record is empty', () => {
    const result = run(fixture(''), { NEXT_PUBLIC_CONTRACT_ID: DEPLOYMENT_ID })
    expect(result.status).toBe(0)
  })

  it('rejects malformed public values that are set', () => {
    expect(run(fixture(), { NEXT_PUBLIC_CONTRACT_ID: 'not-a-contract' }).output)
      .toMatch(/NEXT_PUBLIC_CONTRACT_ID must be a 56-character/)
    expect(run(fixture(), { NEXT_PUBLIC_RPC_URL: 'ftp://rpc.example' }).output)
      .toMatch(/NEXT_PUBLIC_RPC_URL must be a valid/)
    expect(run(fixture(), { NEXT_PUBLIC_NETWORK_PASSPHRASE: '  ' }).output)
      .toMatch(/NEXT_PUBLIC_NETWORK_PASSPHRASE must be a non-empty/)
    expect(run(fixture(), { NEXT_PUBLIC_NETWORK_PASSPHRASE: '' }).status).toBe(1)
  })

  it('fails when .env.example stops documenting a public variable', () => {
    const result = run(fixture(DEPLOYMENT_ID, EXAMPLE.replace('NEXT_PUBLIC_RPC_URL=', 'RPC_URL=')))
    expect(result.status).toBe(1)
    expect(result.output).toMatch(/does not document NEXT_PUBLIC_RPC_URL/)
  })

  it('documents every NEXT_PUBLIC variable read by the source', () => {
    const used = new Set<string>()
    for (const file of sourceFiles(ROOT)) {
      const content = readFileSync(file, 'utf8')
      for (const match of content.matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)) {
        used.add(match[1])
      }
    }
    expect([...used].sort()).toEqual([
      'NEXT_PUBLIC_CONTRACT_ID',
      'NEXT_PUBLIC_NETWORK_PASSPHRASE',
      'NEXT_PUBLIC_RPC_URL',
    ])
  })
})
