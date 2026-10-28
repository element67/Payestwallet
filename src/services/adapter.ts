import { createViemAdapterFromPrivateKey } from '@circle-fin/adapter-viem-v2'
import { createWalletClient, http, type Hex } from 'viem'
import { findChainConfig, TIMING } from '@/config/app'

/**
 * Circle App Kit adapter for a key held in memory.
 *
 * In a browser the stock private-key adapter asks the wallet client to run
 * wallet_switchEthereumChain, which a plain RPC endpoint rejects. A key-based wallet has no wallet app
 * to switch, so each chain simply gets its own client and the switch is a no-op.
 */
export function createLocalAdapter(privateKey: Hex) {
  return createViemAdapterFromPrivateKey({
    privateKey,
    getWalletClient: ({ chain, account }) => {
      const url = findChainConfig(chain.id)?.rpcUrl ?? chain.rpcUrls.default.http[0]
      return createWalletClient({ account, chain, transport: http(url, { timeout: TIMING.rpcTimeoutMs, retryCount: 2 }) }).extend(() => ({
        switchChain: () => Promise.resolve(),
      }))
    },
  })
}
