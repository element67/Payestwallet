import { useQuery } from '@tanstack/react-query'
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Droplets, Landmark, MoreHorizontal, Network, RefreshCw, Sprout, Users } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BalanceHero } from '@/components/BalanceHero'
import { TokenIcon } from '@/components/Icons'
import { ActionTile, Button } from '@/components/ui/Button'
import { Card, SectionTitle } from '@/components/ui/Card'
import { EmptyState, ErrorState, InlineAlert, Skeleton } from '@/components/ui/Feedback'
import { TxRow } from '@/components/TxRow'
import { FAUCET_URL } from '@/config/app'
import { useAuth } from '@/context/AuthContext'
import { useSettings } from '@/context/SettingsContext'
import { useWallet } from '@/context/WalletContext'
import { get24hChange, useBalances, useBalanceSnapshots } from '@/hooks/useBalances'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { api } from '@/lib/api'
import { describeError } from '@/lib/errors'
import { formatToken, greeting, toDecimalString } from '@/lib/format'
import { cn } from '@/lib/cn'

const SERVICES = [
  { id: 'exchange', label: 'Exchange', icon: Landmark },
  { id: 'p2p', label: 'P2P', icon: Users },
  { id: 'defi', label: 'DeFi', icon: Sprout },
  { id: 'deposit', label: 'Deposit NGN', icon: ArrowDownToLine },
  { id: 'more', label: 'More', icon: MoreHorizontal },
] as const

export default function Home() {
  const { user } = useAuth()
  const { address } = useWallet()
  const { chain, hideBalances } = useSettings()
  const nav = useNavigate()
  const balances = useBalances()

  const usdcRaw = balances.data?.tokens.USDC
  const usdc = usdcRaw === undefined ? null : Number(toDecimalString(usdcRaw, 6))
  useBalanceSnapshots(address, usdc)
  const change = useMemo(() => get24hChange(address, usdc), [address, usdc])

  const recent = useQuery({
    queryKey: ['transactions', 'recent'],
    queryFn: () => api.transactions({ pageSize: 3 }),
    retry: 0,
  })

  const refresh = useCallback(async () => {
    await Promise.all([balances.refetch(), recent.refetch()])
  }, [balances, recent])
  const { pull, refreshing, ready } = usePullToRefresh(refresh)

  const empty = balances.data && Object.values(balances.data.tokens).every((v) => v === 0n)
  const mask = '••••'

  return (
    <div className="space-y-5">
      <div
        className="flex items-center justify-center overflow-hidden text-xs font-semibold text-brand-600 transition-[height]"
        style={{ height: refreshing ? 28 : pull / 2.5 }}
        aria-hidden={!refreshing && pull === 0}
      >
        <RefreshCw className={cn('mr-1.5 size-3.5', refreshing && 'animate-spin')} />
        {refreshing ? 'Refreshing…' : ready ? 'Release to refresh' : 'Pull to refresh'}
      </div>

      <section>
        <p className="text-sm text-ink-mute">{greeting()}</p>
        <h2 className="font-display text-2xl font-bold tracking-tight text-ink">{user?.displayName.split(' ')[0]}</h2>
      </section>

      {address && <BalanceHero address={address} loading={balances.isLoading} usdc={usdc} change={change} />}

      {balances.errorMessage && !balances.data && <Card><ErrorState message={balances.errorMessage} onRetry={() => balances.refetch()} retrying={balances.isFetching} /></Card>}
      {balances.errorMessage && balances.data && <InlineAlert tone="warn">Could not refresh balances: {balances.errorMessage}</InlineAlert>}

      <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer" className="block">
        <Button full variant="secondary" size="lg" icon={<Droplets className="size-5" />} tabIndex={-1}>
          Get test tokens
        </Button>
      </a>
      {empty && (
        <InlineAlert tone="brand">Your wallet is empty on {chain.name}. Use the faucet to get free test USDC, then pull to refresh.</InlineAlert>
      )}

      <Card>
        <div className="grid grid-cols-4 gap-2">
          <ActionTile icon={<ArrowUpFromLine className="size-6" />} label="Send" onClick={() => nav('/send')} />
          <ActionTile icon={<ArrowDownToLine className="size-6" />} label="Receive" onClick={() => nav('/receive')} />
          <ActionTile icon={<ArrowLeftRight className="size-6" />} label="Swap" onClick={() => nav('/swap')} />
          <ActionTile icon={<Network className="size-6" />} label="Bridge" onClick={() => nav('/bridge')} />
        </div>
      </Card>

      <section>
        <SectionTitle>Assets on {chain.shortName}</SectionTitle>
        <Card className="divide-y divide-canvas p-0">
          {balances.isLoading
            ? chain.tokens.map((t) => (
                <div key={t.symbol} className="p-4"><Skeleton className="h-10" /></div>
              ))
            : chain.tokens.map((t) => {
                const raw = balances.data?.tokens[t.symbol]
                return (
                  <div key={t.symbol} className="flex items-center gap-3 p-4">
                    <TokenIcon symbol={t.symbol} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">{t.symbol}</p>
                      <p className="text-xs text-ink-mute">{t.name}</p>
                    </div>
                    <p className="font-semibold text-ink tabular">{raw === undefined ? '—' : hideBalances ? mask : formatToken(raw, t.decimals, 4, 2)}</p>
                  </div>
                )
              })}
          {!chain.gasIsUsdc && (
            <div className="flex items-center gap-3 p-4">
              <TokenIcon symbol={chain.nativeSymbol} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">{chain.nativeSymbol}</p>
                <p className="text-xs text-ink-mute">Network fee token</p>
              </div>
              <p className="font-semibold text-ink tabular">
                {balances.data ? (hideBalances ? mask : formatToken(balances.data.native, chain.nativeDecimals, 5, 2)) : '—'}
              </p>
            </div>
          )}
        </Card>
      </section>

      <section>
        <SectionTitle>More from Payest</SectionTitle>
        <div className="grid grid-cols-5 gap-1">
          {SERVICES.map(({ id, label, icon: Icon }) => (
            <Link key={id} to={`/soon/${id}`} className="flex min-h-[64px] flex-col items-center gap-1.5 rounded-2xl py-2 text-center hover:bg-white">
              <span className="grid size-11 place-items-center rounded-2xl bg-white text-brand-600 shadow-card">
                <Icon className="size-5" />
              </span>
              <span className="text-[11px] font-semibold leading-tight text-ink-soft">{label}</span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle action={<Link to="/activity" className="text-xs font-semibold text-brand-600">See all</Link>}>Recent activity</SectionTitle>
        <Card className="p-2">
          {recent.isLoading ? (
            <div className="space-y-2 p-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
          ) : recent.error ? (
            <ErrorState message={describeError(recent.error)} onRetry={() => recent.refetch()} retrying={recent.isFetching} />
          ) : recent.data && recent.data.data.length > 0 ? (
            recent.data.data.map((tx) => <TxRow key={tx.id} tx={tx} hide={hideBalances} />)
          ) : (
            <EmptyState title="No activity yet" body="Your sends, receives, swaps and bridges will show up here." />
          )}
        </Card>
      </section>
    </div>
  )
}
