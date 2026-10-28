import { useInfiniteQuery } from '@tanstack/react-query'
import { Receipt } from 'lucide-react'
import { useMemo, useState } from 'react'
import { TX_TYPES, TX_STATUSES, type TxStatus, type TxType } from '../../shared/schemas'
import { TxRow } from '@/components/TxRow'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback'
import { useSettings } from '@/context/SettingsContext'
import { cn } from '@/lib/cn'
import { api } from '@/lib/api'
import { describeError } from '@/lib/errors'
import { dayLabel } from '@/lib/format'

const TYPE_LABEL: Record<TxType, string> = { send: 'Sent', receive: 'Received', swap: 'Swaps', bridge: 'Bridges' }
const STATUS_LABEL: Record<TxStatus, string> = { pending: 'Pending', confirmed: 'Confirmed', failed: 'Failed' }

function Chips<T extends string>({ label, options, value, onChange, names }: { label: string; options: readonly T[]; value: T | null; onChange: (v: T | null) => void; names: Record<T, string> }) {
  return (
    <div role="group" aria-label={label} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      <Chip active={value === null} onClick={() => onChange(null)}>All</Chip>
      {options.map((o) => (
        <Chip key={o} active={value === o} onClick={() => onChange(value === o ? null : o)}>
          {names[o]}
        </Chip>
      ))}
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn('min-h-[40px] shrink-0 rounded-full px-4 text-sm font-semibold transition', active ? 'bg-brand-600 text-white shadow-btn' : 'bg-white text-ink-soft shadow-card')}
    >
      {children}
    </button>
  )
}

export default function Activity() {
  const { hideBalances } = useSettings()
  const [type, setType] = useState<TxType | null>(null)
  const [status, setStatus] = useState<TxStatus | null>(null)

  const q = useInfiniteQuery({
    queryKey: ['transactions', 'list', type, status],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.transactions({ page: pageParam, pageSize: 15, type: type ?? undefined, status: status ?? undefined }),
    getNextPageParam: (last) => (last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined),
    retry: 0,
    refetchInterval: 15_000,
  })

  const groups = useMemo(() => {
    const map = new Map<string, NonNullable<typeof q.data>['pages'][number]['data']>()
    for (const tx of q.data?.pages.flatMap((p) => p.data) ?? []) {
      const key = dayLabel(tx.createdAt)
      map.set(key, [...(map.get(key) ?? []), tx])
    }
    return [...map.entries()]
  }, [q.data])

  const filtered = type !== null || status !== null

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">Activity</h1>
      <Chips label="Filter by type" options={TX_TYPES} value={type} onChange={setType} names={TYPE_LABEL} />
      <Chips label="Filter by status" options={TX_STATUSES} value={status} onChange={setStatus} names={STATUS_LABEL} />

      {q.isLoading ? (
        <Card className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></Card>
      ) : q.error ? (
        <Card><ErrorState message={describeError(q.error)} onRetry={() => q.refetch()} retrying={q.isFetching} /></Card>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Receipt className="size-6" />}
            title={filtered ? 'No matching transactions' : 'No transactions yet'}
            body={filtered ? 'Try a different filter.' : 'When you send, receive, swap or bridge, it appears here.'}
            action={filtered ? <Button variant="secondary" size="sm" onClick={() => { setType(null); setStatus(null) }}>Clear filters</Button> : undefined}
          />
        </Card>
      ) : (
        <>
          {groups.map(([day, items]) => (
            <section key={day}>
              <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-[0.08em] text-ink-mute">{day}</h2>
              <Card className="p-2">
                {items.map((tx) => (
                  <TxRow key={tx.id} tx={tx} hide={hideBalances} />
                ))}
              </Card>
            </section>
          ))}
          {q.hasNextPage && (
            <Button variant="secondary" full onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
              Load more
            </Button>
          )}
        </>
      )}
    </div>
  )
}
