/**
 * Single source of truth for chains, tokens and API settings.
 * TESTNET ONLY. Mainnet chains are deliberately not exposed anywhere in this app.
 * Chain ids, explorers, USDC addresses and RPC defaults come from the generated `@/onchain-facts`.
 */
import { defineChain, type Chain } from 'viem'
import { getUsdc, requireChain } from '@/onchain-facts'

export const APP_NAME = 'Payest Wallet'

export const API = {
  baseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api',
  timeoutMs: 15_000,
} as const

export const TIMING = {
  balanceRefreshMs: 20_000,
  incomingPollMs: 20_000,
  notificationPollMs: 25_000,
  /** Wallet keys are cleared from memory and the PIN is required again. */
  autoLockMs: 2 * 60_000,
  /** The whole session is closed. */
  autoLogoutMs: 15 * 60_000,
  rpcTimeoutMs: 12_000,
  receiptTimeoutMs: 120_000,
} as const

export const FAUCET_URL = 'https://faucet.circle.com'

export const PIN_LENGTH = 6
export const PIN_KDF_ITERATIONS = 600_000
export const PIN_MAX_ATTEMPTS = 5

export interface TokenConfig {
  symbol: 'USDC' | 'EURC'
  name: string
  address: `0x${string}`
  decimals: number
}

export interface ChainConfig {
  id: number
  name: string
  shortName: string
  /** Chain name as App Kit (swap and bridge) expects it. */
  kitName: string
  viem: Chain
  explorerBase: string
  rpcUrl: string
  nativeSymbol: string
  nativeDecimals: number
  /** True when the gas token is USDC (Arc). Then native and ERC-20 USDC are ONE balance. */
  gasIsUsdc: boolean
  tokens: TokenConfig[]
  supportsSwap: boolean
}

interface ChainSeed {
  id: number
  shortName: string
  kitName: string
  envRpc?: string
  eurc?: `0x${string}`
  supportsSwap?: boolean
}

/** EURC addresses verified onchain (symbol() returns EURC). */
const SEEDS: ChainSeed[] = [
  {
    id: 5042002,
    shortName: 'Arc',
    kitName: 'Arc_Testnet',
    envRpc: import.meta.env.VITE_RPC_ARC_TESTNET as string | undefined,
    eurc: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
    supportsSwap: true,
  },
  {
    id: 11155111,
    shortName: 'Sepolia',
    kitName: 'Ethereum_Sepolia',
    envRpc: import.meta.env.VITE_RPC_ETHEREUM_SEPOLIA as string | undefined,
    eurc: '0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4',
  },
  {
    id: 84532,
    shortName: 'Base Sepolia',
    kitName: 'Base_Sepolia',
    envRpc: import.meta.env.VITE_RPC_BASE_SEPOLIA as string | undefined,
    eurc: '0x808456652fdb597867f38412077A9182bf77359F',
  },
  {
    id: 421614,
    shortName: 'Arbitrum Sepolia',
    kitName: 'Arbitrum_Sepolia',
    envRpc: import.meta.env.VITE_RPC_ARBITRUM_SEPOLIA as string | undefined,
  },
  {
    id: 11155420,
    shortName: 'OP Sepolia',
    kitName: 'Optimism_Sepolia',
    envRpc: import.meta.env.VITE_RPC_OP_SEPOLIA as string | undefined,
  },
  {
    id: 43113,
    shortName: 'Avalanche Fuji',
    kitName: 'Avalanche_Fuji',
    envRpc: import.meta.env.VITE_RPC_AVALANCHE_FUJI as string | undefined,
  },
]

function build(seed: ChainSeed): ChainConfig {
  const fact = requireChain(seed.id)
  if (!fact.isTestnet) throw new Error(`Refusing to configure a mainnet chain (${fact.name})`)
  const usdc = getUsdc(seed.id)
  if (!usdc) throw new Error(`USDC is not available on ${fact.name}`)
  const rpcUrl = seed.envRpc && /^https:\/\//.test(seed.envRpc) ? seed.envRpc : fact.rpcUrls[0]
  const tokens: TokenConfig[] = [
    { symbol: 'USDC', name: 'USD Coin', address: usdc.address as `0x${string}`, decimals: usdc.decimals },
  ]
  if (seed.eurc) tokens.push({ symbol: 'EURC', name: 'Euro Coin', address: seed.eurc, decimals: 6 })
  const viem = defineChain({
    id: fact.chainId,
    name: fact.name,
    nativeCurrency: { name: fact.nativeCurrency.symbol, symbol: fact.nativeCurrency.symbol, decimals: fact.nativeCurrency.decimals },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: 'Explorer', url: fact.explorerBase } },
    testnet: true,
  })
  return {
    id: fact.chainId,
    name: fact.name,
    shortName: seed.shortName,
    kitName: seed.kitName,
    viem,
    explorerBase: fact.explorerBase,
    rpcUrl,
    nativeSymbol: fact.nativeCurrency.symbol,
    nativeDecimals: fact.nativeCurrency.decimals,
    gasIsUsdc: fact.nativeCurrency.isUsdc,
    tokens,
    supportsSwap: seed.supportsSwap ?? false,
  }
}

export const CHAINS: ChainConfig[] = SEEDS.map(build)
export const DEFAULT_CHAIN_ID = 5042002

export function getChainConfig(id: number): ChainConfig {
  const c = CHAINS.find((x) => x.id === id)
  if (!c) throw new Error(`Unsupported network ${id}`)
  return c
}

export function findChainConfig(id: number | null | undefined): ChainConfig | undefined {
  return CHAINS.find((x) => x.id === id)
}

export function getToken(chainId: number, symbol: string): TokenConfig | undefined {
  return getChainConfig(chainId).tokens.find((t) => t.symbol === symbol)
}

export const txUrl = (chainId: number, hash: string) => `${getChainConfig(chainId).explorerBase}/tx/${hash}`
export const addressUrl = (chainId: number, address: string) => `${getChainConfig(chainId).explorerBase}/address/${address}`

/** Bridge: USDC between any two supported testnets (Circle CCTP). */
export const BRIDGE = {
  token: 'USDC',
  /** Typical FAST transfer time. Real status is always read from the transfer itself. */
  estimatedTime: 'About 1 to 2 minutes',
} as const

/** Swap: Arc Testnet only, via Circle App Kit (keyless). */
export const SWAP = {
  chainId: 5042002,
  slippageOptionsBps: [50, 100, 300] as const,
  defaultSlippageBps: 100,
  priceImpactWarnPct: 2,
} as const

/** Mock fiat rate. Replaced by a real provider through the FiatProvider interface. */
export const FIAT = { currency: 'NGN', symbol: 'NGN' } as const
