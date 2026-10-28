import { ArrowDownRight, ArrowUpRight, Copy, Eye, EyeOff, Landmark } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSettings } from '@/context/SettingsContext'
import { cn } from '@/lib/cn'
import { shortAddress } from '@/lib/format'
import { fiatProvider, type FiatRate } from '@/services/fiat'
import { Card } from './ui/Card'
import { Skeleton, notifyToast } from './ui/Feedback'
import { ChainIcon, TokenIcon } from './Icons'

interface Props {
  address: string
  loading: boolean
  /** USDC balance as a plain number (display only). Null while unknown. */
  usdc: number | null
  change: { delta: number; pct: number | null } | null
}

const MASK = '••••••'

export function BalanceHero({ address, loading, usdc, change }: Props) {
  const { hideBalances, setHideBalances, chain } = useSettings()
  const [rate, setRate] = useState<FiatRate | null>(null)

  useEffect(() => {
    let live = true
    fiatProvider.getRate().then((r) => live && setRate(r)).catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      notifyToast.success('Address copied')
    } catch {
      notifyToast.error('Could not copy. Select the address and copy it manually.')
    }
  }

  const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
  const positive = (change?.delta ?? 0) >= 0

  return (
    <div className="space-y-3">
      <Card className="relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-brand-100/70 blur-2xl" aria-hidden />
        <div className="relative">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
              <TokenIcon symbol="USDC" size={20} /> USDC balance
            </p>
            <button
              type="button"
              onClick={() => setHideBalances(!hideBalances)}
              className="grid size-11 place-items-center rounded-full text-ink-mute hover:bg-brand-50"
              aria-label={hideBalances ? 'Show balance' : 'Hide balance'}
              aria-pressed={hideBalances}
            >
              {hideBalances ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>

          {loading ? (
            <Skeleton className="mt-1 h-11 w-48" />
          ) : (
            <p className="font-display text-[40px] font-bold leading-tight tracking-tight text-ink tabular" aria-live="polite">
              {usdc === null ? '—' : hideBalances ? MASK : `$${fmt(usdc)}`}
            </p>
          )}

          {/* 24h change is hidden for a zero (or unknown) balance */}
          {!loading && usdc !== null && usdc > 0 && change && (
            <p className={cn('mt-1 inline-flex items-center gap-1 text-sm font-semibold tabular', positive ? 'text-ok' : 'text-bad')}>
              {positive ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
              {hideBalances ? MASK : `${positive ? '+' : '-'}$${fmt(Math.abs(change.delta))}${change.pct !== null ? ` (${positive ? '+' : '-'}${fmt(Math.abs(change.pct))}%)` : ''}`}
              <span className="font-medium text-ink-mute">24h</span>
            </p>
          )}

          <button type="button" onClick={copy} className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-canvas px-3.5 text-xs font-semibold text-ink-soft">
            <ChainIcon chainId={chain.id} size={16} />
            <span className="font-mono">{shortAddress(address, 8, 6)}</span>
            <Copy className="size-3.5" />
          </button>
        </div>
      </Card>

      <Card className="flex items-center gap-3 p-4">
        <span className="grid size-11 place-items-center rounded-2xl bg-brand-50 text-brand-600">
          <Landmark className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink-soft">NGN balance (estimate)</p>
          <p className="font-display text-xl font-bold text-ink tabular">
            {usdc === null || !rate ? '—' : hideBalances ? MASK : `NGN ${fmt(usdc * rate.rate, 0)}`}
          </p>
        </div>
        {rate?.isMock && <span className="rounded-full bg-warn-soft px-2.5 py-1 text-[11px] font-semibold text-warn">Mock rate</span>}
      </Card>
    </div>
  )
}
