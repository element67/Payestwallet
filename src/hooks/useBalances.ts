import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { TIMING } from '@/config/app'
import { useSettings } from '@/context/SettingsContext'
import { useWallet } from '@/context/WalletContext'
import { readBalances } from '@/lib/chain'
import { describeError } from '@/lib/errors'

const SNAP_KEY = (addr: string) => `payest:snap:${addr.toLowerCase()}`
interface Snap {
  t: number
  usd: number
}

export function useBalances() {
  const { chain } = useSettings()
  const { address } = useWallet()
  const q = useQuery({
    queryKey: ['balances', chain.id, address],
    enabled: Boolean(address),
    refetchInterval: TIMING.balanceRefreshMs,
    refetchOnWindowFocus: true,
    retry: 1,
    queryFn: () => readBalances(chain.id, address!),
  })
  return {
    ...q,
    errorMessage: q.error ? describeError(q.error) : null,
  }
}

/** Stores a USD-equivalent snapshot (USDC only) every few minutes so a real 24h change can be computed. */
export function useBalanceSnapshots(address: string | null, usdcTotal: number | null) {
  useEffect(() => {
    if (!address || usdcTotal === null) return
    try {
      const key = SNAP_KEY(address)
      const snaps = JSON.parse(localStorage.getItem(key) ?? '[]') as Snap[]
      const last = snaps[snaps.length - 1]
      if (last && Date.now() - last.t < 5 * 60_000) return
      const cutoff = Date.now() - 48 * 3600_000
      const next = [...snaps.filter((s) => s.t > cutoff), { t: Date.now(), usd: usdcTotal }]
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      /* storage unavailable */
    }
  }, [address, usdcTotal])
}

/** Change in USDC balance versus about 24 hours ago (or the oldest snapshot if the wallet is newer). */
export function get24hChange(address: string | null, current: number | null): { delta: number; pct: number | null } | null {
  if (!address || current === null || current <= 0) return null
  try {
    const snaps = JSON.parse(localStorage.getItem(SNAP_KEY(address)) ?? '[]') as Snap[]
    if (snaps.length === 0) return null
    const target = Date.now() - 24 * 3600_000
    const base = snaps.find((s) => s.t >= target) ?? snaps[0]
    if (Date.now() - base.t < 60_000) return null
    const delta = current - base.usd
    return { delta, pct: base.usd > 0 ? (delta / base.usd) * 100 : null }
  } catch {
    return null
  }
}
