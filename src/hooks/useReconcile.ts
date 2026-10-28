import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { findChainConfig } from '@/config/app'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/lib/api'
import { publicClientFor } from '@/lib/chain'

/**
 * Settles records that were left pending (app closed, tab reloaded) by reading the real receipt.
 * Bridges are not settled here because their final leg lives on another chain.
 */
export function useReconcilePending() {
  const { status } = useAuth()
  const qc = useQueryClient()

  useEffect(() => {
    if (status !== 'authenticated') return
    let stopped = false
    const run = async () => {
      try {
        const pending = await api.transactions({ status: 'pending', pageSize: 20 })
        let changed = false
        for (const tx of pending.data) {
          if (stopped) return
          if ((tx.type !== 'send' && tx.type !== 'swap') || !findChainConfig(tx.chainId)) continue
          try {
            const receipt = await publicClientFor(tx.chainId).getTransactionReceipt({ hash: tx.txHash as `0x${string}` })
            await api.updateTransaction(tx.id, receipt.status === 'success' ? { status: 'confirmed' } : { status: 'failed', error: 'The network rejected this transaction.' })
            changed = true
          } catch {
            /* no receipt yet, or RPC unavailable: try again next round */
          }
        }
        if (changed && !stopped) {
          void qc.invalidateQueries({ queryKey: ['transactions'] })
          void qc.invalidateQueries({ queryKey: ['notifications'] })
          void qc.invalidateQueries({ queryKey: ['balances'] })
        }
      } catch {
        /* backend unreachable: retry later */
      }
    }
    void run()
    const id = setInterval(() => void run(), 30_000)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [status, qc])
}
