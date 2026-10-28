import { createPublicClient, createWalletClient, erc20Abi, http, parseAbiItem, type Hash, type PublicClient } from 'viem'
import type { HDAccount } from 'viem/accounts'
import { getChainConfig, TIMING, type TokenConfig } from '@/config/app'
import { Amount, gasTokenToUsdc } from '@/onchain-money'
import { registerChain } from '@/tracing'
import { withTimeout } from './errors'

const clients = new Map<number, PublicClient>()

export function publicClientFor(chainId: number): PublicClient {
  const existing = clients.get(chainId)
  if (existing) return existing
  const cfg = getChainConfig(chainId)
  registerChain(cfg.id, cfg.rpcUrl)
  const client = createPublicClient({
    chain: cfg.viem,
    transport: http(cfg.rpcUrl, { timeout: TIMING.rpcTimeoutMs, retryCount: 2, retryDelay: 400 }),
  }) as PublicClient
  clients.set(chainId, client)
  return client
}

export interface Balances {
  tokens: Record<string, bigint>
  /** Native gas token balance in its own decimals. On Arc this is the SAME money as USDC, never add them. */
  native: bigint
}

export async function readBalances(chainId: number, address: `0x${string}`): Promise<Balances> {
  const cfg = getChainConfig(chainId)
  const client = publicClientFor(chainId)
  const tokenReads = cfg.tokens.map((t) =>
    client.readContract({ address: t.address, abi: erc20Abi, functionName: 'balanceOf', args: [address] }).then((v) => [t.symbol, v] as const),
  )
  const nativeRead = cfg.gasIsUsdc ? Promise.resolve(0n) : client.getBalance({ address })
  const [pairs, native] = await withTimeout(Promise.all([Promise.all(tokenReads), nativeRead]), TIMING.rpcTimeoutMs * 2, 'Balance request')
  return { tokens: Object.fromEntries(pairs), native }
}

export interface FeeEstimate {
  gas: bigint
  maxFeePerGas: bigint
  /** Fee in the chain's native gas token (its own decimals). */
  feeNative: bigint
  /** Fee expressed in the USDC ERC-20 view (6 decimals). Only set when gas is paid in USDC (Arc). */
  feeUsdcRaw: bigint | null
}

const FALLBACK_TRANSFER_GAS = 70_000n

export async function estimateTransferFee(chainId: number, token: TokenConfig, from: `0x${string}`, to: `0x${string}`, amountRaw: bigint): Promise<FeeEstimate> {
  const cfg = getChainConfig(chainId)
  const client = publicClientFor(chainId)
  const [gasResult, fees] = await withTimeout(
    Promise.all([
      client
        .estimateContractGas({ address: token.address, abi: erc20Abi, functionName: 'transfer', args: [to, amountRaw > 0n ? amountRaw : 1n], account: from })
        // Estimation reverts when the balance is too low. The balance check reports that clearly, so fall back here.
        .catch(() => FALLBACK_TRANSFER_GAS),
      client.estimateFeesPerGas(),
    ]),
    TIMING.rpcTimeoutMs * 2,
    'Fee estimate',
  )
  const gas = (gasResult * 12n) / 10n
  const maxFeePerGas = fees.maxFeePerGas ?? (await client.getGasPrice())
  const feeNative = gas * maxFeePerGas
  const feeUsdcRaw = cfg.gasIsUsdc ? gasTokenToUsdc(chainId, Amount.fromRaw(feeNative, cfg.nativeDecimals), 'trunc').raw + 1n : null
  return { gas, maxFeePerGas, feeNative, feeUsdcRaw }
}

export async function sendToken(params: {
  chainId: number
  account: HDAccount
  token: TokenConfig
  to: `0x${string}`
  amountRaw: bigint
}): Promise<Hash> {
  const cfg = getChainConfig(params.chainId)
  registerChain(cfg.id, cfg.rpcUrl)
  const wallet = createWalletClient({
    account: params.account,
    chain: cfg.viem,
    transport: http(cfg.rpcUrl, { timeout: TIMING.rpcTimeoutMs, retryCount: 1 }),
  })
  return withTimeout(
    wallet.writeContract({ address: params.token.address, abi: erc20Abi, functionName: 'transfer', args: [params.to, params.amountRaw] }),
    TIMING.rpcTimeoutMs * 3,
    'Sending',
  )
}

export type ReceiptOutcome = { status: 'confirmed' | 'failed'; blockNumber: bigint; gasUsed: bigint; effectiveGasPrice: bigint } | { status: 'timeout' }

/** Waits for a receipt. Returns "timeout" (not an error) when it takes too long so the UI can keep it pending. */
export async function waitForReceipt(chainId: number, hash: Hash, timeoutMs: number = TIMING.receiptTimeoutMs): Promise<ReceiptOutcome> {
  try {
    const r = await publicClientFor(chainId).waitForTransactionReceipt({ hash, timeout: timeoutMs, pollingInterval: 1500 })
    return {
      status: r.status === 'success' ? 'confirmed' : 'failed',
      blockNumber: r.blockNumber,
      gasUsed: r.gasUsed,
      effectiveGasPrice: r.effectiveGasPrice,
    }
  } catch {
    return { status: 'timeout' }
  }
}

export const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')

export interface IncomingTransfer {
  hash: Hash
  token: TokenConfig
  from: `0x${string}`
  value: bigint
  blockNumber: bigint
}

/** Incoming ERC-20 transfers to `address` in (fromBlock, head]. Returns head so callers can advance their cursor. */
export async function scanIncoming(chainId: number, address: `0x${string}`, fromBlock: bigint | null): Promise<{ head: bigint; transfers: IncomingTransfer[] }> {
  const cfg = getChainConfig(chainId)
  const client = publicClientFor(chainId)
  const head = await client.getBlockNumber()
  // Never scan from genesis: start a short, bounded window behind head on the first run.
  const MAX_RANGE = 1500n
  let start = fromBlock === null ? head - 100n : fromBlock + 1n
  if (start < 0n) start = 0n
  if (head - start > MAX_RANGE) start = head - MAX_RANGE
  if (start > head) return { head, transfers: [] }
  const transfers: IncomingTransfer[] = []
  for (const token of cfg.tokens) {
    const logs = await client.getLogs({ address: token.address, event: transferEvent, args: { to: address }, fromBlock: start, toBlock: head })
    for (const l of logs) {
      if (!l.transactionHash || !l.args.from || l.args.value === undefined) continue
      if (l.args.from.toLowerCase() === address.toLowerCase()) continue
      transfers.push({ hash: l.transactionHash, token, from: l.args.from, value: l.args.value, blockNumber: l.blockNumber ?? head })
    }
  }
  // A transfer inside a transaction this wallet itself sent (a swap payout, a bridge refund) is the
  // wallet's own activity, already shown as a swap or bridge. Only transfers started by others count.
  const own = new Map<string, boolean>()
  const incoming: IncomingTransfer[] = []
  for (const t of transfers) {
    if (!own.has(t.hash)) {
      own.set(t.hash, await client.getTransaction({ hash: t.hash }).then((tx) => tx.from.toLowerCase() === address.toLowerCase()).catch(() => false))
    }
    if (!own.get(t.hash)) incoming.push(t)
  }
  return { head, transfers: incoming }
}
