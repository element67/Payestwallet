import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Network } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { TransactionDto, TxStatus, TxType } from '../../shared/schemas'
import { findChainConfig } from '@/config/app'
import { cn } from '@/lib/cn'
import { relativeTime, shortAddress } from '@/lib/format'
import { Badge } from './ui/Feedback'

export const TX_META: Record<TxType, { label: string; icon: typeof ArrowUpRight; tint: string }> = {
  send: { label: 'Sent', icon: ArrowUpRight, tint: 'bg-brand-50 text-brand-600' },
  receive: { label: 'Received', icon: ArrowDownLeft, tint: 'bg-ok-soft text-ok' },
  swap: { label: 'Swapped', icon: ArrowLeftRight, tint: 'bg-brand-50 text-brand-600' },
  bridge: { label: 'Bridged', icon: Network, tint: 'bg-brand-50 text-brand-600' },
}

export function StatusBadge({ status }: { status: TxStatus }) {
  if (status === 'confirmed') return <Badge tone="ok">Confirmed</Badge>
  if (status === 'failed') return <Badge tone="bad">Failed</Badge>
  return <Badge tone="warn">Pending</Badge>
}

export function txSubtitle(tx: TransactionDto): string {
  const from = findChainConfig(tx.chainId)?.shortName ?? 'Unknown network'
  if (tx.type === 'send') return `To ${shortAddress(tx.toAddress)}`
  if (tx.type === 'receive') return `From ${shortAddress(tx.fromAddress)}`
  if (tx.type === 'swap') return `${tx.tokenSymbol} to ${tx.toTokenSymbol ?? '—'}`
  return `${from} to ${findChainConfig(tx.destChainId)?.shortName ?? '—'}`
}

export function TxRow({ tx, hide }: { tx: TransactionDto; hide?: boolean }) {
  const meta = TX_META[tx.type]
  const Icon = meta.icon
  const sign = tx.type === 'receive' ? '+' : tx.type === 'swap' || tx.type === 'bridge' ? '' : '-'
  return (
    <Link to={`/activity/${tx.id}`} className="flex min-h-[64px] items-center gap-3 rounded-2xl p-2.5 hover:bg-canvas">
      <span className={cn('grid size-11 shrink-0 place-items-center rounded-2xl', meta.tint)}>
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-ink">
          {meta.label} {tx.type === 'swap' || tx.type === 'bridge' ? tx.tokenSymbol : ''}
        </span>
        <span className="block truncate text-xs text-ink-mute">
          {txSubtitle(tx)} · {relativeTime(tx.createdAt)}
        </span>
      </span>
      <span className="text-right">
        <span className={cn('block font-semibold tabular', tx.type === 'receive' ? 'text-ok' : 'text-ink')}>
          {hide ? '••••' : `${sign}${tx.amount}`} <span className="text-xs font-medium text-ink-mute">{tx.tokenSymbol}</span>
        </span>
        <StatusBadge status={tx.status} />
      </span>
    </Link>
  )
}
