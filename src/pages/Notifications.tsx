import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Bell, CheckCheck, LogIn, Network, ShieldAlert, XCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { NotificationDto, NotificationType } from '../../shared/schemas'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState, Skeleton, notifyToast } from '@/components/ui/Feedback'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { describeError } from '@/lib/errors'
import { relativeTime } from '@/lib/format'

const ICONS: Record<NotificationType, { icon: typeof Bell; tint: string }> = {
  sent: { icon: ArrowUpRight, tint: 'bg-brand-50 text-brand-600' },
  received: { icon: ArrowDownLeft, tint: 'bg-ok-soft text-ok' },
  failed: { icon: XCircle, tint: 'bg-bad-soft text-bad' },
  security: { icon: ShieldAlert, tint: 'bg-warn-soft text-warn' },
  login: { icon: LogIn, tint: 'bg-canvas text-ink-soft' },
  swap: { icon: ArrowLeftRight, tint: 'bg-brand-50 text-brand-600' },
  bridge: { icon: Network, tint: 'bg-brand-50 text-brand-600' },
}

export default function Notifications() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const q = useInfiniteQuery({
    queryKey: ['notifications', 'list'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.notifications({ page: pageParam, pageSize: 20 }),
    getNextPageParam: (last) => (last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined),
    retry: 0,
    refetchInterval: 20_000,
  })

  const markCache = (id: string) => {
    qc.setQueriesData<{ pages: Awaited<ReturnType<typeof api.notifications>>[]; pageParams: unknown[] }>(
      { queryKey: ['notifications', 'list'] },
      (old) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map((pg) => ({
            ...pg,
            unreadCount: id === 'all' ? 0 : Math.max(0, pg.unreadCount - (pg.data.some((n) => n.id === id && !n.read) ? 1 : 0)),
            data: pg.data.map((n) => (id === 'all' || n.id === id ? { ...n, read: true } : n)),
          })),
        }
      },
    )
    if (id === 'all') qc.setQueriesData({ queryKey: ['notifications', 'unread'] }, 0)
  }
  const refreshCounts = () => qc.invalidateQueries({ queryKey: ['notifications'] })
  const readOne = useMutation({
    mutationFn: (id: string) => api.markRead(id),
    onMutate: (id) => markCache(id),
    onSettled: refreshCounts,
  })
  const readAll = useMutation({
    mutationFn: () => api.markAllRead(),
    onMutate: () => markCache('all'),
    onSettled: refreshCounts,
    onError: (e) => notifyToast.error(describeError(e)),
  })

  const items = q.data?.pages.flatMap((p) => p.data) ?? []
  const unread = q.data?.pages[0]?.unreadCount ?? 0

  const open = (n: NotificationDto) => {
    if (!n.read && !readOne.isPending) readOne.mutate(n.id)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">Notifications</h1>
        {unread > 0 && (
          <Button variant="ghost" size="sm" icon={<CheckCheck className="size-4" />} onClick={() => readAll.mutate()} loading={readAll.isPending}>
            Mark all read
          </Button>
        )}
      </div>

      {q.isLoading ? (
        <Card className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></Card>
      ) : q.error ? (
        <Card><ErrorState message={describeError(q.error)} onRetry={() => q.refetch()} retrying={q.isFetching} /></Card>
      ) : items.length === 0 ? (
        <Card><EmptyState icon={<Bell className="size-6" />} title="You are all caught up" body="Payments, security alerts and sign-ins will appear here." /></Card>
      ) : (
        <>
          <Card className="p-2">
            <ul>
              {items.map((n) => {
                const m = ICONS[n.type] ?? ICONS.login
                const Icon = m.icon
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => {
                        open(n)
                        if (n.txHash) void nav('/activity')
                      }}
                      className={cn('flex min-h-[68px] w-full items-start gap-3 rounded-2xl p-3 text-left hover:bg-canvas', !n.read && 'bg-brand-50/60')}
                    >
                      <span className={cn('mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl', m.tint)}>
                        <Icon className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-semibold text-ink">{n.title}</span>
                          {!n.read && <span className="size-2 shrink-0 rounded-full bg-brand-500" aria-label="Unread" />}
                        </span>
                        <span className="block text-sm text-ink-soft">{n.body}</span>
                        <span className="mt-0.5 block text-xs text-ink-mute">{relativeTime(n.createdAt)}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </Card>
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
