import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { Toaster, toast } from 'sonner'
import { cn } from '@/lib/cn'
import { Button } from './Button'

/* Badge */
type Tone = 'brand' | 'ok' | 'bad' | 'warn' | 'neutral'
const tones: Record<Tone, string> = {
  brand: 'bg-brand-50 text-brand-700',
  ok: 'bg-ok-soft text-ok',
  bad: 'bg-bad-soft text-bad',
  warn: 'bg-warn-soft text-warn',
  neutral: 'bg-canvas text-ink-soft',
}
export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold', tones[tone], className)}>{children}</span>
}

/* Skeleton */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-xl bg-brand-50', className)} aria-hidden>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/70 to-transparent" />
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-brand-500', className)} aria-label="Loading" />
}

/* Empty and error states */
export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-500">{icon ?? <Inbox className="size-6" />}</div>
      <p className="font-display text-base font-semibold text-ink">{title}</p>
      {body && <p className="mt-1 max-w-xs text-sm text-ink-mute">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry, retrying }: { message: string; onRetry?: () => void; retrying?: boolean }) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-8 text-center">
      <div className="mb-3 grid size-14 place-items-center rounded-2xl bg-bad-soft text-bad">
        <AlertTriangle className="size-6" />
      </div>
      <p className="font-display text-base font-semibold text-ink">Something went wrong</p>
      <p className="mt-1 max-w-xs text-sm text-ink-mute">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" icon={<RefreshCw className="size-4" />} onClick={onRetry} loading={retrying}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function InlineAlert({ tone = 'warn', children }: { tone?: 'warn' | 'bad' | 'brand' | 'ok'; children: ReactNode }) {
  const t = { warn: 'bg-warn-soft text-warn', bad: 'bg-bad-soft text-bad', brand: 'bg-brand-50 text-brand-700', ok: 'bg-ok-soft text-ok' }[tone]
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={cn('rounded-2xl px-4 py-3 text-sm font-medium', t)}>
      {children}
    </div>
  )
}

/* Toast */
export const notifyToast = {
  success: (m: string) => toast.success(m),
  error: (m: string) => toast.error(m),
  info: (m: string) => toast(m),
}

export function AppToaster() {
  return <Toaster position="top-center" richColors closeButton toastOptions={{ style: { borderRadius: '16px', fontFamily: 'DM Sans, sans-serif' } }} />
}
