import { AppKit } from '@circle-fin/app-kit'
import type { createViemAdapterFromPrivateKey } from '@circle-fin/adapter-viem-v2'
import { getChainConfig, SWAP } from '@/config/app'

export type KitAdapter = ReturnType<typeof createViemAdapterFromPrivateKey>

const kit = new AppKit()
const chain = () => getChainConfig(SWAP.chainId).kitName

export interface SwapQuote {
  amountIn: string
  tokenIn: string
  tokenOut: string
  /** Expected output, human readable. */
  estimatedOut: string
  /** Guaranteed minimum after slippage. */
  minimumOut: string
  /** Output per 1 input at this size. */
  rate: number
  /** Percent worse than the rate for a 1 unit trade. 0 means no measurable impact. */
  priceImpactPct: number
  fees: { type: string; amount: string; token: string }[]
  provider: string | null
}

async function estimate(adapter: KitAdapter, tokenIn: string, tokenOut: string, amountIn: string, slippageBps: number) {
  return kit.estimateSwap({
    from: { adapter, chain: chain() as never },
    tokenIn: tokenIn,
    tokenOut: tokenOut,
    amountIn,
    config: { slippageBps },
  })
}

/** Live quote. Price impact is measured against a 1 unit quote on the same route. */
export async function quoteSwap(adapter: KitAdapter, tokenIn: string, tokenOut: string, amountIn: string, slippageBps: number): Promise<SwapQuote> {
  const [main, ref] = await Promise.all([
    estimate(adapter, tokenIn, tokenOut, amountIn, slippageBps),
    Number(amountIn) === 1 ? Promise.resolve(null) : estimate(adapter, tokenIn, tokenOut, '1', slippageBps).catch(() => null),
  ])
  const out = Number(main.estimatedOutput.amount)
  const rate = out / Number(amountIn)
  const refRate = ref ? Number(ref.estimatedOutput.amount) : rate
  const impact = refRate > 0 ? Math.max(0, (1 - rate / refRate) * 100) : 0
  return {
    amountIn,
    tokenIn,
    tokenOut,
    estimatedOut: main.estimatedOutput.amount,
    minimumOut: main.stopLimit.amount,
    rate,
    priceImpactPct: Number.isFinite(impact) ? impact : 0,
    fees: (main.fees ?? []).map((f) => ({ type: String(f.type), amount: String(f.amount), token: String(f.token) })),
    provider: main.route?.provider ? String(main.route.provider) : null,
  }
}

export interface SwapOutcome {
  txHash: string
  amountOut: string | null
  status: string
}

export async function executeSwap(adapter: KitAdapter, tokenIn: string, tokenOut: string, amountIn: string, slippageBps: number): Promise<SwapOutcome> {
  const result = await kit.swap({
    from: { adapter, chain: chain() as never },
    tokenIn: tokenIn,
    tokenOut: tokenOut,
    amountIn,
    config: { slippageBps },
  })
  return {
    txHash: result.txHash,
    amountOut: result.amountOut ?? null,
    status: String(result.progress?.status ?? 'DONE'),
  }
}
