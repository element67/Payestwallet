import { AppKit } from '@circle-fin/app-kit'
import { getChainConfig } from '@/config/app'
import type { KitAdapter } from './swap'

export interface BridgeEstimate {
  amount: string
  /** Fees charged in USDC (protocol + forwarding). */
  usdcFees: { type: string; amount: string }[]
  totalUsdcFee: string
  /** Gas on the source chain, in that chain's gas token. */
  gas: { token: string; amount: string; chain: string }[]
  /** What arrives on the destination. */
  youReceive: string
}

export interface BridgeStepUpdate {
  name: string
  state: 'pending' | 'success' | 'error' | 'noop'
  txHash?: string
  explorerUrl?: string
}

export interface BridgeOutcome {
  state: 'success' | 'error' | 'pending'
  steps: BridgeStepUpdate[]
  /** Transaction on the source chain that burned the USDC. */
  sourceTxHash: string | null
  /** Transaction on the destination chain that minted it. */
  destTxHash: string | null
  error?: string
  /** Opaque SDK result, needed to resume a transfer that stopped part way. */
  raw?: unknown
}

const route = (adapter: KitAdapter, fromChainId: number, toChainId: number) => ({
  from: { adapter, chain: getChainConfig(fromChainId).kitName as never },
  // The forwarding service mints on the destination, so no gas is needed there.
  to: { adapter, chain: getChainConfig(toChainId).kitName as never, useForwarder: true as const },
})

export async function estimateBridge(adapter: KitAdapter, fromChainId: number, toChainId: number, amount: string): Promise<BridgeEstimate> {
  const kit = new AppKit()
  const est = await kit.estimateBridge({ ...route(adapter, fromChainId, toChainId), amount, token: 'USDC' })
  const usdcFees = (est.fees ?? []).map((f) => ({ type: String(f.type), amount: f.amount ?? '0' }))
  const totalFee = usdcFees.reduce((s, f) => s + Number(f.amount), 0)
  const gas = (est.gasFees ?? [])
    .filter((g) => g.fees)
    .map((g) => ({ token: g.token, amount: String(g.fees?.fee ?? '0'), chain: String(g.blockchain) }))
  return {
    amount,
    usdcFees,
    totalUsdcFee: totalFee.toFixed(6).replace(/0+$/, '').replace(/\.$/, ''),
    gas,
    youReceive: Math.max(0, Number(amount) - totalFee).toFixed(6).replace(/0+$/, '').replace(/\.$/, ''),
  }
}

function toStep(s: { name: string; state: string; txHash?: string; explorerUrl?: string }): BridgeStepUpdate {
  return { name: s.name, state: s.state as BridgeStepUpdate['state'], txHash: s.txHash, explorerUrl: s.explorerUrl }
}

/**
 * Runs the full transfer (approve, burn, attestation, mint) and reports each real step as it happens.
 * Never call automatically: only from the user's confirmed action.
 */
export async function executeBridge(
  adapter: KitAdapter,
  fromChainId: number,
  toChainId: number,
  amount: string,
  onStep: (step: BridgeStepUpdate) => void,
): Promise<BridgeOutcome> {
  const kit = new AppKit()
  kit.on('*', (payload: unknown) => {
    const p = payload as { method?: string; values?: { txHash?: string; transactionHash?: string; explorerUrl?: string; state?: string } }
    if (!p?.method) return
    const name = p.method.replace(/^bridge\./, '')
    const txHash = p.values?.txHash ?? p.values?.transactionHash
    onStep({ name, state: p.values?.state === 'error' ? 'error' : 'success', txHash, explorerUrl: p.values?.explorerUrl })
  })
  const result = await kit.bridge({ ...route(adapter, fromChainId, toChainId), amount, token: 'USDC' })
  return summarise(result)
}

type RawBridgeResult = Awaited<ReturnType<AppKit['bridge']>>

function summarise(result: RawBridgeResult): BridgeOutcome {
  const steps = result.steps.map(toStep)
  const burn = steps.find((s) => s.name.toLowerCase().includes('burn'))
  const mint = [...steps].reverse().find((s) => /mint|forward/i.test(s.name) && s.txHash)
  const failed = result.steps.find((s) => s.state === 'error')
  return {
    state: result.state === 'success' ? 'success' : result.state === 'error' ? 'error' : 'pending',
    steps,
    sourceTxHash: burn?.txHash ?? steps.find((s) => s.txHash)?.txHash ?? null,
    destTxHash: mint?.txHash ?? null,
    error: failed ? stepError(failed) : undefined,
    raw: result,
  }
}

function stepError(step: unknown): string {
  const e = (step as { error?: unknown }).error
  if (e instanceof Error) return e.message
  return typeof e === 'string' ? e : 'A step failed'
}

/** Resumes a transfer from the step that failed. Never starts a new burn. */
export async function resumeBridge(adapter: KitAdapter, raw: unknown): Promise<BridgeOutcome> {
  const kit = new AppKit()
  const result = await kit.retryBridge(raw as RawBridgeResult, { from: adapter, to: adapter })
  return summarise(result)
}
