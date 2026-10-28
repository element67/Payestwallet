import { Check, ShieldCheck, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { PASSWORD_RULES } from '../../../shared/schemas'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { describeError } from '@/lib/errors'
import { Badge, InlineAlert } from '../ui/Feedback'

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span className="grid place-items-center rounded-2xl bg-gradient-to-b from-brand-400 to-brand-600 text-white shadow-btn" style={{ width: size, height: size }}>
      <ShieldCheck style={{ width: size * 0.55, height: size * 0.55 }} />
    </span>
  )
}

export function TestnetBadge() {
  return <Badge tone="warn">Testnet</Badge>
}

export function TestnetWarning({ className }: { className?: string }) {
  return (
    <p className={cn('rounded-2xl bg-warn-soft px-4 py-2.5 text-center text-xs font-medium text-warn', className)}>
      Testnet only. Test tokens have no real value.
    </p>
  )
}

/** Tells the user up front when the Payest API cannot be reached, instead of failing on the first submit. */
function ApiStatus() {
  const q = useQuery({ queryKey: ['api-health'], queryFn: api.health, retry: 1, staleTime: 60_000, refetchOnWindowFocus: true })
  if (!q.isError) return null
  return (
    <div className="mb-4 space-y-2" role="alert">
      <InlineAlert tone="bad">{describeError(q.error)}</InlineAlert>
      <button type="button" className="text-sm font-semibold text-brand-600" onClick={() => void q.refetch()} disabled={q.isFetching}>
        {q.isFetching ? 'Checking...' : 'Check again'}
      </button>
    </div>
  )
}

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-10">
      <div className="mb-8 flex items-center gap-3">
        <Logo />
        <div>
          <p className="font-display text-lg font-bold leading-tight text-ink">Payest Wallet</p>
          <TestnetBadge />
        </div>
      </div>
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink">{title}</h1>
      {subtitle && <p className="mb-6 mt-2 text-ink-soft">{subtitle}</p>}
      <ApiStatus />
      <div className={cn('rounded-xl3 bg-white p-5 shadow-card', !subtitle && 'mt-6')}>{children}</div>
      {footer && <div className="mt-6 text-center text-sm text-ink-soft">{footer}</div>}
      <TestnetWarning className="mt-8" />
    </main>
  )
}

export function PasswordChecklist({ password }: { password: string }) {
  return (
    <ul className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2" aria-label="Password requirements">
      {PASSWORD_RULES.map((r) => {
        const ok = r.test(password)
        return (
          <li key={r.id} className={cn('flex items-center gap-1.5', ok ? 'text-ok' : 'text-ink-mute')}>
            {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
            {r.label}
          </li>
        )
      })}
    </ul>
  )
}
