import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/AppShell'
import { StatusBadge, TX_META, txSubtitle } from '@/components/TxRow'
import { Card, Row } from '@/components/ui/Card'
import { ErrorState, InlineAlert, Skeleton } from '@/components/ui/Feedback'
import { findChainConfig, txUrl } from '@/config/app'
import { useSettings } from '@/context/SettingsContext'
import { api, ApiClientError } from '@/lib/api'
import { describeError } from '@/lib/errors'
import { dateTime, shortAddress } from '@/lib/format'

export default function TransactionDetail() {
  const { id = '' } = useParams()
  const { hideBalances } = useSettings()
  const q = useQuery({
    queryKey: ['transactions', 'one', id],
    queryFn: () => api.transaction(id),
    retry: 0,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 5_000 : false),
  })

  if (q.isLoading) {
    return (
      <>
        <PageHeader title="Transaction" />
        <Skeleton className="h-64" />
      </>
    )
  }
  if (q.error || !q.data) {
    const notFound = q.error instanceof ApiClientError && q.error.status === 404
    return (
      <>
        <PageHeader title="Transaction" />
        <Card>
          <ErrorState message={notFound ? 'This transaction could not be found.' : describeError(q.error)} onRetry={notFound ? undefined : () => q.refetch()} retrying={q.isFetching} />
        </Card>
      </>
    )
  }

  const tx = q.data
  const meta = TX_META[tx.type]
  const Icon = meta.icon
  const chain = findChainConfig(tx.chainId)
  const dest = findChainConfig(tx.destChainId)

  return (
    <>
      <PageHeader title="Transaction" />
      <div className="space-y-4">
        <Card className="flex flex-col items-center py-6 text-center">
          <span className={`mb-3 grid size-14 place-items-center rounded-2xl ${meta.tint}`}>
            <Icon className="size-7" />
          </span>
          <p className="text-sm font-semibold text-ink-mute">{meta.label}</p>
          <p className="font-display text-3xl font-bold text-ink tabular">
            {hideBalances ? '••••' : tx.amount} <span className="text-lg text-ink-mute">{tx.tokenSymbol}</span>
          </p>
          {tx.toAmount && <p className="mt-1 text-sm text-ink-soft">for {hideBalances ? '••••' : tx.toAmount} {tx.toTokenSymbol}</p>}
          <div className="mt-3"><StatusBadge status={tx.status} /></div>
        </Card>

        {tx.status === 'pending' && <InlineAlert tone="warn">Waiting for the network to confirm. This page updates by itself.</InlineAlert>}
        {tx.status === 'failed' && <InlineAlert tone="bad">{tx.error ?? 'This transaction did not complete.'}</InlineAlert>}

        <Card className="divide-y divide-canvas py-1">
          <Row label="Type" value={meta.label} />
          <Row label="Details" value={txSubtitle(tx)} />
          <Row label="Network" value={chain?.name ?? tx.chainId} />
          {tx.type === 'bridge' && <Row label="Destination" value={dest?.name ?? tx.destChainId} />}
          <Row label="From" value={shortAddress(tx.fromAddress, 10, 8)} mono />
          <Row label="To" value={shortAddress(tx.toAddress, 10, 8)} mono />
          {tx.fee && <Row label="Network fee" value={`${tx.fee} ${tx.feeSymbol ?? ''}`} />}
          {tx.note && <Row label="Note" value={tx.note} />}
          <Row label="Date" value={dateTime(tx.createdAt)} />
          <Row label="Hash" value={shortAddress(tx.txHash, 10, 8)} mono />
        </Card>

        <div className="space-y-2">
          {chain && (
            <a href={txUrl(tx.chainId, tx.txHash)} target="_blank" rel="noopener noreferrer" className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-white font-semibold text-brand-700 shadow-card">
              View on {chain.shortName} explorer <ExternalLink className="size-4" />
            </a>
          )}
          {dest && tx.destTxHash && (
            <a href={txUrl(dest.id, tx.destTxHash)} target="_blank" rel="noopener noreferrer" className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-white font-semibold text-brand-700 shadow-card">
              View arrival on {dest.shortName} <ExternalLink className="size-4" />
            </a>
          )}
        </div>
      </div>
    </>
  )
}
