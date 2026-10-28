import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { TIMING } from '@/config/app'
import { useSettings } from '@/context/SettingsContext'
import { useWallet } from '@/context/WalletContext'
import { api } from '@/lib/api'
import { scanIncoming } from '@/lib/chain'
import { formatToken, toDecimalString } from '@/lib/format'
import { notifyToast } from '@/components/ui/Feedback'

const cursorKey = (chainId: number, address: string) => `payest:cursor:${chainId}:${address.toLowerCase()}`

/**
 * Watches the active network for incoming token transfers, records them in the backend
 * (idempotent per transaction) and raises an in-app notification for each new one.
 */
export function useIncomingWatcher() {
  const { chain } = useSettings()
  const { address } = useWallet()
  const qc = useQueryClient()
  const running = useRef(false)

  useEffect(() => {
    if (!address) return
    let stopped = false

    const poll = async () => {
      if (running.current || stopped || document.hidden) return
      running.current = true
      try {
        const key = cursorKey(chain.id, address)
        const stored = localStorage.getItem(key)
        const { head, transfers } = await scanIncoming(chain.id, address, stored ? BigInt(stored) : null)
        for (const t of transfers) {
          const amount = toDecimalString(t.value, t.token.decimals)
          const rec = await api.recordTransaction({
            walletAddress: address,
            chainId: chain.id,
            type: 'receive',
            status: 'confirmed',
            tokenSymbol: t.token.symbol,
            amount,
            fromAddress: t.from,
            toAddress: address,
            txHash: t.hash,
          })
          // The server raises the notification when the record is new. Toast only for fresh ones.
          if (Date.now() - new Date(rec.createdAt).getTime() < 15_000) {
            const shown = `${formatToken(t.value, t.token.decimals, 4, 2)} ${t.token.symbol}`
            notifyToast.success(`Received ${shown}`)
          }
        }
        localStorage.setItem(key, head.toString())
        if (transfers.length > 0) {
          void qc.invalidateQueries({ queryKey: ['balances'] })
          void qc.invalidateQueries({ queryKey: ['transactions'] })
          void qc.invalidateQueries({ queryKey: ['notifications'] })
        }
      } catch {
        /* RPC hiccup: the cursor does not advance, so the next poll retries the same range */
      } finally {
        running.current = false
      }
    }

    void poll()
    const id = setInterval(() => void poll(), TIMING.incomingPollMs)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [chain.id, chain.shortName, address, qc])
}
