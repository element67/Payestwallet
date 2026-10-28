import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Laptop, ShieldAlert, ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Card, SectionTitle } from '@/components/ui/Card'
import { Badge, EmptyState, ErrorState, Skeleton, notifyToast } from '@/components/ui/Feedback'
import { api } from '@/lib/api'
import { describeError } from '@/lib/errors'
import { dateTime, relativeTime } from '@/lib/format'

const LABELS: Record<string, { text: string; bad?: boolean }> = {
  login: { text: 'Signed in' },
  logout: { text: 'Signed out' },
  register: { text: 'Account created' },
  new_device: { text: 'New device signed in', bad: true },
  login_failed: { text: 'Failed sign-in attempt', bad: true },
  '2fa_failed': { text: 'Wrong 2FA code', bad: true },
  account_locked: { text: 'Account locked after failed attempts', bad: true },
  refresh_reuse_detected: { text: 'Reused session token blocked', bad: true },
  password_changed: { text: 'Password changed' },
  password_change_failed: { text: 'Password change failed', bad: true },
  password_reset_requested: { text: 'Password reset requested' },
  password_reset: { text: 'Password reset' },
  '2fa_enabled': { text: 'Two-factor authentication turned on' },
  '2fa_disabled': { text: 'Two-factor authentication turned off', bad: true },
  session_revoked: { text: 'Device signed out remotely' },
  wallet_created: { text: 'Wallet created on a device' },
  wallet_imported: { text: 'Wallet imported on a device' },
  pin_set: { text: 'PIN created' },
  pin_changed: { text: 'PIN changed' },
  pin_failed: { text: 'Wrong PIN entered', bad: true },
  phrase_viewed: { text: 'Recovery phrase viewed', bad: true },
  wallet_unlocked: { text: 'Wallet unlocked' },
  wallet_locked: { text: 'Wallet locked' },
}

export default function SecurityLog() {
  const qc = useQueryClient()
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.sessions(), retry: 0 })
  const events = useInfiniteQuery({
    queryKey: ['security-events'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.securityEvents(pageParam),
    getNextPageParam: (last) => (last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined),
    retry: 0,
  })

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeSession(id),
    onSuccess: () => {
      notifyToast.success('Device signed out')
      void qc.invalidateQueries({ queryKey: ['sessions'] })
      void qc.invalidateQueries({ queryKey: ['security-events'] })
    },
    onError: (e) => notifyToast.error(describeError(e)),
  })

  const rows = events.data?.pages.flatMap((p) => p.data) ?? []

  return (
    <>
      <PageHeader title="Security log" />
      <div className="space-y-5">
        <section>
          <SectionTitle>Signed-in devices</SectionTitle>
          {sessions.isLoading ? (
            <Skeleton className="h-20" />
          ) : sessions.error ? (
            <Card><ErrorState message={describeError(sessions.error)} onRetry={() => sessions.refetch()} retrying={sessions.isFetching} /></Card>
          ) : (
            <Card className="divide-y divide-canvas p-0">
              {sessions.data?.data.map((s) => (
                <div key={s.id} className="flex items-center gap-3 p-4">
                  <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600">
                    <Laptop className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-semibold text-ink">
                      {s.deviceLabel} {s.current && <Badge tone="ok">This device</Badge>}
                    </p>
                    <p className="text-xs text-ink-mute">
                      {s.ip ? `${s.ip} · ` : ''}Active {relativeTime(s.lastUsedAt)}
                    </p>
                  </div>
                  {!s.current && (
                    <Button size="sm" variant="secondary" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)}>
                      Sign out
                    </Button>
                  )}
                </div>
              ))}
            </Card>
          )}
        </section>

        <section>
          <SectionTitle>Recent activity</SectionTitle>
          {events.isLoading ? (
            <Card className="space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></Card>
          ) : events.error ? (
            <Card><ErrorState message={describeError(events.error)} onRetry={() => events.refetch()} retrying={events.isFetching} /></Card>
          ) : rows.length === 0 ? (
            <Card><EmptyState icon={<ShieldCheck className="size-6" />} title="Nothing here yet" /></Card>
          ) : (
            <>
              <Card className="divide-y divide-canvas p-0">
                {rows.map((e) => {
                  const meta = LABELS[e.type] ?? { text: e.type.replace(/_/g, ' ') }
                  return (
                    <div key={e.id} className="flex items-start gap-3 p-4">
                      <span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl ${meta.bad ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}>
                        {meta.bad ? <ShieldAlert className="size-4" /> : <ShieldCheck className="size-4" />}
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">{meta.text}</p>
                        <p className="text-xs text-ink-mute">
                          {e.deviceLabel ?? 'Unknown device'}
                          {e.ip ? ` · ${e.ip}` : ''}
                        </p>
                        <p className="text-xs text-ink-mute">{dateTime(e.createdAt)}</p>
                      </div>
                    </div>
                  )
                })}
              </Card>
              {events.hasNextPage && (
                <Button className="mt-3" variant="secondary" full onClick={() => events.fetchNextPage()} loading={events.isFetchingNextPage}>
                  Load more
                </Button>
              )}
            </>
          )}
        </section>
      </div>
    </>
  )
}
